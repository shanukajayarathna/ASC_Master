import os, sys, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fw_reconstruct as R
from fw_parse import parse as parse_a

ROOT = R.ROOT
res = R.main()   # (year, month) -> (rows, text) for the legacy months
by_month = {}
for (y, m), (rows, _) in res.items():
    by_month[(y, m)] = {r["code"]: r["q"] for r in rows}
for y in (2019, 2020):
    for m in range(1, 13):
        if (y, m) in by_month:
            continue
        p = os.path.join(ROOT, str(y), f"factory-averages-{y}-{m:02d}.txt")
        if os.path.exists(p):
            _, _, rows = parse_a(open(p, encoding="utf-8").read())
            by_month[(y, m)] = {}
            for r in rows:
                if r["kind"] == "FACTORY":
                    q = r["q"]
                    by_month[(y, m)][r["code"]] = {"main_m": q.get(0, 0), "main_c": q.get(1, 0), "off_m": q.get(2, 0), "off_c": q.get(3, 0), "tot_m": q.get(4, 0), "tot_c": q.get(6, 0)}

print("\nYTD continuity: cumulative(month) == cumulative(previous month) + monthly(month)")
tot_bad = 0
for (y, m) in sorted(by_month):
    cur = by_month[(y, m)]
    prev = by_month.get((y, m - 1)) if m > 1 else {}
    if prev is None:
        continue
    bad = collections.Counter()
    checked = 0
    for code, q in cur.items():
        p = prev.get(code, {}) if m > 1 else {}
        for mc, cc in (("main_m", "main_c"), ("off_m", "off_c"), ("tot_m", "tot_c")):
            checked += 1
            if abs((p.get(cc, 0) or 0) + (q.get(mc, 0) or 0) - (q.get(cc, 0) or 0)) > 1:
                bad[cc] += 1
    legacy = "legacy" if (y, m) in res else "      "
    print(f"  {y}-{m:02d} {legacy}: {len(cur):4} factories, {checked:5} checks, mismatching cells {sum(bad.values()):3} {dict(bad) or ''}")
    tot_bad += sum(bad.values())
print("total mismatching cells:", tot_bad)
