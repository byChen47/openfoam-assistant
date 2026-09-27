'use strict';

const DYNAMIC_CONTAINERS = new Map(Object.entries(require('./dynamic-containers.json')));

const ZERO_DIR_RE = /^0(?:\.(?:orig|org))?$/;
const BACKUP_SUFFIX_RE = /\.(?:[0-9]+|orig|org|x|y|bak|old)$/i;
const SCHEME_CONTEXT_RE = /^(?:convectionSchemes|d2dt2Schemes|ddtSchemes|divSchemes|gradSchemes|interpolationSchemes|laplacianSchemes|snGradSchemes)(?:\/|$)/;

function toPosix(value) {
  return value.split('\\').join('/');
}

function classifyRelativePath(relativePath) {
  const parts = toPosix(relativePath).split('/').filter(Boolean);
  const fileName = parts.at(-1);

  for (const scriptName of ['Allrun', 'Allclean']) {
    const suffix = fileName.slice(scriptName.length);
    if (fileName === scriptName || (suffix.startsWith('.') && BACKUP_SUFFIX_RE.test(suffix))) {
      return { category: 'scripts', fileKey: scriptName };
    }
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

function getFileKeyCandidates(fileKey) {
  const normalized = toPosix(fileKey).replace(/^\/+|\/+$/g, '');
  if (!normalized) return [];

  const segments = normalized.split('/').filter(Boolean);
  const baseName = segments.pop() || '';
  const baseNames = [];
  let current = baseName;
  while (BACKUP_SUFFIX_RE.test(current)) {
    current = current.slice(0, current.lastIndexOf('.'));
    if (!current || current === '.') break;
    if (!baseNames.includes(current)) baseNames.push(current);
  }

  const candidates = [];
  const add = (value) => {
    if (value && !candidates.includes(value)) candidates.push(value);
  };

  add(normalized);
  for (const name of baseNames) add([...segments, name].join('/'));
  if (segments.length === 0) {
    for (const name of [baseName, ...baseNames]) add(name);
  }
  return candidates;
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
  let pendingListKey = null;
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

    // OpenFOAM list-of-dictionaries syntax, for example:
    // actions ( { name c0; type cellSet; } );
    // The dictionary inside the list has no textual key, so retain the list
    // key and expose it as a dynamic action/item context.
    if (char === '(') {
      const key = token.trim().replace(/^"(.*)"$/, '$1');
      if (key && !key.startsWith('#') && !key.startsWith('$')) {
        pendingListKey = key;
      }
      token = '';
      index += 1;
      continue;
    }

    if (char === '{') {
      const key = token.trim().replace(/^"(.*)"$/, '$1');
      if (key && !key.startsWith('#') && !key.startsWith('$')) {
        stack.push(key);
      }
      else if (pendingListKey) {
        const placeholder = DYNAMIC_CONTAINERS.get(pendingListKey) || 'item';
        stack.push(pendingListKey + '/{' + placeholder + '}');
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

    if (char === ')') {
      pendingListKey = null;
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
function isInsideBlockComment(textBeforeCursor) {
  const DOUBLE_QUOTE = String.fromCharCode(34);
  const SINGLE_QUOTE = String.fromCharCode(39);
  const STAR = String.fromCharCode(42);
  const SLASH = String.fromCharCode(47);
  const BACKSLASH = String.fromCharCode(92);
  const NEWLINE = String.fromCharCode(10);
  let inBlockComment = false;
  let quote = null;
  let index = 0;

  while (index < textBeforeCursor.length) {
    const char = textBeforeCursor[index];
    const next = textBeforeCursor[index + 1];

    if (inBlockComment) {
      if (char === STAR && next === SLASH) {
        inBlockComment = false;
        index += 2;
      }
      else {
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (char === BACKSLASH && index + 1 < textBeforeCursor.length) {
        index += 2;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      index += 1;
      continue;
    }

    if (char === DOUBLE_QUOTE || char === SINGLE_QUOTE) {
      quote = char;
      index += 1;
      continue;
    }

    if (char === SLASH && next === STAR) {
      inBlockComment = true;
      index += 2;
      continue;
    }

    if (char === SLASH && next === SLASH) {
      index += 2;
      while (index < textBeforeCursor.length && textBeforeCursor[index] !== NEWLINE) {
        index += 1;
      }
      continue;
    }

    index += 1;
  }

  return inBlockComment;
}

function getCompletionContext(linePrefix) {
  // Allow dictionary keys containing parentheses, for example div(phi,U),
  // grad(U) and laplacian(nu,U). Previously such lines fell back to keyword
  // completion, so values such as limitedLinearV were never offered.
  const valueMatch = linePrefix.match(/^\s*([^\s{};]+)\s+([^;{}]*)$/);

  if (valueMatch) {
    const rawPrefix = valueMatch[2];
    return {
      type: 'value',
      keyword: valueMatch[1],
      prefix: rawPrefix.trimEnd(),
      prefixStart: linePrefix.length - rawPrefix.length,
    };
  }

  const keywordMatch = linePrefix.match(/([^\s{};]*)$/);
  return {
    type: 'keyword',
    prefix: keywordMatch ? keywordMatch[1] : '',
    prefixStart: keywordMatch ? keywordMatch.index : linePrefix.length,
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

function normalizeSearchQuery(value) {
  return String(value || '')
    .replace(/^\$\{?/, '')
    .replace(/\}$/, '')
    .toLowerCase();
}

function compactSearchQuery(value) {
  return normalizeSearchQuery(value).replace(/[\s_./:()[\]{},+]+/g, '');
}

function getSearchMatchScore(text, prefix) {
  const source = normalizeSearchQuery(text);
  const query = normalizeSearchQuery(prefix);
  if (!query) {
    return 0;
  }
  if (source === query) {
    return 0;
  }
  if (source.startsWith(query)) {
    return 1;
  }
  if (source.includes(query)) {
    return 2;
  }

  // Also compare compact forms so spaces, underscores and dictionary
  // punctuation do not hide valid completions. Examples: "linear upwind"
  // matches "linearUpwind", and "div phi U" matches "div(phi,U)".
  const compactSource = compactSearchQuery(text);
  const compactQuery = compactSearchQuery(prefix);
  if (compactQuery && (compactSource === compactQuery
    || compactSource.startsWith(compactQuery)
    || compactSource.includes(compactQuery))) {
    return 3;
  }

  // Allow compact initials and other in-order fragments, for example
  // "wc" -> "writeControl" and "fv" -> "fixedValue".
  let queryIndex = 0;
  for (let sourceIndex = 0; sourceIndex < compactSource.length && queryIndex < compactQuery.length; sourceIndex += 1) {
    if (compactSource[sourceIndex] === compactQuery[queryIndex]) {
      queryIndex += 1;
    }
  }
  return compactQuery && queryIndex === compactQuery.length ? 3 : -1;
}

function getCompletionFilterText(prefix, label) {
  const variants = [
    prefix,
    normalizeSearchQuery(prefix),
    compactSearchQuery(prefix),
    label,
    normalizeSearchQuery(label),
    compactSearchQuery(label),
  ];
  return [...new Set(variants.filter((value) => value !== null && value !== undefined && value !== ''))]
    .join(' ');
}

function filterByPrefix(items, prefix, getText) {
  if (!prefix) {
    return items;
  }
  return items.filter((item) => getSearchMatchScore(getText(item), prefix) >= 0);
}

function contextSegmentMatches(left, right) {
  return left === right
    || (/^\{[^}]+\}$/.test(left) && !/^\{[^}]+\}$/.test(right))
    || (/^\{[^}]+\}$/.test(right) && !/^\{[^}]+\}$/.test(left));
}

function commonContextSegmentCount(left, right) {
  const leftSegments = left.split('/').filter(Boolean);
  const rightSegments = right.split('/').filter(Boolean);
  const length = Math.min(leftSegments.length, rightSegments.length);
  let index = 0;
  while (index < length && contextSegmentMatches(leftSegments[index], rightSegments[index])) {
    index += 1;
  }
  return index;
}

function contextStartsWith(prefix, value) {
  const prefixSegments = prefix.split('/').filter(Boolean);
  const valueSegments = value.split('/').filter(Boolean);
  if (prefixSegments.length === 0 || prefixSegments.length > valueSegments.length) {
    return false;
  }
  for (let index = 0; index < prefixSegments.length; index += 1) {
    if (!contextSegmentMatches(prefixSegments[index], valueSegments[index])) {
      return false;
    }
  }
  return true;
}

function getContextMatchScore(entryContext, normalizedContext) {
  const normalizedEntryContext = normalizeContextString(entryContext);
  const entrySegments = normalizedEntryContext.split('/').filter(Boolean);
  const currentSegments = normalizedContext.split('/').filter(Boolean);

  if (entrySegments.length === currentSegments.length
    && contextStartsWith(normalizedEntryContext, normalizedContext)
    && contextStartsWith(normalizedContext, normalizedEntryContext)) {
    return 0;
  }
  if (contextStartsWith(normalizedEntryContext, normalizedContext)) {
    return 1;
  }
  if (entrySegments.length === 0) {
    return 2;
  }
  if (contextStartsWith(normalizedContext, normalizedEntryContext)) {
    return 3;
  }

  // Keep sibling contexts available but rank them below exact, ancestor and
  // descendant matches. This avoids excluding useful values from the same
  // dictionary block while still putting the current block first.
  const commonSegments = commonContextSegmentCount(normalizedEntryContext, normalizedContext);
  if (commonSegments > 0 && commonSegments === Math.min(entrySegments.length, currentSegments.length)) {
    return 4;
  }
  return commonSegments > 0 ? 5 : 6;
}

function getKeywordCandidates(entries, contextPath, prefix = '', limit = 200) {
  const normalizedContext = normalizeContextString(contextPath);
  const matchingEntries = [];
  const contextScores = new Map();
  const matchScores = new Map();

  for (const entry of entries || []) {
    if (!entry || !entry.keyword || entry.keyword.startsWith('{')) {
      continue;
    }

    const matchScore = getSearchMatchScore(entry.keyword, prefix);
    if (matchScore < 0) {
      continue;
    }

    matchingEntries.push(entry);
    const contextScore = getContextMatchScore(entry.context, normalizedContext);
    contextScores.set(entry.keyword, Math.min(contextScores.get(entry.keyword) ?? Infinity, contextScore));
    matchScores.set(entry.keyword, Math.min(matchScores.get(entry.keyword) ?? Infinity, matchScore));
  }

  return mergeKeywordEntries(matchingEntries)
    .map((item) => ({
      item,
      contextScore: contextScores.get(item.keyword) ?? 4,
      matchScore: matchScores.get(item.keyword) ?? Infinity,
    }))
    .sort((a, b) => a.contextScore - b.contextScore
      || a.matchScore - b.matchScore
      || b.item.occurrences - a.item.occurrences
      || a.item.keyword.localeCompare(b.item.keyword, 'en'))
    .slice(0, limit)
    .map(({ item }) => item);
}

function escapeKeywordPatternCharacter(char) {
  return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchingParenIndex(pattern, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < pattern.length; index += 1) {
    if (pattern[index] === '(') depth += 1;
    else if (pattern[index] === ')' && --depth === 0) return index;
  }
  return -1;
}

function hasTopLevelAlternative(value) {
  let depth = 0;
  for (const char of value) {
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === '|' && depth === 0) return true;
  }
  return false;
}

function keywordPatternRegExp(pattern) {
  let source = '^';
  const groupStack = [];
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];

    // A dot followed by a star is the wildcard used by the generated index,
    // for example div(phi.*,U.*). A lone dot remains a literal dot.
    if (char === '.' && next === '*') {
      source += '.*';
      index += 1;
    }
    else if (char === '*') {
      source += '.*';
    }
    else if (char === '(') {
      const close = matchingParenIndex(pattern, index);
      const isAlternativeGroup = close >= 0
        && hasTopLevelAlternative(pattern.slice(index + 1, close));
      groupStack.push(isAlternativeGroup);
      source += isAlternativeGroup ? '(' : '\\(';
    }
    else if (char === ')') {
      const isAlternativeGroup = groupStack.pop();
      source += isAlternativeGroup ? ')' : '\\)';
    }
    else if (char === '|') {
      source += '|';
    }
    else {
      source += escapeKeywordPatternCharacter(char);
    }
  }
  source += '$';
  return new RegExp(source);
}

function isKeywordEntryMatch(pattern, keyword) {
  if (pattern === keyword) {
    return true;
  }
  if (!/[.*|()]/.test(pattern)) {
    return false;
  }
  try {
    return keywordPatternRegExp(pattern).test(keyword);
  }
  catch {
    return false;
  }
}

function schemeContextRoot(context) {
  const normalized = normalizeContextString(context);
  const match = normalized.match(SCHEME_CONTEXT_RE);
  return match ? match[0].replace(/\/$/, '') : null;
}

function collectValueCandidates(matchedEntries, normalizedContext, prefix, limit, directEntries = null) {
  const values = new Map();

  for (const entry of matchedEntries) {
    const contextScore = getContextMatchScore(entry.context, normalizedContext);
    const isDirect = !directEntries || directEntries.has(entry);
    for (const value of entry.values || []) {
      const matchScore = getSearchMatchScore(value.value, prefix);
      if (matchScore < 0) {
        continue;
      }

      let candidate = values.get(value.value);
      if (!candidate) {
        candidate = {
          value: value.value,
          occurrences: 0,
          contextScore: Infinity,
          matchScore: Infinity,
          shared: !isDirect,
        };
        values.set(value.value, candidate);
      }

      candidate.occurrences += value.occurrences || 0;
      candidate.contextScore = Math.min(candidate.contextScore, contextScore);
      candidate.matchScore = Math.min(candidate.matchScore, matchScore);
      candidate.shared = candidate.shared && !isDirect;
    }
  }

  return [...values.values()]
    .sort((a, b) => Number(a.shared) - Number(b.shared)
      || a.contextScore - b.contextScore
      || a.matchScore - b.matchScore
      || b.occurrences - a.occurrences
      || a.value.localeCompare(b.value, 'en'))
    .slice(0, limit)
    .map(({ value, occurrences, shared }) => (
      shared ? { value, occurrences, shared: true } : { value, occurrences }
    ));
}

function getValueCandidates(entries, contextPath, keyword, prefix = '', limit = 200) {
  const normalizedContext = normalizeContextString(contextPath);
  const exactEntries = (entries || []).filter((entry) => entry && entry.keyword === keyword);
  const patternEntries = (entries || []).filter(
    (entry) => entry && entry.keyword !== keyword && isKeywordEntryMatch(entry.keyword, keyword),
  );

  let matchedEntries = [...exactEntries, ...patternEntries];

  // Exact and wildcard entries are preferred. In scheme blocks, an unknown
  // concrete key such as div(rhoPhi,omega) must still receive the complete set
  // of observed schemes instead of returning early before the fallback.
  const schemeRoot = schemeContextRoot(normalizedContext);
  if (matchedEntries.length === 0 && !schemeRoot) {
    // Keep the existing behavior where a user may press Space before accepting
    // a partial keyword completion, but only when that partial resolves uniquely.
    const matchingKeywords = new Set();
    for (const entry of entries || []) {
      if (entry && getSearchMatchScore(entry.keyword, keyword) >= 0) {
        matchingKeywords.add(entry.keyword);
      }
    }
    if (matchingKeywords.size !== 1) {
      return [];
    }
    const resolvedKeyword = [...matchingKeywords][0];
    matchedEntries = (entries || []).filter((entry) => entry && entry.keyword === resolvedKeyword);
  }

  // Scheme values are reusable inside the same fvSchemes block. A concrete key
  // such as div(phi,U) may only appear in a few tutorials, while its default
  // and sibling keys contain the complete set of observed interpolation
  // schemes. Include those entries so partial input such as "linear" exposes
  // all relevant values instead of only the one or two observed for that key.
  if (schemeRoot) {
    const directEntries = new Set(matchedEntries);
    const matchedEntrySet = new Set(directEntries);
    for (const entry of entries || []) {
      if (entry && schemeContextRoot(entry.context) === schemeRoot && !matchedEntrySet.has(entry)) {
        matchedEntrySet.add(entry);
        matchedEntries.push(entry);
      }
    }
    return collectValueCandidates(matchedEntries, normalizedContext, prefix, limit, directEntries);
  }

  return collectValueCandidates(matchedEntries, normalizedContext, prefix, limit);
}

function getSchemeValueCandidates(entries, contextPath, prefix = '', limit = 200) {
  const normalizedContext = normalizeContextString(contextPath);
  const schemeRoot = schemeContextRoot(normalizedContext);
  if (!schemeRoot || normalizeSearchQuery(prefix).length < 2) {
    return [];
  }

  const matchedEntries = (entries || []).filter(
    (entry) => entry && schemeContextRoot(entry.context) === schemeRoot,
  );
  return collectValueCandidates(matchedEntries, normalizedContext, prefix, limit, new Set());
}

function getScriptCandidates(scriptData, linePrefix, prefix = '', limit = 200) {
  const variableMatch = linePrefix.match(/\$\{?[A-Za-z_][A-Za-z0-9_]*$/);
  if (variableMatch) {
    const bracedVariable = /^\$\{/.test(variableMatch[0]);
    return filterByPrefix(scriptData.variables || [], prefix, (item) => item.name)
      .map((item) => ({
        label: `$${item.name}`,
        insertText: bracedVariable ? `\${${item.name}}` : `$${item.name}`,
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
    .filter((item) => getSearchMatchScore(item.label, prefix) >= 0)
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
  compactSearchQuery,
  findHoverEntries,
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
  normalizeSearchQuery,
  normalizeContextString,
  toPosix,
};
