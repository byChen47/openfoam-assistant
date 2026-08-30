"""Merge tutorial words + filenames + src keywords into one database."""
import re, os, json
from collections import Counter

ROOT = r"D:\3.OpenFOAM\0.OpenFOAM\OpenFOAM\OpenFOAM-v2606"
PLUGIN = r"D:\3.OpenFOAM\0.OpenFOAM\OpenFOAM\openfoam-assistant"

word_pat = re.compile(r'\b([A-Za-z_][\w.:-]*\w)\b')
all_words = Counter()

# ═══ 1. Tutorials: 0/, constant/, system/ files ═══
tut = os.path.join(ROOT, "tutorials")
for root, dirs_, files in os.walk(tut):
    dname = os.path.basename(root)
    if dname not in ("0","system","constant","0.org","0.orig","constant.org","constant.orig","system.org","system.orig"):
        continue
    for f in files:
        ext = os.path.splitext(f)[1].lower()
        if ext in {".gz",".obj",".stl",".vtk",".msh",".png",".jpg",".bmp",".dat",".csv",".xlsx",".pdf",".tgz"}:
            continue
        fpath = os.path.join(root, f)
        try:
            if os.path.getsize(fpath) > 300000: continue
            with open(fpath, "r", encoding="utf-8", errors="ignore") as fh:
                content = fh.read()
        except: continue
        for m in word_pat.finditer(content):
            w = m.group(1)
            if len(w) >= 2:
                all_words[w] += 1
        # Also add the filename itself as a keyword
        fn = os.path.splitext(f)[0]
        if len(fn) >= 2 and not fn.startswith("."):
            all_words[fn] += 1

# ═══ 2. Walk all tutorials to collect FILENAMES ═══
for root, dirs_, files in os.walk(tut):
    for f in files:
        fn = os.path.splitext(f)[0]
        if len(fn) >= 2 and not fn.startswith(".") and not fn.isdigit():
            all_words[fn] += 1

# ═══ 3. Quick src scan for missing keywords ═══
src = os.path.join(ROOT, "src")
dict_pat = re.compile(r'(?:dict|coeffs|d)\.(?:lookup|get|lookupOrDefault|readIfPresent)\s*[<(]\s*"(\w+)"')
for root, dirs_, files in os.walk(src):
    if "lnInclude" in root: continue
    for f in files:
        if not f.endswith((".C",".H")): continue
        try:
            with open(os.path.join(root,f), "r", encoding="utf-8", errors="ignore") as fh:
                content = fh.read()
        except: continue
        for m in dict_pat.finditer(content):
            all_words[m.group(1)] += 1

# ═══ 4. Applications scan ═══
apps = os.path.join(ROOT, "applications")
for root, dirs_, files in os.walk(apps):
    for d in dirs_:
        if len(d) >= 2: all_words[d] += 3
    for f in files:
        if not f.endswith((".C",".H")): continue
        try:
            with open(os.path.join(root,f), "r", encoding="utf-8", errors="ignore") as fh:
                content = fh.read()
        except: continue
        for m in word_pat.finditer(content):
            w = m.group(1)
            if len(w) >= 2: all_words[w] += 1

# ═══ Save ═══
unique = sorted(all_words.keys())
out = os.path.join(PLUGIN, "data", "tutorial_words.json")
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w", encoding="utf-8") as f:
    json.dump({"words": unique, "_count": len(unique)}, f)

print(f"Words: {len(unique)}")
print(f"Size: {os.path.getsize(out):,} bytes")

# Check previously missing
for k in ["alphatWallFunction","renumberMeshDict","faSchemes","faSolution"]:
    print(f"  {k}: {'OK' if k in all_words else 'MISSING'}")