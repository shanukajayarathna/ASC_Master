import os, csv, shutil, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
ROOT = r"C:\Projects\ASC Projects\Project ASC Master\data\msl\factory-averages"
STAGE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "recon")
MAN = os.path.join(ROOT, "manifest.csv")

rows = list(csv.DictReader(open(MAN, encoding="utf-8")))
fields = list(rows[0].keys())
if "derived_from" not in fields:
    fields.append("derived_from")
for r in rows:
    r.setdefault("derived_from", "")
by_path = {r["path"]: r for r in rows}

# 1) the raw Dec 2018 legacy-layout text becomes the second copy; the reconstructed report takes the base name
raw = os.path.join(ROOT, "2018", "factory-averages-2018-12.txt")
raw2 = os.path.join(ROOT, "2018", "factory-averages-2018-12~2.txt")
if os.path.exists(raw) and not os.path.exists(raw2):
    os.rename(raw, raw2)
    r = by_path.pop("factory-averages/2018/factory-averages-2018-12.txt", None) or by_path.pop("2018/factory-averages-2018-12.txt", None)
    if r is None:
        r = next(x for x in rows if x["path"].endswith("2018/factory-averages-2018-12.txt"))
        by_path.pop(r["path"], None)
    r["path"] = r["path"].replace("factory-averages-2018-12.txt", "factory-averages-2018-12~2.txt")
    by_path[r["path"]] = r

added = 0
for fn in sorted(os.listdir(STAGE)):
    y, m = int(fn[17:21]), int(fn[22:24])
    dest = os.path.join(ROOT, str(y), fn)
    shutil.copy2(os.path.join(STAGE, fn), dest)
    rel = f"factory-averages/{y}/{fn}"
    # the source it was rebuilt from: the sibling PDF (or the raw Dec-2018 text copy)
    src_rel = f"factory-averages/{y}/factory-averages-{y}-{m:02d}.pdf" if os.path.exists(os.path.join(ROOT, str(y), f"factory-averages-{y}-{m:02d}.pdf")) else f"factory-averages/{y}/factory-averages-{y}-{m:02d}~2.txt"
    src_row = next((x for x in by_path.values() if x["path"].endswith(src_rel.replace("factory-averages/", "", 1)) or x["path"] == src_rel), None)
    by_path[rel] = dict(path=rel, kind="factory-averages", period=f"{y}-{m:02d}", period_source="content", variant="", format="txt",
                        source_encoding="derived", source_path=(src_row or {}).get("source_path", ""), source_sha1="", source_bytes=os.path.getsize(dest),
                        derived_from=src_rel)
    added += 1
print("reconstructed files placed:", added)

# normalise manifest paths (earlier rows are relative to factory-averages/ or to msl/): keep them as they were
out = sorted(by_path.values(), key=lambda x: (x["kind"], x["period"], x["variant"], x["path"]))
with open(MAN, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=fields)
    w.writeheader()
    w.writerows(out)
print("manifest rows:", len(out))
