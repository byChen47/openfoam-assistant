'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyRelativePath,
  compactSearchQuery,
  formatIndexStats,
  getCompletionContext,
  getCompletionFilterText,
  getContextPath,
  getFileKeyCandidates,
  getKeywordCandidates,
  getSchemeValueCandidates,
  getSearchMatchScore,
  getScriptCandidates,
  getValueCandidates,
  isInsideBlockComment,
} = require('../src/openfoam');

test('classifies OpenFOAM case paths while preserving file case', () => {
  assert.deepEqual(classifyRelativePath('case/0/U'), { category: '0', fileKey: 'U' });
  assert.deepEqual(classifyRelativePath('case/0.orig/air/U'), {
    category: '0',
    fileKey: 'air/U',
  });
  assert.deepEqual(classifyRelativePath('case/constant/transportProperties'), {
    category: 'constant',
    fileKey: 'transportProperties',
  });
  assert.deepEqual(classifyRelativePath('case/system/controlDict'), {
    category: 'system',
    fileKey: 'controlDict',
  });
  assert.deepEqual(classifyRelativePath('case/Allrun'), {
    category: 'scripts',
    fileKey: 'Allrun',
  });
  assert.deepEqual(classifyRelativePath('case/Allrun.1'), {
    category: 'scripts',
    fileKey: 'Allrun',
  });
});

test('builds normalized contextual paths', () => {
  const text = [
    'boundaryField',
    '{',
    '    inlet',
    '    {',
    '        type ',
  ].join('\n');

  assert.equal(getContextPath(text), 'boundaryField/{patch}');

  const actionsText = [
    'actions',
    '(',
    '    {',
    '        name c0;',
    '        type ',
  ].join('\n');
  assert.equal(getContextPath(actionsText), 'actions/{action}');
});

test('suggests contextual keywords and observed values', () => {
  const entries = [
    {
      keyword: 'type',
      context: 'boundaryField/{patch}',
      path: 'boundaryField/{patch}/type',
      kinds: ['entry'],
      occurrences: 10,
      fileCount: 5,
      values: [{ value: 'fixedValue', occurrences: 7 }],
      examples: [],
    },
    {
      keyword: 'application',
      context: '',
      path: 'application',
      kinds: ['entry'],
      occurrences: 20,
      fileCount: 10,
      values: [{ value: 'simpleFoam', occurrences: 8 }],
      examples: [],
    },
  ];

  assert.deepEqual(
    getKeywordCandidates(entries, 'boundaryField/inlet', 'ty').map((item) => item.keyword),
    ['type'],
  );
  assert.deepEqual(
    getValueCandidates(entries, 'boundaryField/inlet', 'type', 'fix').map((item) => item.value),
    ['fixedValue'],
  );
});

test('falls back to broader contexts when an exact context has no match', () => {
  const entries = [
    {
      keyword: 'type',
      context: 'boundaryField/{patch}',
      path: 'boundaryField/{patch}/type',
      kinds: ['entry'],
      occurrences: 5,
      fileCount: 1,
      values: [{ value: 'fixedValue', occurrences: 5 }],
      examples: [],
    },
    {
      keyword: 'convergence',
      context: 'solvers/{solver}',
      path: 'solvers/{solver}/convergence',
      kinds: ['entry'],
      occurrences: 3,
      fileCount: 1,
      values: [],
      examples: [],
    },
  ];

  assert.deepEqual(
    getKeywordCandidates(entries, '', 'conv').map((item) => item.keyword),
    ['convergence'],
  );
  assert.deepEqual(
    getKeywordCandidates(entries, 'solvers/{solver}/sub', 'conv').map((item) => item.keyword),
    ['convergence'],
  );
  assert.deepEqual(
    getValueCandidates(entries, 'unknown/context', 'type', 'fix').map((item) => item.value),
    ['fixedValue'],
  );
});

test('matches partial text inside OpenFOAM identifiers', () => {
  assert.equal(getSearchMatchScore('fixedValue', 'value'), 2);
  assert.equal(getSearchMatchScore('writeControl', 'Control'), 2);
  assert.equal(getSearchMatchScore('application', 'app'), 1);
  assert.equal(getSearchMatchScore('writeControl', 'wc'), 3);
  assert.equal(getSearchMatchScore('fixedValue', 'fv'), 3);
  assert.equal(getSearchMatchScore('application', 'xyz'), -1);
});

test('matches compact forms across spaces and dictionary punctuation', () => {
  assert.equal(compactSearchQuery('div(phi,U)'), 'divphiu');
  assert.equal(compactSearchQuery('Gauss linearUpwindV'), 'gausslinearupwindv');
  assert.equal(getSearchMatchScore('linearUpwindV', 'linear upwind'), 3);
  assert.equal(getSearchMatchScore('div(phi,U)', 'div phi U'), 3);
});

