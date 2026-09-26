#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanOpenFoamSources } from './openfoam-source-scanner.mjs';
import { resolveOpenFoamRoot } from './openfoam-source-root.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const openfoamRoot = resolveOpenFoamRoot(projectRoot);
const openfoamRootLabel = toPosix(path.relative(projectRoot, openfoamRoot));
const tutorialRoot = path.join(openfoamRoot, 'tutorials');
const outputRoot = path.join(projectRoot, 'data', 'keywords');
const MAX_TEXT_FILE_SIZE = 4 * 1024 * 1024;

const ZERO_DIR_RE = /^0(?:\.(?:orig|org))?$/;
const MESH_DATA_FILES = new Set(['points', 'faces', 'owner', 'neighbour', 'cells']);
const DYNAMIC_CONTAINERS = new Map([
  ['boundaryField', 'patch'],
  ['solvers', 'solver'],
  ['functions', 'function'],
  ['fieldFunctions', 'function'],
  ['regions', 'region'],
  ['zones', 'zone'],
  ['residualControl', 'field'],
  ['fields', 'field'],
]);
const SHELL_CONTROL_WORDS = new Set([
  'if', 'then', 'elif', 'else', 'fi', 'for', 'while', 'until', 'do', 'done',
  'case', 'esac', 'function', 'time',
]);

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function compareText(a, b) {
  return a.localeCompare(b, 'en');
}

function walkFiles(root) {
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
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  visit(root);
  return files;
}

function classify(relativePath) {
  const parts = relativePath.split('/');
  const fileName = parts.at(-1);

  if (fileName === 'Allrun' || fileName === 'Allclean') {
    return { category: 'scripts', fileKey: fileName };
  }

  const zeroIndex = parts.findIndex((part) => ZERO_DIR_RE.test(part));
  if (zeroIndex !== -1) {
    return {
      category: '0',
      fileKey: parts.slice(zeroIndex + 1).join('/') || '0',
    };
  }

  const constantIndex = parts.indexOf('constant');
  if (constantIndex !== -1) {
    return {
      category: 'constant',
      fileKey: parts.slice(constantIndex + 1).join('/') || 'constant',
    };
  }

  const systemIndex = parts.indexOf('system');
  if (systemIndex !== -1) {
    return {
      category: 'system',
      fileKey: parts.slice(systemIndex + 1).join('/') || 'system',
    };
  }

  return null;
}

function readTextFile(fullPath) {
  const stat = fs.statSync(fullPath);
  if (stat.size === 0 || stat.size > MAX_TEXT_FILE_SIZE) {
    return null;
  }

  const buffer = fs.readFileSync(fullPath);
  if (buffer.includes(0)) {
    return null;
  }

  return buffer.toString('utf8');
}

function isWhitespace(char) {
  return char === ' ' || char === '\t' || char === '\r' || char === '\n';
}

function tokenize(text) {
  const tokens = [];
  let index = 0;
  let line = 1;

  while (index < text.length) {
    const char = text[index];

    if (char === '\n') {
      line += 1;
      index += 1;
      continue;
    }
    if (isWhitespace(char)) {
      index += 1;
      continue;
    }

    if (char === '/' && text[index + 1] === '/') {
      index += 2;
      while (index < text.length && text[index] !== '\n') {
        index += 1;
      }
      continue;
    }

    if (char === '/' && text[index + 1] === '*') {
      index += 2;
      while (index < text.length) {
        if (text[index] === '\n') {
          line += 1;
        }
        if (text[index] === '*' && text[index + 1] === '/') {
          index += 2;
          break;
        }
        index += 1;
      }
      continue;
    }

    if (char === '"') {
      const tokenLine = line;
      index += 1;
      let value = '';
      while (index < text.length) {
        if (text[index] === '\\' && index + 1 < text.length) {
          value += text[index + 1];
          index += 2;
          continue;
        }
        if (text[index] === '"') {
          index += 1;
          break;
        }
        if (text[index] === '\n') {
          line += 1;
        }
        value += text[index];
        index += 1;
      }
      tokens.push({ type: 'string', value, line: tokenLine });
      continue;
    }

    if ('{}();[]'.includes(char)) {
      tokens.push({ type: 'punct', value: char, line });
      index += 1;
      continue;
    }

    if (char === '#' && text[index + 1] === '{') {
      const tokenLine = line;
      index += 2;
      let value = '#{';
      while (index < text.length) {
        if (text[index] === '\n') {
          line += 1;
        }
        if (text[index] === '#' && text[index + 1] === '}') {
          value += '#}';
          index += 2;
          break;
        }
        value += text[index];
        index += 1;
      }
      tokens.push({ type: 'string', value, line: tokenLine });
      continue;
    }

    if (char === '#') {
      const tokenLine = line;
      let value = '#';
      index += 1;
      while (index < text.length && !isWhitespace(text[index]) && !'{}();[]'.includes(text[index])) {
        value += text[index];
        index += 1;
      }
      tokens.push({ type: 'word', value, line: tokenLine });
      continue;
    }

    const tokenLine = line;
    let value = '';
    while (index < text.length) {
      const current = text[index];
      if (isWhitespace(current) || '{}();[]"'.includes(current)) {
        break;
      }
      if (current === '/' && (text[index + 1] === '/' || text[index + 1] === '*')) {
        break;
      }
      value += current;
      index += 1;
    }

    if (value.length > 0) {
      tokens.push({ type: 'word', value, line: tokenLine });
    }
  }

  return tokens;
}

