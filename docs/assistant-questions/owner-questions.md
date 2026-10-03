# Owner's question set (test list for the AI Assistant)

Status key: **Ready** = the assistant has the data and a route for it today (may still need checking against answers) · **Partial** = data exists, but a route or a grouping is missing · **Gap** = needs new logic or data.

| # | Question | Status | What it needs |
|---|---|---|---|
| 1 | Tell me the withdrawn lots | Partial | Withdrawn = catalogue Asking Price 0. Needs a lot-list route for a chosen sale (the Auction agent's withdrawn tool exists). |
| 2 | What is the grade mix of Aruna Tea Factory | Partial | Factory name lookup, then the grade breakdown. Factory names come from the catalogue Producer field. |
| 3 | What is the code for Glen Alpin | Partial | Name-to-factory-code lookup (same as 2). |
| 4 | ASC lots for New Baddegama in sale 41 | Partial | Lot search exists; the sale (41) and the factory name must be picked up from the question. Sale 41 may be catalogue-only. |
| 5 | Top prices for High and Medium catalogue | Partial | Category field (`SaleCategory`) exists; top sold price per lot needs a category filter route. |
| 6 | Who are the top buyers for OP | Partial | Buyer breakdown for grade OP exists in the archive. |
| 7 | What is the buyer pattern in this sale | Gap | A sale-level buyer comparison (buyers by quantity and price, with changes against the previous sale). |
| 8 | Monthly catalogued quantity by broker this year | Gap | Monthly grouping of catalogued quantity; the archive is per sale, not per month for catalogue data. |
| 9 | Why the quantity dropped this sale for Tippy catalogue | Gap | Sale-to-sale comparison with a stated reason from the data (listings, withdrawals, category changes). |
| 10 | Shared marks for ASC | Partial | "Shared" marks are an existing report (sharing status); route needed. |

Add a row for every new question you send. The wording you use is the wording the test should check.
