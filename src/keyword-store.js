'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { classifyRelativePath, toPosix } = require('./openfoam');

class KeywordStore {
  constructor(extensionPath) {
    this.extensionPath = extensionPath;
    this.keywordRoot = path.join(extensionPath, 'data', 'keywords');
    this.manifest = null;
    this.documentCache = new Map();
    this.manifestFiles = new Map();
    this.reload();
  }

  reload() {
    const manifestPath = path.join(this.keywordRoot, 'manifest.json');
    this.manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    this.documentCache.clear();
    this.manifestFiles.clear();

    for (const [category, categoryInfo] of Object.entries(this.manifest.categories || {})) {
      const files = new Map();
      for (const fileInfo of categoryInfo.files || []) {
        files.set(fileInfo.fileKey, fileInfo);
      }
      this.manifestFiles.set(category, files);
    }
  }

  lookup(workspaceRoot, documentPath) {
    const relativePath = toPosix(path.relative(workspaceRoot, documentPath));
    if (relativePath.startsWith('../')) {
      return null;
    }

    const classification = classifyRelativePath(relativePath);
    if (!classification) {
      return null;
    }

    const categoryFiles = this.manifestFiles.get(classification.category);
    if (!categoryFiles) {
      return null;
    }

    let fileInfo = categoryFiles.get(classification.fileKey);
    if (!fileInfo && !classification.fileKey.includes('/')) {
      fileInfo = [...categoryFiles.values()].find(
        (item) => item.fileKey.split('/').at(-1) === classification.fileKey,
      );
    }

    if (!fileInfo) {
      return null;
    }

    return {
      category: classification.category,
      fileKey: fileInfo.fileKey,
      output: fileInfo.output,
      relativePath,
      data: this.loadDocument(fileInfo.output),
    };
  }

  loadDocument(outputPath) {
    if (!this.documentCache.has(outputPath)) {
      const fullPath = path.join(this.keywordRoot, outputPath);
      this.documentCache.set(outputPath, JSON.parse(fs.readFileSync(fullPath, 'utf8')));
    }
    return this.documentCache.get(outputPath);
  }

  getStats() {
    const categories = {};
    for (const [category, categoryInfo] of Object.entries(this.manifest.categories || {})) {
      categories[category] = {
        files: categoryInfo.fileKeyCount || 0,
        sourceFiles: categoryInfo.sourceFileCount || 0,
      };
    }
    return {
      source: this.manifest.source,
      casePolicy: this.manifest.casePolicy,
      categories,
    };
  }
}

module.exports = { KeywordStore };