function normalizeContext(context) {
  const normalized = [...context];

  for (let index = 0; index < normalized.length - 1; index += 1) {
    const placeholder = DYNAMIC_CONTAINERS.get(normalized[index]);
    if (placeholder && !normalized[index + 1].startsWith('{')) {
      normalized[index + 1] = `{${placeholder}}`;
    }
  }

  return normalized;
}

function makeRecord(keyword, context, kind, value, line) {
  const normalizedContext = normalizeContext(context);
  const dynamicParent = context.at(-1);
  const placeholderName = DYNAMIC_CONTAINERS.get(dynamicParent);

  if (placeholderName) {
    const pathParts = [...normalizedContext, `{${placeholderName}}`];
    return {
      keyword,
      context: normalizedContext.join('/'),
      path: pathParts.join('/'),
      kind,
      value: null,
      line,
    };
  }

  return {
    keyword,
    context: normalizedContext.join('/'),
    path: [...normalizedContext, keyword].join('/'),
    kind,
    value,
    line,
  };
}

function simpleValue(tokens) {
  if (tokens.length === 0 || tokens.length > 4) {
    return null;
  }

  const text = tokens
    .map((token) => token.type === 'string' ? `"${token.value}"` : token.value)
    .join(' ');

  if (text.length > 100 || /[()[\]$#]/.test(text)) {
    return null;
  }
  if (/^[+-]?(?:\d|\.\d)/.test(text)) {
    return null;
  }

  return text;
}

function parseDictionary(text) {
  const tokens = tokenize(text);
  const records = [];

  function addRecord(keyword, context, kind, value, line) {
    records.push(makeRecord(keyword, context, kind, value, line));
  }

  function findSemicolon(start) {
    let depth = 0;

    for (let index = start; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token.value === '(' || token.value === '[') {
        depth += 1;
        continue;
      }
      if (token.value === ')' || token.value === ']') {
        depth = Math.max(0, depth - 1);
        continue;
      }
      if (depth === 0 && token.value === ';') {
        return index;
      }
      if (depth === 0 && (token.value === '{' || token.value === '}')) {
        return -1;
      }
    }

    return -1;
  }

  function parseLevel(start, end, context) {
    let index = start;

    while (index < end) {
      const token = tokens[index];
      if (!token || token.value === '}') {
        return index + 1;
      }
      if (token.type === 'punct') {
        index += 1;
        continue;
      }

      if (token.value.startsWith('#')) {
        addRecord(token.value, context, 'directive', null, token.line);
        const directiveLine = token.line;
        index += 1;
        while (index < end && tokens[index].line === directiveLine) {
          index += 1;
        }
        continue;
      }

      if (token.value.startsWith('$')) {
        index += 1;
        continue;
      }

      const next = tokens[index + 1];
      if (next && next.value === '{') {
        addRecord(token.value, context, 'subdict', null, token.line);
        index = parseLevel(index + 2, end, [...context, token.value]);
        continue;
      }

      const semicolonIndex = findSemicolon(index + 1);
      if (semicolonIndex !== -1) {
        const valueTokens = tokens.slice(index + 1, semicolonIndex);
        addRecord(token.value, context, 'entry', simpleValue(valueTokens), token.line);
        index = semicolonIndex + 1;
        continue;
      }

      // A valid OpenFOAM dictionary entry ends with ';' or opens a subdict with
      // '{'. Everything else is raw field/mesh data and must not be parsed as
      // dictionary keys. Stop this level instead of rescanning the data.
      break;
    }

    return end;
  }

  parseLevel(0, tokens.length, []);
  return records;
}

function stripShellComment(line) {
  let singleQuoted = false;
  let doubleQuoted = false;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === "'" && !doubleQuoted) {
      singleQuoted = !singleQuoted;
      continue;
    }
    if (char === '"' && !singleQuoted) {
      doubleQuoted = !doubleQuoted;
      continue;
    }
    if (char === '#' && !singleQuoted && !doubleQuoted) {
      return line.slice(0, index);
    }
  }

  return line;
}

