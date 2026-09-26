'use strict';

const path = require('node:path');
const vscode = require('vscode');
const { KeywordStore } = require('./keyword-store');
const {
  findHoverEntries,
  formatIndexStats,
  getCompletionContext,
  getContextPath,
  getKeywordCandidates,
  getScriptCandidates,
  getValueCandidates,
  isInsideBlockComment,
  normalizeSearchQuery,
} = require('./openfoam');

const DOCUMENT_SELECTOR = { scheme: 'file' };
const CONFIG_SECTION = 'openfoamIntellisense';
const COMPLETION_TRIGGER_CHARACTERS = [
  String.fromCharCode(36),
  String.fromCharCode(35),
  ...Array.from("abcdefghijklmnopqrstuvwxyz"),
  ...Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
  ...Array.from("0123456789"),
  "_", "-", ".",
];
const OPENFOAM_LANGUAGE_ID = 'openfoam-dict';
let keywordStore;
let indexErrorReported = false;
const documentTextCache = new WeakMap();

function isEnabled() {
  return vscode.workspace.getConfiguration(CONFIG_SECTION).get('enabled', true);
}

function getLimit() {
  return vscode.workspace.getConfiguration(CONFIG_SECTION).get('maxItems', 200);
}

function getDocumentInfo(document) {
  if (!isEnabled() || document.uri.scheme !== 'file') {
    return null;
  }

  try {
    for (const folder of vscode.workspace.workspaceFolders || []) {
      const info = keywordStore.lookup(folder.uri.fsPath, document.uri.fsPath);
      if (info) {
        return info;
      }
    }

    // Support files opened without a workspace folder by walking up until a
    // recognized OpenFOAM case root contains the document.
    let candidateRoot = path.dirname(document.uri.fsPath);
    while (candidateRoot !== path.dirname(candidateRoot)) {
      const info = keywordStore.lookup(candidateRoot, document.uri.fsPath);
      if (info) {
        return info;
      }
      candidateRoot = path.dirname(candidateRoot);
    }
  }
  catch (error) {
    if (!indexErrorReported) {
      indexErrorReported = true;
      console.warn('Unable to read the OpenFOAM keyword index.', error);
      vscode.window.showWarningMessage(`Unable to read the OpenFOAM keyword index: ${error.message}`);
    }
  }

  return null;
}

async function applyOpenFoamLanguage(document) {
  if (!document || document.uri.scheme !== 'file') {
    return;
  }
  if (!vscode.workspace.getConfiguration(CONFIG_SECTION).get('fixLanguageMode', true)) {
    return;
  }
  if (document.languageId === OPENFOAM_LANGUAGE_ID) {
    return;
  }

  const info = getDocumentInfo(document);
  if (!info || info.category === 'scripts') {
    return;
  }

  try {
    await vscode.languages.setTextDocumentLanguage(document, OPENFOAM_LANGUAGE_ID);
  } catch (error) {
    console.warn(`Unable to set OpenFOAM language mode for ${document.uri.fsPath}`, error);
  }
}

function getDocumentText(document) {
  let cached = documentTextCache.get(document);
  if (!cached || cached.version !== document.version) {
    cached = {
      version: document.version,
      text: document.getText(),
    };
    documentTextCache.set(document, cached);
  }
  return cached.text;
}

function textBeforePosition(document, position) {
  const text = getDocumentText(document);
  return text.slice(0, document.offsetAt(position));
}

function applyCompletionMetadata(completion, position, prefix, label) {
  if (!prefix) {
    return;
  }

  completion.range = new vscode.Range(
    new vscode.Position(position.line, Math.max(0, position.character - prefix.length)),
    position,
  );

  // VS Code filters provider results again on the client. Prefix the filter
  // text with the typed fragment so substring/fuzzy results are not discarded.
  const normalizedPrefix = normalizeSearchQuery(prefix) || prefix;
  completion.filterText = `${prefix} ${normalizedPrefix} ${label}`;
}

function isCommentLine(linePrefix, textBeforeCursor) {
  const trimmed = linePrefix.trimStart();
  return trimmed.startsWith('//')
    || trimmed.startsWith('/*')
    || trimmed.startsWith('*')
    || isInsideBlockComment(textBeforeCursor);
}

function keywordKind(item) {
  if (item.kinds.includes('subdict')) {
    return vscode.CompletionItemKind.Module;
  }
  if (item.kinds.includes('directive')) {
    return vscode.CompletionItemKind.Keyword;
  }
  return vscode.CompletionItemKind.Property;
}

