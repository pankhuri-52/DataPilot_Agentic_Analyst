# Data Model: Retail / B2B Sales POC

## What the data is about

This is **retail / B2B sales data** for a product company that sells to businesses (B2B). It models:

- **Products** (catalog: Electronics, Home, Furniture, Office)
- **Customers** (companies by region and segment: Enterprise, SMB (Small and Medium Sized Business), Startup)
- **Orders** (order header: who bought, when, status, total)
- **Order line items** (what was bought in each order: product, quantity, price, line total)
- **Sales daily** (pre-aggregated summary: revenue and units by date × product × region)

So: **who bought what, when, for how much**, plus a daily rollup for fast reporting.

---

## Table relationships (ER)

```
customers (1) ──────────< orders (N)
    │                         │
    │                         │ order_id
    │                         ▼
    │                    order_items (N)
    │                         │
    │                         │ product_id
    ▼                         ▼
  region              products (1)
  (used in                  │
   sales_daily)              │
                             ▼
                    sales_daily (aggregate: date, product_id, region)
```

- **customers** — dimension. One row per customer.  
  **orders.customer_id** → **customers.customer_id** (each order belongs to one customer).

- **orders** — order header. One row per order.  
  **order_items.order_id** → **orders.order_id** (each order has one or more line items).

- **products** — dimension. One row per product.  
  **order_items.product_id** → **products.product_id** (each line item references one product).

- **order_items** — fact (transaction detail). One row per product per order.  
  Joining orders + order_items + customers gives full context (customer region, segment, product category, etc.).

- **sales_daily** — derived aggregate. One row per (date, product_id, region).  
  Built from orders + order_items + customers; use for fast “revenue/units by day, product, region” without joining the fact table.

---

## Business questions and insights you can answer

| Question | Tables / approach |
|----------|-------------------|
| Revenue by region | `sales_daily` by region, or orders + customers |
| Revenue by customer segment (Enterprise vs SMB vs Startup) | orders + customers, group by segment |
| Top products by revenue or units | order_items + products, or sales_daily + products |
| Revenue by category | order_items + products, group by category |
| Revenue by month/quarter | orders or sales_daily, group by date |
| Average order value (AOV) by segment or region | orders + customers, AVG(total_amount) |
| Which customers ordered most / are most valuable | orders + customers, SUM(total_amount), COUNT(orders) |
| Product mix per order (basket analysis) | order_items + orders, group by order_id |
| Pending vs completed orders | orders where status = 'pending' vs 'completed' |
| Daily trend: units and revenue by product and region | sales_daily |

---

## How to use the scripts

1. In BigQuery, create a dataset (e.g. `customer_data`) in your project.
2. Replace `YOUR_PROJECT_ID` and `YOUR_DATASET_ID` in the SQL files with your project and dataset.
3. Run **01_ddl.sql** (full DDL) to create all tables.
4. Run **02_inserts.sql** in order: products → customers → orders → order_items → sales_daily (the last is an INSERT...SELECT from the others).

After that, you can run the business queries above (and more) in the BigQuery console or from your app.