function firstShellCommand(segment) {
  let value = segment.trim();
  value = value.replace(/^(?:if|then|elif|else|while|until|do|for)\s+/, '');
  value = value.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)+/, '');

  if (value.length === 0 || value.startsWith('#')) {
    return null;
  }

  const match = value.match(/^([^\s=]+)/);
  if (!match) {
    return null;
  }

  const command = match[1];
  if (SHELL_CONTROL_WORDS.has(command)) {
    return null;
  }
  if (!/^[A-Za-z_.][A-Za-z0-9_.-]*$/.test(command) && command !== '[') {
    return null;
  }
  return command;
}

function shellWords(value) {
  return value.match(/"(?:[^"\\]|\\.)*"|'(?:[^']*)'|[^\s]+/g) || [];
}

function runUtility(value) {
  const match = value.match(/\b(?:runApplication|runParallel)\b(.*)$/);
  if (!match) {
    return null;
  }

  const words = shellWords(match[1].trim());
  let index = 0;
  while (index < words.length && words[index].startsWith('-')) {
    const option = words[index];
    index += 1;
    if (option === '-s' && index < words.length) {
      index += 1;
    }
  }

  const utility = words[index];
  if (!utility || utility.startsWith('$') || utility.startsWith('(')) {
    return null;
  }
  return path.basename(utility.replace(/[;)]$/, ''));
}

function parseShell(text) {
  const commands = new Map();
  const helpers = new Map();
  const utilities = new Map();
  const variables = new Map();

  function count(map, value) {
    if (!value) {
      return;
    }
    map.set(value, (map.get(value) || 0) + 1);
  }

  const logicalText = text.replace(/\\\r?\n\s*/g, ' ');
  for (const rawLine of logicalText.split(/\r?\n/)) {
    const line = stripShellComment(rawLine).trim();
    if (line.length === 0) {
      continue;
    }

    for (const segment of line.split(/(?:&&|\|\||;|\|)/)) {
      const command = firstShellCommand(segment);
      if (command) {
        count(commands, path.basename(command));
      }

      if (/\b(?:runApplication|runParallel)\b/.test(segment)) {
        count(utilities, runUtility(segment));
      }
    }

    for (const match of line.matchAll(/\b(runApplication|runParallel|restore\w+|clean\w+|foam\w+|getApplication)\b/g)) {
      count(helpers, match[1]);
    }

    for (const match of line.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g)) {
      count(variables, match[1]);
    }
  }

  return { commands, helpers, utilities, variables };
}

function createFileModel() {
  return {
    sourceFiles: new Set(),
    sourceEvidenceFiles: new Set(),
    occurrences: 0,
    sourceOccurrences: 0,
    entries: new Map(),
  };
}

function addEntryRecord(fileModel, relativePath, record) {
  const key = record.path;
  let entry = fileModel.entries.get(key);

  if (!entry) {
    entry = {
      keyword: record.keyword,
      context: record.context,
      path: record.path,
      kinds: new Set(),
      occurrences: 0,
      fileCount: 0,
      lastFile: null,
      values: new Map(),
      examples: [],
      sourceOccurrences: 0,
      sourceTypes: new Set(),
      sourceLocations: [],
    };
    fileModel.entries.set(key, entry);
  }

  entry.kinds.add(record.kind);
  entry.occurrences += 1;
  if (entry.lastFile !== relativePath) {
    entry.fileCount += 1;
    entry.lastFile = relativePath;
  }
  if (record.value) {
    entry.values.set(record.value, (entry.values.get(record.value) || 0) + 1);
  }
  if (!record.source && entry.examples.length < 5 && !entry.examples.includes(relativePath)) {
    entry.examples.push(relativePath);
  }
  if (record.source) {
    entry.sourceOccurrences += 1;
    fileModel.sourceOccurrences += 1;
    fileModel.sourceEvidenceFiles.add(relativePath);
    if (record.sourceType) {
      entry.sourceTypes.add(record.sourceType);
    }
    if (record.sourceLocation && entry.sourceLocations.length < 5) {
      entry.sourceLocations.push(record.sourceLocation);
    }
  }
}

