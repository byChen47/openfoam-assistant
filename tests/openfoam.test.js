'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyRelativePath,
  formatIndexStats,
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
