"""Rebuild the 2018 plantation-ranking PDFs as text reports in the standard layout (the original PDFs stay).
Usage: python pr_reconstruct.py [--apply]"""
import os, re, sys, warnings, collections, csv
warnings.filterwarnings("ignore")
import fitz

ROOT = r"C:\Projects\ASC Projects\Project ASC Master\data\msl\plantation-ranking\2018"
APPLY = "--apply" in sys.argv
MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"]
NUM = re.compile(r"^-?\d[\d,]*(?:\.\d+)?$")
ENDS = [32, 36, 43, 47, 63, 67, 75, 79]     # month qty, rank, avg, rank | todate qty, rank, avg, rank


def page_lines(page, tol=2.5):
    ws = page.get_text("words")
    ws.sort(key=lambda w: (round(w[1] / tol), w[0]))
    out, cur, last = [], [], None
    for w in ws:
        y = round(w[1] / tol)
        if last is not None and y != last:
            out.append(cur); cur = []
        cur.append(w); last = y
    if cur:
        out.append(cur)
    return [merge(ln) for ln in out]


def merge(line):
    """Join figures the PDF split into pieces: a word like ',325.00' touching the digits before it."""
    out = []
    for w in sorted(line, key=lambda w: w[0]):
        if out and re.match(r"^[,.]\d", w[4]) and re.match(r"^-?\d[\d,]*$", out[-1][4]) and w[0] - out[-1][2] <= 4:
            p = out[-1]
            out[-1] = (p[0], p[1], w[2], w[3], p[4] + w[4])
        else:
            out.append(tuple(w[:4]) + (w[4],))
    return out


def read(path):
    doc = fitz.open(path)
    text0 = " ".join(w[4] for w in page_lines(doc[0])[0])
    m = re.search(r"END OF\s+([A-Za-z]+)\s+(\d{4})", text0, re.I)
    month, year = MONTHS.index(m.group(1).upper()) + 1, int(m.group(2))
    items, elev = [], None
    edges = []
    for page in doc:
        for ln in page_lines(page):
            text = " ".join(w[4] for w in ln)
            mm = re.match(r"^ELEVATION\s*:\s*(\w+)", text, re.I)
            if mm:
                elev = mm.group(1).upper()
                continue
            if re.match(r"^(PERR?FORMANCE|COMPANY NAME|MONTH\b)", text, re.I):
                continue
            nums = [(w[2], float(w[4].replace(",", ""))) for w in ln if NUM.match(w[4]) and w[2] > 270]
            label = " ".join(w[4] for w in ln if not (NUM.match(w[4]) and w[2] > 270)).strip()
            if not nums and not label:
                continue
            if elev is None or not nums and not re.match(r"^T\s*O\s*T\s*A\s*L", label):
                continue
            if not label:
                continue   # a repeated figures line with no name
            items.append((elev, label, nums))
            if len(nums) >= 8:
                edges += [x for x, _ in nums]
    return year, month, items, edges


def cluster(xs, n, mingap=12):
    xs = sorted(xs)
    groups, cur = [], [xs[0]]
    for x in xs[1:]:
        if x - cur[-1] > mingap:
            groups.append(cur); cur = [x]
        else:
            cur.append(x)
    groups.append(cur)
    top = sorted(groups, key=len, reverse=True)[:n]
    return sorted(sum(g) / len(g) for g in top)


def build(path):
    year, month, items, edges = read(path)
    cols = cluster(edges, 8)
    if len(cols) != 8:
        raise ValueError(f"{len(cols)} columns")
    measure = [0, 2, 4, 6]

    def assign(nums, allowed, strict=True, tol=14):
        cells = {}
        for x, v in nums:
            i = min(allowed, key=lambda k: abs(cols[k] - x))
            if abs(cols[i] - x) > tol:
                if not strict:
                    continue
                raise ValueError(f"number {v} at {x:.0f} not under a column {cols}")
            cells[i] = v
        return cells

    rows = []      # (elev, kind, label, cells)
    printed = {}
    for elev, label, nums in items:
        compact = label.replace(" ", "").upper()
        if compact.startswith("TOTAL"):
            printed[elev] = assign(nums, measure, strict=False)
            continue
        # brokers are printed in mixed case, companies in capitals. A broker line can carry stray rank
        # figures in the source (they are not part of the data); only its four measures are kept.
        if any(ch.islower() for ch in label):
            cells = {}
            for x, v in nums:
                i = min(range(8), key=lambda k: abs(cols[k] - x))
                if i in (1, 3, 5, 7):
                    continue                      # a rank digit on a broker line
                if abs(cols[i] - x) > 40:
                    raise ValueError(f"broker figure {v} at {x:.0f} not under a column {cols}")
                cells[i] = v
            rows.append((elev, "broker", label, cells))
        else:
            rows.append((elev, "company", label, assign(nums, range(8))))
    return year, month, rows, printed