function serializeFileModel(fileModel) {
  const entries = [];

  for (const [key, entry] of [...fileModel.entries.entries()].sort(([a], [b]) => compareText(a, b))) {
    entries.push({
      key,
      keyword: entry.keyword,
      context: entry.context,
      path: entry.path,
      kinds: [...entry.kinds].sort(compareText),
      occurrences: entry.occurrences,
      fileCount: entry.fileCount,
      sourceOccurrences: entry.sourceOccurrences,
      sourceTypes: [...entry.sourceTypes].sort(compareText),
      sourceLocations: entry.sourceLocations,
      values: [...entry.values.entries()]
        .sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))
        .slice(0, 100)
        .map(([value, occurrences]) => ({ value, occurrences })),
      examples: entry.examples,
    });
  }

  return {
    sourceFileCount: fileModel.sourceFiles.size,
    sourceEvidenceFileCount: fileModel.sourceEvidenceFiles.size,
    occurrences: fileModel.occurrences,
    sourceOccurrences: fileModel.sourceOccurrences,
    entries,
  };
}

function serializeCountMap(map, limit = 200) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))
    .slice(0, limit)
    .map(([name, occurrences]) => ({ name, occurrences }));
}

function resetOutputRoot() {
  const expectedRoot = path.resolve(projectRoot, 'data', 'keywords');
  if (path.resolve(outputRoot) !== expectedRoot || !expectedRoot.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error(`Refusing to reset unexpected output directory: ${outputRoot}`);
  }

  fs.rmSync(expectedRoot, { recursive: true, force: true });
  fs.mkdirSync(expectedRoot, { recursive: true });
}

function rawOutputPathFor(category, fileKey) {
  const segments = fileKey.split('/').filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`Invalid file key: ${fileKey}`);
  }

  const categoryRoot = path.resolve(outputRoot, category);
  const outputPath = `${path.resolve(categoryRoot, ...segments)}.json`;
  if (!outputPath.startsWith(`${categoryRoot}${path.sep}`)) {
    throw new Error(`Refusing to write outside category directory: ${outputPath}`);
  }
  return outputPath;
}

function shortHash(value) {
  return createHash('sha1').update(value).digest('hex').slice(0, 8);
}

function createOutputPlans(category, fileKeys) {
  const entries = fileKeys.map((fileKey) => ({
    fileKey,
    outputPath: rawOutputPathFor(category, fileKey),
  }));
  const groups = new Map();

  for (const entry of entries) {
    const collisionKey = entry.outputPath.toLowerCase();
    const group = groups.get(collisionKey) || [];
    group.push(entry);
    groups.set(collisionKey, group);
  }

  const plans = new Map();
  const usedPaths = new Set();

  for (const group of groups.values()) {
    for (const entry of group) {
      let outputPath = entry.outputPath;
      if (group.length > 1) {
        outputPath = path.join(
          path.dirname(outputPath),
          `.case-${shortHash(entry.fileKey)}`,
          path.basename(outputPath),
        );
      }

      const sourceFileName = entry.fileKey.split('/').at(-1);
      if (path.basename(outputPath) !== `${sourceFileName}.json`) {
        throw new Error(`Output basename case changed for ${entry.fileKey}: ${outputPath}`);
      }

      const collisionKey = outputPath.toLowerCase();
      if (usedPaths.has(collisionKey)) {
        throw new Error(`Output path collision: ${outputPath}`);
      }
      usedPaths.add(collisionKey);
      plans.set(entry.fileKey, outputPath);
    }
  }

  return plans;
}

function writeJson(outputPath, value) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const MODEL_SELECTOR_KEYWORDS = new Set([
  'application',
  'dynamicFvMesh',
  'method',
  'mixture',
  'solver',
  'thermo',
  'transport',
  'type',
]);

function isTypeSelectorEntry(entry) {
  if (MODEL_SELECTOR_KEYWORDS.has(entry.keyword)) {
    return true;
  }
  return /(?:Model|model|Solver|solver|Scheme|scheme|Type|type)$/.test(entry.keyword);
}

function existingFileKeyByBasename(categoryFiles, basename) {
  for (const category of ['system', 'constant', '0']) {
    for (const fileKey of categoryFiles[category].keys()) {
      if (fileKey === basename || fileKey.split('/').at(-1) === basename) {
        return { category, fileKey };
      }
    }
  }
  return null;
}

function inferEtcTargets(relativePath, categoryFiles) {
  const posixPath = toPosix(relativePath);
  const lowerPath = posixPath.toLowerCase();
  const basename = posixPath.split('/').at(-1);

  const templateMatch = posixPath.match(/\/templates\/[^/]+\/(0(?:\.(?:orig|org))?|constant|system)\/(.+)$/);
  if (templateMatch) {
    const category = ZERO_DIR_RE.test(templateMatch[1]) ? '0' : templateMatch[1];
    return [{ category, fileKey: templateMatch[2], context: '' }];
  }

  if (lowerPath.includes('/casedicts/postprocessing/')) {
    return [{ category: 'system', fileKey: 'controlDict', context: 'functions/{function}' }];
  }
  if (lowerPath.includes('/casedicts/general/fvsolution/')) {
    return [{ category: 'system', fileKey: 'fvSolution', context: '' }];
  }
  if (lowerPath.includes('/casedicts/general/fvoptions/')) {
    return [{ category: 'constant', fileKey: 'fvOptions', context: '' }];
  }
  if (lowerPath.includes('/createzerodirectorytemplates/models/turbulence/')) {
    return [{
      category: 'constant',
      fileKey: 'turbulenceProperties',
      context: `${basename}Coeffs`,
    }];
  }
  // The basename check already covers etc/controlDict, so no corpus directory
  // name needs to be hard-coded here.
  if (basename === 'controlDict') {
    return [{ category: 'system', fileKey: 'controlDict', context: '' }];
  }

  const existing = existingFileKeyByBasename(categoryFiles, basename);
  if (existing) {
    return [{ ...existing, context: '' }];
  }

  if (basename.endsWith('Dict')) {
    return [{ category: 'system', fileKey: basename, context: '' }];
  }
  if (basename.endsWith('Properties')) {
    return [{ category: 'constant', fileKey: basename, context: '' }];
  }

  return [];
}

function supplementFromEtc(categoryFiles) {
  const etcRoot = path.join(openfoamRoot, 'etc');
  const stats = {
    sourceRoot: `${openfoamRootLabel}/etc`,
    scannedFiles: 0,
    classifiedFiles: 0,
    skippedFiles: 0,
    addedCallCount: 0,
    addedKeywordCount: 0,
    targetFileCount: 0,
  };
  const addedKeywords = new Set();
  const targetFiles = new Set();

  if (!fs.existsSync(etcRoot)) {
    return stats;
  }

  for (const fullPath of walkFiles(etcRoot)) {
    const relativePath = toPosix(path.relative(projectRoot, fullPath));
    const lowerPath = relativePath.toLowerCase();
    if (
      lowerPath.includes('/codetemplates/')
      || lowerPath.includes('/thermodata/')
      || lowerPath.includes('/config.')
      || lowerPath.endsWith('/allrun')
      || lowerPath.endsWith('/allclean')
      || lowerPath.endsWith('/readme')
      || lowerPath.endsWith('/.gitignore')
    ) {
      stats.skippedFiles += 1;
      continue;
    }

    const text = readTextFile(fullPath);
    if (text === null) {
      stats.skippedFiles += 1;
      continue;
    }

    const records = parseDictionary(text).filter((record) => !record.context.startsWith('FoamFile'));
    if (records.length === 0) {
      stats.skippedFiles += 1;
      continue;
    }

    const targets = inferEtcTargets(relativePath, categoryFiles);
    if (targets.length === 0) {
      stats.skippedFiles += 1;
      continue;
    }

    stats.scannedFiles += 1;
    stats.classifiedFiles += 1;

    for (const target of targets) {
      let model = categoryFiles[target.category].get(target.fileKey);
      if (!model) {
        model = createFileModel();
        categoryFiles[target.category].set(target.fileKey, model);
      }

      for (const record of records) {
        const contextParts = [];
        if (target.context) {
          contextParts.push(target.context);
        }
        if (record.context) {
          contextParts.push(record.context);
        }
        const context = contextParts.filter(Boolean).join('/');
        const fullRecordPath = context ? `${context}/${record.keyword}` : record.keyword;
        addEntryRecord(model, relativePath, {
          ...record,
          context,
          path: fullRecordPath,
          source: true,
          sourceType: 'etc',
          sourceLocation: `${relativePath}:${record.line}`,
        });
        stats.addedCallCount += 1;
        addedKeywords.add(record.keyword);
        targetFiles.add(`${target.category}/${target.fileKey}`);
      }
    }
  }

  stats.addedKeywordCount = addedKeywords.size;
  stats.targetFileCount = targetFiles.size;
  return stats;
}

function buildTypeUsageIndex(categoryFiles) {
  const index = new Map();

  for (const category of ['0', 'constant', 'system']) {
    for (const [fileKey, model] of categoryFiles[category]) {
      for (const entry of model.entries.values()) {
        if (!isTypeSelectorEntry(entry)) {
          continue;
        }
        for (const value of entry.values.keys()) {
          const usages = index.get(value) || [];
          usages.push({ category, fileKey, entry });
          index.set(value, usages);
        }
      }
    }
  }

  return index;
}

