# Changelog

## 1.1.2
- FOAMDict auto-highlighting expanded: dictionary keywords from the FOAMDict data (union of all file-type keyword tables + curated list, 939 tags) are highlighted automatically in recognized OpenFOAM case files (`0/constant/system` and known filenames)
- No more workspace symlinks: `FOAMSRC` configs use absolute OpenFOAM paths only (the plugin no longer creates `OpenFOAM-v*` / `ThirdParty-v*` links in the workspace); legacy links are removed when the toggle is switched off
- Auto global setup now re-validates on every startup: if OpenFOAM is detected and the global `forcedInclude` (compat header) is missing, the global config is re-applied automatically
- Multiple OpenFOAM versions: all detected installs are merged into the global includePath (deduplicated by real path, highest version first); defines/compiler/tasks follow the highest version
- Offline hints now activate even without a workspace folder: `FOAMSRC` can be toggled in single-file mode (no `.vscode` write, pure bundled hints)
- Hover on `#include "xxx.H"` shows the header description or the classes it defines (offline-friendly)
- Curated include list expanded (30 → 36): `createControl.H`, `pisoControl.H`, `setRootCase.H`, `readGravity.H`, `fluidThermo.H`, `basicThermo.H`
- 74 offline stub headers (`data/stubs/`) added to the offline include path — common `#include "xxx.H"` resolve without an OpenFOAM install, eliminating `#include errors detected` for them
- New command `OpenFOAM: Set OpenFOAM Install Path` for non-standard installations (stores the path, re-applies workspace config when FOAMSRC is on)
- Auto-detection extended to `/opt/OpenFOAM` and `/usr/local/OpenFOAM`
- Added a "Troubleshooting on other computers" section to the README (cpptools requirement, FOAMSRC toggle, forcedInclude check, manual path, IntelliSense reset)
- Fixed false "identifier is undefined" for OpenFOAM code symbols (`nl`, `endl`, `Info`, `Pout`, `forAll`, …): new IntelliSense compatibility header (`data/foamCompat.H`) is force-included via `forcedInclude` in workspace/global configs
- Offline mode now writes a minimal `.vscode/c_cpp_properties.json` (defines `FOAM_ASSISTANT_OFFLINE` + forced compat header) so cpptools stops flagging OpenFOAM identifiers even without an installation
- Audited the keyword list against OpenFOAM-v2206: removed non-existent entries (`Cout`, `Cerr`, `indent`, `NOT_IMPLEMENTED`, `forAllList*`, `Pstream::allReduce/combineReduce`, `dimKinematicViscosity`, `dimMassFlowRate`, `dimVolumetricFlowRate`, `dimAngle`) and added the real ones (`combineReduce`, `dimViscosity`, `dimVol`, `dimMoles`, `dimCurrent`, `dimLuminousIntensity`, `dimPower`, `dimCompressibility`, `dimGasConstant`, `dimSpecificHeatCapacity`) — 192 keywords total
- Compat header now also covers `forAllIter` / `forAllConstIter` and the full error-macro set (`InfoIn*`, `WarningIn*`, `SeriousErrorIn*`, `FatalErrorIn*`, `FatalIOErrorIn*`, `NotImplemented`) in offline mode

## 1.0.9
- OpenFOAM code keywords expanded to 195 (`Info`, `forAll`, `nl`, `endl`, `fvc::`/`fvm::`, `IOobject::`, dimensioned types, runTime/mesh methods, `Pstream`/`gSum`, math helpers, run-time selection macros, …) with descriptions and snippets — extendable via `data/cpp_keywords.json`
- Hover hints: hovering OpenFOAM keywords/classes shows description, defining header and usage (FOAMSRC on)
- C++ snippets added (`foamSolver`, `foamPimple`, `foamSimple`, `foamReadDict`, `foamCreateField`, `foamRunTime`, `foamInfo`, `foamFatal`, `foamForAll`, `foamTurbulence`) for `.C` files
- Filled missing file keyword tables (`Allrun`, `Allwmake`, `Allclean`, `foamDictionary`) — 78 file-type mappings total

## 1.0.8
- Status bar toggles renamed: `Dict` → `FOAMDict` (now OFF by default), `OpenFOAM` → `FOAMSRC`; order is FOAMDict / FOAMSRC / C++
- `FOAMSRC` toggle: auto-detects an OpenFOAM install, creates source symlinks and workspace `.vscode` config (all lnInclude dirs + exact wmake macros `OPENFOAM=<ver>`, `WM_DP/SP`, `WM_LABEL_SIZE`, `NoRepository`)
- Auto global setup: detects OpenFOAM on activation and writes VS Code user settings + wmake/wclean tasks once per machine
- Offline code hints: bundled class→header map (3,886) and common include list; `#include "fv...` and class-name suggestions work without an OpenFOAM install (FOAMSRC falls back to offline mode)
- File-type aware completion: dictionary hints only in 0/constant/system files, C++ hints only in code files
- Commands: `OpenFOAM: Apply Global IntelliSense Config`, `OpenFOAM: Open Terminal with Environment`
- Test hook `FOAM_ASSISTANT_OFFLINE=1` to simulate a machine without OpenFOAM
- Turning on `FOAMDict` / `FOAMSRC` opens an info panel describing the toggle state and features (replaces notification spam)
- Removed the `C++` status bar toggle (duplicated the built-in C++ extension); code hints now follow the `FOAMSRC` toggle

## 1.0.7
- C++ class-name completions enriched with header info

## 1.0.6
- 74 file-type keyword mappings
- 43K clean word database (numeric noise removed)
- 72 dynamic libraries for controlDict libs()
- 126 dynamicMeshDict keywords
- 291 controlDict keywords
- Fuzzy search: prefix + substring (100 max)
- C++ mode: 4,577 class completions

## 1.0.0
- Initial release
