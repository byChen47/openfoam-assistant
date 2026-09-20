'use strict';

const vscode = require('vscode');
const { KeywordStore } = require('./keyword-store');
const {
  findHoverEntries,
  getCompletionContext,
  getContextPath,
  getKeywordCandidates,
  getScriptCandidates,
  getValueCandidates,
} = require('./openfoam');

const DOCUMENT_SELECTOR = { scheme: 'file' };
const CONFIG_SECTION = 'openfoamIntellisense';
const OPENFOAM_LANGUAGE_ID = 'openfoam-dict';
let keywordStore;

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

  for (const folder of vscode.workspace.workspaceFolders || []) {
    const info = keywordStore.lookup(folder.uri.fsPath, document.uri.fsPath);
    if (info) {
      return info;
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

function textBeforePosition(document, position) {
  return document.getText(new vscode.Range(new vscode.Position(0, 0), position));
}

function isCommentLine(linePrefix) {
  const trimmed = linePrefix.trimStart();
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
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

function createKeywordItem(item) {
  const completion = new vscode.CompletionItem(item.keyword, keywordKind(item));
  completion.detail = item.paths[0] || item.keyword;
  completion.documentation = createDocumentation(item);
  completion.sortText = `${String(1000000 - Math.min(item.occurrences, 999999)).padStart(6, '0')}:${item.keyword}`;
  return completion;
}

function createValueItem(keyword, item) {
  const completion = new vscode.CompletionItem(item.value, vscode.CompletionItemKind.EnumMember);
  completion.detail = `${keyword} 的候选值`;
  completion.documentation = new vscode.MarkdownString(
    `观测到 **${item.occurrences}** 次。\n\n关键词：\`${keyword}\`\n\n值：\`${item.value}\``,
  );
  completion.sortText = `${String(1000000 - Math.min(item.occurrences, 999999)).padStart(6, '0')}:${item.value}`;
  return completion;
}

function createScriptItem(item) {
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
  return completion;
}

function provideCompletionItems(document, position) {
  const info = getDocumentInfo(document);
  if (!info) {
    return undefined;
  }

  const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
  if (isCommentLine(linePrefix)) {
    return undefined;
  }

  const limit = getLimit();

  if (info.category === 'scripts') {
    const context = getCompletionContext(linePrefix);
    const prefix = context.prefix;
    const candidates = getScriptCandidates(info.data, linePrefix, prefix, limit);
    return candidates.map(createScriptItem);
  }

  const contextPath = getContextPath(textBeforePosition(document, position));
  const context = getCompletionContext(linePrefix);

  if (context.type === 'value') {
    const values = getValueCandidates(
      info.data.entries || [],
      contextPath,
      context.keyword,
      context.prefix,
      limit,
    );
    return values.map((item) => createValueItem(context.keyword, item));
  }

  const keywords = getKeywordCandidates(info.data.entries || [], contextPath, context.prefix, limit);
  return keywords.map(createKeywordItem);
}

function provideHover(document, position) {
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

function activate(context) {
  keywordStore = new KeywordStore(context.extensionUri.fsPath);

  for (const document of vscode.workspace.textDocuments) {
    void applyOpenFoamLanguage(document);
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      void applyOpenFoamLanguage(document);
    }),
    vscode.languages.registerCompletionItemProvider(
      DOCUMENT_SELECTOR,
      { provideCompletionItems },
      '$',
      '#',
    ),
    vscode.languages.registerHoverProvider(DOCUMENT_SELECTOR, { provideHover }),
    vscode.commands.registerCommand('openfoamIntellisense.reload', () => {
      keywordStore.reload();
      vscode.window.showInformationMessage('OpenFOAM 关键词索引已重新加载。');
    }),
    vscode.commands.registerCommand('openfoamIntellisense.setLanguage', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('没有活动的 OpenFOAM 文件。');
        return;
      }
      await vscode.languages.setTextDocumentLanguage(editor.document, OPENFOAM_LANGUAGE_ID);
      vscode.window.showInformationMessage('当前文件已设置为 OpenFOAM Dictionary 语言模式。');
    }),
    vscode.commands.registerCommand('openfoamIntellisense.showIndexInfo', () => {
      const stats = keywordStore.getStats();
      const parts = Object.entries(stats.categories).map(
        ([category, value]) => `${category}: ${value.files} 个文件`,
      );
      vscode.window.showInformationMessage(
        `OpenFOAM 索引：${parts.join('，')}；数据源 ${stats.source}`,
      );
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };