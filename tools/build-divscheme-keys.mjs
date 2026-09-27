'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveOpenFoamRoot } from './openfoam-source-root.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const openfoamRoot = resolveOpenFoamRoot(projectRoot);
const outputRoot = path.join(projectRoot, 'data', 'keyword-supplements', 'fvSchemes');
const outputFile = path.join(outputRoot, 'divSchemesKeys.json');

// Scan every shipped tree that can contain an OpenFOAM case dictionary. In
// OpenFOAM distributions, tutorials and applications are not the only sources: modules,
// plugins and etc-mingw also ship fvSchemes/faSchemes examples.
const scanRootNames = ['applications', 'etc', 'etc-mingw', 'modules', 'plugins', 'tutorials'];
const scanRoots = scanRootNames
  .map((name) => path.join(openfoamRoot, name))
  .filter((root) => fs.existsSync(root));

// These concrete keys are valid OpenFOAM settings even when a particular
// source snapshot does not contain a tutorial using them. Keep common field
// combinations here so an incomplete corpus cannot silently remove them.
const MANUAL_DIV_KEYS = [
  'div(phi,U)',
  'div(rhoPhi,U)',
  'div(phi,k)',
  'div(rhoPhi,k)',
  'div(phi,epsilon)',
  'div(rhoPhi,epsilon)',
  'div(phi,omega)',
  'div(rhoPhi,omega)',
  'div(phi,nuTilda)',
  'div(phi,h)',
  'div(rhoPhi,h)',
  'div(phi,e)',
  'div(rhoPhi,e)',
  'div(phi,K)',
  'div(rhoPhi,K)',
  'div(phi,alpha)',
  'div(phirb,alpha)',
  'div(phi,Yi)',
  'div(rhoPhi,Yi)',
  'div(phi,Theta)',
  'div(rhoPhi,Theta)',
];

const compare = (a, b) => a.localeCompare(b, 'en');
const toPosix = (value) => value.split(path.sep).join('/');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const sortedUnique = (values) => [...new Set(values.filter(Boolean))].sort(compare);

function walkFiles(root) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => compare(a.name, b.name))) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  }
  visit(root);
  return files;
}

function isDictionaryFile(file) {
  const base = path.basename(file);
  if (base === 'fvSchemes' || base === 'faSchemes') return true;
  const normalized = toPosix(file);
  return base.endsWith('.cfg') && /\/etc(?:-mingw)?\//.test(normalized);
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ' ');
}

function extractDivKeys(text) {
  const keys = [];
  const pattern = /^[ \t]*div[ \t]*\(/gm;

  for (const match of text.matchAll(pattern)) {
    const start = match.index + match[0].lastIndexOf('div');
    const open = text.indexOf('(', start);
    let depth = 0;
    let close = -1;

    for (let index = open; index < text.length; index += 1) {
      const char = text[index];
      if (char === '\n' || char === '\r') break;
      if (char === '(') depth += 1;
      else if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          close = index;
          break;
        }
      }
      if (char === ';' || char === '{' || char === '}') break;
    }

    if (close < 0) continue;
    const key = text.slice(start, close + 1).replace(/\s+/g, '');
    if (!/^div\([^&]*\)$/.test(key)) continue;
    keys.push(key);
  }

  return keys;
}

const records = new Map();
for (const root of scanRoots) {
  for (const file of walkFiles(root)) {
    if (!isDictionaryFile(file)) continue;
    const stat = fs.statSync(file);
    if (stat.size === 0 || stat.size > 4 * 1024 * 1024) continue;
    const rawText = fs.readFileSync(file, 'utf8');
    if (rawText.includes('\0')) continue;
    const relativeFile = toPosix(path.relative(projectRoot, file));
    for (const key of extractDivKeys(stripComments(rawText))) {
      const item = records.get(key) || { name: key, occurrences: 0, sourceFiles: new Set() };
      item.occurrences += 1;
      item.sourceFiles.add(relativeFile);
      records.set(key, item);
    }
  }
}

const previous = fs.existsSync(outputFile) ? readJson(outputFile) : {};
const previousManual = (Array.isArray(previous.manualItems) ? previous.manualItems : [])
  .filter((item) => item && typeof item.name === 'string')
  .map((item) => item.name);
const manualNames = sortedUnique([...MANUAL_DIV_KEYS, ...previousManual]);
const generatedNames = new Set(records.keys());
const manualItems = manualNames
  .filter((name) => !generatedNames.has(name))
  .map((name) => ({ name, occurrences: 0, sourceFiles: [], manual: true }));

const generatedAt = new Date().toISOString();
const items = [...records.values()]
  .map((item) => ({
    name: item.name,
    occurrences: item.occurrences,
    sourceFiles: [...item.sourceFiles].sort(compare),
    sourceLocations: [...item.sourceFiles].sort(compare).slice(0, 20),
  }))
  .sort((a, b) => b.occurrences - a.occurrences || compare(a.name, b.name));

const totalItemCount = items.length + manualItems.length;
const supplementsManifestFile = path.join(outputRoot, '..', 'manifest.json');
if (fs.existsSync(supplementsManifestFile)) {
  const manifest = readJson(supplementsManifestFile);
  const groups = (Array.isArray(manifest.groups) ? manifest.groups : [])
    .filter((group) => group && group.group !== 'fvSchemes/divSchemesKeys');
  groups.push({
    group: 'fvSchemes/divSchemesKeys',
    output: 'fvSchemes/divSchemesKeys.json',
    itemCount: items.length,
    manualItemCount: manualItems.length,
  });
  groups.sort((a, b) => compare(a.group, b.group));
  manifest.generatedAt = generatedAt;
  manifest.groupCount = groups.length;
  manifest.itemCount = groups.reduce((sum, group) => sum + (group.itemCount || 0), 0);
  manifest.groups = groups;
  fs.writeFileSync(supplementsManifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}
fs.mkdirSync(outputRoot, { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify({
  generatedAt,
  sourceRoots: scanRoots.map((root) => toPosix(path.relative(projectRoot, root))),
  group: 'fvSchemes/divSchemesKeys',
  casePolicy: 'preserve-source-case',
  itemCount: items.length + manualItems.length,
  generatedItemCount: items.length,
  manualItemCount: manualItems.length,
  items,
  manualItems,
}, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  output: toPosix(path.relative(projectRoot, outputFile)),
  itemCount: items.length + manualItems.length,
  generatedItemCount: items.length,
  manualItemCount: manualItems.length,
}, null, 2)}\n`);