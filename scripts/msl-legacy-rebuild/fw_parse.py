import os, re, collections

MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"]
NUM = re.compile(r"-?\d[\d,]*(?:\.\d+)?")
CODE = re.compile(r"^[A-Z]{2,3}\d{3,5}$")
# right edge of each numeric column: qty line = 8 cols (with ranks), avg line = 6 cols
QTY_ENDS = [46, 60, 74, 89, 105, 110, 125, 130]   # mainM, mainC, offM, offC, totM, rankM, totC, rankC
FIELD = ["main_m", "main_c", "off_m", "off_c", "tot_m", "rank_m", "tot_c", "rank_c"]


def decode(raw: bytes) -> str:
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return raw.decode("utf-16")
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("latin1")


def spaced(s: str) -> str:
    """'E L E V A T I O N   T O T A L' -> 'ELEVATION TOTAL'"""
    return re.sub(r"\s+", " ", re.sub(r"(?<=\S) (?=\S)", "", s)).strip() if re.search(r"\w \w \w", s) else s.strip()


def cells(line, ends=QTY_ENDS, start=30):
    out = {}
    for m in NUM.finditer(line):
        if m.start() < start:
            continue
        col = min(range(len(ends)), key=lambda i: abs(ends[i] - m.end()))
        if abs(ends[col] - m.end()) > 4:
            raise ValueError(f"number {m.group()!r} ends at {m.end()}, not near a column: {line!r}")
        out[col] = float(m.group().replace(",", ""))
    return out


def parse(text: str):
    lines = text.splitlines()
    title = next((l for l in lines[:6] if "FACTORY WISE AVERAGES FOR" in l), None)
    if not title:
        raise ValueError("no FACTORY WISE AVERAGES title")
    m = re.search(r"FOR\s+([A-Z]+)\s+(\d{4})", title)
    month, year = MONTHS.index(m.group(1)) + 1, int(m.group(2))
    rows, elevation, pending = [], None, None
    for raw in lines:
        l = raw.rstrip()
        if not l.strip():
            continue
        if l.startswith("Elevation :"):
            elevation = re.sub(r"\s+PAGE:.*$", "", l.split(":", 1)[1]).strip()
            pending = None
            continue
        if re.match(r"^\w?ASIA SIYAKA", l) or l.startswith(("FACTORY WISE", "NAME OF ESTATE", "---")) or l.lstrip().startswith(("MONTHLY", "* * *", "*  *  *")):
            continue
        sp = spaced(l[:38])
        if sp.startswith(("ELEVATION TOTAL", "GRAND TOTAL")):
            pending = ("ELEVATION_TOTAL" if sp.startswith("ELEVATION") else "GRAND_TOTAL", None, None, cells(l))
            continue
        left = l[:38].strip()
        if not left and pending and pending[0] in ("ELEVATION_TOTAL", "GRAND_TOTAL"):
            kind, _, _, q = pending
            a = cells(l)
            rows.append(dict(kind=kind, elevation=elevation if kind == "ELEVATION_TOTAL" else None, name=None, code=None, q=q, a=a))
            pending = None
            continue
        if CODE.match(left.replace(" ", "")) and pending and pending[0] == "FACTORY":
            a = cells(l)
            rows.append(dict(kind="FACTORY", elevation=elevation, name=pending[1], code=left.replace(" ", ""), q=pending[3], a=a))
            pending = None
            continue
        if left and elevation:
            pending = ("FACTORY", left, None, cells(l))
            continue
        raise ValueError(f"unparsed line: {l!r}")
    return year, month, rows


def check(year, month, rows):
    """Return list of problems."""
    problems = []
    fac = [r for r in rows if r["kind"] == "FACTORY"]
    et = {r["elevation"]: r for r in rows if r["kind"] == "ELEVATION_TOTAL"}
    gt = next((r for r in rows if r["kind"] == "GRAND_TOTAL"), None)
    if len(et) != 5:
        problems.append(f"{len(et)} elevation totals")
    if gt is None:
        problems.append("no grand total")
    for el, tot in et.items():
        for col, f in ((0, "main_m"), (1, "main_c"), (2, "off_m"), (3, "off_c"), (4, "tot_m"), (6, "tot_c")):
            s = sum(r["q"].get(col, 0) for r in fac if r["elevation"] == el)
            t = tot["q"].get(col, 0)
            if abs(s - t) > max(1, t * 1e-6):
                problems.append(f"{el} {f}: sum {s:,.2f} != total {t:,.2f}")
    if gt:
        for col, f in ((0, "main_m"), (2, "off_m"), (4, "tot_m")):
            s = sum(r["q"].get(col, 0) for r in rows if r["kind"] == "ELEVATION_TOTAL")
            t = gt["q"].get(col, 0)
            if abs(s - t) > max(1, t * 1e-6):
                problems.append(f"grand {f}: elevations {s:,.2f} != grand {t:,.2f}")
    bad = 0
    for r in fac:
        q, a = r["q"], r["a"]
        tq = q.get(4)
        if tq:
            val = q.get(0, 0) * a.get(0, 0) + q.get(2, 0) * a.get(2, 0)
            if abs(val / tq - a.get(4, 0)) > 0.05 * 1 + 0.001 * a.get(4, 0):
                bad += 1
    if bad:
        problems.append(f"{bad} factories whose weighted avg != total avg")
    return problems
