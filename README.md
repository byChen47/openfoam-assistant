# OpenFOAM Dict IntelliSense

[中文](#中文) | [English](#english)

[Releases](https://github.com/byChen47/openfoam-assistant/releases/latest) | [Issues](https://github.com/byChen47/openfoam-assistant/issues) | [MIT License](LICENSE)

**最新版本 / Latest version:** `1.1.9` | **VS Code:** `1.111+` | **许可证 / License:** MIT

OpenFOAM 算例字典关键词与候选值补全扩展。

OpenFOAM case dictionary keyword and value completion extension for VS Code.

---

## 中文

### 简介

OpenFOAM Dict IntelliSense 是一个 Visual Studio Code 扩展，用于在编写 OpenFOAM 算例文件时提供类似 C/C++ IntelliSense 的上下文提示。扩展会根据当前文件、当前字典层级以及光标位置，提示可用的关键词和观测到的候选值。

适用场景：

- 新建或修改 OpenFOAM 算例
- 编写 `0`、`constant`、`system` 下的字段和字典文件
- 编辑 `Allrun`、`Allclean` 算例运行脚本
- 学习和检索 OpenFOAM 教程中实际使用的关键字和值

### 主要功能

- 按具体文件加载独立关键词索引，例如 `0/U`、`system/controlDict`、`constant/transportProperties`
- 输入部分关键词时提示当前文件中可用的关键词
- 输入 `keyword ` 后提示该关键词的候选值
- 根据 `boundaryField/{patch}`、`solvers/{solver}` 等父级上下文过滤提示
- 为关键词和值提供 Hover 说明
- 为 `Allrun`、`Allclean` 提示命令、OpenFOAM 函数、工具和环境变量
- 自动把已识别的字典文件设置为 `OpenFOAM Dictionary` 语言模式
- 为 `OpenFOAM Dictionary` 语言模式提供语法高亮：注释、`#` 指令、`#{...}#` 代码流、字符串、变量、量纲、数值、布尔值和键名
- 支持关键词和值的大小写区分

### 支持的文件

| 区域 | 文件示例 | 功能 |
| --- | --- | --- |
| `0`、`0.orig`、`0.org` | `U`、`p`、`k`、`epsilon`、`C` | 字段和边界条件补全 |
| `constant` | `transportProperties`、`turbulenceProperties`、`g`、`fvOptions` | 物理属性、湍流和区域设置补全 |
| `system` | `controlDict`、`fvSchemes`、`fvSolution`、`blockMeshDict` | 时间、离散格式、求解器和网格设置补全 |
| 算例根目录 | `Allrun`、`Allclean` | Shell 命令、工具和变量补全 |

说明：

- `Allrun`、`Allclean` 保持 Shell Script 语言模式。
- `.C` 文件是 OpenFOAM C++ 源码，不会被强制切换为字典语言。

### 安装

从 [GitHub Releases](https://github.com/byChen47/openfoam-assistant/releases/latest) 下载 `openfoam-dict-intellisense-1.1.9.vsix`，然后执行：

```powershell
code --install-extension openfoam-dict-intellisense-1.1.9.vsix --force
```

也可以直接在 VS Code 的扩展面板中选择：

```text
Extensions → ... → Install from VSIX...
```

安装后执行一次：

```text
Ctrl+Shift+P → Developer: Reload Window
```

### 基本用法

#### 1. 打开算例文件

打开包含 OpenFOAM 算例的工作区，然后打开具体文件，例如：

```text
myCase/0/U
myCase/system/controlDict
myCase/constant/transportProperties
myCase/Allrun
```

扩展会根据工作区相对路径识别文件类型。

#### 2. 关键词补全

在 `system/controlDict` 中输入：

```text
writ
```

会提示：

```text
writeControl
writeFormat
writeInterval
writeCompression
writePrecision
```

在 `system/fvSchemes` 的 `divSchemes` 中输入：

```text
div
```

会提示当前文件中与 `div` 相关的关键词。

#### 3. 值补全

在 `system/controlDict` 中输入：

```text
writeControl time
```

会提示：

```text
timeStep
```

在 `0/U` 的边界条件中输入：

```text
type fixed
```

会提示：

```text
fixedValue
fixedNormalInletOutletVelocity
fixedShearStress
```

在 `system/fvSolution` 中输入：

```text
solver GAM
```

会提示：

```text
GAMG
```

#### 4. 上下文补全

扩展会区分同名的关键词。例如：

```text
boundaryField/{patch}/type
```

与：

```text
functions/{function}/type
```

是不同上下文，提示内容不会无条件混在一起。

#### 5. Allrun / Allclean 补全

在 `Allrun` 中输入：

```text
runApplication block
```

会提示：

```text
blockMesh
```

在脚本中输入环境变量时：

```text
$WM_
```

会提示：

```text
$WM_PROJECT_DIR
```

#### 6. Hover 说明

将鼠标悬停在已知关键词或候选值上，可以查看：

- 关键词路径
- 父级上下文
- 出现次数
- 来源文件数量
- 观测到的常见值
- 教程来源示例

### 语言模式

OpenFOAM 算例文件通常没有扩展名，VS Code 可能把它识别为 Plain Text、C、C++、C# 或其他语言。

本扩展会在打开已索引的 `0`、`constant`、`system` 文件时自动切换为：

```text
OpenFOAM Dictionary
```

如果某个文件没有自动切换，使用命令：

```text
OpenFOAM: Set Current File Language to OpenFOAM Dictionary
```

### 命令

| 命令 | 作用 |
| --- | --- |
| `OpenFOAM: Reload Keyword Index` | 重新加载关键词索引 |
| `OpenFOAM: Show Keyword Index Information` | 查看索引文件和来源文件统计 |
| `OpenFOAM: Set Current File Language to OpenFOAM Dictionary` | 手动设置当前文件的 OpenFOAM 语言模式 |

### 配置

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `openfoamIntellisense.enabled` | `true` | 启用或禁用补全 |
| `openfoamIntellisense.maxItems` | `200` | 单次返回的最大补全数量 |
| `openfoamIntellisense.fixLanguageMode` | `true` | 自动修正已识别文件的语言模式 |

### 数据来源与限制

- 索引以 `OpenFOAM-v2606/tutorials/` 为教学案例基础
- 同时扫描 `OpenFOAM-v2606/src/` 和 `OpenFOAM-v2606/applications/` 中的 dictionary 读取调用
- 源码关键词按运行类型和源码路径映射到 `0`、`constant`、`system` 的具体文件
- 当前源码补充映射了 4,704 条调用、623 个关键词，覆盖 423 个目标文件
- 每个源码补充条目记录 `sourceTypes` 和 `sourceLocations`，便于审查
- 扩展不编译 OpenFOAM、不执行求解器，也不替代 OpenFOAM 自身的输入校验

### 1.1.9 索引覆盖

- `0` 文件：347 个文件级索引
- `constant` 文件：198 个文件级索引
- `system` 文件：537 个文件级索引
- 脚本：`Allrun`、`Allclean`
- 边界条件：162 个独立定义，其中 74 个带额外 dictionary 关键词
- `applications`：247 个应用/工具组，532 个 dictionary 关键词，297 个命令行选项或参数
- `bin`：64 个 Shell 脚本，包含命令、函数、变量和选项
- `OpenFOAM Dictionary` 语言模式：新增语法高亮（注释、`#` 指令、`#{...}#` 代码流、字符串、变量、量纲、数值、布尔值、键名）
- VS Code 最低版本：1.111

### 开发与构建

运行环境：

- VS Code 1.111 或更高版本
- Node.js 20 或更高版本

运行测试：

```powershell
node --test tests\openfoam.test.js
```

重新生成关键词数据：

```powershell
npm run extract:keywords
```

`OpenFOAM-v2606` 源码树是提取语料，体积较大，因此不纳入版本库。脚本按以下顺序定位语料：

1. 环境变量 `OPENFOAM_SOURCE_ROOT`
2. 项目根目录下的 `OpenFOAM-v2606`
3. 项目根目录下唯一的 `OpenFOAM-v*` 目录

如果都找不到，脚本会给出明确报错而不是中途失败。语料路径不会写入生成结果，生成结果中的来源路径始终相对于项目根目录。

完整数据管线（顺序不可调换，后一步依赖前一步的输出；第一步会整体重建 `data/keywords/`，因此单独运行它会删掉 `applications/`、`bin/`、`boundary-conditions/` 和 `manifest.auxiliary`，必须四步一起运行）：

```powershell
node tools\extract-openfoam-keywords.mjs
node tools\build-source-review.mjs
node tools\build-app-bin-review.mjs
node tools\merge-source-supplements.mjs
```

重新构建 VSIX：

```powershell
powershell -ExecutionPolicy Bypass -File tools\build-vsix.ps1
```

输出：

```text
openfoam-dict-intellisense-1.1.9.vsix
```

---

## English

### Overview

OpenFOAM Dict IntelliSense is a Visual Studio Code extension that provides context-aware keyword and value completion while editing OpenFOAM case files. Suggestions are selected from the current case file, the current dictionary scope, and the current cursor position.

Typical use cases:

- Creating or editing an OpenFOAM case
- Writing files under `0`, `constant`, and `system`
- Editing `Allrun` and `Allclean`
- Learning which keywords and values are used in real OpenFOAM tutorials

### Features

- Loads a separate keyword index for each concrete file, such as `0/U`, `system/controlDict`, and `constant/transportProperties`
- Suggests keywords available in the current file as you type
- Suggests observed values after typing `keyword `
- Filters suggestions by contexts such as `boundaryField/{patch}` and `solvers/{solver}`
- Provides hover documentation for keywords and values
- Suggests commands, OpenFOAM functions, utilities, and environment variables in `Allrun` and `Allclean`
- Automatically applies the `OpenFOAM Dictionary` language mode to recognized dictionary files
- Highlights the `OpenFOAM Dictionary` language mode: comments, `#` directives, `#{...}#` code streams, strings, variables, dimensions, numbers, booleans, and entry keys
- Preserves keyword and value case

### Supported Files

| Area | Examples | Purpose |
| --- | --- | --- |
| `0`, `0.orig`, `0.org` | `U`, `p`, `k`, `epsilon`, `C` | Fields and boundary conditions |
| `constant` | `transportProperties`, `turbulenceProperties`, `g`, `fvOptions` | Physical properties, turbulence, and regions |
| `system` | `controlDict`, `fvSchemes`, `fvSolution`, `blockMeshDict` | Time controls, schemes, solvers, and mesh setup |
| Case root | `Allrun`, `Allclean` | Shell commands, utilities, and variables |

Notes:

- `Allrun` and `Allclean` remain in Shell Script mode.
- `.C` files are OpenFOAM C++ source files and are not forced into dictionary language mode.

### Installation

Download `openfoam-dict-intellisense-1.1.9.vsix` from [GitHub Releases](https://github.com/byChen47/openfoam-assistant/releases/latest), then run:

```powershell
code --install-extension openfoam-dict-intellisense-1.1.9.vsix --force
```

Or use the VS Code UI:

```text
Extensions → ... → Install from VSIX...
```

Reload VS Code after installation:

```text
Ctrl+Shift+P → Developer: Reload Window
```

### Usage

#### 1. Open a Case File

Open a workspace containing an OpenFOAM case and then open a concrete file:

```text
myCase/0/U
myCase/system/controlDict
myCase/constant/transportProperties
myCase/Allrun
```

The extension identifies the file from its workspace-relative path.

#### 2. Keyword Completion

In `system/controlDict`, type:

```text
writ
```

Suggested keywords include:

```text
writeControl
writeFormat
writeInterval
writeCompression
writePrecision
```

In `system/fvSchemes`, type:

```text
div
```

The extension suggests matching keywords from that file.

#### 3. Value Completion

In `system/controlDict`, type:

```text
writeControl time
```

Suggested values include:

```text
timeStep
```

In a boundary condition in `0/U`, type:

```text
type fixed
```

Suggested values include:

```text
fixedValue
fixedNormalInletOutletVelocity
fixedShearStress
```

In `system/fvSolution`, type:

```text
solver GAM
```

Suggested values include:

```text
GAMG
```

#### 4. Context-Aware Completion

The same keyword can have different meanings in different scopes. For example:

```text
boundaryField/{patch}/type
```

and:

```text
functions/{function}/type
```

are treated as different contexts.

#### 5. Allrun and Allclean

In `Allrun`, type:

```text
runApplication block
```

Suggested utilities include:

```text
blockMesh
```

For environment variables, type:

```text
$WM_
```

Suggested variables include:

```text
$WM_PROJECT_DIR
```

#### 6. Hover Documentation

Hover over a known keyword or value to see:

- Keyword path
- Parent context
- Occurrence count
- Number of source files
- Observed values
- Tutorial source examples

### Language Mode

OpenFOAM case files often have no file extension. VS Code may otherwise detect them as Plain Text, C, C++, C#, or another language.

The extension automatically switches recognized `0`, `constant`, and `system` files to:

```text
OpenFOAM Dictionary
```

If a file is not switched automatically, run:

```text
OpenFOAM: Set Current File Language to OpenFOAM Dictionary
```

### Commands

| Command | Purpose |
| --- | --- |
| `OpenFOAM: Reload Keyword Index` | Reload the keyword index |
| `OpenFOAM: Show Keyword Index Information` | Show index and source statistics |
| `OpenFOAM: Set Current File Language to OpenFOAM Dictionary` | Set the current file language mode manually |

### Settings

| Setting | Default | Description |
| --- | --- | --- |
| `openfoamIntellisense.enabled` | `true` | Enable or disable completion |
| `openfoamIntellisense.maxItems` | `200` | Maximum number of completion items |
| `openfoamIntellisense.fixLanguageMode` | `true` | Automatically correct recognized file language modes |

### Data Source and Limitations

- The index is based on `OpenFOAM-v2606/tutorials/` as the tutorial corpus.
- It also scans dictionary reads in `OpenFOAM-v2606/src/` and `OpenFOAM-v2606/applications/`.
- Source keywords are mapped to concrete `0`, `constant`, and `system` files by runtime type and source path.
- The current source supplement maps 4,704 calls and 623 keywords across 423 target files; the `etc` supplement adds 4,702 calls and 1,811 keywords across 87 target files.
- Each source-derived entry records `sourceTypes` and `sourceLocations` for auditing.
- The extension does not compile OpenFOAM, run solvers, or replace OpenFOAM input validation.

### 1.1.9 Index Coverage

- `0` files: 347 file-level indexes
- `constant` files: 198 file-level indexes
- `system` files: 537 file-level indexes
- Scripts: `Allrun`, `Allclean`
- Boundary conditions: 162 independent definitions, including 74 with additional dictionary keywords
- `applications`: 247 application/tool groups, 532 dictionary keywords, and 297 command-line options or arguments
- `bin`: 64 shell scripts with commands, functions, variables, and options
- `OpenFOAM Dictionary` language mode: new syntax highlighting (comments, `#` directives, `#{...}#` code streams, strings, variables, dimensions, numbers, booleans, entry keys)
- Minimum VS Code version: 1.111

### Development and Build

Requirements:

- VS Code 1.111 or later
- Node.js 20 or later

Run tests:

```powershell
node --test tests\openfoam.test.js
```

Regenerate keyword data:

```powershell
npm run extract:keywords
```

The `OpenFOAM-v2606` source tree is the extraction corpus. It is large and therefore not committed. The scripts locate it in this order:

1. the `OPENFOAM_SOURCE_ROOT` environment variable
2. `OpenFOAM-v2606` in the project root
3. the single `OpenFOAM-v*` directory in the project root

If none is found, the scripts fail with an explicit message instead of failing halfway. The corpus location is never written into the generated output; recorded source paths stay relative to the project root.

Full data pipeline (the order matters, each step consumes the previous output; the first step rebuilds `data/keywords/` from scratch, so running it alone drops `applications/`, `bin/`, `boundary-conditions/`, and `manifest.auxiliary` - always run all four, or use `npm run extract:keywords` above):

```powershell
node tools\extract-openfoam-keywords.mjs
node tools\build-source-review.mjs
node tools\build-app-bin-review.mjs
node tools\merge-source-supplements.mjs
```

Build the VSIX:

```powershell
powershell -ExecutionPolicy Bypass -File tools\build-vsix.ps1
```

Output:

```text
openfoam-dict-intellisense-1.1.9.vsix
```

## License / 许可证

This project is licensed under the MIT License. See [LICENSE](LICENSE).

本项目采用 MIT License，详见 [LICENSE](LICENSE)。
