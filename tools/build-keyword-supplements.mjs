'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCppComments } from './openfoam-source-scanner.mjs';
import { resolveOpenFoamRoot } from './openfoam-source-root.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const openfoamRoot = resolveOpenFoamRoot(projectRoot);
const sourceRoot = path.join(openfoamRoot, 'src');
const outputRoot = path.join(projectRoot, 'data', 'keyword-supplements');
const sourceLabel = `${path.basename(openfoamRoot)}/src`;
const generatedAt = new Date().toISOString();

const compare = (a, b) => a.localeCompare(b, 'en');
const toPosix = (value) => value.split(path.sep).join('/');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

function walkSourceFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => compare(a.name, b.name))) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (/\.(?:C|H|Hpp|Cpp|cc|cxx)$/.test(entry.name)) files.push(fullPath);
    }
  }
  visit(root);
  return files;
}

const classDeclarationPattern = /\bclass\s+[A-Za-z_]\w*\s*(?:final\s*)?:\s*([^{;]+)\{/g;
const pointPatchFieldBasePattern = /^(?:[A-Za-z_]\w*)?pointPatch\w*Field$/i;
const fvPatchFieldBasePattern = /^(?:[A-Za-z_]\w*)?fvPatch\w*Field$/i;
const headerTextCache = new Map();

function readHeaderText(sourcePath) {
  const headerPath = sourcePath.replace(/\.(?:C|H|Hpp|Cpp|cc|cxx)$/, '.H');
  const candidate = headerPath !== sourcePath && fs.existsSync(headerPath) ? headerPath : sourcePath;
  if (!headerTextCache.has(candidate)) {
    headerTextCache.set(candidate, fs.existsSync(candidate) ? fs.readFileSync(candidate, 'utf8') : '');
  }
  return headerTextCache.get(candidate);
}

function patchFieldKind(text) {
  let kind = null;
  for (const declaration of text.matchAll(classDeclarationPattern)) {
    for (const token of declaration[1].matchAll(/[A-Za-z_]\w*/g)) {
      if (pointPatchFieldBasePattern.test(token[0])) return 'pointPatchField';
      if (fvPatchFieldBasePattern.test(token[0])) kind = 'fvPatchField';
    }
  }
  return kind;
}

function patchFieldGroup(fullPath) {
  const kind = patchFieldKind(readHeaderText(fullPath));
  if (kind === 'pointPatchField') return '0/pointPatchFields';
  if (kind === 'fvPatchField') return '0/fvPatchFields';
  return null;
}

function lineNumberAt(text, offset) {
  return text.slice(0, offset).split('\n').length;
}

function addRecord(records, name, sourceFile, line, registeredBy) {
  if (!name || !/^[A-Za-z_][A-Za-z0-9_.:|+\-]*$/.test(name)) return;
  const existing = records.get(name);
  const sourceLocation = `${sourceFile}:${line}`;
  if (existing) {
    existing.registeredBy = [...new Set([...existing.registeredBy, registeredBy])].sort(compare);
    existing.sourceFiles = [...new Set([...existing.sourceFiles, sourceFile])].sort(compare);
    if (!existing.sourceLocations.includes(sourceLocation)) existing.sourceLocations.push(sourceLocation);
    return;
  }
  records.set(name, {
    name,
    registeredBy: [registeredBy],
    sourceFiles: [sourceFile],
    sourceLocations: [sourceLocation],
    sourceLine: line,
  });
}

function classTypeNames(text) {
  const result = new Map();
  const pattern = /\bclass\s+([A-Za-z_]\w*)\s*(?:final\s*)?(?::\s*([^{;]+))?\{/g;

  for (const match of text.matchAll(pattern)) {
    let depth = 0;
    let end = match.index;
    for (let index = match.index + match[0].length - 1; index < text.length; index += 1) {
      if (text[index] === '{') depth += 1;
      else if (text[index] === '}' && --depth === 0) {
        end = index + 1;
        break;
      }
    }

    const body = text.slice(match.index, end);
    const names = [...body.matchAll(/\b(?:TypeName|typeName)\s*\(\s*"([^"]+)"\s*\)/g)]
      .map((item) => item[1]);
    if (names.length > 0) result.set(match[1], names);
  }

  return result;
}

function collectClassTypeNames(sourceFiles) {
  const result = new Map();

  for (const fullPath of sourceFiles) {
    const stat = fs.statSync(fullPath);
    if (stat.size === 0 || stat.size > 4 * 1024 * 1024) continue;
    const rawText = fs.readFileSync(fullPath, 'utf8');
    if (rawText.includes('\0')) continue;
    const text = stripCppComments(rawText);
    for (const [className, names] of classTypeNames(text)) {
      const key = className.toLowerCase();
      const current = result.get(key) || new Set();
      for (const name of names) current.add(name);
      result.set(key, current);
    }
  }

  return result;
}

function resolveClassName(className, classTypes) {
  const names = classTypes.get(className.toLowerCase());
  return names && names.size > 0 ? [...names].sort(compare) : [className];
}

function extractSourceRecords(text, sourceFile, classTypes) {
  const records = new Map();
  const typePattern = /\b(?:TypeName|typeName)\s*\(\s*"([^"]+)"\s*\)/g;
  for (const match of text.matchAll(typePattern)) {
    addRecord(records, match[1], sourceFile, lineNumberAt(text, match.index), 'TypeName');
  }

  const macroPatterns = [
    // Includes makeFvDdtScheme, makeFvGradScheme, makeFvDivScheme,
    // makeFvLaplacianScheme, makeFvSnGradScheme and the lower-case
    // makelimited... family used by linearUpwind/blended/upwind.
    ['make*Interpolation/Scheme', /\bmake[A-Za-z]*(?:SurfaceInterpolation|Ddt|Grad|Div|Laplacian|SnGrad)[A-Za-z]*Scheme\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)/g],
    ['makeCentredFitSnGradScheme', /\bmakeCentredFitSnGradScheme\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)/g],
    ['makeFvConvectionScheme', /\bmake[A-Za-z]*Convection[A-Za-z]*Scheme\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)/g],
    ['makeFvD2dt2Scheme', /\bmake[A-Za-z]*D2dt2[A-Za-z]*Scheme\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)/g],
    ['makeRASModel', /\bmakeRASModel\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)/g],
    ['makeLESModel', /\bmakeLESModel\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)/g],
    ['makeLduSolver', /\bmakeLdu(?:Sym|Asym)?Solver\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)/g],
    ['makeLduPreconditioner', /\bmakeLdu(?:Sym|Asym)?Preconditioner\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)/g],
    ['makeLduSmoother', /\bmakeLdu(?:Sym|Asym)?Smoother\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)/g],
  ];
  for (const [registeredBy, pattern] of macroPatterns) {
    for (const match of text.matchAll(pattern)) {
      const macroName = (match[0].match(/^[A-Za-z_][A-Za-z0-9_]*/) || [registeredBy])[0];
      for (const name of resolveClassName(match[1], classTypes)) {
        addRecord(records, name, sourceFile, lineNumberAt(text, match.index), macroName);
      }
    }
  }

  const runtimeTablePattern = /\baddToRunTimeSelectionTable\s*\(\s*([A-Za-z_][A-Za-z0-9_:~]*)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s*,/g;
  for (const match of text.matchAll(runtimeTablePattern)) {
    for (const name of resolveClassName(match[2], classTypes)) {
      addRecord(records, name, sourceFile, lineNumberAt(text, match.index), `addToRunTimeSelectionTable:${match[1]}`);
    }
  }
  return [...records.values()];
}

