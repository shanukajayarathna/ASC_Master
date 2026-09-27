import re, collections, warnings
warnings.filterwarnings("ignore")
import fitz

NUM = re.compile(r"^-?\d+(?:\.\d+)?$")
CODE = re.compile(r"^[A-Z]{2,3}\d{4,5}$")
ELEV = {"UVAHIGH": "UVA HIGH", "WESTERNHIGH": "WESTERN HIGH", "UVAMEDIUM": "UVA MEDIUM", "WESTERNMEDIUM": "WESTERN MEDIUM", "LOW": "LOW"}
HEADER_WORDS = {"NAME", "ESTATE/MFCODE", "MAIN", "OFF", "GRADE", "TOTAL", "MONTHLY", "CUMULATIVE", "RANK", "REF:FAC03", "ASIA", "SIYAKA",
                "COMMODITIES", "PLC", "FACTORY", "WISE", "AVERAGES", "AVERAGE", "DATE", "PAGE:", "FOR"}
# column order on a quantity line / average line
COLS = ["main_m", "main_c", "off_m", "off_c", "tot_m", "rank_m", "tot_c", "rank_c"]


def norm_code(c):
    m = re.match(r"^([A-Z]{2,3})(\d+)$", c)
    pre, dig = m.groups()
    if len(dig) == 5 and dig.startswith("0"):
        dig = dig[1:]
    return pre + dig


def page_lines(page, tol=2.5):
    ws = page.get_text("words")
    ws.sort(key=lambda w: (round(w[1] / tol), w[0]))
    out, cur, last = [], [], None
    for w in ws:
        y = round(w[1] / tol)
        if last is not None and y != last:
            out.append(cur)
            cur = []
        cur.append(w)
        last = y
    if cur:
        out.append(cur)
    return out


def merge_fragments(words, gap=3.0):
    """join numeric fragments that touch (a figure split by the PDF writer)"""
    out = []
    for w in sorted(words, key=lambda w: w[0]):
        if out and NUM.match(w[4]) and NUM.match(out[-1][4]) and w[0] - out[-1][2] <= gap:
            p = out[-1]
            out[-1] = (p[0], p[1], w[2], w[3], p[4] + w[4])
        else:
            out.append((w[0], w[1], w[2], w[3], w[4]))
    return out


def read_pdf(path):
    """-> (title_year_month or None, list of dict(elev, name, code, q{col:val}, a{col:val}))"""
    doc = fitz.open(path)
    entries = []      # raw: (elev, kind, label, numbers[(x2, val)])
    elev = None
    right_edges = []
    for page in doc:
        L = page_lines(page)
        for ln in L:
            text = " ".join(w[4] for w in ln)
            # elevation banner
            m = re.match(r"^(?:Elevation\s*:\s*)?((?:UVA|WESTERN)\s*-?\s*(?:HIGH|MEDIUM)|LOW)\b", text, re.I)
            if m and not any(w[4].upper() in HEADER_WORDS for w in ln[:1]) and len(ln) <= 45 and not re.search(r"\d", re.sub(r"PAGE\s*:?\s*\d+|DATE\s*[\d/\-]+|[\d/]+20\d\d|\d+/\d+/\d+", "", text)):
                key = re.sub(r"[^A-Z]", "", m.group(1).upper())
                if key in ELEV:
                    elev = ELEV[key]
                    continue
            ws = merge_fragments(ln)
            nums = [(w[2], (w[0] + w[2]) / 2, float(w[4])) for w in ws if NUM.match(w[4]) and w[0] > 200]
            label = " ".join(w[4] for w in ws if not (NUM.match(w[4]) and w[0] > 200) and w[2] < 240).strip()
            entries.append((elev, label, nums, text))
            # an elevation's printed total closes it: what follows (even mid-page, before the next
            # page banner) belongs to the next elevation in the fixed order
            if TOTAL_RE.match(text) and not text.upper().startswith("GRAND") and elev:
                order = ["UVA HIGH", "WESTERN HIGH", "UVA MEDIUM", "WESTERN MEDIUM", "LOW"]
                i = order.index(elev)
                elev = order[i + 1] if i < 4 else elev
            right_edges += [(x, c) for x, c, _ in nums]
    return entries, right_edges


def cluster_columns(edges, n=8, mingap=18):
    xs = sorted(round(e) for e in edges)
    groups, cur = [], [xs[0]]
    for x in xs[1:]:
        if x - cur[-1] > mingap:
            groups.append(cur)
            cur = [x]
        else:
            cur.append(x)
    groups.append(cur)
    groups = sorted(groups, key=len, reverse=True)[:n]
    return sorted(sum(g) / len(g) for g in groups)


DEBUG = []
HEADER_RE = re.compile(r"MONTHLY|CUMULATIVE|MAIN\s+GRADE|OFF\s+GRADE|ESTATE/MFCODE|REF:FAC03|ASIA\s+SIYAKA|FACTORY\s+WISE|"
                       r"^NAME\s+OF|^\s*(?:[A-Z][a-z]{2}-\d\d|[A-Z]{3,9}\s+\d{4})\s*$|^DATE\b|PAGE\s*:", re.I)
TOTAL_RE = re.compile(r"^(?:T\s*O\s*T\s*A\s*L|TOTAL|GRAND\s+TOTAL)\s*->", re.I)


