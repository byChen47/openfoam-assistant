'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanOpenFoamSources } from './openfoam-source-scanner.mjs';
import { resolveOpenFoamRoot } from './openfoam-source-root.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const openfoamRoot = resolveOpenFoamRoot(projectRoot);
const applicationsRoot = path.join(openfoamRoot, 'applications');
const binRoot = path.join(openfoamRoot, 'bin');
const reviewRoot = path.join(projectRoot, 'data', 'source-supplements');
const applicationsOut = path.join(reviewRoot, 'applications');
const binOut = path.join(reviewRoot, 'bin');
const SHELL_CONTROL_WORDS = new Set(['if', 'then', 'elif', 'else', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'function', 'in']);
const compare = (a, b) => a.localeCompare(b, 'en');
const toPosix = (value) => value.split(path.sep).join('/');
const openfoamRootLabel = toPosix(path.relative(projectRoot, openfoamRoot));
const applicationsLabel = `${openfoamRootLabel}/applications`;
const binLabel = `${openfoamRootLabel}/bin`;

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function resetDirectory(target) {
  const expected = path.resolve(reviewRoot, path.basename(target));
  if (path.resolve(target) !== expected || !expected.startsWith(`${reviewRoot}${path.sep}`)) {
    throw new Error(`Unexpected output path: ${target}`);
  }
  fs.rmSync(expected, { recursive: true, force: true });
  fs.mkdirSync(expected, { recursive: true });
}

function walkFiles(root) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  }
  visit(root);
  return files;
}

function stripShellComment(line) {
  let single = false;
  let double = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (char === "'" && !double) { single = !single; continue; }
    if (char === '"' && !single) { double = !double; continue; }
    if (char === '#' && !single && !double) return line.slice(0, index);
  }
  return line;
}

function parseShell(text) {
  const commands = new Map();
  const functions = new Map();
  const variables = new Map();
  const options = new Map();

  const count = (map, value) => {
    if (!value) return;
    map.set(value, (map.get(value) || 0) + 1);
  };

  const logical = text.replace(/\\\r?\n\s*/g, ' ');
  for (const rawLine of logical.split(/\r?\n/)) {
    const line = stripShellComment(rawLine).trim();
    if (!line) continue;

    const functionMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(\)\s*\{/);
    if (functionMatch) count(functions, functionMatch[1]);

    for (const segment of line.split(/(?:&&|\|\||;|\|)/)) {
      const trimmed = segment.trim().replace(/^(?:if|then|elif|else|while|until|do|for)\s+/, '');
      const commandMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_.-]*)/);
      if (commandMatch && !SHELL_CONTROL_WORDS.has(commandMatch[1])) count(commands, commandMatch[1]);
    }

    for (const match of line.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g)) count(variables, match[1]);
    for (const match of line.matchAll(/(?:^|\s)(--?[A-Za-z0-9][A-Za-z0-9_-]*)/g)) count(options, match[1]);
  }

  const serialize = (map) => [...map.entries()].sort((a, b) => b[1] - a[1] || compare(a[0], b[0])).map(([name, occurrences]) => ({ name, occurrences }));
  const helpers = serialize(commands).filter((item) => /^(?:run|restore|clean|foam|getApplication)/.test(item.name));
  return { commands: serialize(commands), functions: serialize(functions), helpers, variables: serialize(variables), options: serialize(options) };
}

const REVIEW_MARKER = '## Applications Supplement';

// The Applications/Bin summary lives in the same REVIEW.md that
// build-source-review.mjs regenerates, so these sections are rebuilt here
// rather than hand-maintained - a manual edit would be silently overwritten.
function writeReviewSupplements(data) {
  const reviewPath = path.join(reviewRoot, 'REVIEW.md');
  const existing = fs.existsSync(reviewPath) ? fs.readFileSync(reviewPath, 'utf8') : '';
  const markerIndex = existing.indexOf(REVIEW_MARKER);
  const header = (markerIndex === -1 ? existing : existing.slice(0, markerIndex)).trimEnd();
  const total = (files, key) => files.reduce((sum, item) => sum + (item[key] || 0), 0);

  const sections = [
    REVIEW_MARKER, '',
    `- Source files scanned: ${data.applicationScan.scannedFiles}`,
    `- Application groups: ${data.applicationFiles.length}`,
    `- Dictionary keywords: ${data.applicationKeywordCount}`,
    `- Command-line options/arguments: ${data.applicationOptionCount}`,
    '- Output: `applications/`, one independent JSON file per application group', '',
    '## Bin Supplement', '',
    `- Shell script files: ${data.binFiles.length}`,
    `- Commands collected: ${total(data.binFiles, 'commandCount')}`,
    `- Functions collected: ${total(data.binFiles, 'functionCount')}`,
    `- Variables collected: ${total(data.binFiles, 'variableCount')}`,
    `- Options collected: ${total(data.binFiles, 'optionCount')}`,
    '- Output: `bin/`, one independent JSON file per script', '',
  ].join('\n');

  fs.writeFileSync(reviewPath, `${header}\n\n${sections}`, 'utf8');
}

