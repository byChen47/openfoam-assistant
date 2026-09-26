# OpenFOAM keyword supplements

本目录保存从 OpenFOAM 源码提取的、与算例设置直接相关的运行类型候选。所有名称保持 OpenFOAM 源码中的原始大小写。

This directory contains source-derived runtime type candidates used by the
OpenFOAM case-setting completion index. Names preserve the original case used in
the OpenFOAM source tree.

## 文件划分 / File layout

| 文件 / File | 内容 / Content |
| --- | --- |
| `fvSchemes/surfaceInterpolation.json` | 面插值格式，例如 `limitedLinearV`、`vanLeer`、`MUSCLV` |
| `fvSchemes/convectionSchemes.json` | 对流格式，例如 `Gauss`、`bounded` |
| `fvSchemes/d2dt2Schemes.json` | 二阶时间导数格式 |
| `fvSchemes/ddtSchemes.json` | 时间导数格式 |
| `fvSchemes/gradSchemes.json` | 梯度格式 |
| `fvSchemes/divSchemes.json` | 散度格式框架 |
| `fvSchemes/laplacianSchemes.json` | 拉普拉斯格式 |
| `fvSchemes/snGradSchemes.json` | 法向梯度格式 |
| `fvSolution/solvers.json` | 线性方程求解器 |
| `fvSolution/preconditioners.json` | 预条件器 |
| `fvSolution/smoothers.json` | 光滑器 |
| `0/fvPatchFields.json` | `0` 文件边界条件类型 |
| `0/pointPatchFields.json` | 点场边界条件类型 |
| `constant/transportModels.json` | 传输/黏度模型 |
| `constant/turbulenceModels/RAS.json` | RAS 湍流模型 |
| `constant/turbulenceModels/LES.json` | LES/DES 湍流模型 |
| `constant/turbulenceModels/LES/LESdelta.json` | LES 尺度模型 |
| `constant/turbulenceModels/LES/LESfilter.json` | LES 过滤模型 |
| `system/functionObjects.json` | 函数对象类型 |

## 手工维护 / Manual maintenance

每个 JSON 都包含自动生成的 `items` 数组。需要长期保留的手工补充请写入同一个文件的
`manualItems` 数组，重新运行数据管线时不会被覆盖。`items` 由源码扫描器重建，
`manualItems` 会一起被合并到正式索引。

Each JSON file contains generated `items`. Put durable manual additions in the
`manualItems` array of the same file. Regenerating the data pipeline replaces
`items` but preserves `manualItems`; both are merged into the runtime indexes.

The supplements are generated from OpenFOAM runtime registration macros. The parser resolves the C++ class passed to `make*` and `addToRunTimeSelectionTable` through the class-level `TypeName("...")`, so the JSON files contain runtime names rather than implementation class names. OpenFOAM-v2606 uses `skewCorrected` and `cubic`, not `skewLinear` or `cubicCorrected`; `noInterfaceCompression` is not registered. `interfaceCompression`, `DEShybrid`, `Phi`, `blended`, and the Fit schemes are included for source-backed completion.

## 重建 / Regeneration

```powershell
node tools\build-keyword-supplements.mjs
node tools\merge-keyword-supplements.mjs
node --test tests\openfoam.test.js
```

完整流程请使用仓库根目录 `README.md` 中的 `npm.cmd run extract:keywords`（Windows PowerShell 可能需要 `npm.cmd`）。

The full workflow is documented in the repository root `README.md`.