test('builds client filter text with normalized and compact variants', () => {
  const filterText = getCompletionFilterText('Gauss linear', 'Gauss limitedLinearV 1');
  assert.ok(filterText.includes('Gauss linear'));
  assert.ok(filterText.includes('gauss linear'));
  assert.ok(filterText.includes('gausslinear'));
  assert.ok(filterText.includes('Gauss limitedLinearV 1'));
  assert.ok(filterText.includes('gausslimitedlinearv1'));
});

test('parses multi-token value prefixes', () => {
  assert.deepEqual(
    getCompletionContext('        default Gauss linear'),
    { type: 'value', keyword: 'default', prefix: 'Gauss linear', prefixStart: 16 },
  );
  assert.deepEqual(
    getCompletionContext('        default '),
    { type: 'value', keyword: 'default', prefix: '', prefixStart: 16 },
  );
  assert.deepEqual(
    getCompletionContext('        divSchemes'),
    { type: 'keyword', prefix: 'divSchemes', prefixStart: 8 },
  );
  assert.deepEqual(
    getCompletionContext('        div('),
    { type: 'keyword', prefix: 'div(', prefixStart: 8 },
  );
  assert.deepEqual(
    getCompletionContext('        div(phi,U'),
    { type: 'keyword', prefix: 'div(phi,U', prefixStart: 8 },
  );
  assert.deepEqual(
    getCompletionContext('        div(phi,U)'),
    { type: 'keyword', prefix: 'div(phi,U)', prefixStart: 8 },
  );
  assert.deepEqual(
    getCompletionContext('        default Gauss '),
    { type: 'value', keyword: 'default', prefix: 'Gauss', prefixStart: 16 },
  );
});

test('parses value context for parenthesized dictionary keys', () => {
  assert.deepEqual(
    getCompletionContext('        div(phi,U) Gauss limitedLinearV'),
    {
      type: 'value',
      keyword: 'div(phi,U)',
      prefix: 'Gauss limitedLinearV',
      prefixStart: 19,
    },
  );
  assert.deepEqual(
    getCompletionContext('        laplacian(nu,U) '),
    { type: 'value', keyword: 'laplacian(nu,U)', prefix: '', prefixStart: 24 },
  );
});

test('matches generated wildcard keyword patterns for value completion', () => {
  const entries = [
    {
      keyword: 'div(phi.*,U.*)',
      context: 'divSchemes',
      values: [{ value: 'Gauss limitedLinearV 1', occurrences: 32 }],
    },
    {
      keyword: 'div(phi,(k|omega))',
      context: 'divSchemes',
      values: [{ value: 'Gauss upwind', occurrences: 2 }],
    },
  ];

  assert.deepEqual(
    getValueCandidates(entries, 'divSchemes', 'div(phi,U)', 'limitedLinearV'),
    [{ value: 'Gauss limitedLinearV 1', occurrences: 32 }],
  );
  assert.deepEqual(
    getValueCandidates(entries, 'divSchemes', 'div(phi,k)', 'upwind'),
    [{ value: 'Gauss upwind', occurrences: 2 }],
  );
});

test('broadens scheme values across the same fvSchemes block', () => {
  const entries = [
    {
      keyword: 'div(phi,U)',
      context: 'divSchemes',
      values: [{ value: 'Gauss limitedLinearV 1', occurrences: 1 }],
    },
    {
      keyword: 'default',
      context: 'divSchemes',
      values: [
        { value: 'Gauss linear', occurrences: 20 },
        { value: 'Gauss linearUpwind grad(U)', occurrences: 10 },
        { value: 'bounded Gauss linearUpwindV grad(U)', occurrences: 1 },
      ],
    },
    {
      keyword: 'default',
      context: 'gradSchemes',
      values: [{ value: 'cellLimited Gauss linear 1', occurrences: 5 }],
    },
  ];

  const values = getValueCandidates(entries, 'divSchemes', 'div(phi,U)', 'Gauss linear', 500);
  assert.ok(values.length >= 4);
  assert.ok(values.some((item) => item.value === 'Gauss linear'));
  assert.ok(values.some((item) => item.value === 'Gauss linearUpwind grad(U)'));
  assert.ok(values.some((item) => item.value === 'bounded Gauss linearUpwindV grad(U)'));
  assert.ok(!values.some((item) => item.value === 'cellLimited Gauss linear 1'));

  const direct = getSchemeValueCandidates(entries, 'divSchemes', 'linear', 500);
  assert.ok(direct.length >= 3);
  assert.ok(direct.some((item) => item.value === 'Gauss linearUpwind grad(U)'));
  assert.ok(!direct.some((item) => item.value === 'cellLimited Gauss linear 1'));
});