function main() {
  if (!fs.existsSync(applicationsRoot) || !fs.existsSync(binRoot)) throw new Error('OpenFOAM applications or bin directory not found.');
  resetDirectory(applicationsOut);
  resetDirectory(binOut);

  const generatedAt = new Date().toISOString();
  const appScan = scanOpenFoamSources([applicationsRoot]);
  const groups = new Map();
  for (const record of appScan.records) {
    const relative = toPosix(path.relative(applicationsRoot, record.source));
    const group = path.posix.dirname(relative);
    const list = groups.get(group) || [];
    list.push({ recordType: 'dictionary', sourceFile: toPosix(path.relative(projectRoot, record.source)), line: record.line, keyword: record.keyword, method: record.method, receiver: record.receiver, typeNames: record.typeNames });
    groups.set(group, list);
  }

  const applicationFilesSet = new Set(appScan.records.map((record) => record.source));
  const optionPatterns = [
    ['option', /argList::addOption\s*\(\s*"([^"]+)"/g],
    ['boolOption', /argList::addBoolOption\s*\(\s*"([^"]+)"/g],
    ['compatOption', /argList::addCompatOption\s*\(\s*"([^"]+)"/g],
    ['argument', /argList::addArgument\s*\(\s*"([^"]+)"/g],
  ];
  for (const fullPath of applicationFilesSet) {
    const text = fs.readFileSync(fullPath, 'utf8');
    const relative = toPosix(path.relative(applicationsRoot, fullPath));
    const group = path.posix.dirname(relative);
    const list = groups.get(group) || [];
    for (const [optionType, pattern] of optionPatterns) {
      for (const match of text.matchAll(pattern)) {
        const line = text.slice(0, match.index).split('\n').length;
        list.push({ recordType: 'commandLine', optionType, keyword: match[1], sourceFile: toPosix(path.relative(projectRoot, fullPath)), line });
      }
    }
    groups.set(group, list);
  }

  const applicationFiles = [];
  for (const [group, records] of [...groups.entries()].sort(([a], [b]) => compare(a, b))) {
    const outputPath = path.join(applicationsOut, ...group.split('/')) + '.json';
    const dictionaryRecords = records.filter((record) => record.recordType === 'dictionary');
    const commandLineRecords = records.filter((record) => record.recordType === 'commandLine');
    const keywords = [...new Set(dictionaryRecords.map((record) => record.keyword))].sort(compare);
    const options = [...new Set(commandLineRecords.map((record) => `${record.optionType}|${record.keyword}`))].sort(compare).map((key) => {
      const [optionType, keyword] = key.split('|');
      return { keyword, optionType };
    });
    writeJson(outputPath, { generatedAt, sourceRoot: applicationsLabel, group, keywordCount: keywords.length, keywords, optionCount: options.length, options, records: dictionaryRecords.sort((a, b) => compare(a.keyword, b.keyword) || compare(a.sourceFile, b.sourceFile) || a.line - b.line), commandLineRecords: commandLineRecords.sort((a, b) => compare(a.keyword, b.keyword) || compare(a.sourceFile, b.sourceFile) || a.line - b.line) });
    applicationFiles.push({ group, output: toPosix(path.relative(reviewRoot, outputPath)), keywordCount: keywords.length, optionCount: options.length, recordCount: dictionaryRecords.length, commandLineCount: commandLineRecords.length });
  }
  const applicationKeywordCount = [...new Set(appScan.records.map((record) => record.keyword))].length;
  const applicationOptionCount = [...new Set([...groups.values()].flat().filter((record) => record.recordType === 'commandLine').map((record) => record.keyword))].length;
  writeJson(path.join(applicationsOut, 'manifest.json'), { generatedAt, sourceRoot: applicationsLabel, sourceScan: appScan.stats, groupCount: applicationFiles.length, keywordCount: applicationKeywordCount, optionCount: applicationOptionCount, files: applicationFiles });

  const binFiles = [];
  for (const fullPath of walkFiles(binRoot)) {
    const relative = toPosix(path.relative(binRoot, fullPath));
    const text = fs.readFileSync(fullPath, 'utf8');
    const firstLine = text.split(/\r?\n/, 1)[0];
    const isShell = firstLine.startsWith('#!') || /\.(?:sh|in)$/i.test(fullPath) || ['RunFunctions', 'CleanFunctions', 'LogFunctions', 'source-bashrc'].includes(path.basename(fullPath));
    if (!isShell) continue;
    const parsed = parseShell(text);
    const outputPath = path.join(binOut, ...relative.split('/')) + '.json';
    writeJson(outputPath, { generatedAt, sourceRoot: binLabel, file: toPosix(path.relative(projectRoot, fullPath)), shebang: firstLine, ...parsed });
    binFiles.push({ file: relative, output: toPosix(path.relative(reviewRoot, outputPath)), commandCount: parsed.commands.length, functionCount: parsed.functions.length, variableCount: parsed.variables.length, optionCount: parsed.options.length });
  }
  writeJson(path.join(binOut, 'manifest.json'), { generatedAt, sourceRoot: binLabel, fileCount: binFiles.length, files: binFiles.sort((a, b) => compare(a.file, b.file)) });

  writeReviewSupplements({
    applicationScan: appScan.stats,
    applicationFiles,
    applicationKeywordCount,
    applicationOptionCount,
    binFiles,
  });

  process.stdout.write(`${JSON.stringify({ applications: { sourceScan: appScan.stats, groupCount: applicationFiles.length }, bin: { fileCount: binFiles.length } }, null, 2)}\n`);
}

main();