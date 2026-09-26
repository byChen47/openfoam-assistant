'use strict';

const DYNAMIC_CONTAINERS = new Map([
  ['boundaryField', 'patch'],
  ['solvers', 'solver'],
  ['functions', 'function'],
  ['fieldFunctions', 'function'],
  ['regions', 'region'],
  ['zones', 'zone'],
  ['residualControl', 'field'],
  ['fields', 'field'],
]);

const ZERO_DIR_RE = /^0(?:\.(?:orig|org))?$/;

function toPosix(value) {
  return value.split('\\').join('/');
}

function classifyRelativePath(relativePath) {
  const parts = toPosix(relativePath).split('/').filter(Boolean);
  const fileName = parts.at(-1);

  if (fileName === 'Allrun' || fileName === 'Allclean') {
    return { category: 'scripts', fileKey: fileName };
  }

  const zeroIndex = parts.findIndex((part) => ZERO_DIR_RE.test(part));
  if (zeroIndex !== -1) {
    return {
      category: '0',
      fileKey: parts.slice(zeroIndex + 1).join('/') || '0',
    };
  }

  const constantIndex = parts.indexOf('constant');
  if (constantIndex !== -1) {
    return {
      category: 'constant',
      fileKey: parts.slice(constantIndex + 1).join('/') || 'constant',
    };
  }

  const systemIndex = parts.indexOf('system');
  if (systemIndex !== -1) {
    return {
      category: 'system',
      fileKey: parts.slice(systemIndex + 1).join('/') || 'system',
    };
  }

  return null;
}

function normalizeContextSegments(segments) {
  const normalized = [...segments];

  for (let index = 0; index < normalized.length - 1; index += 1) {
    const placeholder = DYNAMIC_CONTAINERS.get(normalized[index]);
    if (placeholder && !normalized[index + 1].startsWith('{')) {
      normalized[index + 1] = `{${placeholder}}`;
    }
  }

  return normalized;
}

function normalizeContextString(context) {
  if (!context) {
    return '';
  }
  return normalizeContextSegments(context.split('/').filter(Boolean)).join('/');
}