def cluster_auto(vals, mingap=9, min_share=0.02):
    xs = sorted(vals)
    groups, cur = [], [xs[0]]
    for x in xs[1:]:
        if x - cur[-1] > mingap:
            groups.append(cur)
            cur = [x]
        else:
            cur.append(x)
    groups.append(cur)
    keep = [g for g in groups if len(g) >= max(3, min_share * len(xs))]
    return sorted(sum(g) / len(g) for g in keep)


NAMES6 = ["main_m", "main_c", "off_m", "off_c", "tot_m", "tot_c"]


def factories(path):
    """-> rows, printed elevation totals, description of the column sets.
    Column positions are learnt separately for quantity (name) lines and price (MF-code) lines,
    because some issues print the two out of line; ranks are whichever extra columns a line type has."""
    entries, _ = read_pdf(path)

    def classify(label, text, nums):
        compact = label.replace(" ", "")
        if TOTAL_RE.match(text):
            return "total"
        if CODE.match(compact):
            return "code"
        if HEADER_RE.search(text) or not (label and nums):
            return None
        return "name"

    kinds = [classify(l, t, n) for _, l, n, t in entries]
    q_tokens = [(x, c) for k, (_, _, n, _) in zip(kinds, entries) if k == "name" for x, c, _ in n]
    a_tokens = [(x, c) for k, (_, _, n, _) in zip(kinds, entries) if k == "code" for x, c, _ in n]

    def spread(pairs, i):
        import statistics
        cl = cluster_auto([p[i] for p in pairs])
        if not cl:
            return 1e9
        err = [min(abs(p[i] - c) for c in cl) for p in pairs]
        return statistics.mean(err)

    use_centre = spread(q_tokens + a_tokens, 1) < spread(q_tokens + a_tokens, 0)
    ci = 1 if use_centre else 0
    q_cols = cluster_auto([p[ci] for p in q_tokens])
    a_cols = cluster_auto([p[ci] for p in a_tokens])

    def names_for(cols):
        if len(cols) == 6:
            return NAMES6
        if len(cols) == 8:
            return COLS
        raise ValueError(f"{len(cols)} number columns: {cols}")
    q_names, a_names = names_for(q_cols), names_for(a_cols)

    def assign(nums, cols, names, strict=True):
        cells = {}
        for x, c, v in nums:
            pos = c if use_centre else x
            i = min(range(len(cols)), key=lambda k: abs(cols[k] - pos))
            if abs(cols[i] - pos) > 14:
                if strict:
                    raise ValueError(f"number {v} at {pos:.0f} not under a column {cols}")
                continue
            cells[names[i]] = v
        return cells

    rows, printed_totals, pending = [], {}, None
    for (elev, label, nums, text), kind in zip(entries, kinds):
        if kind == "total":
            if not text.upper().startswith("GRAND") and elev:
                printed_totals[elev] = assign(nums, q_cols, q_names, strict=False)
            pending = None
        elif kind == "code":
            if pending is None:
                DEBUG.append(("orphan-code", elev, text[:100]))
                continue
            rows.append(dict(elev=pending[0], name=pending[1], code=norm_code(label.replace(" ", "")),
                             q=pending[2], a=assign(nums, a_cols, a_names)))
            pending = None
        elif kind == "name" and elev is not None:
            pending = (elev, label, assign(nums, q_cols, q_names))
    return rows, printed_totals, (q_cols, a_cols)


def check_rows(rows):
    """weighted-average consistency per factory; returns list of anomalies"""
    bad = []
    for r in rows:
        q, a = r["q"], r["a"]
        for m, c, t in (("main_m", "off_m", "tot_m"), ("main_c", "off_c", "tot_c")):
            tq = q.get(t)
            if tq:
                calc = (q.get(m, 0) * a.get(m, 0) + q.get(c, 0) * a.get(c, 0)) / tq
                if abs(calc - a.get(t, 0)) > 0.06 + 0.002 * a.get(t, 0):
                    bad.append((r["elev"], r["name"], r["code"], t, round(calc, 2), a.get(t)))
            if abs(q.get(m, 0) + q.get(c, 0) - (q.get(t) or 0)) > 1:
                bad.append((r["elev"], r["name"], r["code"], t + "-qty", q.get(m, 0) + q.get(c, 0), q.get(t)))
    return bad


if __name__ == "__main__":
    import sys
    p = sys.argv[1]
    rows, printed, cols = factories(p)
    print("columns (x right edge):", [round(c) for c in cols])
    print("factories:", len(rows), "| by elevation:", dict(collections.Counter(r["elev"] for r in rows)))
    tm = sum(r["q"].get("tot_m", 0) for r in rows)
    print(f"sum total monthly kg: {tm:,.1f}")
    bad = check_rows(rows)
    print("anomalies:", len(bad))
    for b in bad[:12]:
        print("   ", b)
    for r in rows[:3]:
        print(r)
    tot = collections.defaultdict(lambda: collections.Counter())
    for r in rows:
        for k, v in r["q"].items():
            tot[r["elev"]][k] += v
    print("elevation totals: computed vs printed (total monthly kg)")
    for e, c in tot.items():
        pr = printed.get(e, {})
        print(f"  {e:15} computed {c['tot_m']:>14,.1f}  printed {pr.get('tot_m', float('nan')):>14,.1f}   main_m {c['main_m']:,.1f} vs {pr.get('main_m', float('nan')):,.1f}   tot_c {c['tot_c']:,.1f} vs {pr.get('tot_c', float('nan')):,.1f}")
