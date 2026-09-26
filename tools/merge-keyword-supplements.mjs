'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveOpenFoamRoot } from './openfoam-source-root.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const supplementRoot = path.join(root, 'data', 'keyword-supplements');
const indexRoot = path.join(root, 'data', 'keywords');
const compare = (a, b) => a.localeCompare(b, 'en');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};
const sortedUnique = (values) => [...new Set(values.filter(Boolean))].sort(compare);

function walkJsonFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkJsonFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'manifest.json') files.push(fullPath);
  }
  return files.sort(compare);
}

function itemName(item) {
  if (typeof item === 'string') return item;
  return item && typeof item.name === 'string' ? item.name : null;
}

function loadSupplements() {
  const files = [];
  const namesByGroup = new Map();
  const locationsByGroup = new Map();

  for (const file of walkJsonFiles(supplementRoot)) {
    const document = read(file);
    if (!document.group || !Array.isArray(document.items)) continue;
    const names = [...document.items, ...(document.manualItems || [])].map(itemName).filter(Boolean);
    files.push({ file, group: document.group, names });
    const current = namesByGroup.get(document.group) || [];
    const locations = locationsByGroup.get(document.group) || [];
    namesByGroup.set(document.group, sortedUnique([...current, ...names]));
    for (const item of [...document.items, ...(document.manualItems || [])]) {
      if (item && Array.isArray(item.sourceLocations)) locations.push(...item.sourceLocations);
    }
    locationsByGroup.set(document.group, sortedUnique(locations));
  }

  return { files, namesByGroup, locationsByGroup };
}

function entryFor(file, entryPath) {
  return (file.entries || []).find((entry) => entry.path === entryPath);
}

function addEntry(file, entryPath, values, meta) {
  let entry = entryFor(file, entryPath);
  const segments = entryPath.split('/');
  const keyword = segments.at(-1);
  const context = segments.slice(0, -1).join('/');
  if (!entry) {
    entry = {
      key: entryPath,
      keyword,
      context,
      path: entryPath,
      kinds: ['entry'],
      occurrences: 0,
      fileCount: 0,
      sourceOccurrences: 0,
      sourceTypes: [],
      sourceLocations: [],
      values: [],
      examples: [],
    };
    file.entries.push(entry);
  }

  entry.sourceTypes = sortedUnique([...(entry.sourceTypes || []), meta.group]);
  entry.sourceLocations = sortedUnique([...(entry.sourceLocations || []), ...(meta.locations || [])]).slice(0, 20);
  entry.sourceOccurrences = Math.max(entry.sourceOccurrences || 0, values.length);
  const valueMap = new Map((entry.values || []).map((value) => [value.value, value]));
  for (const value of values) {
    const existing = valueMap.get(value);
    if (existing) {
      existing.supplemental = true;
      existing.sourceGroups = sortedUnique([...(existing.sourceGroups || []), meta.group]);
    }
    else {
      const item = {
        value,
        occurrences: 1,
        supplemental: true,
        sourceGroups: [meta.group],
      };
      entry.values.push(item);
      valueMap.set(value, item);
    }
  }
  return entry;
}

function mergeFile(relativePath, points, supplementData) {
  const filePath = path.join(indexRoot, ...relativePath.split('/'));
  const file = read(filePath);
  for (const point of points) {
    const values = point.values || [];
    if (values.length === 0) continue;
    addEntry(file, point.path, values, {
      group: point.group,
      locations: supplementData.locationsByGroup.get(point.group) || [],
    });
  }
  file.supplemental = {
    directory: 'data/keyword-supplements',
    casePolicy: 'preserve-source-case',
  };
  write(filePath, file);
}

function mergeZeroBoundaryFields(supplementData) {
  const manifest = read(path.join(indexRoot, 'manifest.json'));
  const category = manifest.categories && manifest.categories['0'];
  if (!category || !Array.isArray(category.files)) return { fv: 0, point: 0 };

  const fvTypes = supplementData.namesByGroup.get('0/fvPatchFields') || [];
  const fvLocations = supplementData.locationsByGroup.get('0/fvPatchFields') || [];
  const pointTypes = supplementData.namesByGroup.get('0/pointPatchFields') || [];
  const pointLocations = supplementData.locationsByGroup.get('0/pointPatchFields') || [];
  let fvFiles = 0;
  let pointFiles = 0;

  for (const info of category.files) {
    const filePath = path.join(indexRoot, ...info.output.split('/'));
    if (!fs.existsSync(filePath)) continue;
    const file = read(filePath);
    if (!(file.entries || []).some((entry) => entry.path === 'boundaryField' || entry.path.startsWith('boundaryField/'))) continue;

    addEntry(file, 'boundaryField/{patch}/type', fvTypes, {
      group: '0/fvPatchFields',
      locations: fvLocations,
    });
    fvFiles += 1;

    // Point fields use a distinct runtime selection table. Keep the point
    // candidates on point-field files rather than offering displacement
    // solvers on every volField boundary.
    if (/(?:^|\/)point/i.test(info.fileKey)) {
      addEntry(file, 'boundaryField/{patch}/type', pointTypes, {
        group: '0/pointPatchFields',
        locations: pointLocations,
      });
      pointFiles += 1;
    }

    file.supplemental = {
      directory: 'data/keyword-supplements',
      casePolicy: 'preserve-source-case',
    };
    write(filePath, file);
  }

  return { fv: fvFiles, point: pointFiles };
}