function sourceGroup(relativeSource, item) {
  const source = toPosix(relativeSource);
  const lowerSource = source.toLowerCase();
  const surfaceInterpolationRegistration = item.registeredBy.some(
    (registeredBy) => /SurfaceInterpolation/.test(registeredBy),
  );
  const runtimeTableBases = item.registeredBy
    .filter((registeredBy) => registeredBy.startsWith('addToRunTimeSelectionTable:'))
    .map((registeredBy) => registeredBy.slice('addToRunTimeSelectionTable:'.length));
  if (runtimeTableBases.includes('functionObject')) return 'system/functionObjects';
  if (lowerSource.includes('interpolation/surfaceinterpolation') || surfaceInterpolationRegistration) {
    return 'fvSchemes/surfaceInterpolation';
  }
  if (lowerSource.includes('/finitevolume/convectionschemes/')) return 'fvSchemes/convectionSchemes';
  if (lowerSource.includes('/finitevolume/d2dt2schemes/')) return 'fvSchemes/d2dt2Schemes';
  if (lowerSource.includes('/finitevolume/ddtschemes/')) return 'fvSchemes/ddtSchemes';
  if (lowerSource.includes('/finitevolume/gradschemes/')) return 'fvSchemes/gradSchemes';
  if (lowerSource.includes('/finitevolume/divschemes/')) return 'fvSchemes/divSchemes';
  if (lowerSource.includes('/finitevolume/laplacianschemes/')) return 'fvSchemes/laplacianSchemes';
  if (lowerSource.includes('/finitevolume/sngradschemes/')) return 'fvSchemes/snGradSchemes';
  if (lowerSource.includes('matrices/ldumatrix/solvers/')) return 'fvSolution/solvers';
  if (lowerSource.includes('matrices/ldumatrix/preconditioners/')) return 'fvSolution/preconditioners';
  if (lowerSource.includes('matrices/ldumatrix/smoothers/')) return 'fvSolution/smoothers';
  if (lowerSource.includes('/transportmodels/') && lowerSource.includes('/viscositymodels/')) {
    return 'constant/transportModels';
  }
  if (lowerSource.includes('/turbulencemodels/')) {
    if (lowerSource.includes('/lesdeltas/')) return 'constant/turbulenceModels/LES/LESdelta';
    if (lowerSource.includes('/lesfilters/')) return 'constant/turbulenceModels/LES/LESfilter';
    if (lowerSource.includes('/les/') || lowerSource.includes('/des/')) return 'constant/turbulenceModels/LES';
    if (lowerSource.includes('/ras/')) return 'constant/turbulenceModels/RAS';
  }
  if (lowerSource.includes('/functionobjects/')) return 'system/functionObjects';
  return null;
}