test('returns broad linear completions from the generated fvSchemes index', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const projectRoot = path.resolve(__dirname, '..');
  const fvSchemes = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'data', 'keywords', 'system', 'fvSchemes.json'), 'utf8'),
  );

  const values = getValueCandidates(
    fvSchemes.entries || [],
    'divSchemes',
    'div(phi,U)',
    'Gauss linear',
    500,
  );
  assert.ok(values.length >= 30, 'expected at least 30 scheme values, got ' + values.length);
  assert.ok(values.some((item) => item.value === 'Gauss linearUpwindV'));
  assert.ok(values.some((item) => item.value === 'Gauss limitedLinearV 1'));

  const compact = getValueCandidates(
    fvSchemes.entries || [],
    'divSchemes',
    'div(phi,U)',
    'Gauss lin up',
    500,
  );
  assert.ok(compact.length >= 10, 'expected compact input to match at least 10 values');

  const direct = getSchemeValueCandidates(fvSchemes.entries || [], 'divSchemes', 'linear', 500);
  assert.ok(direct.length >= 30, 'expected at least 30 direct scheme values, got ' + direct.length);
  assert.ok(direct.some((item) => item.value === 'Gauss linearUpwindV'));
});

test('offers values after a unique partial or case-insensitive keyword', () => {
  const entries = [
    {
      keyword: 'writeControl',
      context: '',
      values: [{ value: 'timeStep', occurrences: 3 }],
    },
    {
      keyword: 'writeFormat',
      context: '',
      values: [{ value: 'ascii', occurrences: 1 }],
    },
  ];

  assert.deepEqual(
    getValueCandidates(entries, '', 'writeCont', 'tim'),
    [{ value: 'timeStep', occurrences: 3 }],
  );
  assert.deepEqual(
    getValueCandidates(entries, '', 'writecontrol', 'tim'),
    [{ value: 'timeStep', occurrences: 3 }],
  );
  assert.deepEqual(getValueCandidates(entries, '', 'write', ''), []);
});

test('ignores completions inside multi-line block comments', () => {
  assert.equal(isInsideBlockComment('/* open comment\n type'), true);
  assert.equal(isInsideBlockComment('/* closed comment */\ntype'), false);
  assert.equal(isInsideBlockComment('"/* not a comment */"'), false);
});

test('suggests script utilities and variables', () => {
  const data = {
    commands: [{ name: 'cd', occurrences: 2 }],
    helpers: [{ name: 'runApplication', occurrences: 3 }],
    utilities: [{ name: 'blockMesh', occurrences: 4 }],
    variables: [{ name: 'WM_PROJECT_DIR', occurrences: 5 }],
  };

  assert.deepEqual(
    getScriptCandidates(data, 'runApplication block').map((item) => item.label),
    ['blockMesh'],
  );
  assert.deepEqual(
    getScriptCandidates(data, '. ${WM_').map((item) => item.label),
    ['$WM_PROJECT_DIR'],
  );
  const bracedContext = getCompletionContext('. ${WM_');
  assert.deepEqual(
    getScriptCandidates(data, '. ${WM_', bracedContext.prefix).map(
      (item) => ({ label: item.label, insertText: item.insertText }),
    ),
    [{ label: '$WM_PROJECT_DIR', insertText: '${WM_PROJECT_DIR}' }],
  );
});