const SOURCE_PATH_TARGET_RULES = [
  { fragment: '/mesh/blockmesh/', category: 'system', fileKey: 'blockMeshDict' },
  { fragment: '/mesh/generation/blockmesh/', category: 'system', fileKey: 'blockMeshDict' },
  { fragment: '/mesh/snappyhexmesh/', category: 'system', fileKey: 'snappyHexMeshDict' },
  { fragment: '/mesh/generation/snappyhexmesh/', category: 'system', fileKey: 'snappyHexMeshDict' },
  { fragment: '/mesh/manipulation/setfields/', category: 'system', fileKey: 'setFieldsDict' },
  { fragment: '/preprocessing/setfields/', category: 'system', fileKey: 'setFieldsDict' },
  { fragment: '/mesh/manipulation/toposet/', category: 'system', fileKey: 'topoSetDict' },
  { fragment: '/meshtools/toposet/', category: 'system', fileKey: 'topoSetDict' },
  { fragment: '/mesh/manipulation/createpatch/', category: 'system', fileKey: 'createPatchDict' },
  { fragment: '/mesh/manipulation/refinemesh/', category: 'system', fileKey: 'refineMeshDict' },
  { fragment: '/mesh/manipulation/extrudemesh/', category: 'system', fileKey: 'extrudeMeshDict' },
  { fragment: '/mesh/manipulation/changedictionary/', category: 'system', fileKey: 'changeDictionaryDict' },
  { fragment: '/mesh/manipulation/mapfields/', category: 'system', fileKey: 'mapFieldsDict' },
  { fragment: '/mesh/manipulation/renumbermesh/', category: 'system', fileKey: 'renumberMeshDict' },
  { fragment: '/surfacefeatureextract/', category: 'system', fileKey: 'surfaceFeatureExtractDict' },
  { fragment: '/parallel/decompose/decomposepar/', category: 'system', fileKey: 'decomposeParDict' },
  { fragment: '/parallelprocessing/decomposepar/', category: 'system', fileKey: 'decomposeParDict' },
  { fragment: '/parallel/decompose/decompositionmethods/', category: 'system', fileKey: 'decomposeParDict' },
];

function inferSourcePathTargets(sourcePath, record) {
  const lowerPath = sourcePath.toLowerCase();
  const rule = SOURCE_PATH_TARGET_RULES.find((item) => lowerPath.includes(item.fragment));
  if (!rule) {
    return [];
  }

  const typeName = record.typeNames.length === 1 ? record.typeNames[0] : '';
  return [{
    category: rule.category,
    fileKey: rule.fileKey,
    context: typeName ? `${typeName}Coeffs` : '',
  }];
}

function sourcePathAllowsUsage(sourcePath, usage) {
  const lowerPath = sourcePath.toLowerCase();

  if (lowerPath.includes('/fvoptions/')) {
    return usage.fileKey === 'fvOptions';
  }
  if (lowerPath.includes('/functionobjects/')) {
    return usage.category === 'system' && usage.fileKey === 'controlDict';
  }
  if (
    lowerPath.includes('/finitevolume/fields/fvpatchfields/')
    || lowerPath.includes('/derivedfvpatchfields/')
  ) {
    return usage.category === '0';
  }
  if (
    lowerPath.includes('/matrices/ldumatrix/solvers/')
    || lowerPath.includes('/matrices/solvers/')
    || lowerPath.includes('/solutioncontrol/')
  ) {
    return usage.fileKey === 'fvSolution';
  }

  return true;
}

function inferSourceTargetContext(usage, typeName) {
  const entry = usage.entry;
  const contextParts = entry.context ? entry.context.split('/').filter(Boolean) : [];
  const context = normalizeContext(contextParts).join('/');

  if (usage.category === '0' && entry.keyword === 'type') {
    return context;
  }
  if (usage.fileKey === 'fvSolution' && entry.keyword === 'solver') {
    return context || 'solvers/{solver}';
  }
  if (usage.fileKey === 'controlDict' && entry.keyword === 'application') {
    return '';
  }
  if (entry.keyword === 'method') {
    return context;
  }
  if (entry.keyword === 'type') {
    return context;
  }

  return context ? `${context}/${typeName}Coeffs` : `${typeName}Coeffs`;
}