function getContextPath(textBeforeCursor) {
  const stack = [];
  let token = '';
  let index = 0;

  while (index < textBeforeCursor.length) {
    const char = textBeforeCursor[index];
    const next = textBeforeCursor[index + 1];

    if (char === '/' && next === '/') {
      index += 2;
      while (index < textBeforeCursor.length && textBeforeCursor[index] !== '\n') {
        index += 1;
      }
      token = '';
      continue;
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (index < textBeforeCursor.length) {
        if (textBeforeCursor[index] === '*' && textBeforeCursor[index + 1] === '/') {
          index += 2;
          break;
        }
        index += 1;
      }
      token = '';
      continue;
    }

    if (char === '#' && next === '{') {
      index += 2;
      while (index < textBeforeCursor.length) {
        if (textBeforeCursor[index] === '#' && textBeforeCursor[index + 1] === '}') {
          index += 2;
          break;
        }
        index += 1;
      }
      token = '';
      continue;
    }

    if (char === '"') {
      token += char;
      index += 1;
      while (index < textBeforeCursor.length) {
        token += textBeforeCursor[index];
        if (textBeforeCursor[index] === '\\' && index + 1 < textBeforeCursor.length) {
          token += textBeforeCursor[index + 1];
          index += 2;
          continue;
        }
        if (textBeforeCursor[index] === '"') {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    if (char === '{') {
      const key = token.trim().replace(/^"(.*)"$/, '$1');
      if (key && !key.startsWith('#') && !key.startsWith('$')) {
        stack.push(key);
      }
      token = '';
      index += 1;
      continue;
    }

    if (char === '}') {
      stack.pop();
      token = '';
      index += 1;
      continue;
    }

    if (char === ';') {
      token = '';
      index += 1;
      continue;
    }

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    token += char;
    index += 1;
  }

  return normalizeContextSegments(stack).join('/');
}

function getCompletionContext(linePrefix) {
  const trimmed = linePrefix.trimEnd();
  const valueMatch = trimmed.match(/^\s*([^\s{}();]+)\s+([^\s{}();]*)$/);

  if (valueMatch) {
    return {
      type: 'value',
      keyword: valueMatch[1],
      prefix: valueMatch[2],
    };
  }

  const keywordMatch = linePrefix.match(/([^\s{}();]*)$/);
  return {
    type: 'keyword',
    prefix: keywordMatch ? keywordMatch[1] : '',
  };
}

function mergeKeywordEntries(entries) {
  const merged = new Map();

  for (const entry of entries) {
    if (!entry.keyword || entry.keyword.startsWith('{')) {
      continue;
    }

    let item = merged.get(entry.keyword);
    if (!item) {
      item = {
        keyword: entry.keyword,
        occurrences: 0,
        fileCount: 0,
        paths: new Set(),
        kinds: new Set(),
        values: new Map(),
        examples: [],
        sourceOccurrences: 0,
        sourceTypes: new Set(),
        sourceLocations: [],
      };
      merged.set(entry.keyword, item);
    }

    item.occurrences += entry.occurrences || 0;
    item.fileCount += entry.fileCount || 0;
    if (entry.path) {
      item.paths.add(entry.path);
    }
    for (const kind of entry.kinds || []) {
      item.kinds.add(kind);
    }
    for (const value of entry.values || []) {
      item.values.set(value.value, (item.values.get(value.value) || 0) + value.occurrences);
    }
    item.sourceOccurrences += entry.sourceOccurrences || 0;
    for (const sourceType of entry.sourceTypes || []) {
      item.sourceTypes.add(sourceType);
    }
    for (const sourceLocation of entry.sourceLocations || []) {
      if (item.sourceLocations.length < 5 && !item.sourceLocations.includes(sourceLocation)) {
        item.sourceLocations.push(sourceLocation);
      }
    }
    for (const example of entry.examples || []) {
      if (item.examples.length < 5 && !item.examples.includes(example)) {
        item.examples.push(example);
      }
    }
  }

  return [...merged.values()].map((item) => ({
    keyword: item.keyword,
    occurrences: item.occurrences,
    fileCount: item.fileCount,
    paths: [...item.paths].sort((a, b) => a.localeCompare(b, 'en')),
    kinds: [...item.kinds].sort((a, b) => a.localeCompare(b, 'en')),
    values: [...item.values.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'))
      .map(([value, occurrences]) => ({ value, occurrences })),
    examples: item.examples,
    sourceOccurrences: item.sourceOccurrences,
    sourceTypes: [...item.sourceTypes].sort((a, b) => a.localeCompare(b, 'en')),
    sourceLocations: item.sourceLocations,
  }));
}

function filterByPrefix(items, prefix, getText) {
  if (!prefix) {
    return items;
  }
  const lowerPrefix = prefix.toLowerCase();
  return items.filter((item) => getText(item).toLowerCase().startsWith(lowerPrefix));
}

function getKeywordCandidates(entries, contextPath, prefix = '', limit = 200) {
  const normalizedContext = normalizeContextString(contextPath);
  const exact = entries.filter((entry) => normalizeContextString(entry.context) === normalizedContext);
  let source = exact;

  if (source.length === 0) {
    source = entries.filter((entry) => !entry.context);
  }

  if (source.length === 0) {
    source = entries;
  }

  const candidates = mergeKeywordEntries(source);
  return filterByPrefix(candidates, prefix, (item) => item.keyword)
    .sort((a, b) => b.occurrences - a.occurrences || a.keyword.localeCompare(b.keyword, 'en'))
    .slice(0, limit);
}

function getValueCandidates(entries, contextPath, keyword, prefix = '', limit = 200) {
  const normalizedContext = normalizeContextString(contextPath);
  const keywordMatches = entries.filter((entry) => entry.keyword === keyword);
  const exact = keywordMatches.filter((entry) => normalizeContextString(entry.context) === normalizedContext);
  const source = exact.length > 0 ? exact : keywordMatches;
  const values = new Map();

  for (const entry of source) {
    for (const value of entry.values || []) {
      values.set(value.value, (values.get(value.value) || 0) + value.occurrences);
    }
  }

  return [...values.entries()]
    .map(([value, occurrences]) => ({ value, occurrences }))
    .filter((item) => !prefix || item.value.toLowerCase().startsWith(prefix.toLowerCase()))
    .sort((a, b) => b.occurrences - a.occurrences || a.value.localeCompare(b.value, 'en'))
    .slice(0, limit);
}

function getScriptCandidates(scriptData, linePrefix, prefix = '', limit = 200) {
  const variableMatch = linePrefix.match(/\$\{?[A-Za-z_][A-Za-z0-9_]*$/);
  if (variableMatch) {
    return filterByPrefix(scriptData.variables || [], prefix, (item) => `$${item.name}`)
      .map((item) => ({
        label: `$${item.name}`,
        insertText: item.name,
        kind: 'variable',
        occurrences: item.occurrences,
      }))
      .slice(0, limit);
  }

  if (/\b(?:runApplication|runParallel)\b/.test(linePrefix)) {
    return filterByPrefix(scriptData.utilities || [], prefix, (item) => item.name)
      .map((item) => ({
        label: item.name,
        insertText: item.name,
        kind: 'utility',
        occurrences: item.occurrences,
      }))
      .slice(0, limit);
  }

  const combined = new Map();
  for (const [kind, items] of [
    ['command', scriptData.commands || []],
    ['helper', scriptData.helpers || []],
    ['utility', scriptData.utilities || []],
  ]) {
    for (const item of items) {
      const existing = combined.get(item.name);
      if (existing) {
        existing.occurrences += item.occurrences;
        existing.kinds.add(kind);
      } else {
        combined.set(item.name, {
          label: item.name,
          insertText: item.name,
          occurrences: item.occurrences,
          kinds: new Set([kind]),
        });
      }
    }
  }

  return [...combined.values()]
    .filter((item) => !prefix || item.label.toLowerCase().startsWith(prefix.toLowerCase()))
    .sort((a, b) => b.occurrences - a.occurrences || a.label.localeCompare(b.label, 'en'))
    .slice(0, limit)
    .map((item) => ({
      label: item.label,
      insertText: item.insertText,
      kind: [...item.kinds].join('/'),
      occurrences: item.occurrences,
    }));
}

function findHoverEntries(entries, word, contextPath) {
  const normalizedContext = normalizeContextString(contextPath);
  const keywordMatches = entries.filter((entry) => entry.keyword === word);
  const valueMatches = entries.filter((entry) =>
    (entry.values || []).some((value) => value.value === word),
  );
  const matches = [...keywordMatches, ...valueMatches];

  if (matches.length === 0) {
    return [];
  }

  const exact = matches.filter((entry) => normalizeContextString(entry.context) === normalizedContext);
  return exact.length > 0 ? exact : matches;
}

function formatIndexStats(stats) {
  const parts = Object.entries(stats.categories || {}).map(
    ([category, value]) => `${category}: ${value.files} 个文件`,
  );
  return `OpenFOAM 索引：${parts.join('，')}；数据源 ${stats.source}`;
}

module.exports = {
  classifyRelativePath,
  findHoverEntries,
  formatIndexStats,
  getCompletionContext,
  getContextPath,
  getKeywordCandidates,
  getScriptCandidates,
  getValueCandidates,
  normalizeContextString,
  toPosix,
};