test('loads the generated index for a concrete OpenFOAM case file', () => {
  const path = require('node:path');
  const { KeywordStore } = require('../src/keyword-store');
  const projectRoot = path.resolve(__dirname, '..');
  const store = new KeywordStore(projectRoot);
  const info = store.lookup(projectRoot, path.join(projectRoot, 'case', 'system', 'controlDict'));

  assert.ok(info);
  assert.equal(info.category, 'system');
  assert.equal(info.fileKey, 'controlDict');
  assert.ok(info.data.entries.some((entry) => entry.keyword === 'application'));
});
test('recognizes OpenFOAM files with trailing suffixes', () => {
  const path = require('node:path');
  const { KeywordStore } = require('../src/keyword-store');
  const projectRoot = path.resolve(__dirname, '..');
  const store = new KeywordStore(projectRoot);

  assert.deepEqual(getFileKeyCandidates('air/U.air.1'), [
    'air/U.air.1',
    'air/U.air',
  ]);
  assert.deepEqual(getFileKeyCandidates('air/U.air'), ['air/U.air']);

  for (const [relativePath, category, fileKey] of [
    ['case/system/controlDict.1', 'system', 'controlDict'],
    ['case/system/controlDict.2', 'system', 'controlDict'],
    ['case/system/controlDict.x', 'system', 'controlDict'],
    ['case/system/controlDict.y', 'system', 'controlDict'],
    ['case/system/fvSchemes.1', 'system', 'fvSchemes'],
    ['case/constant/transportProperties.x', 'constant', 'transportProperties'],
    ['case/0/U.x', '0', 'U'],
    ['case/0/p.y', '0', 'p'],
    ['case/0/air/U.x', '0', 'air/U'],
    ['case/Allclean.2', 'scripts', 'Allclean'],
  ]) {
    const info = store.lookup(projectRoot, path.join(projectRoot, ...relativePath.split('/')));
    assert.ok(info, `expected lookup to recognize ${relativePath}`);
    assert.equal(info.category, category);
    assert.equal(info.fileKey, fileKey);
  }

  assert.equal(
    store.lookup(projectRoot, path.join(projectRoot, 'case', 'system', 'notAControlDict.1')),
    null,
  );
  assert.equal(
    store.lookup(projectRoot, path.join(projectRoot, 'case', '0', 'unindexedRegion', 'U.x')),
    null,
  );
});
test('contributes and binds the OpenFOAM dictionary language', () => {
  const path = require('node:path');
  const fs = require('node:fs');
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
  const language = packageJson.contributes.languages.find((item) => item.id === 'openfoam-dict');

  assert.ok(language);
  assert.equal(language.configuration, './language-configuration.json');
  assert.ok(packageJson.contributes.commands.some(
    (item) => item.command === 'openfoamIntellisense.setLanguage',
  ));
});
test('extracts OpenFOAM dictionary calls from source without changing case', async () => {
  const { extractDictionaryCalls } = await import('../tools/openfoam-source-scanner.mjs');
  const calls = extractDictionaryCalls(`
    coeffs.readIfPresent("Pr", Pr_);
    solution.get<scalar>("tolerance");
    dict->readIfPresent("rho", rho);
    config::lookup("nu", nu);
    args.get<scalar>("ignored");
  `);

  assert.deepEqual(
    calls.map((item) => ({ keyword: item.keyword, receiver: item.receiver, method: item.method })),
    [
      { keyword: 'Pr', receiver: 'coeffs', method: 'readIfPresent' },
      { keyword: 'tolerance', receiver: 'solution', method: 'get<scalar>' },
      { keyword: 'rho', receiver: 'dict', method: 'readIfPresent' },
      { keyword: 'nu', receiver: 'config', method: 'lookup' },
    ],
  );
});

test('contains source-derived settings in the generated indexes', () => {
  const path = require('node:path');
  const { KeywordStore } = require('../src/keyword-store');
  const projectRoot = path.resolve(__dirname, '..');
  const store = new KeywordStore(projectRoot);
  const control = store.lookup(projectRoot, path.join(projectRoot, 'case', 'system', 'controlDict'));
  const solution = store.lookup(projectRoot, path.join(projectRoot, 'case', 'system', 'fvSolution'));

  assert.ok(control.data.entries.some((entry) => entry.sourceOccurrences > 0));
  assert.ok(solution.data.entries.some(
    (entry) => entry.keyword === 'cacheAgglomeration' && entry.sourceTypes.includes('GAMG'),
  ));
});
test('keeps source-derived keyword supplements in independent files', () => {
  const path = require('node:path');
  const fs = require('node:fs');
  const root = path.resolve(__dirname, '..', 'data', 'keyword-supplements');
  const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const surface = read('fvSchemes/surfaceInterpolation.json');
  const solvers = read('fvSolution/solvers.json');
  const preconditioners = read('fvSolution/preconditioners.json');
  const boundaries = read('0/fvPatchFields.json');
  const lesDelta = read('constant/turbulenceModels/LES/LESdelta.json');
  const lesFilter = read('constant/turbulenceModels/LES/LESfilter.json');
  const convection = read('fvSchemes/convectionSchemes.json');
  const d2dt2 = read('fvSchemes/d2dt2Schemes.json');
  const functionObjects = read('system/functionObjects.json');

  assert.ok(surface.items.some((item) => item.name === 'limitedLinearV'));
  assert.ok(surface.items.some((item) => item.name === 'linearUpwindV'));
  assert.ok(surface.items.some((item) => item.name === 'MUSCLV'));
  assert.ok(surface.items.some((item) => item.name === 'interfaceCompression'));
  assert.ok(surface.items.some((item) => item.name === 'DEShybrid'));
  assert.ok(surface.items.some((item) => item.name === 'linearFit'));
  assert.ok(surface.items.some((item) => item.name === 'Phi'));
  assert.ok(solvers.items.some((item) => item.name === 'GAMG'));
  assert.ok(solvers.items.some((item) => item.name === 'PBiCGStab'));
  assert.ok(solvers.items.some((item) => item.name === 'smoothSolver'));
  assert.ok(preconditioners.items.some((item) => item.name === 'DIC'));
  assert.ok(preconditioners.items.some((item) => item.name === 'DILU'));
  assert.ok(boundaries.items.some((item) => item.name === 'movingWallVelocity'));
  assert.ok(boundaries.items.some((item) => item.name === 'pressureInletOutletVelocity'));
  assert.ok(boundaries.items.some((item) => item.name === 'externalCoupledTemperature'));
  for (const name of ['cubeRootVol', 'DeltaOmegaTilde', 'IDDESDelta', 'maxDeltaxyz', 'maxDeltaxyzCubeRoot', 'Prandtl', 'SLADelta', 'smooth', 'vanDriest']) {
    assert.ok(lesDelta.items.some((item) => item.name === name), `missing LES delta: ${name}`);
  }
  for (const name of ['anisotropic', 'laplace', 'simple']) {
    assert.ok(lesFilter.items.some((item) => item.name === name), `missing LES filter: ${name}`);
  }
  assert.ok(convection.items.some((item) => item.name === 'bounded'));
  assert.ok(convection.items.some((item) => item.name === 'Gauss'));
  assert.ok(d2dt2.items.some((item) => item.name === 'Euler'));
  assert.ok(d2dt2.items.some((item) => item.name === 'steadyState'));
  assert.ok(functionObjects.items.some((item) => item.name === 'patchProbes'));
  assert.ok(functionObjects.items.some((item) => item.name === 'sixDoFRigidBodyState'));
  assert.ok(!lesDelta.items.some((item) => item.name === 'smoothDelta'));
  assert.ok(!lesFilter.items.some((item) => item.name === 'anisotropicFilter'));

  const divKeys = read('fvSchemes/divSchemesKeys.json');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.groupCount, manifest.groups.length);
  assert.equal(
    manifest.itemCount,
    manifest.groups.reduce((sum, group) => sum + group.itemCount, 0),
  );
  const divGroup = manifest.groups.find((group) => group.group === 'fvSchemes/divSchemesKeys');
  assert.ok(divGroup, 'missing concrete divSchemes key supplement in the manifest');
  assert.equal(divGroup.itemCount, divKeys.items.length);
  assert.equal(divGroup.manualItemCount, divKeys.manualItems.length);

  const topoSetActions = read('system/topoSet/actions.json');
  const topoSetSources = read('system/topoSet/sources.json');
  const topoSetParameters = read('system/topoSet/parameters.json');
  assert.ok(topoSetActions.items.some((item) => item.name === 'new'));
  assert.ok(topoSetActions.items.some((item) => item.name === 'subset'));
  assert.ok(topoSetSources.items.some((item) => item.name === 'boxToCell'));
  assert.ok(topoSetParameters.items.some((item) => item.name === 'box'));
  const absoluteLocations = topoSetParameters.items
    .flatMap((item) => item.sourceLocations || [])
    .filter((location) => /^[A-Za-z]:[\\/]|^\//.test(location));
  assert.deepEqual(absoluteLocations, []);
  for (const group of [
    'system/topoSet/actions',
    'system/topoSet/parameters',
    'system/topoSet/setTypes',
    'system/topoSet/sources',
  ]) {
    assert.ok(manifest.groups.some((item) => item.group === group), `missing ${group}`);
  }

  const packageJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
  );
  assert.match(packageJson.scripts['extract:keywords'], /build-toposet-supplements\.mjs/);
});

