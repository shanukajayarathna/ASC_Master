# Tea glossary for the AI Assistant

Plain definitions the assistant must use. Each term says which data field it maps to. Confirmed by the business owner unless marked **to confirm**.

## Withdrawn lots
A lot is **withdrawn** when its catalogue Asking Price is exactly 0. Withdrawn lots are not sold, so they are counted separately from sold and unsold lots. Source: the sale catalogue's Asking Price column. (Already in the Auction agent's instructions.)

## Category (also called Catalogue)
The sale catalogue's category column (`SaleCategory`, shown as "Category" or "Catalogue"). Examples: High and Medium, Ex-estate, Leafy, Dust. Use the catalogue's own value; do not rebuild it from the grade name, because grade and category do not always match (see the notes on "High & Medium").

## Packing
The packing of a lot is its **net weight**, the weight of tea in the lot (`PackingKg`, per bag). Lot-level packing is the bag weight, and the lot's net weight is the total of its bags. **To confirm:** whether "packing" should always mean total lot net weight, or the per-bag weight when the question says "per bag".

## Grade mix
A **grade mix** shows how a lot, broker, garden or sale's tea is spread across grades. For each grade it gives:
- quantity offered and quantity sold (kg)
- its share of the total (%)
- the average price (quantity-weighted) and the total quantity
- the total for the whole mix

Use the query's grade breakdown with the quantity and share columns, and state which sale, broker and grade types it covers.
