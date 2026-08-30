# OpenFOAM 在 VS Code 中的代码识别设置

本文记录如何让 VS Code 正确识别 OpenFOAM 的头文件、预处理宏和你自己写的 OpenFOAM 代码，使编写/编译 OpenFOAM 程序时拥有完整的智能提示、跳转定义和报错定位。

## 为什么需要设置

默认情况下 VS Code 存在两个问题：

1. **不识别 OpenFOAM 的文件后缀**。OpenFOAM 的源文件用大写 `.C`、头文件用大写 `.H`，而 VS Code 内置语言表只登记了小写 `.c` / `.h`（Linux 文件后缀区分大小写），因此 `.C` / `.H` 文件会被当成纯文本，没有代码补全和语法高亮。
2. **找不到 OpenFOAM 头文件**。OpenFOAM 通过 `wmake` 把每个模块的头文件软链接到 `src/<module>/lnInclude/`，编译时用 `-I$(FOAM_SRC)/<module>/lnInclude` 引用；VS Code 的 C/C++ 扩展（`ms-vscode.cpptools`）不知道这些目录，就会报 `#include errors detected`，并且整个文件的语法分析和提示都会失效。

## 前置条件

- VS Code 已安装 **C/C++** 扩展（`ms-vscode.cpptools`）。
- OpenFOAM 已经成功编译过，`src` 下存在 `lnInclude` 目录（例如 `$FOAM_SRC/OpenFOAM/lnInclude`）。
- 知道自己的 OpenFOAM 安装路径和编译选项，例如：
  ```bash
  echo $WM_PROJECT_DIR      # 例如 /home/<user>/OpenFOAM/OpenFOAM-v2206
  echo $WM_OPTIONS          # 例如 linux64GccDPInt32Opt
  echo $FOAM_SRC            # 例如 /home/<user>/OpenFOAM/OpenFOAM-v2206/src
  ```

## 方案一：全局用户设置（推荐，所有工程生效）

在 VS Code 用户设置文件（Linux：`~/.config/Code/User/settings.json`；Windows：`%APPDATA%\Code\User\settings.json`）中配置以下内容。路径请替换成你自己机器的实际路径。

### 1. 文件关联：让 `.C` / `.H` 作为 C++ 解析

```jsonc
"files.associations": {
    "*.C": "cpp",
    "*.H": "cpp"
}
```

### 2. C/C++ 全局默认配置

```jsonc
"C_Cpp.default.compilerPath": "/usr/bin/g++",
"C_Cpp.default.cppStandard": "c++14",
"C_Cpp.default.cStandard": "c11",
"C_Cpp.default.intelliSenseMode": "linux-gcc-x64",
"C_Cpp.default.defines": [
    "WM_DP",
    "WM_LABEL_SIZE=32"
],
"C_Cpp.default.includePath": [
    "${workspaceFolder}/**",
    "/home/<user>/OpenFOAM/OpenFOAM-v2206/src/OpenFOAM/lnInclude",
    "/home/<user>/OpenFOAM/OpenFOAM-v2206/src/finiteVolume/lnInclude",
    "/home/<user>/OpenFOAM/OpenFOAM-v2206/src/meshTools/lnInclude",
    "/home/<user>/OpenFOAM/OpenFOAM-v2206/src/OSspecific/POSIX/lnInclude"
    // ... 其余 src 下所有模块的 lnInclude 目录，见下文自动生成命令
],
"C_Cpp.default.browse.path": [
    "${workspaceFolder}",
    "/home/<user>/OpenFOAM/OpenFOAM-v2206/src",
    "/home/<user>/OpenFOAM/OpenFOAM-v2206/applications"
],
"C_Cpp.default.browse.limitSymbolsToIncludedHeaders": true
```

说明：

