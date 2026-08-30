# OpenFOAM Assistant

面向 OpenFOAM 用户的 VS Code 插件与工具集。

## 仓库结构

- [`openfoam-assistant/`](openfoam-assistant) — VS Code 插件(OpenFOAM Dict IntelliSense):
  - FOAMDict:字典文件(0/constant/system)关键词补全与高亮
  - FOAMSRC:一键接入 OpenFOAM 源码编译环境(lnInclude、wmake 宏、构建任务),无安装时自动切换离线提示
  - 离线代码提示:OpenFOAM 关键字(195)、类名(4,577)、头文件与 `#include` 建议、悬停说明、10 个代码模板
- [`OpenFOAMPathSettingReadme.md`](OpenFOAMPathSettingReadme.md) — OpenFOAM 在 VS Code 中的环境配置说明
- [`_deep_scan.py`](_deep_scan.py) / [`_merge_scan.py`](_merge_scan.py) — 从 OpenFOAM 源码生成词库数据的脚本
- `README.MD` — 项目原始需求

## 快速开始

1. 打开 `openfoam-assistant/` 目录,按 F5 调试,或打包 vsix 安装;
2. 打开任一 OpenFOAM 算例,点状态栏 `FOAMDict` / `FOAMSRC` 开关;
3. 详见 [openfoam-assistant/README.md](openfoam-assistant/README.md)。

## License

MIT
