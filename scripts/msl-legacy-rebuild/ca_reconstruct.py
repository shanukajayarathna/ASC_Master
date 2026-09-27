"""Rebuild the 2018 combined-averages (gross averages) PDFs as standard text reports; the PDFs stay.
Usage: python ca_reconstruct.py [--apply]"""
import os, re, sys, warnings
warnings.filterwarnings("ignore")
import fitz
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pr_reconstruct as P

ROOT = r"C:\Projects\ASC Projects\Project ASC Master\data\msl\combined-averages\2018"
APPLY = "--apply" in sys.argv
MON = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"]
NUM = re.compile(r"^-?\d[\d,]*(?:\.\d+)?$")
TOTAL_LABEL = re.compile(r"^(TOTAL|LOW|(?:HIGH|MEDIUM)\s*-\s*(?:UVA|WESTERN|OTHERS)|GRAND\s+TO[A-Z]+\s*-?)$", re.I)


BROKERS = [("LANKA COMMODIT", "LANKA COMMODITY BROKERS LTD"), ("JOHN KEEL", "JOHN KEELLS PLC"), ("FORBES", "FORBES & WALKERS TEA BROKERS (PVT) LTD"),
           ("CEYLON TEA", "CEYLON TEA BROKERS  PLC"), ("ASIA SIYAKA", "ASIA SIYAKA COMMODITIES PLC"), ("MERCANTILE", "MERCANTILE PRODUCE BROKERS LTD"),
           ("BARTLEET", "BARTLEET PRODUCE MARKETING (PVT) LTD"), ("EASTERN", "EASTERN BROKERS LTD")]


def canonical_broker(name):
    flat = re.sub(r"[^A-Z]", "", name.upper())
    for key, canon in BROKERS:
        if re.sub(r"[^A-Z]", "", key) in flat:
            return canon
    return re.sub(r"\s+", " ", name).strip().upper()


def total_nums(ws):
    """The three figures of a total line (quantity, proceeds, average). The PDF sometimes prints a wide number's
    leading digit as a separate fragment ("1" + "9596166433" = 19,596,166,433), sometimes with a digit lost; the
    merged figure is accepted only if it agrees (within 2%) with quantity x average, otherwise proceeds = qty x avg."""
    toks = [w[4] for w in sorted(ws, key=lambda w: w[0]) if NUM.match(w[4]) and w[0] > 200]
    if len(toks) == 4 and re.fullmatch(r"\d{1,2}", toks[1]):
        q, a = float(toks[0].replace(",", "")), float(toks[3].replace(",", ""))
        merged = float((toks[1] + toks[2]).replace(",", ""))
        expected = q * a
        proceeds = merged if expected and abs(merged - expected) / expected < 0.02 else round(expected, 1)
        return [(0, q), (0, proceeds), (0, a)]
    return [(0, float(t.replace(",", ""))) for t in toks] if len(toks) == 3 else []


def read(path):
    doc = fitz.open(path)
    first = " ".join(w[4] for w in P.page_lines(doc[0])[0])
    m = re.search(r"MONTH\s*OF\s+([A-Za-z]+)\s+(\d{4})", first, re.I)
    if not m:
        m = re.search(r"MONTH\s*OF\s+([A-Za-z]+)[\s\-]*(\d{2})", first, re.I)
    month = [x[:3] for x in MON].index(m.group(1).upper()[:3]) + 1
    year = int(m.group(2)) if len(m.group(2)) == 4 else 2000 + int(m.group(2))
    out = []      # ("factory", broker, rec) / ("total", broker, label, nums) / ("grandmark",)
    pending = None
    grand = False
    hdr = re.compile(r"^(?:BROKER-?\s*)?(.+?)\s+(?:GROSS\s+)?PAGE\s*-+\s*\d+", re.I)

    # The listing is continuous: after a broker's totals the NEXT broker's factories follow on the same page,
    # and that broker's header only appears at the top of the next page. So the brokers are taken in the
    # order their headers first appear, and the current broker advances when a total block (ending in LOW) closes.
    order = []
    for page in doc:
        for ln in P.page_lines(page):
            text = " ".join(w[4] for w in ln)
            m = hdr.match(text)
            if m and "GROSS AVERAGES" not in text.upper():
                b = canonical_broker(m.group(1))
                if b not in order:
                    order.append(b)
    k = 0
    in_total_block = False
    for page in doc:
        for ln in P.page_lines(page):
            ws = [w for w in ln]
            text = " ".join(w[4] for w in ws)
            if re.match(r"^\*|^F\s*A\s*C\s*T|^M\s*F\s*C\s*O\s*D|PROCEEDS", text):
                continue
            if hdr.match(text) and "GROSS AVERAGES" not in text.upper():
                continue          # a page header — a record can straddle the page break, so keep any pending name
            broker = order[min(k, len(order) - 1)]
            nums = [(w[2], float(w[4].replace(",", ""))) for w in ws if NUM.match(w[4]) and w[0] > 285]
            label = " ".join(w[4] for w in ws if not (NUM.match(w[4]) and w[0] > 285)).strip()
            if label.upper().startswith("SELLING MARK"):
                mark = re.sub(r"^SELLING\s+MARK:?\s*", "", label, flags=re.I).strip()
                if pending and pending.get("code"):
                    pending["mark"] = mark
                    out.append(("factory", broker, pending))
                    pending = None
                continue
            cm = re.match(r"^([A-Z]{1,3}\d{3,5})\s+UNIT\s+RATE", label)
            if cm and pending:
                pending["code"] = cm.group(1)
                pending["unit"] = nums[-1][1] if nums else 15.0
                continue
            words_only = " ".join(w[4] for w in ws if not NUM.match(w[4])).strip()
            if TOTAL_LABEL.match(words_only):      # a total line, whatever x its (possibly shifted) figures sit at
                lab = re.sub(r"\s+", " ", words_only.upper())
                tnums = total_nums(ws)
                if lab.startswith("GRAND"):
                    grand = True
                    pending = None
                    out.append(("grandmark",))
                    if tnums:
                        out.append(("total", broker, "TOTAL", tnums))
                    continue
                out.append(("total", broker, lab, tnums))
                if lab == "TOTAL":
                    in_total_block = True
                elif lab == "LOW" and in_total_block and not grand:
                    in_total_block = False
                    k += 1                     # this broker's block is complete
                continue
            if label and len(nums) == 3:
                pending = dict(name=label, qty=nums[0][1], proceeds=nums[1][1], avg=nums[2][1])
    return year, month, out


