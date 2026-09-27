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

function mergeDivSchemeKeys() {
  const supplementFile = path.join(supplementRoot, 'fvSchemes', 'divSchemesKeys.json');
  if (!fs.existsSync(supplementFile)) return { itemCount: 0, generatedItemCount: 0, manualItemCount: 0 };

  const document = read(supplementFile);
  const filePath = path.join(indexRoot, 'system', 'fvSchemes.json');
  const file = read(filePath);
  const items = [
    ...(Array.isArray(document.items) ? document.items : []),
    ...(Array.isArray(document.manualItems) ? document.manualItems : []),
  ];
  let manualItemCount = 0;

  for (const item of items) {
    if (!item || typeof item.name !== 'string' || !item.name.startsWith('div(')) continue;
    const sourceFiles = Array.isArray(item.sourceFiles) ? item.sourceFiles : [];
    const entry = addEntry(file, 'divSchemes/' + item.name, [], {
      group: document.group || 'fvSchemes/divSchemesKeys',
      locations: item.sourceLocations || item.sourceFiles || [],
    });
    entry.occurrences = Math.max(entry.occurrences || 0, item.occurrences || 0);
    entry.fileCount = Math.max(entry.fileCount || 0, sourceFiles.length);
    entry.sourceOccurrences = Math.max(entry.sourceOccurrences || 0, item.occurrences || 0);
    if (item.manual) {
      entry.manual = true;
      entry.sourceTypes = sortedUnique([...(entry.sourceTypes || []), 'manual']);
      manualItemCount += 1;
    }
    for (const location of item.sourceLocations || item.sourceFiles || []) {
      if (entry.examples.length < 5 && !entry.examples.includes(location)) entry.examples.push(location);
    }
  }

  file.entryKeySupplement = {
    directory: 'data/keyword-supplements/fvSchemes/divSchemesKeys.json',
    itemCount: items.length,
    generatedItemCount: Array.isArray(document.items) ? document.items.length : 0,
    manualItemCount,
  };
  write(filePath, file);
  return {
    itemCount: items.length,
    generatedItemCount: Array.isArray(document.items) ? document.items.length : 0,
    manualItemCount,
  };
}

function mergeTopoSetSupplements(supplementData) {
  const names = (group) => supplementData.namesByGroup.get(group) || [];
  const locations = (group) => supplementData.locationsByGroup.get(group) || [];
  const filePath = path.join(indexRoot, 'system', 'topoSetDict.json');
  const file = read(filePath);

  for (const point of [
    {
      group: 'system/topoSet/setTypes',
      path: 'actions/{action}/type',
      values: names('system/topoSet/setTypes'),
    },
    {
      group: 'system/topoSet/actions',
      path: 'actions/{action}/action',
      values: names('system/topoSet/actions'),
    },
    {
      group: 'system/topoSet/sources',
      path: 'actions/{action}/source',
      values: names('system/topoSet/sources'),
    },
  ]) {
    if (point.values.length === 0) continue;
    addEntry(file, point.path, point.values, {
      group: point.group,
      locations: locations(point.group),
    });
  }

  const parameterGroup = 'system/topoSet/parameters';
  const parameterNames = names(parameterGroup);
  for (const name of parameterNames) {
    addEntry(file, `actions/{action}/${name}`, [], {
      group: parameterGroup,
      locations: locations(parameterGroup),
    });
  }

  file.supplemental = {
    directory: 'data/keyword-supplements',
    casePolicy: 'preserve-source-case',
  };
  write(filePath, file);
  return {
    setTypeCount: names('system/topoSet/setTypes').length,
    actionCount: names('system/topoSet/actions').length,
    sourceCount: names('system/topoSet/sources').length,
    parameterCount: parameterNames.length,
  };
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

  const mergedDivSchemeKeys = mergeDivSchemeKeys();
  const mergedTopoSet = mergeTopoSetSupplements(supplementData);
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
    divSchemeKeys: {
      file: 'data/keyword-supplements/fvSchemes/divSchemesKeys.json',
      itemCount: mergedDivSchemeKeys.itemCount,
      generatedItemCount: mergedDivSchemeKeys.generatedItemCount,
      manualItemCount: mergedDivSchemeKeys.manualItemCount,
    },
    topoSet: mergedTopoSet,
  };
  write(path.join(indexRoot, 'manifest.json'), manifest);

  process.stdout.write(`${JSON.stringify({ groupCount: supplementData.files.length, zeroBoundaryFieldFileCount: mergedZeroFiles.fv, zeroPointBoundaryFieldFileCount: mergedZeroFiles.point, topoSet: mergedTopoSet })}\n`);
}

main();
