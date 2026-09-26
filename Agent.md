# Agent.md — 开发与发布流程

本文件面向在本仓库工作的 AI Agent（也适合人工参考），说明改动代码、重建数据、跑测试和发布 VSIX 的标准流程。
所有命令都在仓库根目录执行（PowerShell）。

---

## 1. 项目概览

VS Code 扩展 `openfoam-dict-intellisense`（发布者 `boyaoChen`），为 OpenFOAM 算例字典提供关键词、候选值补全与 Hover 说明，并自带 `OpenFOAM Dictionary` 语言模式的语法高亮。

| 路径 | 作用 | 是否进 VSIX |
| --- | --- | --- |
| `src/` | 扩展运行时（`extension.js`、`openfoam.js`、`keyword-store.js`） | 是 |
| `syntaxes/openfoam-dict.tmLanguage.json` | TextMate 语法高亮 | 是 |
| `data/keywords/` | **扩展运行时读取**的关键词索引（含 `manifest.json` 与 `applications/`、`bin/`、`boundary-conditions/`） | 是 |
| `data/source-supplements/` | 源码审查产物（REVIEW.md、覆盖率、逐条候选） | 否 |
| `tools/` | 数据提取、审查、打包脚本 | 否 |
| `tests/openfoam.test.js` | 唯一的测试入口（`node:test`） | 否 |
| `OpenFOAM-v2606/` | 提取语料（OpenFOAM 源码树），体积大，**不入库** | 否 |
| `*.vsix` | 本地构建产物，不入库 | 否 |

`.vscodeignore` 决定 VSIX 内容：除 `src/`、`data/keywords/`、`syntaxes/` 和元数据外全部排除；新增运行时必需目录时必须同步更新它。

## 2. 前置条件

- Node.js 20+、npm
- VS Code 1.111+（`package.json` 的 `engines`）
- OpenFOAM 源码语料（用于重建数据；日常改扩展代码不需要）
- Python（`tools/build-vsix.ps1` 用它把 `OpenFOAM.ico` 转成 `icon.png`）
- `vsce`（`npm i -g @vscode/vsce`，或让脚本回退到 `npx @vscode/vsce`）

## 3. 常用命令

```powershell
node --test tests\openfoam.test.js   # 跑测试（npm test 等价）
npm run extract:keywords             # 重建全部关键词数据（4 步管线）
npm run review:supplements           # 只重建 data/source-supplements
npm run merge:supplements            # 只把审查产物合并回 data/keywords
powershell -ExecutionPolicy Bypass -File tools\build-vsix.ps1   # 测试 + 图标 + 打包
```

## 4. 语料定位（重要）

数据脚本不硬编码语料目录，统一调用 `tools/openfoam-source-root.mjs` 的 `resolveOpenFoamRoot()`，顺序为：

1. 环境变量 `OPENFOAM_SOURCE_ROOT`
2. 项目根目录下的 `OpenFOAM-v2606`
3. 项目根目录下唯一的 `OpenFOAM-v*` 目录

都找不到时抛出可读错误。**除该模块外，任何脚本都不得出现 `OpenFOAM-v2606` 字面量**——`tests/openfoam.test.js` 里有专门的回归测试守护这一点。生成结果中的来源路径一律相对仓库根目录，语料绝对路径不会写入数据。

## 5. 数据管线

四步顺序固定，后一步依赖前一步的输出：

```powershell
node tools\extract-openfoam-keywords.mjs   # 1. 教程 + etc + 源码 -> data/keywords
node tools\build-source-review.mjs         # 2. 源码审查 -> data/source-supplements + REVIEW.md
node tools\build-app-bin-review.mjs        # 3. applications/bin 审查 + 追加 REVIEW.md 章节
node tools\merge-source-supplements.mjs    # 4. 审查结果合并回 data/keywords（含 auxiliary）
```

`npm run extract:keywords` 就是这四步。**不要只跑第 1 步**：`extract` 会 `rm -rf data/keywords` 后重建，只跑它会丢掉 `applications/`、`bin/`、`boundary-conditions/` 和 `manifest.auxiliary`，测试会立刻失败。

各脚本职责：

| 脚本 | 输入 | 输出 |
| --- | --- | --- |
| `extract-openfoam-keywords.mjs` | `tutorials/`、`etc/`、`src/`、`applications/` | `data/keywords/{0,constant,system,scripts}/**`、`manifest.json` |
| `build-source-review.mjs` | `src/`、`applications/` + 已生成的索引 | `data/source-supplements/**`、聚合 `boundary-conditions.json`、逐类型 `boundary-conditions/*.json`、`coverage.json`、`unmapped.json`、`REVIEW.md` 上半部分 |
| `build-app-bin-review.mjs` | `applications/`、`bin/` | `data/source-supplements/{applications,bin}/**`、`REVIEW.md` 的 Applications/Bin 章节（整体重写，勿手工编辑） |
| `merge-source-supplements.mjs` | 上述审查产物 | 合并进 `data/keywords/**`，写入 `manifest.auxiliary` |
| `openfoam-source-scanner.mjs` | — | 公共库：C++ 调用抽取、`TypeName` 抽取 |

注意事项：

- 每个 JSON 都带 `generatedAt`，所以**重跑管线会让所有数据文件都出现在 diff 里**，这是正常的；核对时看统计数字而不是文件数。
- `data/keywords/**` 必须与代码一起提交，扩展运行时直接读取它。
- `REVIEW.md` 由脚本生成，手工编辑会被覆盖。

## 6. 数据契约（扩展运行时依赖）