function supplementFromSourceKeywords(categoryFiles) {
  const sourceRoots = [
    path.join(openfoamRoot, 'src'),
    path.join(openfoamRoot, 'applications'),
  ];
  const scan = scanOpenFoamSources(sourceRoots);
  const typeUsageIndex = buildTypeUsageIndex(categoryFiles);
  const mappedKeywords = new Set();
  const unmappedKeywords = new Set();
  const sourceTargets = new Set();
  let mappedCallCount = 0;

  for (const record of scan.records) {
    const sourcePath = toPosix(path.relative(projectRoot, record.source));
    const sourceLocation = `${sourcePath}:${record.line}`;
    const targetKeys = new Set();

    for (const typeName of record.typeNames) {
      const usages = typeUsageIndex.get(typeName) || [];
      for (const usage of usages) {
        if (!sourcePathAllowsUsage(sourcePath, usage)) {
          continue;
        }
        const context = inferSourceTargetContext(usage, typeName);
        const targetKey = `${usage.category}|${usage.fileKey}|${context}|${record.keyword}`;
        if (targetKeys.has(targetKey)) {
          continue;
        }
        targetKeys.add(targetKey);

        const model = categoryFiles[usage.category].get(usage.fileKey);
        if (!model) {
          continue;
        }

        addEntryRecord(model, sourcePath, {
          keyword: record.keyword,
          context,
          path: context ? `${context}/${record.keyword}` : record.keyword,
          kind: record.method.includes('SubDict') ? 'subdict' : 'entry',
          value: null,
          line: record.line,
          source: true,
          sourceType: typeName,
          sourceLocation,
        });
        mappedKeywords.add(record.keyword);
        sourceTargets.add(`${usage.category}/${usage.fileKey}`);
        mappedCallCount += 1;
      }
    }

    for (const target of inferSourcePathTargets(sourcePath, record)) {
      const targetKey = `${target.category}|${target.fileKey}|${target.context}|${record.keyword}`;
      if (targetKeys.has(targetKey)) {
        continue;
      }
      targetKeys.add(targetKey);

      let model = categoryFiles[target.category].get(target.fileKey);
      if (!model) {
        model = createFileModel();
        categoryFiles[target.category].set(target.fileKey, model);
      }

      addEntryRecord(model, sourcePath, {
        keyword: record.keyword,
        context: target.context,
        path: target.context ? `${target.context}/${record.keyword}` : record.keyword,
        kind: record.method.includes('SubDict') ? 'subdict' : 'entry',
        value: null,
        line: record.line,
        source: true,
        sourceType: record.typeNames.length === 1 ? record.typeNames[0] : 'utility',
        sourceLocation,
      });
      mappedKeywords.add(record.keyword);
      sourceTargets.add(`${target.category}/${target.fileKey}`);
      mappedCallCount += 1;
    }

    if (targetKeys.size === 0) {
      unmappedKeywords.add(record.keyword);
    }
  }

  return {
    ...scan.stats,
    sourceRoots: sourceRoots.map((root) => toPosix(path.relative(projectRoot, root))),
    mappedCallCount,
    mappedKeywordCount: mappedKeywords.size,
    unmappedKeywordCount: unmappedKeywords.size,
    targetFileCount: sourceTargets.size,
  };
}

