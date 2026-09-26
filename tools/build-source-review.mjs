'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractTypeNames, scanOpenFoamSources } from './openfoam-source-scanner.mjs';
import { resolveOpenFoamRoot } from './openfoam-source-root.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const openfoamRoot = resolveOpenFoamRoot(projectRoot);
const sourceRoot = path.join(openfoamRoot, 'src');
const applicationRoot = path.join(openfoamRoot, 'applications');
const keywordRoot = path.join(projectRoot, 'data', 'keywords');
const outputRoot = path.join(projectRoot, 'data', 'source-supplements');

const compare = (a, b) => a.localeCompare(b, 'en');
const toPosix = (value) => value.split(path.sep).join('/');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const openfoamRootLabel = toPosix(path.relative(projectRoot, openfoamRoot));
const sourceLabel = `${openfoamRootLabel}/src`;
const applicationLabel = `${openfoamRootLabel}/applications`;

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function resetOutput() {
  const expected = path.resolve(projectRoot, 'data', 'source-supplements');
  if (path.resolve(outputRoot) !== expected || !expected.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error(`Unexpected output path: ${outputRoot}`);
  }
  fs.rmSync(expected, { recursive: true, force: true });
  fs.mkdirSync(expected, { recursive: true });
}

function outputPath(category, fileKey) {
  return `${path.resolve(outputRoot, category, ...fileKey.split('/'))}.json`;
}

