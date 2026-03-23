# Data Model: Retail / B2B Sales POC

## What the data is about

This is **retail / B2B sales data** for a product company that sells to businesses (B2B). It models:

- **Brands** and **products** (catalog with `brand_id`)
- **Sales reps** and **customers** (accounts with `sales_rep_id`, region, segment)
- **Orders** and **order line items** (transaction facts)
- **Warehouses** and **shipments** (fulfillment)
- **Return lines** (refunds and reasons)
- **Campaigns** and **order_campaigns** (marketing attribution)
- **Sales daily** (pre-aggregated revenue and units by date × product × region)

So: **who sold, who bought, what was shipped, what was returned, which campaign drove the order**, plus a daily rollup for fast reporting.

---

## Script layout

| Path | Purpose |
|------|---------|
| `DDL/01_ddl.sql` | Base tables: `products`, `customers`, `orders`, `order_items`, `sales_daily` |
| `DDL/02_ddl_new_tables.sql` | Extended model: `brands`, `sales_reps`, `warehouses`, `campaigns`, `shipments`, `return_items`, `order_campaigns`; adds `products.brand_id`, `customers.sales_rep_id` |
| `DML/01_inserts.sql` | Small static seed for the **base** model only (no extension columns) |
| `DML/02_dml_seed_enriched.sql` | Full refresh: ~1,200 orders, ~1 year of dates, all tables (run after both DDL scripts) |

Replace `agile-charger-488911-e6.retail_data` in every file with your **project** and **dataset** before running.

**Run order**

1. `DDL/01_ddl.sql`
2. `DDL/02_ddl_new_tables.sql` (safe to re-run if `ADD COLUMN IF NOT EXISTS` is supported; otherwise run once)
3. Either `DML/01_inserts.sql` **or** `DML/02_dml_seed_enriched.sql` — not both on the same dataset if you want a clean state (enriched script deletes all rows first).

---

## Table relationships (high level)

```
brands (1) ──< products (1) ──< order_items (N) >── (1) orders >── (1) customers >── (1) sales_reps
                                    │                    │
                                    │                    ├──< shipments >── warehouses
                                    │                    ├──< order_campaigns >── campaigns
                                    │                    └──< return_items
                                    └── sales_daily (aggregate by date, product_id, region)
```

---

## Business questions and insights you can answer

| Question | Tables / approach |
|----------|-------------------|
| Revenue by region / segment | `orders` + `customers`, or `sales_daily` + `customers` via product path |
| Revenue by brand | `order_items` + `products` + `brands` |
| Sales by rep | `customers` + `sales_reps` + `orders` |
| Fulfillment: carrier, delays | `shipments` + `warehouses` + `orders` |
| Return rate, refunds by reason | `return_items` + `products` / `orders` |
| Campaign-attributed revenue | `order_campaigns` + `campaigns` + `orders` |
| Daily trend without heavy joins | `sales_daily` |

---

## Application metadata

The LangGraph agents read **`backend/schema/metadata.json`**. After loading BigQuery, keep **date `data_range`** values in that file aligned with your actual min/max dates (the enriched seed targets roughly **2024-03-01** through **2025-03-01** on `orders.order_date`).
