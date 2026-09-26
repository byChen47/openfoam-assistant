'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const supplements = path.join(root, 'data', 'source-supplements');
const indexes = path.join(root, 'data', 'keywords');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};
const sortedUnique = (values) => [...new Set(values)].sort((a, b) => a.localeCompare(b, 'en'));

function mergeCaseFiles() {
  const manifest = read(path.join(indexes, 'manifest.json'));
  const review = read(path.join(supplements, 'manifest.json'));
  const targetByKey = new Map();
  for (const [category, info] of Object.entries(manifest.categories)) {
    for (const item of info.files || []) targetByKey.set(`${category}|${item.fileKey}`, item);
  }

  let added = 0;
  let merged = 0;
  for (const item of review.files || []) {
    if (!['0', 'constant', 'system'].includes(item.category)) continue;
    const targetInfo = targetByKey.get(`${item.category}|${item.fileKey}`);
    if (!targetInfo) continue;
    const reviewFile = read(path.join(supplements, item.output));
    const targetFile = read(path.join(indexes, targetInfo.output));
    const entryByPath = new Map((targetFile.entries || []).map((entry) => [entry.path, entry]));

    for (const candidate of reviewFile.candidates || []) {
      let entry = entryByPath.get(candidate.path);
      if (!entry) {
        entry = {
          key: candidate.path,
          keyword: candidate.keyword,
          context: candidate.context,
          path: candidate.path,
          kinds: candidate.kinds || ['entry'],
          occurrences: candidate.sourceOccurrences || 0,
          fileCount: new Set(candidate.sourceLocations || []).size,
          sourceOccurrences: candidate.sourceOccurrences || 0,
          sourceTypes: candidate.sourceTypes || [],
          sourceLocations: candidate.sourceLocations || [],
          values: [],
          examples: [],
        };
        targetFile.entries.push(entry);
        entryByPath.set(entry.path, entry);
        added += 1;
      }
      else {
        entry.sourceOccurrences = Math.max(entry.sourceOccurrences || 0, candidate.sourceOccurrences || 0);
        entry.sourceTypes = sortedUnique([...(entry.sourceTypes || []), ...(candidate.sourceTypes || [])]);
        entry.sourceLocations = sortedUnique([...(entry.sourceLocations || []), ...(candidate.sourceLocations || [])]).slice(0, 20);
        merged += 1;
      }
    }

    targetFile.entries.sort((a, b) => a.path.localeCompare(b.path, 'en'));
    targetFile.sourceOccurrences = targetFile.entries.reduce((sum, entry) => sum + (entry.sourceOccurrences || 0), 0);
    write(path.join(indexes, targetInfo.output), targetFile);
  }
  return { added, merged };
}

function copyDirectory(sourceName, targetName) {
  const source = path.join(supplements, sourceName);
  const target = path.resolve(indexes, targetName);
  if (!target.startsWith(`${indexes}${path.sep}`)) throw new Error(`Unsafe target: ${target}`);
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
}

function main() {
  const stats = mergeCaseFiles();
  copyDirectory('boundary-conditions', 'boundary-conditions');
  copyDirectory('applications', 'applications');
  copyDirectory('bin', 'bin');

  const manifest = read(path.join(indexes, 'manifest.json'));
  const applications = read(path.join(supplements, 'applications', 'manifest.json'));
  const bin = read(path.join(supplements, 'bin', 'manifest.json'));
  const boundary = read(path.join(supplements, 'boundary-conditions.json'));
  manifest.auxiliary = {
    applications: {
      outputDirectory: 'data/keywords/applications',
      groupCount: applications.groupCount,
      keywordCount: applications.keywordCount,
      optionCount: applications.optionCount,
    },
    bin: {
      outputDirectory: 'data/keywords/bin',
      fileCount: bin.fileCount,
    },
    boundaryConditions: {
      outputDirectory: 'data/keywords/boundary-conditions',
      conditionCount: boundary.conditionCount,
      withKeywords: boundary.conditions.filter((item) => item.keywords.length > 0).length,
      withoutKeywords: boundary.conditions.filter((item) => item.keywords.length === 0).length,
    },
    mergeStats: stats,
  };
  write(path.join(indexes, 'manifest.json'), manifest);
  process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`);
}

main();