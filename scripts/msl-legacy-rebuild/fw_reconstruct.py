"""Rebuild the legacy Factory Wise Averages months (PDFs + the Dec 2018 text layout) as standard
layout-A reports, so the existing parser/importer handle them. Totals are COMPUTED from the factory
rows and checked against the printed totals. Usage: python fw_reconstruct.py [--apply]"""
import os, re, sys, collections, statistics
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fw_pdf as F
from fw_parse import parse as parse_a

ROOT = r"C:\Projects\ASC Projects\Project ASC Master\data\msl\factory-averages"
STAGE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "recon")
APPLY = "--apply" in sys.argv
MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"]
ELEV_ORDER = ["UVA HIGH", "WESTERN HIGH", "UVA MEDIUM", "WESTERN MEDIUM", "LOW"]
QTY_ENDS = [46, 60, 74, 89, 105, 110, 125, 130]
AVG_ENDS = [46, 60, 74, 89, 105, None, 125, None]
COLS = F.COLS  # main_m main_c off_m off_c tot_m rank_m tot_c rank_c


# ------------------------------------------------------------------ layout B (Dec 2018 text)
def read_layout_b(text):
    L = text.replace("\x1a", "").split("\n")
    elev, pending, raw = None, None, []   # raw: (elev, kind, label, [(end, value, has_dot)])
    NUMT = re.compile(r"-?\d+(?:\.\d+)?")
    for line in L:
        m = re.match(r"^(UVA\s*-\s*HIGH|WESTERN\s*-\s*HIGH|UVA\s*-\s*MEDIUM|WESTERN\s*-\s*MEDIUM|LOW)\b", line)
        if m and "PAGE" in line:
            elev = F.ELEV[re.sub(r"[^A-Z]", "", m.group(1))]
            continue
        if not line.strip() or re.search(r"REF:FAC03|MONTHLY|^NAME OF|^\s+NK|^¬|DEC 2018", line):
            continue
        toks = [(t.end(), float(t.group()), "." in t.group()) for t in NUMT.finditer(line) if t.start() >= 20]
        label = line[:20].strip() if not line.startswith(" ") else ""
        is_total = bool(re.match(r"^(T O T A L|GRAND\s+TOTAL)", line))
        raw.append((elev, "total" if is_total else "line", label, toks, line))
    return raw


def rows_from_b(text):
    raw = read_layout_b(text)
    # the six number columns come from the quantity lines only (avg lines align with them; ranks don't)
    qty_edges = [e for elev, kind, label, toks, _ in raw
                 if kind == "line" and label and not F.CODE.match(label.replace(" ", "")) for e, _, _ in toks]
    cols = F.cluster_columns(qty_edges, n=6, mingap=8)
    if len(cols) != 6:
        raise ValueError(f"{len(cols)} number columns in layout B: {cols}")
    names = ["main_m", "main_c", "off_m", "off_c", "tot_m", "tot_c"]

    def col_of(e):
        i = min(range(6), key=lambda k: abs(cols[k] - e))
        if abs(cols[i] - e) > 9:
            raise ValueError(f"layout B number ends at {e}, columns {cols}")
        return names[i]

    rows, pending, printed = [], None, {}
    for elev, kind, label, toks, line in raw:
        if kind == "total":
            if not line.startswith("GRAND") and elev:
                printed[elev] = {col_of(e): v for e, v, _ in toks}
            pending = None
            continue
        compact = label.replace(" ", "")
        if F.CODE.match(compact) and pending:
            a = {}
            ranks = []
            for e, v, dotted in toks:
                if dotted:
                    a[col_of(e)] = v
                else:
                    ranks.append((e, v))
            ranks.sort()
            tot_c_end = max([e for e, v, d in toks if d and col_of(e) == "tot_c"] or [999])
            for e, v in ranks:
                a["rank_c" if e > tot_c_end else "rank_m"] = v
            rows.append(dict(elev=pending[0], name=pending[1], code=F.norm_code(compact), q=pending[2], a=a))
            pending = None
        elif label and toks and elev:
            pending = (elev, label, {col_of(e): v for e, v, _ in toks})
    return rows, printed


# ------------------------------------------------------------------ writer (layout A)
def fmt(v, w=None):
    return f"{v:.2f}"


def put(line, end, text):
    text = str(text)
    start = end - len(text)
    line = line.ljust(end)
    return line[:start] + text + line[end:]


def q_line(label, q, rank_m=None, rank_c=None):
    s = label[:38].ljust(38)
    for c, end in zip(COLS, QTY_ENDS):
        if c in q and q[c] is not None and not c.startswith("rank"):
            s = put(s, end, fmt(q[c]))
    if rank_m is not None:
        s = put(s, 110, int(rank_m))
    if rank_c is not None:
        s = put(s, 130, int(rank_c))
    return s.rstrip()