test('covers source-registered divergence interpolation schemes', () => {
  const path = require('node:path');
  const fs = require('node:fs');
  const root = path.resolve(__dirname, '..', 'data', 'keyword-supplements');
  const surface = JSON.parse(fs.readFileSync(path.join(root, 'fvSchemes', 'surfaceInterpolation.json'), 'utf8'));
  const names = new Set(surface.items.map((item) => item.name));

  for (const name of [
    'interfaceCompression',
    'DEShybrid',
    'Phi',
    'blended',
    'biLinearFit',
    'cubicUpwindFit',
    'linearFit',
    'linearPureUpwindFit',
    'quadraticFit',
    'quadraticLinearFit',
    'quadraticLinearPureUpwindFit',
    'quadraticLinearUpwindFit',
    'quadraticUpwindFit',
    'skewCorrected',
    'cubic',
  ]) {
    assert.ok(names.has(name), `missing source-registered surface interpolation scheme: ${name}`);
  }

  for (const name of ['skewLinear', 'cubicCorrected', 'noInterfaceCompression']) {
    assert.ok(!names.has(name), `unexpected non-registered scheme name: ${name}`);
  }
});

test('indexes concrete divSchemes keys and exposes them from div completion', () => {
  const path = require('node:path');
  const fs = require('node:fs');
  const root = path.resolve(__dirname, '..');
  const supplement = JSON.parse(
    fs.readFileSync(
      path.join(root, 'data', 'keyword-supplements', 'fvSchemes', 'divSchemesKeys.json'),
      'utf8',
    ),
  );
  const expectedKeys = [...supplement.items, ...supplement.manualItems].map((item) => item.name);
  for (const key of [
    'div(phi,U)',
    'div(rhoPhi,U)',
    'div(phirb,alpha)',
    'div(rhoPhi,omega)',
  ]) {
    assert.ok(expectedKeys.includes(key), `missing concrete divergence key: ${key}`);
  }

  const fvSchemes = JSON.parse(
    fs.readFileSync(path.join(root, 'data', 'keywords', 'system', 'fvSchemes.json'), 'utf8'),
  );
  const entries = fvSchemes.entries || [];
  for (const key of ['div(phi,U)', 'div(rhoPhi,U)', 'div(phirb,alpha)', 'div(rhoPhi,omega)']) {
    const entry = entries.find((item) => item.keyword === key && item.context === 'divSchemes');
    assert.ok(entry, `missing runtime index entry for ${key}`);
  }
  const defaultEntry = entries.find(
    (item) => item.keyword === 'default' && item.context === 'divSchemes',
  );
  assert.ok(defaultEntry);
  assert.ok(defaultEntry.values.length >= 80, 'too few shared divSchemes values');
  const manualEntry = entries.find(
    (item) => item.keyword === 'div(rhoPhi,omega)' && item.context === 'divSchemes',
  );
  assert.equal(manualEntry.values.length, 0);
  assert.equal(manualEntry.sourceOccurrences, 0);

  const candidates = getKeywordCandidates(entries, 'divSchemes', 'div', 500);
  const concrete = candidates.filter((item) => item.keyword.startsWith('div('));
  assert.ok(concrete.length >= expectedKeys.length, `expected at least ${expectedKeys.length} concrete div completions, got ${concrete.length}`);
  for (const key of expectedKeys) {
    assert.ok(concrete.some((item) => item.keyword === key), `div completion missing ${key}`);
  }

  const values = getValueCandidates(entries, 'divSchemes', 'div(rhoPhi,omega)', 'linear', 500);
  assert.ok(values.length >= 20, `expected broad linear values, got ${values.length}`);
  assert.ok(values.some((item) => item.value === 'Gauss linear'));
  assert.ok(values.some((item) => item.value === 'Gauss limitedLinear 1'));
  assert.ok(values.every((item) => item.shared));
});

test('merges TopoSet supplements into contextual runtime entries', () => {
  const path = require('node:path');
  const fs = require('node:fs');
  const root = path.resolve(__dirname, '..');
  const topoSet = JSON.parse(
    fs.readFileSync(path.join(root, 'data', 'keywords', 'system', 'topoSetDict.json'), 'utf8'),
  );
  const entries = topoSet.entries || [];
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));

  assert.deepEqual(
    byPath.get('actions/{action}/type').values.map((item) => item.value).sort(),
    ['cellSet', 'cellZoneSet', 'faceSet', 'faceZoneSet', 'pointSet', 'pointZoneSet'],
  );
  assert.ok(byPath.get('actions/{action}/action').values.some((item) => item.value === 'new'));
  assert.ok(byPath.get('actions/{action}/source').values.some((item) => item.value === 'boxToCell'));
  assert.ok(byPath.has('actions/{action}/box'));
});

test('merges source supplements into the runtime keyword indexes', () => {
  const path = require('node:path');
  const fs = require('node:fs');
  const root = path.resolve(__dirname, '..', 'data', 'keywords');
  const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const values = (document, entryPath) => {
    const entry = document.entries.find((item) => item.path === entryPath);
    return (entry ? entry.values : []).map((item) => item.value);
  };

  const schemes = read('system/fvSchemes.json');
  const solution = read('system/fvSolution.json');
  const boundary = read('0/U.json');
  const control = read('system/controlDict.json');
  const turbulence = read('constant/turbulenceProperties.json');

  assert.ok(values(schemes, 'divSchemes/default').includes('Gauss limitedLinearV 1'));
  assert.ok(values(schemes, 'divSchemes/default').includes('Gauss interfaceCompression'));
  assert.ok(values(schemes, 'divSchemes/default').includes('Gauss DEShybrid'));
  assert.ok(values(schemes, 'divSchemes/default').includes('Gauss linearUpwindV'));
  assert.ok(values(schemes, 'convectionSchemes/default').includes('bounded'));
  assert.ok(values(schemes, 'd2dt2Schemes/default').includes('Euler'));
  assert.ok(values(schemes, 'snGradSchemes/default').includes('corrected'));
  assert.ok(values(solution, 'solvers/{solver}/solver').includes('GAMG'));
  assert.ok(values(solution, 'solvers/{solver}/solver').includes('PBiCGStab'));
  assert.ok(values(solution, 'solvers/{solver}/preconditioner').includes('DILU'));
  assert.ok(values(boundary, 'boundaryField/{patch}/type').includes('pressureInletOutletVelocity'));
  assert.ok(values(control, 'functions/{function}/type').includes('fieldAverage'));
  assert.ok(values(control, 'functions/{function}/type').includes('patchProbes'));
  assert.ok(values(control, 'functions/{function}/type').includes('sixDoFRigidBodyState'));
  assert.ok(values(turbulence, 'RAS/RASModel').includes('kOmegaSST'));
  assert.ok(values(turbulence, 'LES/delta').includes('smooth'));
  assert.ok(values(turbulence, 'LES/dynamicKEqnCoeffs/filter').includes('anisotropic'));
});