def norm_total_label(lab):
    lab = re.sub(r"\s*-\s*", " - ", lab)
    return lab


def fill_missing_totals(out):
    """A total line the PDF doesn't print legibly is computed: a broker's from its factories, the grand total from the brokers'."""
    sums = {}
    for o in out:
        if o[0] == "factory":
            q, p = sums.get(o[1], (0.0, 0.0))
            sums[o[1]] = (q + o[2]["qty"], p + o[2]["proceeds"])
    res, grand, broker_tot = [], False, {}
    for o in out:
        if o[0] == "grandmark":
            grand = True
        if o[0] == "total" and o[2] == "TOTAL":
            if not grand and not o[3] and o[1] in sums:
                q, p = sums[o[1]]
                o = ("total", o[1], o[2], [(0, q), (0, p), (0, p / q if q else 0.0)])
            if not grand and o[3]:
                broker_tot[o[1]] = (o[3][0][1], o[3][1][1])
            if grand and not o[3] and broker_tot:
                q = sum(v[0] for v in broker_tot.values()); p = sum(v[1] for v in broker_tot.values())
                o = ("total", o[1], o[2], [(0, q), (0, p), (0, p / q if q else 0.0)])
        res.append(o)
    # a grand block whose TOTAL line was not recognised at all: add it after the grand marker
    if any(o[0] == "grandmark" for o in res) and not any(o[0] == "total" and o[2] == "TOTAL" and i > next(j for j, x in enumerate(res) if x[0] == "grandmark") for i, o in enumerate(res)) and broker_tot:
        k = next(j for j, x in enumerate(res) if x[0] == "grandmark")
        q = sum(v[0] for v in broker_tot.values()); p = sum(v[1] for v in broker_tot.values())
        res.insert(k + 1, ("total", None, "TOTAL", [(0, q), (0, p), (0, p / q if q else 0.0)]))
    return res


def render(year, month, out):
    out = fill_missing_totals(out)
    lines = []
    header_done = set()
    cur = None

    def head(broker, page):
        return [f"* COLOMBO BROKERS ASSO. *     GROSS AVERAGES FOR THE MONTH OF {MON[month - 1][:3]},{year}",
                "                              **********************************************",
                f"{broker}".ljust(70) + f"PAGE--{page:4d}",
                "F A C T O R Y  M A R K   Q U A N T I T Y        G R O S S        C O M B I N E D",
                "M F C O D E                  S O L D            P R O C E E D S  A V E R A G E",
                "**********************   ***************        ***************  ***************"]
    page = 0
    grand = False
    for item in out:
        if item[0] == "factory":
            _, broker, f = item
            if broker != cur:
                page += 1
                cur = broker
                lines += head(broker, page)
            lines.append(f"{f['name'][:28]:<28}{f['qty']:>12.2f}{f['proceeds']:>23,.2f}{f['avg']:>16,.2f}")
            lines.append(f"{f['code']:<52}UNIT RATE{f['unit']:>15.3f}")
            lines.append(f"         SELLING MARK:       {f['mark']}")
            lines.append("*" * 80)
        elif item[0] == "grandmark":
            grand = True
            page += 1
            lines += head("ASIA SIYAKA COMMODITIES PLC", page)
        else:
            _, broker, lab, nums = item
            if grand and lab == "TOTAL":
                lab = "GRAND TOTALS"
            q, p, a = (nums[0][1], nums[1][1], nums[2][1]) if len(nums) == 3 else (0.0, 0.0, 0.0)
            lines.append(f"         {norm_total_label(lab):<20}{q:>14.2f}{p:>23,.2f}{a:>16,.2f}")
    return "\n".join(lines) + "\n"


def main():
    for m in [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12]:
        p = os.path.join(ROOT, f"combined-averages-2018-{m:02d}.pdf")
        try:
            year, month, out = read(p)
        except Exception as e:
            print(f"2018-{m:02d}: FAILED {e}")
            continue
        n = sum(1 for o in out if o[0] == "factory")
        brokers = len({o[1] for o in out if o[0] == "factory"})
        print(f"2018-{m:02d}: {year}-{month:02d} factories {n} brokers {brokers}" + ("" if month == m else f"   !! content month {month}"))
        if APPLY:
            with open(os.path.join(ROOT, f"combined-averages-{year}-{month:02d}.txt"), "w", encoding="utf-8", newline="\n") as f:
                f.write(render(year, month, out))


if __name__ == "__main__":
    main()