const genericNames = new Set([
  'SS', 'Type', 'scalar', 'vector', 'sphericalTensor', 'symmTensor', 'tensor',
  'surfaceInterpolationScheme', 'limitedSurfaceInterpolationScheme',
  'upwindFitScheme', 'PureUpwindFitScheme', 'UpwindFitData',
  'ddtScheme', 'ddtSchemeBase', 'gradScheme', 'divScheme', 'laplacianScheme',
  'convectionScheme', 'd2dt2Scheme', 'snGradScheme', 'solver', 'preconditioner', 'smoother', 'RASModel', 'LESModel',
  'RAS', 'LES', 'RASModelBase', 'RASModelVariables', 'LESdelta', 'LESfilter',
  'turbulenceModel', 'viscosityModel', 'transportModel', 'surfaceTensionModel',
  'generalizedNewtonianViscosityModel', 'functionObject', 'functionObjectList',
  'fvPatchField', 'pointPatchField', 'fvPatchFieldBase', 'pointPatchFieldBase',
  'fvPatchFieldMapper', 'pointPatchFieldMapper', 'PatchTypeField', 'typePatchTypeField',
]);

function isUsefulName(name, group) {
  if (!name || genericNames.has(name)) return false;
  if (/^multivariate/.test(name)) return false;
  if (group === 'fvSchemes/surfaceInterpolation') {
    if (/(?:Scheme|Data|Vectors|Selection|Base)$/.test(name)) return false;
    if (name === 'skewCorrectionVectors' || name === 'multivariateIndependent') return false;
  }
  if (group === 'fvSchemes/ddtSchemes' && /(?:DdtScheme|DdtSchemes)$/.test(name)) return false;
  if (group === 'fvSchemes/convectionSchemes' && /(?:ConvectionScheme|ConvectionSchemes|Base)$/.test(name)) return false;
  if (group === 'fvSchemes/d2dt2Schemes' && /(?:D2dt2Scheme|D2dt2Schemes|Base)$/.test(name)) return false;
  if (group === 'fvSchemes/gradSchemes' && /(?:Grad|GradScheme|GradSchemes|Vectors)$/.test(name)) return false;
  if (group === 'fvSchemes/divSchemes' && /(?:DivScheme|DivSchemes)$/.test(name)) return false;
  if (group === 'fvSchemes/laplacianSchemes' && /(?:LaplacianScheme|LaplacianSchemes)$/.test(name)) return false;
  if (group === 'fvSchemes/snGradSchemes' && /(?:Data|SnGradScheme|SnGradSchemes)$/.test(name)) return false;
  if (group === 'fvSolution/solvers' && name !== 'smoothSolver' && /(?:Solver|Agglomeration|Interface|InterfaceField|ProcAgglomeration)$/.test(name)) return false;
  if (group === 'fvSolution/preconditioners' && /Preconditioner$/.test(name)) return false;
  if (group === 'fvSolution/smoothers' && /Smoother$/.test(name)) return false;
  if (group === 'constant/transportModels') {
    if (/(?:TransportModel|ViscosityModel|Base)$/.test(name)) return false;
  }
  if (group === 'constant/turbulenceModels/RAS' && /(?:ModelVariables|ModelBase|Base)$/.test(name)) return false;
  if (group === 'constant/turbulenceModels/LES' && /(?:ModelBase|Base|Delta|Filter)$/i.test(name)) return false;
  if (group === 'constant/turbulenceModels/LES/LESdelta' && /(?:Data|Base)$/.test(name)) return false;
  if (group === 'constant/turbulenceModels/LES/LESfilter' && /(?:Data|Base)$/.test(name)) return false;
  return true;
}

