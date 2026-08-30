# OpenFOAM Dict IntelliSense

VS Code IntelliSense for OpenFOAM — dictionary-file completions (78 file types), offline hints for `.C`/`.H` solver code, and one-click access to the OpenFOAM compile environment.

## Features

- **78 file-type keyword mappings** - Context-aware suggestions for 0/, constant/, system/ files
- **Fuzzy search** - Prefix + substring matching, up to 100 results
- **43K clean word database** - From OpenFOAM-v2606, numeric noise removed
- **72 dynamic libraries** - Complete `libs()` suggestions for controlDict functions
- **126 dynamicMeshDict keywords** - Full rigid body, 6DOF, motion solver types
- **291 controlDict keywords** - Function objects, runtime controls, libraries
- **Offline code hints** - 4,577 OpenFOAM class completions, header and `#include` suggestions, plus OpenFOAM code keywords (`Info`, `forAll`, `nl`, `endl`, `fvc::`, `fvm::`, `IOobject::` …) with `FOAMSRC` on
- **Hover hints** - mouse over OpenFOAM keywords/classes shows description, defining header and usage
- **Code snippets** - solver/PIMPLE/SIMPLE/readDict/createField templates via `foamSolver`, `foamPimple`, `foamSimple`, `foamReadDict`, `foamCreateField`, …
- **Smart Highlighting** - 447 curated keywords highlighted
- **Auto-detect** - Recognizes 0/, constant/, system/ directory files

## Installation

- From VSIX: Extensions panel → `...` → `Install from VSIX...` → select `openfoam-dict-intellisense-1.1.0.vsix`.
- Or from the terminal: `code --install-extension openfoam-dict-intellisense-1.1.0.vsix`.

The Microsoft C/C++ extension (`ms-vscode.cpptools`) is recommended for full IntelliSense when an OpenFOAM environment is available.

## Usage

1. Open any OpenFOAM case directory in VS Code
2. FOAMDict mode is **OFF by default** — click `FOAMDict` in the status bar to enable
3. Type any keyword fragment to see suggestions
4. Use **arrow keys** to browse, press **Enter** to select
5. **Tab** is disabled to prevent accidental edits
6. Click `FOAMDict` / `FOAMSRC` in the status bar to toggle modes — turning a toggle on opens an info panel describing what it does

## OpenFOAM Compile Environment Toggle

Writing OpenFOAM solvers/applications needs the full compile environment (headers, defines, wmake). Click the **`FOAMSRC`** status bar item (next to `FOAMDict`) to toggle it per workspace:

- **ON**: auto-detects the OpenFOAM installation (`WM_PROJECT_DIR` → `OpenFOAM-v*/` inside the workspace → `~/OpenFOAM/`), creates source symlinks, backs up and writes `.vscode/c_cpp_properties.json` / `tasks.json` / `settings.json` with all `lnInclude` dirs and the exact wmake macros (`OPENFOAM=<ver>`, `WM_DP`/`WM_SP`, `WM_LABEL_SIZE=32/64`, `NoRepository`), plus `wmake`/`wclean` build tasks.
- **OFF**: restores the previous `.vscode` files and removes plugin-created symlinks.
- **OpenFOAM: Open Terminal with Environment**: opens an integrated terminal with `$WM_PROJECT_DIR/etc/bashrc` sourced.
- The toggle state is remembered per workspace and restored on reload.

Requires the Microsoft C/C++ extension (`ms-vscode.cpptools`) for IntelliSense.

## Auto Global Setup

On activation the extension **auto-detects** whether the machine has an OpenFOAM compile environment (`WM_PROJECT_DIR` → `OpenFOAM-v*/` in the workspace → `~/OpenFOAM/`):

- **Detected**: it automatically writes the global VS Code user settings (`C_Cpp.default.includePath/defines/compilerPath/...`, `files.associations` for `*.C`/`*.H`, plus user-level `wmake`/`wclean` tasks) — no manual setup needed in any project. Runs once per machine; re-run anytime with `OpenFOAM: Apply Global IntelliSense Config`.
- **Not detected**: no global changes are made, and turning on **`FOAMSRC`** still works — it enters offline hint mode (bundled class names + header suggestions) instead of failing, so writing OpenFOAM code still gets suggestions.

## Offline Code Hints

Even **without an OpenFOAM installation**, the extension ships a bundled hint database and can help while writing `.C` / `.H` solver code:

- **`#include` suggestions**: type `#include "fv` and get common OpenFOAM headers (`fvCFD.H`, `fvOptions.H`, …) plus all ~3.9K headers extracted from OpenFOAM-v2206.
- **Class-name hints**: with **`FOAMSRC`** on (online or offline mode), typing an identifier suggests OpenFOAM classes (4,577) and shows which header defines it (e.g. `fvMesh` → `src/finiteVolume/fvMesh/fvMesh.H`).
- **Code keywords**: OpenFOAM-specific keywords/macros (`Info`, `FatalErrorInFunction`, `forAll`, `nl`, `endl`, `fvc::div`, `fvm::Sp`, `IOobject::MUST_READ`, `dimensionedScalar`, …) come with descriptions and useful snippets — extend the list in `data/cpp_keywords.json`.
- **Hover**: hovering a keyword/class shows its description, defining header and a usage snippet.
- **Snippets**: type `foamSolver` / `foamPimple` / `foamSimple` / `foamReadDict` / `foamCreateField` / `foamRunTime` in a `.C` file and press Enter to insert the template.
- **No false "undefined" squiggles**: a compatibility header (`data/foamCompat.H`) is force-included while `FOAMSRC` is on, so `Info`, `nl`, `endl`, `forAll` etc. are recognized by the C/C++ extension (online and offline).
- These hints are file-type aware: dictionary completions only appear in `0/constant/system` dictionary files; C++ hints only in `.C/.H/.cpp/...` files (fixes previous cross-pollution).

Full IntelliSense (go-to-definition, symbol resolution) still requires the actual OpenFOAM headers — enable the **`FOAMSRC`** environment toggle on a machine with OpenFOAM installed, or add the source tree to the workspace.

## Keyword Coverage

| Category | Keywords |
|----------|----------|
| Boundary conditions | 80+ |
| Turbulence models (RAS/LES) | 50+ |
| Discretization schemes | 80+ |
| Linear solvers | 30+ |
| Function objects | 100+ |
| fvOptions types | 58 |
| topoSet sources | 65 |
| Dynamic libraries | 72 |
| Dynamic mesh types | 126 |
| Lagrangian models | 50+ |
| Multiphase models | 40+ |
| **Total** | **43,319** |

## Requirements

VS Code 1.114.0+

## Development & Debugging

1. **Open this folder as the workspace**: `File` → `Open Folder…` → select `openfoam-assistant` (the `.vscode/launch.json` uses `${workspaceFolder}`, so it must be the root).
   - If you keep the parent workspace open instead, change `launch.json` args to `--extensionDevelopmentPath=${workspaceFolder}/openfoam-assistant`.
2. Set breakpoints in `src/extension.js`, then press **F5** (or `Run` → `Start Debugging`).
3. An **Extension Development Host** window opens with this extension loaded. In it, open a test OpenFOAM case / `.C` file and trigger the feature you want to inspect (status bar toggles, completion via `Ctrl+Space`, `#include` suggestions).
4. Back in the main window, the debugger pauses at breakpoints — inspect variables, call stack, and the Debug Console (`console.log` output appears there).
5. After editing code, press **Ctrl+Shift+F5** to restart the debug session, or `Developer: Reload Window` in the dev host.

Notes:

- The dev host shares the real VS Code user settings, so the auto global setup may write to `~/.config/Code/User/settings.json` on first run — that's expected.
- Extension-level errors can also be inspected via `Developer: Toggle Developer Tools` in the dev host window (Console tab).

### Manual verification checklist

Ready-made fixtures live in the `test-case/` folder (excluded from the vsix via `.vscodeignore`):

- **Auto global setup**: on startup, an info message appears; check `~/.config/Code/User/settings.json` for `C_Cpp.default.includePath/defines` and `files.associations`, and the user-level `tasks.json` for wmake/wclean.
- **FOAMDict completions**: open `test-case/0/U` or `system/controlDict`, click `FOAMDict`, type e.g. `fixed` or `Euler` — suggestions appear.
- **FOAMSRC (env present)**: click `FOAMSRC` — symlinks `OpenFOAM-v2206` / `ThirdParty-v2206` appear in the workspace and `.vscode/c_cpp_properties.json` is written; open `test-case/code/foamHello.C` — `#include "fvCFD.H"` should resolve.
- **Offline hints**: click `FOAMSRC` (offline mode), open `foamHello.C`, type `#include "fvC` for header suggestions, or type `dimensionedS` for class hints with header detail.
- **wmake task**: with FOAMSRC on, open `test-case/code/foamHello.C`, press `Ctrl+Shift+B` → `wmake: 编译当前文件夹`.
- **Offline (no OpenFOAM) mode**: add `"env": { "FOAM_ASSISTANT_OFFLINE": "1" }` to `launch.json`, restart F5 — FOAMSRC then enters offline hint mode instead of failing.

## Author

boyaoChen

## License

MIT