def put(line, end, text):
    text = str(text)
    line = line.ljust(end)
    return line[:end - len(text)] + text + line[end:]


def fmt_qty(v):
    return f"{v:,.1f}" if v < 1e7 else f"{v:,.2f}"


def line(label, cells, indent=0):
    s = (" " * indent + label)[:22].ljust(22)
    for i, end in enumerate(ENDS):
        if i in cells and cells[i] is not None:
            v = cells[i]
            s = put(s, end, int(v) if i in (1, 3, 5, 7) else (f"{v:,.2f}" if i in (2, 6) else f"{v:,.1f}"))
    return s.rstrip()


def render(year, month, rows, printed, note):
    out = []
    order = []
    for e, *_ in rows:
        if e not in order:
            order.append(e)
    for page, e in enumerate(order, 1):
        out += [f"PERFORMANCE OF COMPANIES AS AT END OF {MONTHS[month - 1]}  {year}   [{note}]",
                f"ELEVATION : {e}", f"PAGE: {page:8d}", "-" * 79,
                "                               M O N T H                   T O    D A T E",
                "COMPANY NAME           TOTAL QTY RNK AVG.PR RNK       TOTAL QTY RNK  AVG.PR RNK", "-" * 79]
        comp = [r for r in rows if r[0] == e and r[1] == "company"]
        for r in rows:
            if r[0] != e:
                continue
            out.append(line(r[2], r[3], 0 if r[1] == "company" else 3))
        # computed total = sum of companies (avg weighted by quantity)
        mq = sum(c[3].get(0, 0) for c in comp); tq = sum(c[3].get(4, 0) for c in comp)
        ma = sum(c[3].get(0, 0) * c[3].get(2, 0) for c in comp) / mq if mq else None
        ta = sum(c[3].get(4, 0) * c[3].get(6, 0) for c in comp) / tq if tq else None
        out.append(line("T O T A L", {0: mq, 2: ma, 4: tq, 6: ta}))
    out.append("                                     *  *  *    E N D   O F   R E P O R T   *  *  *")
    return "\n".join(out) + "\n"


def main():
    for m in range(1, 12):
        p = os.path.join(ROOT, f"plantation-ranking-2018-{m:02d}.pdf")
        try:
            year, month, rows, printed = build(p)
        except Exception as e:
            print(f"2018-{m:02d}: FAILED {e}")
            continue
        text = render(year, month, rows, printed, "RECONSTRUCTED FROM ORIGINAL PDF; TOTALS COMPUTED")
        comp = collections.Counter(r[0] for r in rows if r[1] == "company")
        # compare computed vs printed elevation totals (month qty)
        mism = []
        for e, pr in printed.items():
            c = sum(r[3].get(0, 0) for r in rows if r[0] == e and r[1] == "company")
            if pr.get(0) is not None and abs(pr[0] - c) > 1:
                mism.append((e, pr[0], round(c, 1)))
        print(f"2018-{m:02d}: {year}-{month:02d} companies {dict(comp)} brokers {sum(1 for r in rows if r[1] == 'broker')} | printed-vs-computed total mismatches {mism}")
        if month != m:
            print(f"   !! content month {month} != file month {m}")
        if APPLY:
            with open(os.path.join(ROOT, f"plantation-ranking-{year}-{month:02d}.txt"), "w", encoding="utf-8", newline="\n") as f:
                f.write(text)


if __name__ == "__main__":
    main()