function createDocumentation(item) {
  const markdown = new vscode.MarkdownString();
  markdown.appendMarkdown(`**${item.keyword}**\n\n`);
  if (item.paths && item.paths.length > 0) {
    markdown.appendCodeblock(item.paths.join('\n'), 'text');
  }
  markdown.appendMarkdown(`\n出现次数：${item.occurrences}，来源文件：${item.fileCount}\n\n`);

  if (item.values && item.values.length > 0) {
    const values = item.values.slice(0, 20).map((value) => value.value).join('、');
    markdown.appendMarkdown(`常见值：${values}`);
  }

  if (item.examples && item.examples.length > 0) {
    markdown.appendMarkdown(`\n\n示例：\`${item.examples[0]}\``);
  }

  if (item.sourceOccurrences > 0) {
    markdown.appendMarkdown(`\n\n源码补充：${item.sourceOccurrences} 次`);
  }
  if (item.sourceTypes && item.sourceTypes.length > 0) {
    markdown.appendMarkdown(`\n\n源码类型：${item.sourceTypes.slice(0, 10).join('、')}`);
  }
  if (item.sourceLocations && item.sourceLocations.length > 0) {
    markdown.appendMarkdown(`\n\n源码位置：\`${item.sourceLocations[0]}\``);
  }

  return markdown;
}

function createKeywordItem(item, position, prefix) {
  const completion = new vscode.CompletionItem(item.keyword, keywordKind(item));
  completion.detail = item.paths[0] || item.keyword;
  completion.documentation = createDocumentation(item);
  completion.sortText = `${String(1000000 - Math.min(item.occurrences, 999999)).padStart(6, '0')}:${item.keyword}`;
  applyCompletionMetadata(completion, position, prefix, item.keyword);
  return completion;
}

function createValueItem(keyword, item, position, prefix) {
  const completion = new vscode.CompletionItem(item.value, vscode.CompletionItemKind.EnumMember);
  completion.detail = `${keyword} 的候选值`;
  completion.documentation = new vscode.MarkdownString(
    `观测到 **${item.occurrences}** 次。\n\n关键词：\`${keyword}\`\n\n值：\`${item.value}\``,
  );
  completion.sortText = `${String(1000000 - Math.min(item.occurrences, 999999)).padStart(6, '0')}:${item.value}`;
  applyCompletionMetadata(completion, position, prefix, item.value);
  return completion;
}

function createScriptItem(item, position, prefix) {
  const kind = item.kind === 'variable'
    ? vscode.CompletionItemKind.Variable
    : item.kind === 'helper'
      ? vscode.CompletionItemKind.Function
      : item.kind === 'utility'
        ? vscode.CompletionItemKind.Reference
        : vscode.CompletionItemKind.Value;

  const completion = new vscode.CompletionItem(item.label, kind);
  completion.insertText = item.insertText;
  completion.detail = `OpenFOAM ${item.kind}`;
  completion.documentation = new vscode.MarkdownString(`观测到 **${item.occurrences}** 次。`);
  completion.sortText = `${String(1000000 - Math.min(item.occurrences, 999999)).padStart(6, '0')}:${item.label}`;
  applyCompletionMetadata(completion, position, prefix, item.label);
  return completion;
}

function provideCompletionItems(document, position) {
  try {
    const info = getDocumentInfo(document);
    if (!info) {
      return undefined;
    }

    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
    const beforeCursor = textBeforePosition(document, position);
    if (isCommentLine(linePrefix, beforeCursor)) {
      return undefined;
    }

    const limit = getLimit();

    if (info.category === 'scripts') {
      const context = getCompletionContext(linePrefix);
      const prefix = context.prefix;
      const candidates = getScriptCandidates(info.data, linePrefix, prefix, limit);
      return candidates.map((item) => createScriptItem(item, position, prefix));
    }

    const contextPath = getContextPath(beforeCursor);
    const context = getCompletionContext(linePrefix);

    if (context.type === 'value') {
      const values = getValueCandidates(
        info.data.entries || [],
        contextPath,
        context.keyword,
        context.prefix,
        limit,
      );
      return values.map((item) => createValueItem(context.keyword, item, position, context.prefix));
    }

    const keywords = getKeywordCandidates(info.data.entries || [], contextPath, context.prefix, limit);
    return keywords.map((item) => createKeywordItem(item, position, context.prefix));
  }
  catch (error) {
    console.warn('Unable to provide OpenFOAM completions.', error);
    return undefined;
  }
}

function provideHover(document, position) {
  try {
    const info = getDocumentInfo(document);
    if (!info) {
      return undefined;
    }

    const range = document.getWordRangeAtPosition(position, /[A-Za-z_#$][A-Za-z0-9_.#$-]*/);
    if (!range) {
      return undefined;
    }

    const word = document.getText(range);
    if (info.category === 'scripts') {
      const normalizedWord = word.replace(/^\$/, '');
      const groups = ['commands', 'helpers', 'utilities', 'variables'];
      for (const group of groups) {
        const item = (info.data[group] || []).find((candidate) => candidate.name === normalizedWord);
        if (item) {
          return new vscode.Hover(
            new vscode.MarkdownString(`**${word}**\n\nOpenFOAM ${group}\n\n观测到 **${item.occurrences}** 次。`),
            range,
          );
        }
      }
      return undefined;
    }
    const contextPath = getContextPath(textBeforePosition(document, position));
    const entries = findHoverEntries(info.data.entries || [], word, contextPath);
    if (entries.length === 0) {
      return undefined;
    }

    const item = entries[0];
    const markdown = new vscode.MarkdownString();
    markdown.appendMarkdown(`**${item.keyword}**\n\n`);
    markdown.appendCodeblock(item.path, 'text');
    markdown.appendMarkdown(`\n出现次数：${item.occurrences}\n\n`);
    if (item.values && item.values.length > 0) {
      markdown.appendMarkdown(`常见值：${item.values.slice(0, 20).map((value) => value.value).join('、')}`);
    }
    if (item.sourceOccurrences > 0) {
      markdown.appendMarkdown(`\n\n源码补充：${item.sourceOccurrences} 次`);
    }
    if (item.sourceTypes && item.sourceTypes.length > 0) {
      markdown.appendMarkdown(`\n\n源码类型：${item.sourceTypes.slice(0, 10).join('、')}`);
    }
    if (item.sourceLocations && item.sourceLocations.length > 0) {
      markdown.appendMarkdown(`\n\n源码位置：\`${item.sourceLocations[0]}\``);
    }
    return new vscode.Hover(markdown, range);
  }
  catch (error) {
    console.warn('Unable to provide OpenFOAM hover information.', error);
    return undefined;
  }
}

function activate(context) {
  keywordStore = new KeywordStore(context.extensionUri.fsPath);

  for (const document of vscode.workspace.textDocuments) {
    void applyOpenFoamLanguage(document);
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      void applyOpenFoamLanguage(document);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(`${CONFIG_SECTION}.fixLanguageMode`)) {
        return;
      }
      for (const document of vscode.workspace.textDocuments) {
        if (document.languageId !== OPENFOAM_LANGUAGE_ID) {
          void applyOpenFoamLanguage(document);
        }
      }
    }),
    vscode.languages.registerCompletionItemProvider(
      DOCUMENT_SELECTOR,
      { provideCompletionItems },
      ...COMPLETION_TRIGGER_CHARACTERS,
    ),
    vscode.languages.registerHoverProvider(DOCUMENT_SELECTOR, { provideHover }),
    vscode.commands.registerCommand('openfoamIntellisense.reload', () => {
      try {
        keywordStore.reload();
        indexErrorReported = false;
        vscode.window.showInformationMessage('OpenFOAM 关键词索引已重新加载。');
      }
      catch (error) {
        vscode.window.showWarningMessage(`OpenFOAM 关键词索引重新加载失败：${error.message}`);
      }
    }),
    vscode.commands.registerCommand('openfoamIntellisense.setLanguage', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('没有活动的 OpenFOAM 文件。');
        return;
      }
      try {
        await vscode.languages.setTextDocumentLanguage(editor.document, OPENFOAM_LANGUAGE_ID);
        vscode.window.showInformationMessage('当前文件已设置为 OpenFOAM Dictionary 语言模式。');
      }
      catch (error) {
        vscode.window.showWarningMessage(`无法设置 OpenFOAM Dictionary 语言模式：${error.message}`);
      }
    }),
    vscode.commands.registerCommand('openfoamIntellisense.showIndexInfo', () => {
      try {
        vscode.window.showInformationMessage(formatIndexStats(keywordStore.getStats()));
      }
      catch (error) {
        vscode.window.showWarningMessage(`无法读取 OpenFOAM 关键词索引：${error.message}`);
      }
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
