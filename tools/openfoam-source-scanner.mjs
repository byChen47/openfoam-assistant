'use strict';

import fs from 'node:fs';
import path from 'node:path';

const MAX_SOURCE_FILE_SIZE = 2 * 1024 * 1024;
const DICTIONARY_RECEIVER_RE = /(?:dict|coeff|config|control|solution|scheme|propert|model|option|constraint|source|thermo|transport|turbulence|cloud|region|mesh)/i;
const DICTIONARY_METHODS = new Set([
  'readEntry',
  'readIfPresent',
  'lookupOrDefault',
  'subDict',
  'optionalSubDict',
]);

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function compareText(a, b) {
  return a.localeCompare(b, 'en');
}

function walkSourceFiles(root) {
  const files = [];

  function visit(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => compareText(a.name, b.name));

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && /\.(?:C|H|Hpp|Cpp|cc|cxx)$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }

  visit(root);
  return files;
}

function stripCppComments(text) {
  let output = '';
  let index = 0;
  let state = 'normal';

  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];

    if (state === 'lineComment') {
      if (char === '\n') {
        state = 'normal';
        output += '\n';
      }
      else {
        output += ' ';
      }
      index += 1;
      continue;
    }

    if (state === 'blockComment') {
      if (char === '*' && next === '/') {
        output += '  ';
        state = 'normal';
        index += 2;
        continue;
      }
      output += char === '\n' ? '\n' : ' ';
      index += 1;
      continue;
    }

    if (state === 'string') {
      output += char;
      if (char === '\\' && index + 1 < text.length) {
        output += next;
        index += 2;
        continue;
      }
      if (char === '"') {
        state = 'normal';
      }
      index += 1;
      continue;
    }

    if (char === '/' && next === '/') {
      output += '  ';
      state = 'lineComment';
      index += 2;
      continue;
    }
    if (char === '/' && next === '*') {
      output += '  ';
      state = 'blockComment';
      index += 2;
      continue;
    }
    if (char === '"') {
      state = 'string';
    }

    output += char;
    index += 1;
  }

  return output;
}

function lineNumberAt(text, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (text[index] === '\n') {
      line += 1;
    }
  }
  return line;
}

function extractTypeNames(text) {
  const names = new Set();
  const pattern = /\b(?:TypeName|typeName)\s*\(\s*"([^"]+)"\s*\)/g;
  for (const match of text.matchAll(pattern)) {
    names.add(match[1]);
  }
  return [...names].sort(compareText);
}

function isValidDictionaryKey(keyword) {
  if (!keyword || keyword.length > 100) {
    return false;
  }
  if (/[\\/]/.test(keyword) || /\.(?:C|H)$/i.test(keyword)) {
    return false;
  }
  return /^[A-Za-z_#.$][A-Za-z0-9_.$()|*+\-]*$/.test(keyword);
}

function isDictionaryCall(receiver, method) {
  if (DICTIONARY_METHODS.has(method)) {
    return true;
  }
  if (method === 'lookup' || method.startsWith('get<')) {
    return DICTIONARY_RECEIVER_RE.test(receiver || '');
  }
  return false;
}

function extractDictionaryCalls(text) {
  const cleaned = stripCppComments(text);
  const calls = [];
  const pattern = /(?:(?:\b([A-Za-z_][A-Za-z0-9_.>\-]*))\s*\.\s*)?\b(readIfPresent|readEntry|lookupOrDefault|lookup|subDict|optionalSubDict|get(?:<[^>\n]+>)?)\s*\(\s*"([^"\n]+)"/g;

  for (const match of cleaned.matchAll(pattern)) {
    const receiver = match[1] || '';
    const method = match[2];
    const keyword = match[3];

    if (!isDictionaryCall(receiver, method) || !isValidDictionaryKey(keyword)) {
      continue;
    }

    calls.push({
      keyword,
      method,
      receiver,
      typeNames: extractTypeNames(cleaned),
      line: lineNumberAt(cleaned, match.index),
    });
  }

  return calls;
}

function scanOpenFoamSources(roots) {
  const records = [];
  const stats = {
    scannedFiles: 0,
    skippedFiles: 0,
    callCount: 0,
    typedCallCount: 0,
  };
  const sourceFiles = [];
  const typeNamesByStem = new Map();

  for (const root of roots) {
    if (!fs.existsSync(root)) {
      continue;
    }
    sourceFiles.push(...walkSourceFiles(root));
  }

  for (const fullPath of sourceFiles) {
    if (!/\.(?:H|Hpp)$/.test(fullPath)) {
      continue;
    }

    const stat = fs.statSync(fullPath);
    if (stat.size === 0 || stat.size > MAX_SOURCE_FILE_SIZE) {
      continue;
    }

    const text = fs.readFileSync(fullPath, 'utf8');
    if (text.includes('\0')) {
      continue;
    }

    const typeNames = extractTypeNames(text);
    if (typeNames.length > 0) {
      const stemKey = fullPath.replace(/\.(?:H|Hpp)$/, '');
      typeNamesByStem.set(stemKey, typeNames);
    }
  }

  for (const fullPath of sourceFiles) {
    const stat = fs.statSync(fullPath);
    if (stat.size === 0 || stat.size > MAX_SOURCE_FILE_SIZE) {
      stats.skippedFiles += 1;
      continue;
    }

    const text = fs.readFileSync(fullPath, 'utf8');
    if (text.includes('\0')) {
      stats.skippedFiles += 1;
      continue;
    }

    const calls = extractDictionaryCalls(text);
    const stemKey = fullPath.replace(/\.(?:C|H|Hpp|Cpp|cc|cxx)$/, '');
    const typeNames = [...new Set([
      ...extractTypeNames(text),
      ...(typeNamesByStem.get(stemKey) || []),
    ])].sort(compareText);
    const relativePath = toPosix(fullPath);
    stats.scannedFiles += 1;
    stats.callCount += calls.length;
    stats.typedCallCount += calls.filter((call) => typeNames.length > 0).length;

    for (const call of calls) {
      records.push({ ...call, typeNames, source: relativePath });
    }
  }

  return { records, stats };
}

export {
  extractDictionaryCalls,
  extractTypeNames,
  scanOpenFoamSources,
  stripCppComments,
};