function main() {
  if (!fs.existsSync(tutorialRoot)) {
    throw new Error(`OpenFOAM tutorial directory not found: ${tutorialRoot}`);
  }

  const categoryFiles = {
    '0': new Map(),
    constant: new Map(),
    system: new Map(),
    scripts: new Map(),
  };
  const processedFiles = { '0': 0, constant: 0, system: 0, scripts: 0 };
  const skippedFiles = { unreadable: 0, unsupported: 0 };
  let progressCounter = 0;

  for (const fullPath of walkFiles(tutorialRoot)) {
    const relativePath = toPosix(path.relative(tutorialRoot, fullPath));
    const classification = classify(relativePath);
    if (!classification) {
      continue;
    }

    const fileName = path.basename(fullPath);
    const parentName = path.basename(path.dirname(fullPath));
    if (classification.category === 'constant' && parentName === 'polyMesh' && MESH_DATA_FILES.has(fileName)) {
      skippedFiles.unsupported += 1;
      continue;
    }

    const text = readTextFile(fullPath);
    if (text === null) {
      skippedFiles.unreadable += 1;
      continue;
    }

    const { category, fileKey } = classification;
    processedFiles[category] += 1;
    progressCounter += 1;
    if (progressCounter % 1000 === 0) {
      process.stderr.write(`Processed ${progressCounter} candidate files...\n`);
    }

    if (category === 'scripts') {
      let model = categoryFiles.scripts.get(fileKey);
      if (!model) {
        model = {
          sourceFiles: new Set(),
          commands: new Map(),
          helpers: new Map(),
          utilities: new Map(),
          variables: new Map(),
        };
        categoryFiles.scripts.set(fileKey, model);
      }
      model.sourceFiles.add(relativePath);
      const parsed = parseShell(text);
      for (const [name, occurrences] of parsed.commands) {
        model.commands.set(name, (model.commands.get(name) || 0) + occurrences);
      }
      for (const [name, occurrences] of parsed.helpers) {
        model.helpers.set(name, (model.helpers.get(name) || 0) + occurrences);
      }
      for (const [name, occurrences] of parsed.utilities) {
        model.utilities.set(name, (model.utilities.get(name) || 0) + occurrences);
      }
      for (const [name, occurrences] of parsed.variables) {
        model.variables.set(name, (model.variables.get(name) || 0) + occurrences);
      }
      continue;
    }

    const records = parseDictionary(text);
    if (records.length === 0) {
      continue;
    }

    let model = categoryFiles[category].get(fileKey);
    if (!model) {
      model = createFileModel();
      categoryFiles[category].set(fileKey, model);
    }

    model.sourceFiles.add(relativePath);
    for (const record of records) {
      model.occurrences += 1;
      addEntryRecord(model, relativePath, record);
    }
  }

  const etcSupplement = supplementFromEtc(categoryFiles);
  const sourceSupplement = supplementFromSourceKeywords(categoryFiles);
  const generatedAt = new Date().toISOString();
  const manifestCategories = {};

  resetOutputRoot();

  for (const category of ['0', 'constant', 'system']) {
    const files = [];
    let entryCount = 0;
    let occurrenceCount = 0;
    const outputPlans = createOutputPlans(category, [...categoryFiles[category].keys()]);

    for (const [fileKey, model] of [...categoryFiles[category].entries()].sort(([a], [b]) => compareText(a, b))) {
      const outputPath = outputPlans.get(fileKey);
      const serialized = serializeFileModel(model);
      writeJson(outputPath, {
        generatedAt,
        source: `${openfoamRootLabel}/tutorials`,
        category,
        fileKey,
        ...serialized,
      });

      files.push({
        fileKey,
        output: toPosix(path.relative(outputRoot, outputPath)),
        sourceFileCount: serialized.sourceFileCount,
        keywordCount: serialized.entries.length,
        occurrenceCount: serialized.occurrences,
      });
      entryCount += serialized.entries.length;
      occurrenceCount += model.occurrences;
    }

    manifestCategories[category] = {
      outputDirectory: toPosix(path.join('data', 'keywords', category)),
      sourceFileCount: processedFiles[category],
      fileKeyCount: categoryFiles[category].size,
      uniqueEntryCount: entryCount,
      occurrenceCount,
      files,
    };
  }

  const scriptFiles = [];
  const scriptOutputPlans = createOutputPlans('scripts', [...categoryFiles.scripts.keys()]);
  for (const [fileKey, model] of [...categoryFiles.scripts.entries()].sort(([a], [b]) => compareText(a, b))) {
    const outputPath = scriptOutputPlans.get(fileKey);
    const serialized = {
      sourceFileCount: model.sourceFiles.size,
      commands: serializeCountMap(model.commands),
      helpers: serializeCountMap(model.helpers),
      utilities: serializeCountMap(model.utilities),
      variables: serializeCountMap(model.variables),
    };
    writeJson(outputPath, {
      generatedAt,
      source: `${openfoamRootLabel}/tutorials`,
      category: 'scripts',
      fileKey,
      ...serialized,
    });

    scriptFiles.push({
      fileKey,
      output: toPosix(path.relative(outputRoot, outputPath)),
      sourceFileCount: serialized.sourceFileCount,
      commandCount: serialized.commands.length,
      helperCount: serialized.helpers.length,
      utilityCount: serialized.utilities.length,
      variableCount: serialized.variables.length,
    });
  }

  const manifest = {
    generatedAt,
    source: `${openfoamRootLabel}/tutorials`,
    layout: 'one-json-per-source-file',
    sourceSupplement,
    etcSupplement,
    casePolicy: 'preserve-source-case',
    categories: {
      ...manifestCategories,
      scripts: {
        outputDirectory: 'data/keywords/scripts',
        sourceFileCount: processedFiles.scripts,
        fileKeyCount: categoryFiles.scripts.size,
        files: scriptFiles,
      },
    },
    skippedFiles,
  };

  writeJson(path.join(outputRoot, 'manifest.json'), manifest);

  const summary = {
    generatedAt,
    source: manifest.source,
    layout: manifest.layout,
    casePolicy: manifest.casePolicy,
    etcSupplement: {
      classifiedFiles: etcSupplement.classifiedFiles,
      addedCallCount: etcSupplement.addedCallCount,
      addedKeywordCount: etcSupplement.addedKeywordCount,
      targetFileCount: etcSupplement.targetFileCount,
    },
    sourceSupplement: {
      mappedCallCount: sourceSupplement.mappedCallCount,
      mappedKeywordCount: sourceSupplement.mappedKeywordCount,
      unmappedKeywordCount: sourceSupplement.unmappedKeywordCount,
      targetFileCount: sourceSupplement.targetFileCount,
    },
    categories: Object.fromEntries(
      Object.entries(manifest.categories).map(([category, value]) => [
        category,
        {
          outputDirectory: value.outputDirectory,
          sourceFileCount: value.sourceFileCount,
          fileKeyCount: value.fileKeyCount,
        },
      ]),
    ),
    skippedFiles,
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main();