function main() {
  const supplementData = loadSupplements();
  const names = (group) => supplementData.namesByGroup.get(group) || [];
  const surface = names('fvSchemes/surfaceInterpolation');
  const convection = names('fvSchemes/convectionSchemes');
  const d2dt2 = names('fvSchemes/d2dt2Schemes');
  const ddt = names('fvSchemes/ddtSchemes');
  const grad = names('fvSchemes/gradSchemes');
  const div = names('fvSchemes/divSchemes');
  const laplacian = names('fvSchemes/laplacianSchemes');
  const snGrad = names('fvSchemes/snGradSchemes');
  const solvers = names('fvSolution/solvers');
  const solverAllowlist = new Set([
    'diagonal',
    'FPCG',
    'GAMG',
    'PBiCCCG',
    'PBiCG',
    'PBiCGStab',
    'PBiCICG',
    'PCG',
    'PCICG',
    'PPCG',
    'PPCR',
    'smoothSolver',
  ]);
  const solverValues = solvers.filter((name) => solverAllowlist.has(name));
  const preconditioners = names('fvSolution/preconditioners');
  const smoothers = names('fvSolution/smoothers');
  const transport = names('constant/transportModels');
  const ras = names('constant/turbulenceModels/RAS');
  const les = names('constant/turbulenceModels/LES');
  const lesDelta = names('constant/turbulenceModels/LES/LESdelta');
  const lesFilter = names('constant/turbulenceModels/LES/LESfilter');
  const functionObjects = names('system/functionObjects');

  const surfaceValues = surface.map((name) => ({ name, value: name }));
  const surfaceGaussValues = surface.map((name) => `Gauss ${name}`);
  const surfaceGaussLimitedValues = surface
    .filter((name) => /limited|vanLeer|MUSCL|UMIST|SuperBee|OSPRE|QUICK|SFCD|Gamma|Minmod|vanAlbada/i.test(name))
    .map((name) => `Gauss ${name} 1`);

  mergeFile('system/fvSchemes.json', [
    { group: 'fvSchemes/convectionSchemes', path: 'convectionSchemes/default', values: convection },
    { group: 'fvSchemes/d2dt2Schemes', path: 'd2dt2Schemes/default', values: d2dt2 },
    { group: 'fvSchemes/ddtSchemes', path: 'ddtSchemes/default', values: ddt },
    { group: 'fvSchemes/gradSchemes', path: 'gradSchemes/default', values: grad },
    { group: 'fvSchemes/gradSchemes', path: 'gradSchemes/default', values: surfaceGaussValues },
    { group: 'fvSchemes/divSchemes', path: 'divSchemes/default', values: div },
    { group: 'fvSchemes/divSchemes', path: 'divSchemes/default', values: surfaceGaussValues },
    { group: 'fvSchemes/divSchemes', path: 'divSchemes/default', values: surfaceGaussLimitedValues },
    { group: 'fvSchemes/laplacianSchemes', path: 'laplacianSchemes/default', values: laplacian },
    { group: 'fvSchemes/laplacianSchemes', path: 'laplacianSchemes/default', values: snGrad.map((name) => `Gauss linear ${name}`) },
    { group: 'fvSchemes/snGradSchemes', path: 'snGradSchemes/default', values: snGrad },
    { group: 'fvSchemes/surfaceInterpolation', path: 'interpolationSchemes/default', values: surfaceValues.map((item) => item.value) },
  ], supplementData);

  mergeFile('system/fvSolution.json', [
    { group: 'fvSolution/solvers', path: 'solvers/{solver}/solver', values: solverValues },
    { group: 'fvSolution/preconditioners', path: 'solvers/{solver}/preconditioner', values: preconditioners },
    { group: 'fvSolution/smoothers', path: 'solvers/{solver}/smoother', values: smoothers },
    { group: 'fvSolution/preconditioners', path: 'solvers/{solver}/smoother', values: preconditioners },
  ], supplementData);

  mergeFile('constant/transportProperties.json', [
    { group: 'constant/transportModels', path: 'transportModel', values: transport },
  ], supplementData);

  mergeFile('constant/turbulenceProperties.json', [
    { group: 'constant/turbulenceModels/RAS', path: 'RAS/RASModel', values: ras },
    { group: 'constant/turbulenceModels/LES', path: 'LES/LESModel', values: les },
    { group: 'constant/turbulenceModels/LES/LESdelta', path: 'LES/delta', values: lesDelta },
    { group: 'constant/turbulenceModels/LES/LESfilter', path: 'LES/dynamicKEqnCoeffs/filter', values: lesFilter },
  ], supplementData);

  mergeFile('system/controlDict.json', [
    { group: 'system/functionObjects', path: 'functions/{function}/type', values: functionObjects },
  ], supplementData);

  const mergedZeroFiles = mergeZeroBoundaryFields(supplementData);

  const manifest = read(path.join(indexRoot, 'manifest.json'));
  manifest.casePolicy = 'preserve-source-case';
  manifest.auxiliary = manifest.auxiliary || {};
  manifest.auxiliary.keywordSupplements = {
    directory: 'data/keyword-supplements',
    sourceRoot: `${path.basename(resolveOpenFoamRoot(root))}/src`,
    groupCount: supplementData.files.length,
    itemCount: supplementData.files.reduce((sum, file) => sum + file.names.length, 0),
    zeroBoundaryFieldFileCount: mergedZeroFiles.fv,
    zeroPointBoundaryFieldFileCount: mergedZeroFiles.point,
  };
  write(path.join(indexRoot, 'manifest.json'), manifest);

  process.stdout.write(`${JSON.stringify({ groupCount: supplementData.files.length, zeroBoundaryFieldFileCount: mergedZeroFiles.fv, zeroPointBoundaryFieldFileCount: mergedZeroFiles.point })}\n`);
}

main();
