'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanOpenFoamSources } from './openfoam-source-scanner.mjs';
import { resolveOpenFoamRoot } from './openfoam-source-root.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const openfoamRoot = resolveOpenFoamRoot(projectRoot);
const sourceRoot = path.join(openfoamRoot, 'src');
const outputRoot = path.join(projectRoot, 'data', 'keyword-supplements', 'system', 'topoSet');
const compare = (a, b) => a.localeCompare(b, 'en');
const toPosix = (value) => value.split(path.sep).join('/');
const sourceLabel = `${path.basename(openfoamRoot)}/src`;
const generatedAt = new Date().toISOString();

const manualParameters = [
  'action',
  'box',
  'boxes',
  'cellSet',
  'cellSets',
  'cos',
  'curvature',
  'distance',
  'erode',
  'faceSet',
  'faceSets',
  'field',
  'file',
  'fileType',
  'flip',
  'i',
  'includeCut',
  'includeInside',
  'includeOutside',
  'innerRadius',
  'insidePoint',
  'insidePoints',
  'j',
  'k',
  'max',
  'min',
  'minDistance',
  'nErode',
  'name',
  'nearDistance',
  'nearPoint',
  'neighbours',
  'normal',
  'option',
  'origin',
  'outsidePoints',
  'patch',
  'patches',
  'point',
  'point1',
  'point2',
  'points',
  'radius',
  'scale',
  'set',
  'sets',
  'shape',
  'source',
  'sourceInfo',
  'solidBodyMotionFunction',
  'span',
  'steps',
  'surfaceName',
  'surfaceType',
  'type',
  'useSurfaceOrientation',
  'value',
  'verbose',
  'volume',
  'zone',
  'zones',
];

function readJsonIfExists(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function walkFiles(directory, extensions) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(fullPath, extensions));
    else if (entry.isFile() && extensions.some((extension) => fullPath.endsWith(extension))) files.push(fullPath);
  }
  return files;
}

function relativeSource(file) {
  return toPosix(path.relative(projectRoot, file));
}

function sourceLocationsForName(root, name, extensions = ['.C', '.H', '.Hpp', '.Cpp', '.cc', '.cxx']) {
  const locations = [];
  for (const file of walkFiles(root, extensions)) {
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes(name)) locations.push(relativeSource(file));
  }
  return locations.sort(compare);
}

