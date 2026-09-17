# CLAUDE.md

Project architecture, module behaviour and engineering standards live in [`docs/`](docs/README.md) — start there. Frontend-specific agent notes: [`frontend/CLAUDE.md`](frontend/CLAUDE.md).

## Domain Rules — CTTA By-Laws (governing law for all auction workflows)

Source: By-Laws and Conditions for the Sale of Tea by Public Auction and by Private Treaty, adopted by the Ceylon Chamber of Commerce, 30 June 2023. Full reference: `docs/ctta-bylaws-knowledge-base.md`.

**Any feature touching payments, deposits, delivery timing, defaults, penalties, or claims must use these constants — do not invent or assume different numbers.**

- Buyer deposit: **10%** of lot value, due 2:00 p.m. two working days after the final auction day.
- Buyer's Prompt Day: **6 days** after sale conclusion (excl. public/bank/mercantile holidays), 1:00 p.m. deadline. Forward contracts/private sales: 6th day after sample approval.
- Broker pays Seller by **noon, first working day after** Buyer's Prompt Day.
- Default penalty structure (both Buyer and Broker defaults): **1%/day** of outstanding amount for days 1–3, then **AWPLR + 4%** thereafter.
- Debarment escalation: 1st default → debarred until 1 month after settlement; 2nd within 6 months → 3 months; 3rd within 12 months → debarred from all sale participation (existing contracts still binding).
- Objection/complaint filing window: **51 calendar days** from auction/sale date. Interest-bearing complaint window: 7 days from collection, capped at 28 days from sale.
- Claim settlement window: **14 calendar days** from formal claim receipt.
- Ex-estate delivery deadline: **14 consecutive days** from sale date; Buyer must send delivery instructions within **3 days**.
- Storage charges (Colombo warehouses): Rs. 3.25/package/day (days 22–60), Rs. 10.40/package/day (day 61+).
- Rate-of-advancing-bids table and cataloguing break-size limits are grade- and catalogue-specific — do not hardcode a single bid increment; see the reference doc's tables.
- Minimum quality standard: ISO 3720 (or current SLTB-mandated equivalent) — relevant to any quality/grade validation logic.
- These By-Laws can be suspended by the CCC for up to 3 months at a time — if a workflow's behavior seems to contradict this document, check for an active suspension before assuming the code or the doc is wrong.

The AI agents answer by-law questions from that same file via the `get_ctta_bylaws` tool (`Modules/Knowledge/CttaBylawsService.cs`, section lookup by `##` heading) — to amend a rule, edit only `docs/ctta-bylaws-knowledge-base.md` and its **Last verified** line; keep the `##` headings intact (routing tests in `Asc.Api.Tests/CttaBylawsTests.cs` depend on them).
