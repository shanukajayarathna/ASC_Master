import csv, os
ROOT = r"C:\Projects\ASC Projects\Project ASC Master\data\msl"
MAN = os.path.join(ROOT, "factory-averages", "manifest.csv")
rows = list(csv.DictReader(open(MAN, encoding="utf-8")))
fields = list(rows[0].keys())
by = {r["path"]: r for r in rows}
added = 0
for m in range(1, 12):
    pdf = f"plantation-ranking/2018/plantation-ranking-2018-{m:02d}.pdf"
    txt = f"plantation-ranking/2018/plantation-ranking-2018-{m:02d}.txt"
    src = by.get(pdf)
    if txt in by or not os.path.exists(os.path.join(ROOT, txt.replace("/", os.sep))):
        continue
    by[txt] = dict(path=txt, kind="plantation-ranking", period=f"2018-{m:02d}", period_source="content", variant="", format="txt",
                   source_encoding="derived", source_path=(src or {}).get("source_path", ""), source_sha1="",
                   source_bytes=os.path.getsize(os.path.join(ROOT, txt.replace("/", os.sep))), derived_from=pdf)
    added += 1
out = sorted(by.values(), key=lambda x: (x["kind"], x["period"], x["variant"], x["path"]))
with open(MAN, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=fields)
    w.writeheader()
    w.writerows(out)
print("manifest rows added:", added, "| total:", len(out))