function extractSetTypes() {
  const locations = new Map();
  const directory = path.join(sourceRoot, 'meshTools', 'topoSet', 'topoSets');
  for (const file of walkFiles(directory, ['.C', '.H'])) {
    const text = fs.readFileSync(file, 'utf8');
    const pattern = /addToRunTimeSelectionTable\s*\(\s*topoSet\s*,\s*([A-Za-z_]\w*)/g;
    for (const match of text.matchAll(pattern)) {
      const name = match[1];
      const current = locations.get(name) || [];
      current.push(relativeSource(file));
      locations.set(name, current);
    }
  }

  return [...locations.entries()]
    .map(([name, files]) => ({ name, sourceLocations: [...new Set(files)].sort(compare) }))
    .sort((a, b) => compare(a.name, b.name));
}

function extractEnumNames(text, marker) {
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return [];
  const open = text.indexOf('{', markerIndex);
  if (open < 0) return [];

  let depth = 0;
  let close = -1;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    else if (text[index] === '}' && --depth === 0) {
      close = index + 1;
      break;
    }
  }

  if (close < 0) return [];
  return [...text.slice(open, close).matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function extractActions() {
  const file = path.join(sourceRoot, 'meshTools', 'topoSet', 'topoSetSource', 'topoSetSource.C');
  const text = fs.readFileSync(file, 'utf8');
  const names = new Set([
    ...extractEnumNames(text, 'topoSetSource::actionNames'),
    ...extractEnumNames(text, 'topoSetSource::combineNames'),
  ]);
  return [...names].sort(compare).map((name) => ({
    name,
    sourceLocations: [relativeSource(file)],
  }));
}

function extractSourceTypes() {
  const locations = new Map();
  for (const file of walkFiles(sourceRoot, ['.C', '.H', '.Hpp', '.Cpp', '.cc', '.cxx'])) {
    const text = fs.readFileSync(file, 'utf8');
    const pattern = /addToRunTimeSelectionTable\s*\(\s*topoSetSource\s*,\s*([A-Za-z_]\w*)/g;
    for (const match of text.matchAll(pattern)) {
      const name = match[1];
      const current = locations.get(name) || [];
      current.push(relativeSource(file));
      locations.set(name, current);
    }
  }

  return [...locations.entries()]
    .map(([name, files]) => ({ name, sourceLocations: [...new Set(files)].sort(compare) }))
    .sort((a, b) => compare(a.name, b.name));
}

function extractParameters() {
  const roots = [
    path.join(sourceRoot, 'meshTools', 'topoSet'),
    path.join(sourceRoot, 'dynamicMesh', 'motionSmoother'),
    path.join(sourceRoot, 'overset', 'regionsToCell'),
  ];
  const scan = scanOpenFoamSources(roots);
  const values = new Map();

  for (const record of scan.records) {
    if (!record.keyword || record.keyword.startsWith('#')) continue;
    const current = values.get(record.keyword) || {
      name: record.keyword,
      sourceTypes: new Set(),
      sourceLocations: new Set(),
    };
    for (const typeName of record.typeNames || []) current.sourceTypes.add(typeName);
    current.sourceLocations.add(relativeSource(record.source));
    values.set(record.keyword, current);
  }

  for (const name of manualParameters) {
    const current = values.get(name) || {
      name,
      sourceTypes: new Set(),
      sourceLocations: new Set(),
    };
    values.set(name, current);
  }

  return [...values.values()]
    .map((item) => ({
      name: item.name,
      sourceTypes: [...item.sourceTypes].sort(compare),
      sourceLocations: [...item.sourceLocations].sort(compare),
    }))
    .sort((a, b) => compare(a.name, b.name));
}

function writeSupplement(file, group, items) {
  const existing = readJsonIfExists(file);
  const manualItems = Array.isArray(existing && existing.manualItems) ? existing.manualItems : [];
  writeJson(file, {
    generatedAt,
    sourceRoot: sourceLabel,
    group,
    casePolicy: 'preserve-source-case',
    itemCount: items.length,
    items,
    manualItems,
  });
  return {
    group,
    output: toPosix(path.relative(
      path.join(projectRoot, 'data', 'keyword-supplements'),
      file,
    )),
    itemCount: items.length,
    manualItemCount: manualItems.length,
  };
}

function updateSupplementsManifest(groups) {
  const manifestFile = path.join(projectRoot, 'data', 'keyword-supplements', 'manifest.json');
  if (!fs.existsSync(manifestFile)) return;

  const manifest = readJsonIfExists(manifestFile) || {};
  const groupNames = new Set(groups.map((group) => group.group));
  const mergedGroups = (Array.isArray(manifest.groups) ? manifest.groups : [])
    .filter((group) => group && !groupNames.has(group.group))
    .concat(groups)
    .sort((a, b) => compare(a.group, b.group));

  manifest.generatedAt = generatedAt;
  manifest.groupCount = mergedGroups.length;
  manifest.itemCount = mergedGroups.reduce((sum, group) => sum + (group.itemCount || 0), 0);
  manifest.groups = mergedGroups;
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

const setTypes = extractSetTypes();
const actions = extractActions();
const sources = extractSourceTypes();
const parameters = extractParameters();
const groups = [
  writeSupplement(path.join(outputRoot, 'setTypes.json'), 'system/topoSet/setTypes', setTypes),
  writeSupplement(path.join(outputRoot, 'actions.json'), 'system/topoSet/actions', actions),
  writeSupplement(path.join(outputRoot, 'sources.json'), 'system/topoSet/sources', sources),
  writeSupplement(path.join(outputRoot, 'parameters.json'), 'system/topoSet/parameters', parameters),
];
updateSupplementsManifest(groups);

process.stdout.write(JSON.stringify({
  setTypeCount: setTypes.length,
  actionCount: actions.length,
  sourceCount: sources.length,
  parameterCount: parameters.length,
}) + '\n');