function typeNamesFor(record) {
  if (record.typeNames.length > 0) return record.typeNames;
  return [path.basename(record.source).replace(/\.[^.]+$/, '')];
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

// A selectable boundary condition is a patch-field class that registers a
// dictionary type name. The directory layout alone is not enough: the
// fvPatchFields/pointPatchFields trees also contain helper classes - mappers,
// macro headers, forward declarations and support types such as eddy or
// IntegralScaleBox - which must not be reported as boundary conditions.
//
// Every base class in the declaration is inspected, because patch fields may
// use multiple inheritance, e.g.
//     class calculatedProcessorFvPatchField
//     :
//         public processorLduInterfaceField,
//         public coupledFvPatchField<Type>
const CLASS_DECLARATION_RE = /\bclass\s+[A-Za-z_]\w*\s*:\s*([^{;]+)\{/g;
const PATCH_FIELD_BASE_RE = /^[A-Za-z_]\w*Patch\w*Field$/;
const headerTextCache = new Map();

function readHeaderText(sourcePath) {
  const headerPath = sourcePath.replace(/\.(?:C|H|Hpp|Cpp|cc|cxx)$/, '.H');
  const candidate = headerPath !== sourcePath && fs.existsSync(headerPath) ? headerPath : sourcePath;

  if (!headerTextCache.has(candidate)) {
    headerTextCache.set(candidate, fs.existsSync(candidate) ? fs.readFileSync(candidate, 'utf8') : '');
  }

  return headerTextCache.get(candidate);
}

function headerDefinesPatchField(text) {
  for (const declaration of text.matchAll(CLASS_DECLARATION_RE)) {
    for (const token of declaration[1].matchAll(/[A-Za-z_]\w*/g)) {
      if (PATCH_FIELD_BASE_RE.test(token[0])) {
        return true;
      }
    }
  }

  return false;
}

function boundaryTypeNames(sourcePath) {
  const text = readHeaderText(sourcePath);
  if (!headerDefinesPatchField(text)) {
    return [];
  }

  return extractTypeNames(text);
}

// A selectable type name may carry a C++ scope qualifier - wall functions are
// registered as e.g. `compressible::alphatWallFunction` - and `:` is not a legal
// file-name character on Windows, so the per-type file name is a safe encoding
// of the name. The real name is kept inside the JSON as `typeName`.
function boundaryFileName(typeName) {
  const encoded = typeName.replace(/[^A-Za-z0-9_.-]/g, '_');
  return encoded.length > 0 ? encoded : 'unnamed';
}

function collectBoundaryConditionClasses(root, conditions) {
  const files = walkFiles(root).filter((fullPath) => {
    const posix = toPosix(fullPath).toLowerCase();
    return (posix.includes('/fields/fvpatchfields/') || posix.includes('/fields/pointpatchfields/'))
      && /\.(?:C|H|Hpp|Cpp|cc|cxx)$/.test(fullPath);
  });

  for (const fullPath of files) {
    const typeNames = boundaryTypeNames(fullPath);
    if (typeNames.length === 0) continue;
    const patchKind = fullPath.toLowerCase().includes('pointpatchfield') ? 'pointPatchField' : 'fvPatchField';
    for (const typeName of typeNames) {
      let condition = conditions.get(typeName);
      if (!condition) {
        condition = { typeName, patchKind, sourceFiles: new Set(), keywords: new Map() };
        conditions.set(typeName, condition);
      }
      condition.sourceFiles.add(toPosix(path.relative(projectRoot, fullPath)));
    }
  }
}

function isBoundaryCondition(record) {
  const source = record.source.toLowerCase();
  return source.includes('/fields/fvpatchfields/')
    || source.includes('/fields/pointpatchfields/')
    || source.includes('fvpatchfield')
    || source.includes('pointpatchfield');
}

function main() {
  if (!fs.existsSync(sourceRoot)) throw new Error(`OpenFOAM src directory not found: ${sourceRoot}`);
  const generatedAt = new Date().toISOString();
  const manifest = readJson(path.join(keywordRoot, 'manifest.json'));
  const scan = scanOpenFoamSources([sourceRoot, applicationRoot]);
  resetOutput();

  const boundaryMap = new Map();
  collectBoundaryConditionClasses(sourceRoot, boundaryMap);
  const allSourceTypes = new Set();
  const files = [];
  const mappedTypeNames = new Set();
  const candidateOrigins = { src: 0, applications: 0, etc: 0, other: 0 };

  for (const record of scan.records) {
    for (const typeName of typeNamesFor(record)) allSourceTypes.add(typeName);
    if (!isBoundaryCondition(record)) continue;
    for (const typeName of boundaryTypeNames(record.source)) {
      let condition = boundaryMap.get(typeName);
      if (!condition) {
        condition = { typeName, patchKind: record.source.toLowerCase().includes('pointpatchfield') ? 'pointPatchField' : 'fvPatchField', sourceFiles: new Set(), keywords: new Map() };
        boundaryMap.set(typeName, condition);
      }
      condition.sourceFiles.add(toPosix(path.relative(projectRoot, record.source)));
      const key = `${record.method}|${record.keyword}`;
      const item = condition.keywords.get(key) || { keyword: record.keyword, method: record.method, receiver: record.receiver, occurrences: 0, examples: [] };
      item.occurrences += 1;
      const example = `${toPosix(path.relative(projectRoot, record.source))}:${record.line}`;
      if (item.examples.length < 5 && !item.examples.includes(example)) item.examples.push(example);
      condition.keywords.set(key, item);
    }
  }

  for (const [category, categoryInfo] of Object.entries(manifest.categories)) {
    if (!['0', 'constant', 'system'].includes(category)) continue;
    for (const fileInfo of categoryInfo.files || []) {
      const data = readJson(path.join(keywordRoot, fileInfo.output));
      const candidates = (data.entries || []).filter((entry) => entry.sourceOccurrences > 0).map((entry) => {
        for (const sourceType of entry.sourceTypes || []) mappedTypeNames.add(sourceType);
        for (const location of entry.sourceLocations || []) {
          if (location.includes('/src/')) candidateOrigins.src += 1;
          else if (location.includes('/applications/')) candidateOrigins.applications += 1;
          else if (location.includes('/etc/')) candidateOrigins.etc += 1;
          else candidateOrigins.other += 1;
        }
        return {
          keyword: entry.keyword,
          context: entry.context,
          path: entry.path,
          kinds: entry.kinds,
          sourceOccurrences: entry.sourceOccurrences,
          sourceTypes: entry.sourceTypes || [],
          sourceLocations: entry.sourceLocations || [],
          reviewStatus: 'already-merged-pending-review',
        };
      });
      if (candidates.length === 0) continue;
      const target = outputPath(category, fileInfo.fileKey);
      writeJson(target, { generatedAt, source: sourceLabel, category, fileKey: fileInfo.fileKey, candidateCount: candidates.length, candidates });
      files.push({ category, fileKey: fileInfo.fileKey, output: toPosix(path.relative(outputRoot, target)), candidateCount: candidates.length });
    }
  }

  const boundaryConditions = [...boundaryMap.values()].map((condition) => ({ typeName: condition.typeName, patchKind: condition.patchKind, sourceFiles: [...condition.sourceFiles].sort(compare), keywords: [...condition.keywords.values()].sort((a, b) => compare(a.keyword, b.keyword) || compare(a.method, b.method)) })).sort((a, b) => compare(a.typeName, b.typeName));
  writeJson(path.join(outputRoot, 'boundary-conditions.json'), { generatedAt, source: sourceLabel, conditionCount: boundaryConditions.length, conditions: boundaryConditions });
  const boundaryFiles = [];
  const fileNameCounts = new Map();
  for (const condition of boundaryConditions) {
    const base = boundaryFileName(condition.typeName);
    const seen = (fileNameCounts.get(base) || 0) + 1;
    fileNameCounts.set(base, seen);
    const fileName = seen === 1 ? base : `${base}-${seen}`;
    const target = path.join(outputRoot, 'boundary-conditions', `${fileName}.json`);
    writeJson(target, condition);
    boundaryFiles.push({ typeName: condition.typeName, output: toPosix(path.relative(outputRoot, target)), keywordCount: condition.keywords.length });
  }

  const unmappedTypes = [...allSourceTypes].filter((typeName) => !mappedTypeNames.has(typeName)).sort(compare).map((typeName) => {
    const records = scan.records.filter((record) => typeNamesFor(record).includes(typeName));
    return { typeName, sourceFiles: [...new Set(records.map((record) => toPosix(path.relative(projectRoot, record.source))))].sort(compare), keywords: [...new Set(records.map((record) => record.keyword))].sort(compare) };
  });
  writeJson(path.join(outputRoot, 'unmapped.json'), { generatedAt, source: sourceLabel, typeCount: unmappedTypes.length, types: unmappedTypes });

  const resultManifest = { generatedAt, sourceRoots: [sourceLabel, applicationLabel], sourceScan: scan.stats, candidateOrigins, targetFileCount: files.length, candidateCount: files.reduce((sum, file) => sum + file.candidateCount, 0), boundaryConditionCount: boundaryConditions.length, unmappedTypeCount: unmappedTypes.length, files, boundaryConditionFiles: boundaryFiles };
  writeJson(path.join(outputRoot, 'manifest.json'), resultManifest);
  const boundaryWithKeywords = boundaryConditions.filter((condition) => condition.keywords.length > 0).length;
  const boundaryWithoutKeywords = boundaryConditions.length - boundaryWithKeywords;
  writeJson(path.join(outputRoot, 'coverage.json'), { generatedAt, sourceRoots: resultManifest.sourceRoots, sourceScan: scan.stats, candidateOrigins, candidateCount: resultManifest.candidateCount, mappedTypeCount: mappedTypeNames.size, unmappedTypeCount: unmappedTypes.length, boundaryConditionCount: boundaryConditions.length, boundaryConditionsWithKeywords: boundaryWithKeywords, boundaryConditionsWithoutKeywords: boundaryWithoutKeywords });
  const review = [
    '# OpenFOAM Keyword Supplement Review', '', `Generated: ${generatedAt}`, '', '## Summary', '',
    `- Source roots: \`${sourceLabel}\`, \`${applicationLabel}\``,
    `- Source files scanned: ${scan.stats.scannedFiles}`,
    `- Dictionary calls found: ${scan.stats.callCount}`,
    `- Files with source-derived candidates: ${files.length}`,
    `- Source-derived candidate entries: ${resultManifest.candidateCount}`,
    `- Candidate origins: \`src\` ${candidateOrigins.src}, \`applications\` ${candidateOrigins.applications}, \`etc\` ${candidateOrigins.etc}`,
    `- Boundary condition types: ${boundaryConditions.length}`,
    `- Boundary conditions with explicit keywords: ${boundaryWithKeywords}`,
    `- Boundary conditions without extra keywords: ${boundaryWithoutKeywords}`,
    `- Mapped source types: ${mappedTypeNames.size}`,
    `- Unmapped source types: ${unmappedTypes.length}`, '', '## Output', '',
    '- `0/`, `constant/`, `system/`: source-derived candidates grouped by concrete target file',
    '- `boundary-conditions.json`: aggregate boundary condition catalog',
    '- `boundary-conditions/`: one independent JSON file per boundary condition',
    '- `coverage.json`: mapped/unmapped and boundary condition coverage statistics',
    '- `unmapped.json`: source classes not yet mapped to a concrete case file',
    '- `manifest.json`: machine-readable index', '',
    'All keywords preserve OpenFOAM source casing.', '',
  ].join('\n');
  fs.writeFileSync(path.join(outputRoot, 'REVIEW.md'), review, 'utf8');
  process.stdout.write(`${JSON.stringify({ sourceScan: scan.stats, targetFileCount: files.length, candidateCount: resultManifest.candidateCount, boundaryConditionCount: boundaryConditions.length, unmappedTypeCount: unmappedTypes.length }, null, 2)}\n`);
}

main();