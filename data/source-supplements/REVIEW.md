# OpenFOAM Keyword Supplement Review

## Summary

- Source roots: `OpenFOAM-v2606/src`, `OpenFOAM-v2606/applications`
- Source files scanned: 11,362
- Dictionary calls found: 4,092
- Files with source-derived candidates: 463
- Source-derived candidate entries: 6,657
- Candidate origins: `src` 4,390, `applications` 322, `etc` 4,156
- Boundary condition types: 148
- Boundary conditions with explicit keywords: 38
- Boundary conditions without extra keywords: 110
- Mapped source types: 342
- Unmapped source types: 982

## Output

- `0/`, `constant/`, `system/`: source-derived candidates grouped by concrete target file
- `boundary-conditions.json`: aggregate boundary condition catalog
- `boundary-conditions/`: one independent JSON file per boundary condition
- `coverage.json`: mapped/unmapped and boundary condition coverage statistics
- `unmapped.json`: source classes not yet mapped to a concrete case file
- `manifest.json`: machine-readable index

All keywords preserve OpenFOAM source casing.
## Applications Supplement

- Source files scanned: 1,791
- Application groups: 247
- Dictionary keywords: 532
- Command-line options/arguments: 297
- Output: `applications/`, one independent JSON file per application group

## Bin Supplement

- Shell script files: 64
- Commands collected: 2,131
- Functions collected: 86
- Variables collected: 980
- Options collected: 1,216
- Output: `bin/`, one independent JSON file per script