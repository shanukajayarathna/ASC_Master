# MSL legacy report rebuild (one-off)

Scripts used on 2026-09-27 to turn the legacy PDF / old-layout reports in `data/msl` into the standard text
layout the backend parsers read. **One-off tools, kept as evidence of how the `derived_from` files were made** —
they hardcode the absolute paths of that machine and expect the extracted source archive next to them
(`newmsl/MSL Files/...`), so adjust the paths before re-running. Needs Python 3 + PyMuPDF (`fitz`) + `pdftotext`.

| Script | Does |
|---|---|
| `fw_pdf.py` | Reads a Factory Wise Averages PDF by position (rows by height, columns learnt per line type, split figures rejoined). |
| `fw_reconstruct.py` | Rebuilds factory-averages months (2018 PDFs, Mar/Jun/Jul 2019, Dec 2018 old text) as standard-layout `.txt`; computes totals. |
| `fw_parse.py` | Reference parser for the standard layout (prototype of `FactoryAveragesParser.cs`). |
| `fw_pdf_vs_txt.py` | Ground-truth test: PDF reader vs the clean text report for Feb/Aug/Sep 2019 (cell-for-cell). |
| `fw_continuity.py` | Year-to-date continuity check across consecutive months. |
| `fw_apply.py` | Places the rebuilt files and updates `manifest.csv`. |
| `pr_reconstruct.py` / `pr_manifest.py` | Same for the 2018 plantation-ranking PDFs. |
| `ca_reconstruct.py` | Same for the 2018 combined (gross) averages PDFs. |

The verification that matters is in the backend: `Reconcile` on each parser, and `docs/32_Factory_Averages.md`.