- `defines` 必须与 `$WM_OPTIONS` 一致。`linux64GccDPInt32Opt` 对应 `WM_DP` + `WM_LABEL_SIZE=32`；如果是单精度（SP）或 64 位标签（Int64），请相应改为 `WM_SP` / `WM_LABEL_SIZE=64`。这两个宏来自 `wmake/rules/General/general` 的编译参数。
- `includePath` 需要**逐个列出** OpenFOAM 的所有 `lnInclude` 目录，不要写成 `/.../src/**/lnInclude` 这种“中间带 `**`”的形式——C/C++ 扩展不支持路径中间的 globstar（见 [microsoft/vscode-cpptools#12070](https://github.com/microsoft/vscode-cpptools/issues/12070)），`**` 只支持放在路径末尾做递归搜索。
- `browse.path` 让扩展为**跨文件**符号建立索引，这样其它文件里定义的类/函数也能被识别和跳转。
- 如果代码中用到 ThirdParty 的 boost / CGAL 头文件，把对应目录也加入 `includePath`，例如：
  ```jsonc
  "/home/<user>/OpenFOAM/ThirdParty-v2206/sources/boost/boost_1_74_0",
  "/home/<user>/OpenFOAM/ThirdParty-v2206/sources/cgal/CGAL-4.14.3/include"
  ```

### 3. 自动生成 includePath 目录列表

用一条命令把 src 和 applications 下所有 `lnInclude` 目录列出来，粘进 `includePath`：

```bash
find $FOAM_SRC $FOAM_APP -type d -name lnInclude | sort
```

### 4.（可选）wmake 编译任务

把下面的内容放到用户级任务文件（`~/.config/Code/User/tasks.json`），或工程级 `.vscode/tasks.json`，即可在 VS Code 中直接编译当前文件夹：

```jsonc
{
    "version": "2.0.0",
    "tasks": [
        {
            "label": "wmake: 编译当前文件夹",
            "type": "shell",
            "command": "bash -lc 'source /home/<user>/OpenFOAM/OpenFOAM-v2206/etc/bashrc && wmake'",
            "options": { "cwd": "${fileDirname}" },
            "group": "build",
            "problemMatcher": ["$gcc"]
        },
        {
            "label": "wclean: 清理当前文件夹",
            "type": "shell",
            "command": "bash -lc 'source /home/<user>/OpenFOAM/OpenFOAM-v2206/etc/bashrc && wclean'",
            "options": { "cwd": "${fileDirname}" },
            "group": "build"
        }
    ]
}
```

## 方案二：工程级 `c_cpp_properties.json`

在某个工程的 `.vscode/c_cpp_properties.json` 中放置相同配置。工程级配置优先于全局默认值，适合只想对单个工程启用，或全局默认值未能生效时兜底：

```jsonc
{
    "configurations": [
        {
            "name": "OpenFOAM-v2206 (linux64GccDPInt32Opt)",
            "includePath": [
                "${workspaceFolder}/**",
                "/home/<user>/OpenFOAM/OpenFOAM-v2206/src/OpenFOAM/lnInclude",
                "/home/<user>/OpenFOAM/OpenFOAM-v2206/src/finiteVolume/lnInclude",
                "/home/<user>/OpenFOAM/OpenFOAM-v2206/src/meshTools/lnInclude",
                "/home/<user>/OpenFOAM/OpenFOAM-v2206/src/OSspecific/POSIX/lnInclude"
                // ... 其余 lnInclude 目录同上
            ],
            "defines": ["WM_DP", "WM_LABEL_SIZE=32"],
            "compilerPath": "/usr/bin/g++",
            "cStandard": "c11",
            "cppStandard": "c++14",
            "intelliSenseMode": "linux-gcc-x64"
        }
    ],
    "version": 4
}
```

## 当前项目已应用的配置(2026-08-30)

本仓库(openfoam-assistant 所在的工作区)已经按方案二落地，并把 OpenFOAM 源码整合进了项目，无需再手动配置。应用内容如下：

### 1. OpenFOAM 源码软链接整合

项目根目录下新增了两个软链接，把本机 OpenFOAM 安装直接挂到工作区里（零拷贝，不占额外磁盘）：

```bash
OpenFOAM-v2206    -> /home/chen/OpenFOAM/OpenFOAM-v2206      # 2.7GB 源码树
ThirdParty-v2206  -> /home/chen/OpenFOAM/ThirdParty-v2206    # boost / CGAL 等
```

这样在 VS Code 资源管理器里可以直接浏览 OpenFOAM 源码、搜索头文件，`${workspaceFolder}/OpenFOAM-v2206/**` 也能在 includePath 中生效。**注意：这两个软链接是 IntelliSense 路径解析的根基，不要删除或改名。**

### 2. 工程级 `c_cpp_properties.json`

[`.vscode/c_cpp_properties.json`](.vscode/c_cpp_properties.json) 与全局设置等价，但路径全部改写为 `${workspaceFolder}/OpenFOAM-v2206/...` 的相对形式，随仓库走：

- `includePath`：自动收集了 OpenFOAM 全部 **173 个 `lnInclude` 目录**（含 `modules/OpenQBMM`），并追加 ThirdParty 的 boost 1.74.0 与 CGAL 4.14.3；
- `defines`：`OPENFOAM=2206` + `WM_DP` + `WM_LABEL_SIZE=32` + `NoRepository`（对应 `linux64GccDPInt32Opt` 与 wmake 的实际编译参数）。**前两个不能省**：`OPENFOAM=<版本>` 来自 wmake 的 `-D$(WM_VERSION)`，`NoRepository` 决定模板 `.C` 文件是否内联包含——缺了它们，`fvCFD.H` 会报 `ISstream` / `FieldField` 未声明、版本门控代码解析错乱；
- `compilerPath`：`/usr/bin/g++`，`cppStandard`：`c++14`，`intelliSenseMode`：`linux-gcc-x64`；
- `browse.path`：工作区 + `OpenFOAM-v2206/src` + `OpenFOAM-v2206/applications`，支持跨文件符号索引。

### 3. 工程级 wmake 任务

[`.vscode/tasks.json`](.vscode/tasks.json) 提供了与全局用户级任务相同的 `wmake: 编译当前文件夹` 和 `wclean: 清理当前文件夹`，直接在 VS Code 里 `Ctrl+Shift+B` 即可编译/清理当前 OpenFOAM 求解器目录。

### 4. 工程级文件关联与监听优化

[`.vscode/settings.json`](.vscode/settings.json)：

- `files.associations`：`*.C` / `*.H` 一律按 C++ 解析（项目级兜底，不依赖全局设置）；
- `files.watcherExclude`：排除 `OpenFOAM-v2206/**` 与 `ThirdParty-v2206/**`，避免 VS Code 文件监听 2.7GB 源码树触发 inotify 上限。

## 插件化：状态栏 OpenFOAM 开关（推荐）

上述手动配置已经做成了插件功能（openfoam-assistant 当前版本）。安装插件后，状态栏会出现 **`FOAMDict`** 和 **`FOAMSRC`** 两个开关（原 `C++` 开关已取消，与 VS Code 自带 C++ 扩展重复；类名提示并入 `FOAMSRC`）。打开任一开关时，插件会**自动弹出一个说明页面**，写明该开关当前状态和功能，不再弹出大量通知：

- **自动检测**：插件启动时会自动查询本机是否存在 OpenFOAM 编译环境（依次检查 `WM_PROJECT_DIR` 环境变量、工作区内 `OpenFOAM-v*/` 目录、`~/OpenFOAM/`）。检测到就**自动写入 VS Code 全局用户配置**（`C_Cpp.default.includePath/defines/compilerPath`、`files.associations` 的 `*.C/*.H`，以及用户级 `wmake`/`wclean` 任务），每台机器只自动执行一次，之后无需任何手动设置；也可随时用命令 `OpenFOAM: Apply Global IntelliSense Config` 重新应用。
- **打开（默认关）**：插件自动查找 OpenFOAM 安装（优先 `WM_PROJECT_DIR` 环境变量，其次工作区内 `OpenFOAM-v*/` 目录，最后 `~/OpenFOAM/`），然后：
  1. 在工作区创建 `OpenFOAM-v*`、`ThirdParty-v*` 源码软链接；
  2. 备份工作区原有 `.vscode/c_cpp_properties.json`、`tasks.json`、`settings.json`，再写入自动生成的配置（全部 `lnInclude`、正确宏、wmake/wclean 任务、`.C`/`.H` 文件关联）；
  3. 状态栏提示已开启的 lnInclude 数量。
- **无安装时的离线模式**：如果本机没有 OpenFOAM 编译环境，打开 `FOAMSRC` 不会报错，而是直接进入**离线代码提示模式**——写 `.C`/`.H` 时依然有类名、头文件和 `#include` 建议（数据随插件内置），解决“写 OpenFOAM 代码没有提示”的问题。
- **关闭**：把 `.vscode` 三个文件还原为备份（无备份则删除插件生成的文件），并移除插件创建的软链接。
- **配套命令**：`OpenFOAM: Open Terminal with Environment` 打开一个已 `source` OpenFOAM bashrc 的集成终端，直接运行 wmake/foamRun 等；`OpenFOAM: Setup C++ IntelliSense for Workspace` 等价于打开开关。
- 开关状态按工作区记忆，重启 VS Code 后自动恢复；检测不到 OpenFOAM 时会给出提示而不是静默失败。

如果使用这个开关，前面方案一/二的手动配置可以不做，二者效果等价（本项目仓库内当前仍保留了一份手工生成的 `.vscode` 配置作为默认兜底）。

## 没有安装/编译 OpenFOAM 时的离线提示

插件内置了一份从 OpenFOAM-v2206 源码提取的提示数据库（约 3.9K 个头文件映射 + 4.5K 类名 + 常用 include 清单），**不依赖本机 OpenFOAM 安装**，在 `.C` / `.H` 文件里也能给出提示：

- 输入 `#include "fv` → 建议 `fvCFD.H`、`fvOptions.H` 等常用头文件，以及全部可检索头文件；
- 打开 `FOAMSRC` 后输入标识符 → 建议 OpenFOAM 类名，并标注它定义在哪个头文件（如 `fvMesh` → `src/finiteVolume/fvMesh/fvMesh.H`）；
- 提示按文件类型隔离：字典补全只出现在 `0/constant/system` 字典文件，C++ 提示只出现在 `.C/.H/.cpp` 等代码文件。
- 悬停与模板：悬停 `Info`、`fvMesh` 等关键字/类名显示说明与头文件；输入 `foamSolver`、`foamPimple` 等前缀可直接插入求解器骨架模板。

需要明确边界：**类名/头文件这类“提示”可以离线提供，但跳转定义、符号解析这类完整 IntelliSense 必须依赖真实头文件**——要么本机装有 OpenFOAM（打开 `FOAMSRC` 开关自动接入），要么把 OpenFOAM 源码放进工作区。

## 验证是否生效

1. `Ctrl+Shift+P` → 执行 `Reload Window`（必要时再执行一次 `C/C++: Reset IntelliSense Database`）。
2. 打开任意 `.C` 文件，看右下角语言模式应显示 **C++**（不是纯文本）。
3. `#include "fvCFD.H"` 不再报 `#include errors detected`；按住 `Ctrl` 点击它会跳转到 `src/finiteVolume/cfdTools/general/include/fvCFD.H`。
4. 输入同一个文件里之前定义的变量名前几个字母（或按 `Ctrl+Space`），应出现自动补全。

## 常见问题

- **仍报 `#include errors detected`**：确认 `includePath` 里没有“中间带 `**`”的写法；确认 `lnInclude` 目录存在（OpenFOAM 需先编译过）；改完设置后执行 `Reload Window`。
- **同文件里定义的符号没有提示**：检查右下角语言模式是否为 C++（`.C` / `.H` 的文件关联是否生效）。
- **其它文件里定义的类/函数没有提示**：C++ 必须先用 `#include` 包含对应的 `.H` 头文件才能“看见”这些符号；同时确认 `browse.path` 覆盖了工程目录。
- **宏定义报错（如 `label` 类型不对）**：检查 `defines` 是否与 `$WM_OPTIONS` 匹配（DP/SP、Int32/Int64）。

## 参考：作者本机的实际配置

- OpenFOAM：`/home/chen/OpenFOAM/OpenFOAM-v2206`（`WM_OPTIONS=linux64GccDPInt32Opt`）
- ThirdParty：`/home/chen/OpenFOAM/ThirdParty-v2206`（boost 1.74.0、CGAL 4.14.3）
- 编译器：`/usr/bin/g++`
- 所有配置均放在全局用户设置 `~/.config/Code/User/settings.json` 与 `~/.config/Code/User/tasks.json`，任意 OpenFOAM 工程通用。