function writeSupplement(group, items) {
  const output = `${group}.json`;
  const file = path.join(outputRoot, ...output.split('/'));
  const previous = fs.existsSync(file) ? readJson(file) : {};
  const manualItems = Array.isArray(previous.manualItems) ? previous.manualItems : [];
  const cleanItems = items
    .filter((item) => isUsefulName(item.name, group))
    .map((item) => ({
      name: item.name,
      registeredBy: item.registeredBy,
      sourceFiles: item.sourceFiles,
      sourceLocations: item.sourceLocations.slice(0, 20),
      sourceLine: item.sourceLine,
    }))
    .sort((a, b) => compare(a.name, b.name));
  writeJson(file, {
    generatedAt,
    sourceRoot: sourceLabel,
    group,
    casePolicy: 'preserve-source-case',
    itemCount: cleanItems.length,
    items: cleanItems,
    manualItems,
  });
  return { group, output, itemCount: cleanItems.length, manualItemCount: manualItems.length };
}

function main() {
  if (!fs.existsSync(sourceRoot)) throw new Error(`Missing source directory: ${sourceRoot}`);
  const sourceFiles = walkSourceFiles(sourceRoot);
  const classTypes = collectClassTypeNames(sourceFiles);
  const recordsByGroup = new Map();
  for (const fullPath of sourceFiles) {
    const stat = fs.statSync(fullPath);
    if (stat.size === 0 || stat.size > 4 * 1024 * 1024) continue;
    const rawText = fs.readFileSync(fullPath, 'utf8');
    if (rawText.includes('\0')) continue;
    const text = stripCppComments(rawText);
    const relativeSource = toPosix(path.relative(projectRoot, fullPath));
    const patchGroup = patchFieldGroup(fullPath);
    for (const item of extractSourceRecords(text, relativeSource, classTypes)) {
      if (patchGroup && !item.registeredBy.includes('TypeName')) continue;
      const group = patchGroup || sourceGroup(relativeSource, item);
      if (!group) continue;
      if (!recordsByGroup.has(group)) recordsByGroup.set(group, new Map());
      addRecord(recordsByGroup.get(group), item.name, item.sourceFiles[0], item.sourceLine, item.registeredBy[0]);
      const target = recordsByGroup.get(group).get(item.name);
      target.registeredBy = [...new Set([...target.registeredBy, ...item.registeredBy])].sort(compare);
      target.sourceFiles = [...new Set([...target.sourceFiles, ...item.sourceFiles])].sort(compare);
      target.sourceLocations = [...new Set([...target.sourceLocations, ...item.sourceLocations])].slice(0, 20);
    }
  }

  const groups = [];
  for (const [group, itemMap] of [...recordsByGroup.entries()].sort(([a], [b]) => compare(a, b))) {
    groups.push(writeSupplement(group, [...itemMap.values()]));
  }
  writeJson(path.join(outputRoot, 'manifest.json'), {
    generatedAt,
    sourceRoot: sourceLabel,
    casePolicy: 'preserve-source-case',
    groupCount: groups.length,
    itemCount: groups.reduce((sum, group) => sum + group.itemCount, 0),
    groups,
  });
  process.stdout.write(`${JSON.stringify({ groupCount: groups.length, itemCount: groups.reduce((sum, group) => sum + group.itemCount, 0), groups }, null, 2)}\n`);
}

main();