- `data/keywords/manifest.json`：`source`、`layout`、`casePolicy`、`sourceSupplement`、`etcSupplement`、`categories.{0,constant,system,scripts}`（含每个 `fileKey` 的 `output`）、`auxiliary.{applications,bin,boundaryConditions,mergeStats}`。
- 每个分类 JSON：`entries[]`，字段 `keyword`、`context`、`path`、`kinds`、`occurrences`、`fileCount`、`values[]`、`examples[]`、`sourceOccurrences`、`sourceTypes[]`、`sourceLocations[]`。
- 大小写敏感：`casePolicy` 为 `preserve-source-case`，任何环节都不得做大小写归一。
- 文件名冲突（同一路径仅大小写不同）会落到隐藏目录 `.case-<sha1 前 8 位>/` 下；这些目录会随 VSIX 一起发布。

## 7. 修改代码时的约定

- **边界条件判定**（`build-source-review.mjs`）：一个可选类型 = 头部声明的基类里含 `*Patch*Field`，且文件里出现 `TypeName("...")`。只看目录会把 `*Base`、`*Macros`、`*Mapper`、`*Fwd`、`eddy`、`IntegralScaleBox` 等辅助类误收进来。
- **类型名可能带 C++ 作用域**，例如 `compressible::alphatWallFunction`：`:` 在 Windows 上不是合法文件名字符，写文件前必须经过 `boundaryFileName()` 编码，真实名字保留在 JSON 的 `typeName` 字段里；编码后重名追加 `-2`、`-3`。
- 路径统一用 `toPosix()` 处理后再参与比较或写入 JSON。
- 语言/关键词相关改动要同时补 `tests/openfoam.test.js` 断言（例如语法高亮规则、manifest 计数、文件名安全性）。
- 扩展命令的错误处理：面向用户的命令（`reload`、`showIndexInfo`）必须 `try/catch` 后用 `showWarningMessage` 提示，不要抛原始异常。

## 8. 发布流程（版本号改动清单）

以 `1.1.8 → 1.1.9` 为例：

1. 改 `package.json` 的 `version`。
2. 改 `README.md` 中所有版本引用（务必全改）：
   - 顶部 `**最新版本 / Latest version:**` 行
   - 中文「安装」段的 `openfoam-dict-intellisense-X.Y.Z.vsix`（下载说明 + `code --install-extension`）
   - 中文「索引覆盖」标题 `### X.Y.Z 索引覆盖`
   - 中文「开发与构建」段的输出文件名
   - 英文 `### Installation` 段两处 VSIX 名
   - 英文 `### X.Y.Z Index Coverage` 标题
   - 英文 `### Development and Build` 段的输出文件名
3. 若改了提取逻辑：跑 `npm run extract:keywords`，然后按新数据更新 README 的统计数字（索引覆盖条数、边界条件 `N 个独立定义 / M 个带关键词`、源码补充 `调用数/关键词数/目标文件数`）。数字来源：
   - `data/keywords/manifest.json` 的 `categories`、`auxiliary`、`sourceSupplement`、`etcSupplement`
   - `data/source-supplements/REVIEW.md`、`coverage.json`
4. `node --test tests\openfoam.test.js` 必须全绿。
5. `powershell -ExecutionPolicy Bypass -File tools\build-vsix.ps1` 生成 `<name>-<version>.vsix`（脚本内部会再跑一次测试，并用 Python 重新生成 `icon.png`）。
6. 提交并打 tag（仓库历史约定）：

   ```powershell
   git add -A
   git commit -m "Release 1.1.9: <一句话说明>"
   git tag v1.1.9
   ```

   提交前确认 `syntaxes/`、`tools/` 下的新文件已被 `git add`（untracked 文件最容易漏）。
7. 把 `.vsix` 上传到 GitHub Releases；`*.vsix` 由 `.gitignore` 排除，不入库。

## 9. 已知陷阱（踩过的坑）

- 硬编码语料目录名（`'OpenFOAM-v2606/tutorials'`、`'openfoam-v2606/etc/controlDict'`）会让 `OPENFOAM_SOURCE_ROOT` 指向别的版本时输出不一致；已统一走 `openfoamRootLabel`。
- 拼写错误会静默丢数据：`fvpitchfield`（应为 `fvpatchfield`）曾让 `src/fvMotionSolver/fvPatchFields` 的 `cellMotion`、`surfaceSlipDisplacement` 以及 `derivedFvPatchFields` 下 8 个带 `::` 的壁面函数全部进不了目录。
- 用 `TypeName` 直接当文件名会在 Windows 上 `ENOENT`（含 `::`），必须编码。
- 只跑管线第一步会删掉 `data/keywords` 里的 auxiliary 索引。
- 语法高亮的 entry-key 规则要允许「键独占一行、`{` 在下一行」这种最常见的写法。
- 扩展在 `onStartupFinished` 激活，但 `manifest.json` 是懒加载的；`KeywordStore` 构造函数不应读盘，只有识别出 OpenFOAM 算例路径时才加载索引（测试里有断言）。

## 10. 改动检查清单

- [ ] `node --test tests\openfoam.test.js` 全绿
- [ ] 改了提取/审查逻辑 → 跑完 4 步管线，数据与代码一致
- [ ] README 的统计数字、版本号、命令与实际一致
- [ ] 新增运行时文件已加入 `.vscodeignore` 白名单（即没有被误排除）
- [ ] 新增的 untracked 文件已 `git add`
- [ ] `tools/build-vsix.ps1` 能成功产出 VSIX