test('contains auxiliary application, bin, and boundary-condition indexes', () => {
  const path = require('node:path');
  const fs = require('node:fs');
  const root = path.resolve(__dirname, '..', 'data', 'keywords');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

  assert.ok(manifest.auxiliary);
  assert.ok(manifest.auxiliary.applications.groupCount > 0);
  assert.ok(manifest.auxiliary.bin.fileCount > 0);
  assert.ok(manifest.auxiliary.boundaryConditions.conditionCount > 0);
  assert.ok(fs.existsSync(path.join(root, 'applications', 'manifest.json')));
  assert.ok(fs.existsSync(path.join(root, 'bin', 'manifest.json')));
  assert.ok(fs.existsSync(path.join(root, 'boundary-conditions', 'fixedValue.json')));
});
test('uses the MIT open-source license', () => {
  const path = require('node:path');
  const fs = require('node:fs');
  const projectRoot = path.resolve(__dirname, '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const license = fs.readFileSync(path.join(projectRoot, 'LICENSE'), 'utf8');

  assert.equal(packageJson.license, 'MIT');
  assert.match(license, /^MIT License/m);
  assert.match(license, /Copyright \(c\) 2026 boyaoChen/);
});

test('reports only selectable patch field classes as boundary conditions', () => {
  const path = require('node:path');
  const fs = require('node:fs');
  const root = path.resolve(__dirname, '..', 'data', 'keywords');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const directory = path.join(root, 'boundary-conditions');
  const files = fs.readdirSync(directory).sort();
  const names = files.map((file) => path.basename(file, '.json'));

  // Helper classes, macro headers, mappers and forward declarations live in the
  // same source directories but are not selectable `type` values.
  for (const helper of [
    'fvPatchFieldBase',
    'fvPatchFieldMacros',
    'fvPatchFieldMapper',
    'fvPatchFieldsFwd',
    'pointPatchFieldBase',
    'pointPatchFieldsFwd',
    'mappedPatchFieldBase',
    'IntegralScaleBox',
    'makeSampledPatchFunction1s',
    'sampled',
  ]) {
    assert.ok(!names.includes(helper), `${helper} must not be reported as a boundary condition`);
  }

  assert.ok(names.includes('fixedValue'));
  // Multiple inheritance: processorLduInterfaceField *and* coupledFvPatchField.
  assert.ok(names.includes('calculatedProcessor'));

  const entry = JSON.parse(fs.readFileSync(path.join(directory, 'fixedValue.json'), 'utf8'));
  assert.equal(entry.typeName, 'fixedValue');
  assert.equal(entry.patchKind, 'fvPatchField');
  assert.ok(entry.sourceFiles.some((source) => /fixedValueFvPatchField\.H$/.test(source)));

  // The declared count and the shipped files must describe the same catalog.
  assert.equal(manifest.auxiliary.boundaryConditions.conditionCount, names.length);
});

test('stores every boundary condition under a file-safe name', () => {
  const path = require('node:path');
  const fs = require('node:fs');
  const root = path.resolve(__dirname, '..', 'data', 'keywords', 'boundary-conditions');
  const files = fs.readdirSync(root).filter((file) => file.endsWith('.json'));
  const entries = files.map((file) => ({
    file,
    entry: JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')),
  }));

  for (const { file, entry } of entries) {
    // Namespaced types such as `compressible::alphatWallFunction` must not leak
    // illegal file-name characters; the real name stays inside the JSON.
    assert.match(path.basename(file, '.json'), /^[A-Za-z0-9_.-]+$/);
    assert.ok(entry.typeName, `${file} must keep its real type name`);
  }

  const namespaced = entries.filter(({ entry }) => entry.typeName.includes('::'));
  assert.ok(namespaced.length > 0, 'namespaced wall-function types must be catalogued');
});

test('keeps the generated REVIEW.md sections for applications and bin', () => {
  const path = require('node:path');
  const fs = require('node:fs');
  const review = fs.readFileSync(
    path.resolve(__dirname, '..', 'data', 'source-supplements', 'REVIEW.md'),
    'utf8',
  );

  assert.match(review, /^# OpenFOAM Keyword Supplement Review/m);
  assert.match(review, /^## Applications Supplement$/m);
  assert.match(review, /^## Bin Supplement$/m);
  assert.match(review, /- Shell script files: \d+/);
});

test('contributes syntax highlighting for the OpenFOAM dictionary language', () => {
  const path = require('node:path');
  const fs = require('node:fs');
  const projectRoot = path.resolve(__dirname, '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const grammar = packageJson.contributes.grammars.find(
    (item) => item.language === 'openfoam-dict',
  );

  assert.ok(grammar);
  assert.equal(grammar.scopeName, 'source.openfoam-dict');

  const grammarPath = path.resolve(projectRoot, grammar.path);
  assert.ok(fs.existsSync(grammarPath));
  const parsed = JSON.parse(fs.readFileSync(grammarPath, 'utf8'));
  assert.equal(parsed.scopeName, grammar.scopeName);
  assert.ok(Array.isArray(parsed.patterns) && parsed.patterns.length > 0);

  // Sub-dictionary keys usually own their line, with the '{' on the next one,
  // so the entry-key rule must accept end-of-line as well as a value or '{'.
  const entryKeys = new RegExp(parsed.repository['entry-keys'].match);
  assert.ok(entryKeys.test('boundaryField'));
  assert.ok(entryKeys.test('    inlet {'));
  assert.ok(entryKeys.test('type fixedValue;'));
  assert.ok(!entryKeys.test('    1.5'));
});

test('loads the keyword index lazily and only for OpenFOAM case paths', () => {
  const path = require('node:path');
  const { KeywordStore } = require('../src/keyword-store');
  const projectRoot = path.resolve(__dirname, '..');

  // Construction must not read the ~220 KB manifest, and an unrelated file must
  // never trigger that read - otherwise every VS Code window pays for it.
  const store = new KeywordStore(projectRoot);
  assert.equal(store.manifest, null);
  assert.equal(store.lookup(projectRoot, path.join(projectRoot, 'README.md')), null);
  assert.equal(store.manifest, null);

  // A real case file loads the index on demand.
  assert.ok(store.lookup(projectRoot, path.join(projectRoot, 'case', 'system', 'controlDict')));
  assert.ok(store.manifest);

  // A missing index directory is only reported when the index is actually used.
  const broken = new KeywordStore(path.join(projectRoot, 'missing-extension'));
  assert.equal(broken.lookup(projectRoot, path.join(projectRoot, 'notes.txt')), null);
  assert.throws(() => broken.getStats(), /ENOENT/);
});

test('resolves case-colliding 0 files independently', () => {
  const path = require('node:path');
  const { KeywordStore } = require('../src/keyword-store');
  const projectRoot = path.resolve(__dirname, '..');
  const store = new KeywordStore(projectRoot);

  const lower = store.lookup(projectRoot, path.join(projectRoot, 'case', '0', 'air.gas'));
  const upper = store.lookup(projectRoot, path.join(projectRoot, 'case', '0', 'AIR.gas'));

  assert.ok(lower);
  assert.ok(upper);
  assert.notEqual(lower.output, upper.output);
  assert.equal(lower.fileKey, 'air.gas');
  assert.equal(upper.fileKey, 'AIR.gas');
});

test('resolves the extraction corpus from the environment or the project root', async () => {
  const path = require('node:path');
  const { resolveOpenFoamRoot } = await import('../tools/openfoam-source-root.mjs');
  const projectRoot = path.resolve(__dirname, '..');

  assert.equal(path.basename(resolveOpenFoamRoot(projectRoot)), 'OpenFOAM-v2606');

  const previous = process.env.OPENFOAM_SOURCE_ROOT;
  try {
    process.env.OPENFOAM_SOURCE_ROOT = projectRoot;
    assert.equal(resolveOpenFoamRoot(projectRoot), projectRoot);

    process.env.OPENFOAM_SOURCE_ROOT = path.join(projectRoot, 'does-not-exist');
    assert.throws(() => resolveOpenFoamRoot(projectRoot), /OPENFOAM_SOURCE_ROOT is not a directory/);
  }
  finally {
    if (previous === undefined) {
      delete process.env.OPENFOAM_SOURCE_ROOT;
    }
    else {
      process.env.OPENFOAM_SOURCE_ROOT = previous;
    }
  }
});

test('names the extraction corpus in a single place', () => {
  const path = require('node:path');
  const fs = require('node:fs');
  const toolsRoot = path.resolve(__dirname, '..', 'tools');
  const offenders = fs.readdirSync(toolsRoot)
    .filter((file) => file.endsWith('.mjs') && file !== 'openfoam-source-root.mjs')
    .filter((file) => fs.readFileSync(path.join(toolsRoot, file), 'utf8').includes('OpenFOAM-v2606'));

  // Every other tool must go through resolveOpenFoamRoot(), otherwise the
  // generated labels break as soon as OPENFOAM_SOURCE_ROOT points elsewhere.
  assert.deepEqual(offenders, [], 'hard-coded corpus directory name');
});

test('formats the index summary shown by the Show Keyword Index Information command', () => {
  const summary = formatIndexStats({
    source: 'OpenFOAM-v2606/tutorials',
    categories: {
      '0': { files: 347, sourceFiles: 3474 },
      system: { files: 537, sourceFiles: 4097 },
    },
  });

  assert.equal(summary, 'OpenFOAM 索引：0: 347 个文件，system: 537 个文件；数据源 OpenFOAM-v2606/tutorials');
  // An index without categories must still produce a message instead of throwing.
  assert.equal(formatIndexStats({ source: 'unknown', categories: {} }), 'OpenFOAM 索引：；数据源 unknown');
});