def a_line(label, a):
    s = label[:38].ljust(38)
    for c, end in zip(COLS, AVG_ENDS):
        if end and c in a and a[c] is not None:
            s = put(s, end, fmt(a[c]))
    return s.rstrip()


def weighted(rows, qcol, acol):
    q = sum(r["q"].get(qcol, 0) for r in rows)
    if q <= 0:
        return None
    return sum(r["q"].get(qcol, 0) * r["a"].get(acol, 0) for r in rows) / q


def totals_of(rows):
    q = {c: sum(r["q"].get(c, 0) for r in rows) for c in ("main_m", "main_c", "off_m", "off_c", "tot_m", "tot_c")}
    a = {c: weighted(rows, c, c) for c in q}
    return q, a


def write_report(year, month, rows, source_note):
    out = [f"ASIA SIYAKA COMMODITIES PLC   [{source_note}]".ljust(115) + "DATE: (n/a)",
           f"FACTORY WISE AVERAGES FOR {MONTHS[month - 1]:9s} {year}".ljust(115) + "TIME: (n/a)"]
    page = 0
    all_rows = []
    for e in ELEV_ORDER:
        er = [r for r in rows if r["elev"] == e]
        if not er:
            continue
        page += 1
        out += [f"Elevation : {e}".ljust(115) + f"PAGE: {page:8d}", "-" * 132,
                "NAME OF ESTATE/MFCODE                   M A I N   G R A D E           O F F  G R A D E                        T O T A L",
                "                                       MONTHLY    CUMULATIVE       MONTHLY     CUMULATIVE         MONTHLY  RANK   CUMULATIVE  RANK",
                "-" * 132]
        for r in er:
            out.append(q_line(r["name"], r["q"], r["a"].get("rank_m", r["q"].get("rank_m")), r["a"].get("rank_c", r["q"].get("rank_c"))))
            out.append(a_line(r["code"], r["a"]))
        tq, ta = totals_of(er)
        out.append(q_line("E L E V A T I O N   T O T A L", tq))
        out.append(a_line("", ta))
        all_rows += er
    tq, ta = totals_of(all_rows)
    out.append(q_line("G R A N D   T O T A L", tq))
    out.append(a_line("", ta))
    out.append("                                             *  *  *    E N D   O F   R E P O R T   *  *  *")
    return "\n".join(out) + "\n"


# ------------------------------------------------------------------ run
def load_legacy():
    jobs = []
    for m in range(1, 12):
        jobs.append((2018, m, os.path.join(ROOT, "2018", f"factory-averages-2018-{m:02d}.pdf"), "pdf"))
    for m in (3, 6, 7):
        jobs.append((2019, m, os.path.join(ROOT, "2019", f"factory-averages-2019-{m:02d}.pdf"), "pdf"))
    jobs.append((2018, 12, os.path.join(ROOT, "2018", "factory-averages-2018-12.txt"), "b"))
    return jobs


def main():
    os.makedirs(STAGE, exist_ok=True)
    results = {}
    for year, month, path, kind in load_legacy():
        try:
            if kind == "pdf":
                rows, printed, _ = F.factories(path)
            else:
                rows, printed = rows_from_b(open(path, encoding="utf-8").read())
        except Exception as e:
            print(f"{year}-{month:02d}: READ FAILED: {e}")
            continue
        bad = F.check_rows(rows)
        tq = collections.defaultdict(lambda: collections.Counter())
        for r in rows:
            for k, v in r["q"].items():
                tq[r["elev"]][k] += v
        mism = []
        for e, pr in printed.items():
            for k in ("tot_m", "tot_c"):
                if k in pr and abs(pr[k] - tq[e][k]) > 1:
                    mism.append((e, k, pr[k], round(tq[e][k], 1)))
        note = "RECONSTRUCTED FROM " + ("ORIGINAL PDF" if kind == "pdf" else "LEGACY-LAYOUT TEXT") + "; TOTALS COMPUTED"
        text = write_report(year, month, rows, note)
        results[(year, month)] = (rows, text)
        codes = collections.Counter((r["elev"], r["code"]) for r in rows)
        dup = [k for k, v in codes.items() if v > 1]
        print(f"{year}-{month:02d} [{kind}] {len(rows)} factories, {sum(r['q'].get('tot_m', 0) for r in rows):>13,.0f} kg | weighted-avg anomalies {len(bad)} | printed-vs-computed elevation mismatches {len(mism)} {mism[:2]} | dup keys {len(dup)}")
        with open(os.path.join(STAGE, f"factory-averages-{year}-{month:02d}.txt"), "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
    return results


if __name__ == "__main__":
    main()
