'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyRelativePath,
  getContextPath,
  getKeywordCandidates,
  getScriptCandidates,
  getValueCandidates,
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
    args.get<scalar>("ignored");
  `);

  assert.deepEqual(calls.map((item) => item.keyword), ['Pr', 'tolerance']);
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