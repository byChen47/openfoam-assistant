"""Deep scan of ALL 0/, constant/, system/ files in v2606 tutorials."""
import re, os, json
from collections import Counter

ROOT = r"D:\3.OpenFOAM\0.OpenFOAM\OpenFOAM\OpenFOAM-v2606\tutorials"
PLUGIN = r"D:\3.OpenFOAM\0.OpenFOAM\OpenFOAM\openfoam-assistant"

# Broader word pattern — also capture hyphenated, dotted, and :: names
word_pat = re.compile(r'\b([A-Za-z_][\w.:-]*\w)\b')
all_words = Counter()
files_found = []

for root, dirs_, files in os.walk(ROOT):
    dir_name = os.path.basename(root)
    parent_dir = os.path.basename(os.path.dirname(root))
    
    # Only scan 0/, constant/, system/ directories
    if dir_name not in ("0","system","constant","0.org","0.orig","constant.org","constant.orig","system.org","system.orig"):
        continue
    
    for f in files:
        ext = os.path.splitext(f)[1].lower()
        if ext in {".gz",".obj",".stl",".vtk",".msh",".png",".jpg",".bmp",".dat",".csv",".xlsx",".pdf",".tgz",".tar",".zip",".h5",".vtp",".vtu"}:
            continue
        fpath = os.path.join(root, f)
        try:
            size = os.path.getsize(fpath)
            if size > 500000: continue
            with open(fpath, "r", encoding="utf-8", errors="ignore") as fh:
                content = fh.read()
        except: continue
        
        files_found.append(fpath)
        
        # Extract words
        for m in word_pat.finditer(content):
            w = m.group(1)
            if len(w) >= 2:
                all_words[w] += 1

print(f"Scanned {len(files_found)} files in 0/constant/system/ dirs")
print(f"Unique words: {len(all_words)}")

# Show sample
print("\nTop 60 most frequent:")
for w, c in all_words.most_common(60):
    print(f"  {w}: {c}")

# Save with better metadata
unique = sorted(all_words.keys())
out = os.path.join(PLUGIN, "data", "tutorial_words.json")
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w", encoding="utf-8") as f:
    json.dump({
        "words": unique,
        "top500": {w: c for w, c in all_words.most_common(500)},
        "_count": len(unique),
        "_files": len(files_found)
    }, f, indent=2)
print(f"\nSaved: {os.path.getsize(out):,} bytes, {len(unique)} words")
