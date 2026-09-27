import sys, os, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fw_pdf as F
from fw_parse import parse

R = r"C:\Projects\ASC Projects\Project ASC Master\data\msl\factory-averages\2019"
QMAP = {"main_m": 0, "main_c": 1, "off_m": 2, "off_c": 3, "tot_m": 4, "rank_m": 5, "tot_c": 6, "rank_c": 7}
for m in ("02", "08", "09"):
    pdf = os.path.join(R, f"factory-averages-2019-{m}~2.pdf")
    txt = os.path.join(R, f"factory-averages-2019-{m}.txt")
    rows, printed, cols = F.factories(pdf)
    _, _, trows = parse(open(txt, encoding="utf-8").read())
    truth = {(r["elevation"], r["code"]): r for r in trows if r["kind"] == "FACTORY"}
    mine = {(r["elev"], r["code"]): r for r in rows}
    missing = set(truth) - set(mine)
    extra = set(mine) - set(truth)
    diffs = collections.Counter()
    examples = []
    for k in set(truth) & set(mine):
        t, p = truth[k], mine[k]
        # ground-truth qty cells (cols 0..7) and avg cells (cols 0..5 -> main_m,main_c,off_m,off_c,tot_m,tot_c)
        for name, col in QMAP.items():
            tv = t["q"].get(col) if name.startswith("rank") or name.startswith(("main", "off", "tot")) else None
            pv = p["q"].get(name)
            if name.startswith("rank"):
                tv = t["q"].get(col)
                pv = p["a"].get(name) if p["a"].get(name) is not None else p["q"].get(name)
            if (tv or 0) != (pv or 0) and abs((tv or 0) - (pv or 0)) > 0.51:
                diffs[name + "(qty/rank)"] += 1
                if len(examples) < 4: examples.append((k, name, tv, pv))
        for name in ("main_m", "main_c", "off_m", "off_c", "tot_m", "tot_c"):
            tv, pv = t["a"].get(QMAP[name]), p["a"].get(name)
            if (tv or 0) != (pv or 0) and abs((tv or 0) - (pv or 0)) > 0.011:
                diffs[name + "(avg)"] += 1
                if len(examples) < 4: examples.append((k, name + " avg", tv, pv))
    print(f"2019-{m}: truth {len(truth)} factories | pdf {len(mine)} | missing from pdf {len(missing)} {sorted(missing)[:3]} | extra {len(extra)} {sorted(extra)[:3]} | cell mismatches: {dict(diffs) or 'none'}")
    for e in examples: print("     ", e)
