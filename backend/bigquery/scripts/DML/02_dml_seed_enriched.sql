-- =============================================================================
-- DataPilot – enriched synthetic seed (~1 year, extended model)
-- =============================================================================
-- Prerequisites: run DDL/01_ddl.sql, then DDL/02_ddl_new_tables.sql.
-- Replace agile-charger-488911-e6.retail_data with your project.dataset everywhere.
--
-- This script:
--   1) Deletes existing fact + dimension rows (full refresh).
--   2) Loads brands, sales_reps, warehouses, campaigns, products (120), customers (100).
--   3) Builds ~1,200 orders and ~3–4k order lines via a staging table (deterministic).
--   4) Loads shipments, return_items, order_campaigns, rebuilds sales_daily.
--   5) Drops staging table _dp_staging_order_lines.
--
-- Approximate row counts: orders 1,200; order_items ~3,600; sales_daily thousands;
-- return_items ~200+; shipments ~completed orders.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Clear tables (children before parents)
-- -----------------------------------------------------------------------------
DELETE FROM `agile-charger-488911-e6.retail_data.sales_daily` WHERE TRUE;
DELETE FROM `agile-charger-488911-e6.retail_data.order_campaigns` WHERE TRUE;
DELETE FROM `agile-charger-488911-e6.retail_data.return_items` WHERE TRUE;
DELETE FROM `agile-charger-488911-e6.retail_data.shipments` WHERE TRUE;
DELETE FROM `agile-charger-488911-e6.retail_data.order_items` WHERE TRUE;
DELETE FROM `agile-charger-488911-e6.retail_data.orders` WHERE TRUE;
DELETE FROM `agile-charger-488911-e6.retail_data.customers` WHERE TRUE;
DELETE FROM `agile-charger-488911-e6.retail_data.products` WHERE TRUE;
DELETE FROM `agile-charger-488911-e6.retail_data.campaigns` WHERE TRUE;
DELETE FROM `agile-charger-488911-e6.retail_data.warehouses` WHERE TRUE;
DELETE FROM `agile-charger-488911-e6.retail_data.sales_reps` WHERE TRUE;
DELETE FROM `agile-charger-488911-e6.retail_data.brands` WHERE TRUE;

-- -----------------------------------------------------------------------------
-- 2) Dimensions: brands
-- -----------------------------------------------------------------------------
INSERT INTO `agile-charger-488911-e6.retail_data.brands` (brand_id, name, country, created_at)
VALUES
  ('B01', 'Northwind Labs', 'US', CURRENT_TIMESTAMP()),
  ('B02', 'BlueRiver Co', 'US', CURRENT_TIMESTAMP()),
  ('B03', 'Atlas Goods', 'DE', CURRENT_TIMESTAMP()),
  ('B04', 'Pacific Trade', 'JP', CURRENT_TIMESTAMP()),
  ('B05', 'Summit Brands', 'CA', CURRENT_TIMESTAMP()),
  ('B06', 'Urban Form', 'UK', CURRENT_TIMESTAMP()),
  ('B07', 'Nova Electronics', 'KR', CURRENT_TIMESTAMP()),
  ('B08', 'GreenLeaf Home', 'NL', CURRENT_TIMESTAMP()),
  ('B09', 'IronWorks', 'US', CURRENT_TIMESTAMP()),
  ('B10', 'ClearSky Office', 'MX', CURRENT_TIMESTAMP());

-- -----------------------------------------------------------------------------
-- 3) Dimensions: sales_reps (20)
-- -----------------------------------------------------------------------------
INSERT INTO `agile-charger-488911-e6.retail_data.sales_reps`
  (sales_rep_id, full_name, email, region, hired_at, created_at)
VALUES
  ('R01', 'Alex Morgan', 'alex.morgan@datapilot.demo', 'North', DATE '2021-04-10', CURRENT_TIMESTAMP()),
  ('R02', 'Jordan Lee', 'jordan.lee@datapilot.demo', 'North', DATE '2022-01-15', CURRENT_TIMESTAMP()),
  ('R03', 'Sam Rivera', 'sam.rivera@datapilot.demo', 'South', DATE '2020-11-01', CURRENT_TIMESTAMP()),
  ('R04', 'Taylor Chen', 'taylor.chen@datapilot.demo', 'South', DATE '2023-03-20', CURRENT_TIMESTAMP()),
  ('R05', 'Casey Brooks', 'casey.brooks@datapilot.demo', 'East', DATE '2019-07-08', CURRENT_TIMESTAMP()),
  ('R06', 'Riley Park', 'riley.park@datapilot.demo', 'East', DATE '2022-09-12', CURRENT_TIMESTAMP()),
  ('R07', 'Morgan Blake', 'morgan.blake@datapilot.demo', 'West', DATE '2021-02-28', CURRENT_TIMESTAMP()),
  ('R08', 'Jamie Fox', 'jamie.fox@datapilot.demo', 'West', DATE '2023-06-01', CURRENT_TIMESTAMP()),
  ('R09', 'Avery Singh', 'avery.singh@datapilot.demo', 'North', DATE '2020-05-17', CURRENT_TIMESTAMP()),
  ('R10', 'Quinn Adams', 'quinn.adams@datapilot.demo', 'South', DATE '2024-01-08', CURRENT_TIMESTAMP()),
  ('R11', 'Reese Kumar', 'reese.kumar@datapilot.demo', 'East', DATE '2018-10-22', CURRENT_TIMESTAMP()),
  ('R12', 'Skyler Diaz', 'skyler.diaz@datapilot.demo', 'West', DATE '2022-12-01', CURRENT_TIMESTAMP()),
  ('R13', 'Drew Patel', 'drew.patel@datapilot.demo', 'North', DATE '2023-04-15', CURRENT_TIMESTAMP()),
  ('R14', 'Blake Ortiz', 'blake.ortiz@datapilot.demo', 'South', DATE '2021-08-30', CURRENT_TIMESTAMP()),
  ('R15', 'Cameron Wu', 'cameron.wu@datapilot.demo', 'East', DATE '2019-03-11', CURRENT_TIMESTAMP()),
  ('R16', 'Parker Hall', 'parker.hall@datapilot.demo', 'West', DATE '2020-12-07', CURRENT_TIMESTAMP()),
  ('R17', 'Rowan Iyer', 'rowan.iyer@datapilot.demo', 'North', DATE '2024-02-19', CURRENT_TIMESTAMP()),
  ('R18', 'Sage Nguyen', 'sage.nguyen@datapilot.demo', 'South', DATE '2022-07-25', CURRENT_TIMESTAMP()),
  ('R19', 'Emery Shah', 'emery.shah@datapilot.demo', 'East', DATE '2021-01-04', CURRENT_TIMESTAMP()),
  ('R20', 'Finley Rao', 'finley.rao@datapilot.demo', 'West', DATE '2023-10-10', CURRENT_TIMESTAMP());

-- -----------------------------------------------------------------------------
-- 4) Dimensions: warehouses
-- -----------------------------------------------------------------------------
INSERT INTO `agile-charger-488911-e6.retail_data.warehouses`
  (warehouse_id, name, region, opened_date, created_at)
VALUES
  ('W01', 'Chicago Central', 'North', DATE '2018-01-15', CURRENT_TIMESTAMP()),
  ('W02', 'Dallas South Hub', 'South', DATE '2019-06-01', CURRENT_TIMESTAMP()),
  ('W03', 'Newark East', 'East', DATE '2017-03-20', CURRENT_TIMESTAMP()),
  ('W04', 'Phoenix West', 'West', DATE '2020-09-10', CURRENT_TIMESTAMP()),
  ('W05', 'Denver Mountain', 'West', DATE '2021-11-05', CURRENT_TIMESTAMP());

-- -----------------------------------------------------------------------------
-- 5) Dimensions: campaigns (CMP99 = fallback attribution for any order_date)
-- -----------------------------------------------------------------------------
INSERT INTO `agile-charger-488911-e6.retail_data.campaigns`
  (campaign_id, name, channel, start_date, end_date, budget, created_at)
VALUES
  ('CMP01', 'Q1 B2B push', 'email', DATE '2024-03-01', DATE '2024-05-31', 125000.00, CURRENT_TIMESTAMP()),
  ('CMP02', 'Spring digital', 'paid_search', DATE '2024-04-01', DATE '2024-06-30', 98000.00, CURRENT_TIMESTAMP()),
  ('CMP03', 'Mid-year webinar', 'events', DATE '2024-06-01', DATE '2024-08-31', 45000.00, CURRENT_TIMESTAMP()),
  ('CMP04', 'Summer promo', 'social', DATE '2024-07-01', DATE '2024-09-15', 67000.00, CURRENT_TIMESTAMP()),
  ('CMP05', 'Back-to-business', 'email', DATE '2024-09-01', DATE '2024-11-30', 88000.00, CURRENT_TIMESTAMP()),
  ('CMP06', 'Holiday enterprise', 'display', DATE '2024-11-01', DATE '2025-01-31', 210000.00, CURRENT_TIMESTAMP()),
  ('CMP07', 'Winter nurture', 'email', DATE '2024-12-01', DATE '2025-02-28', 52000.00, CURRENT_TIMESTAMP()),
  ('CMP08', 'Partner co-marketing', 'partner', DATE '2024-05-15', DATE '2024-10-15', 33000.00, CURRENT_TIMESTAMP()),
  ('CMP99', 'Evergreen / organic baseline', 'organic', DATE '2023-01-01', DATE '2030-12-31', 0.00, CURRENT_TIMESTAMP());

-- -----------------------------------------------------------------------------
-- 6) Products (120 SKUs) with brand_id
-- -----------------------------------------------------------------------------
INSERT INTO `agile-charger-488911-e6.retail_data.products`
  (product_id, name, category, unit_price, created_at, brand_id)
SELECT
  FORMAT('P%04d', n) AS product_id,
  CONCAT(
    CASE MOD(n, 4)
      WHEN 0 THEN 'Pro'
      WHEN 1 THEN 'Lite'
      WHEN 2 THEN 'Max'
      ELSE 'Eco'
    END,
    ' ',
    CASE MOD(n, 4)
      WHEN 0 THEN 'Electro'
      WHEN 1 THEN 'Home'
      WHEN 2 THEN 'Office'
      ELSE 'Studio'
    END,
    ' ',
    CAST(n AS STRING)
  ) AS name,
  CASE MOD(n, 4)
    WHEN 0 THEN 'Electronics'
    WHEN 1 THEN 'Home'
    WHEN 2 THEN 'Furniture'
    ELSE 'Office'
  END AS category,
  CAST(
    ROUND(9.99 + MOD(ABS(FARM_FINGERPRINT(CAST(n AS STRING))), 890) * 1.0 + MOD(n, 7) * 0.01, 2) AS NUMERIC
  ) AS unit_price,
  CURRENT_TIMESTAMP() AS created_at,
  FORMAT('B%02d', 1 + MOD(n - 1, 10)) AS brand_id
FROM UNNEST(GENERATE_ARRAY(1, 120)) AS n;

-- -----------------------------------------------------------------------------
-- 7) Customers (100) with sales_rep_id (aligned to rep region when possible)
-- -----------------------------------------------------------------------------
INSERT INTO `agile-charger-488911-e6.retail_data.customers`
  (customer_id, name, region, segment, created_at, sales_rep_id)
SELECT
  FORMAT('C%04d', n) AS customer_id,
  CONCAT('B2B Customer ', n) AS name,
  CASE MOD(n, 4)
    WHEN 0 THEN 'North'
    WHEN 1 THEN 'South'
    WHEN 2 THEN 'East'
    ELSE 'West'
  END AS region,
  CASE MOD(n, 3)
    WHEN 0 THEN 'Enterprise'
    WHEN 1 THEN 'SMB'
    ELSE 'Startup'
  END AS segment,
  CURRENT_TIMESTAMP() AS created_at,
  FORMAT('R%02d', 1 + MOD(n - 1, 20)) AS sales_rep_id
FROM UNNEST(GENERATE_ARRAY(1, 100)) AS n;

-- -----------------------------------------------------------------------------
-- 8) Staging: synthetic order lines (deterministic)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE TABLE `agile-charger-488911-e6.retail_data._dp_staging_order_lines` AS
WITH ord AS (
  SELECT ord_n
  FROM UNNEST(GENERATE_ARRAY(1, 1200)) AS ord_n
),
expanded AS (
  SELECT
    o.ord_n,
    line_idx,
    FORMAT('ORD%06d', o.ord_n) AS order_id,
    FORMAT('C%04d', 1 + MOD(ABS(FARM_FINGERPRINT(CAST(o.ord_n AS STRING))), 100)) AS customer_id,
    DATE_ADD(DATE '2024-03-01', INTERVAL MOD(o.ord_n, 366) DAY) AS order_date,
    CASE
      WHEN MOD(o.ord_n, 37) = 0 THEN 'cancelled'
      WHEN MOD(o.ord_n, 41) = 0 THEN 'pending'
      ELSE 'completed'
    END AS status,
    FORMAT(
      'P%04d',
      1 + MOD(ABS(FARM_FINGERPRINT(CONCAT(CAST(o.ord_n AS STRING), '|', CAST(line_idx AS STRING)))), 120)
    ) AS product_id,
    1 + MOD(ABS(FARM_FINGERPRINT(CONCAT(CAST(o.ord_n AS STRING), '|', CAST(line_idx AS STRING), 'q'))), 9) AS quantity
  FROM ord AS o
  CROSS JOIN UNNEST(GENERATE_ARRAY(1, 2 + MOD(o.ord_n, 3))) AS line_idx
)
SELECT
  e.order_id,
  e.customer_id,
  e.order_date,
  e.status,
  p.product_id,
  e.quantity,
  p.unit_price,
  ROUND(p.unit_price * CAST(e.quantity AS NUMERIC), 2) AS line_total
FROM expanded AS e
JOIN `agile-charger-488911-e6.retail_data.products` AS p
  ON p.product_id = e.product_id;

-- -----------------------------------------------------------------------------
-- 9) Orders (header totals = sum of lines)
-- -----------------------------------------------------------------------------
INSERT INTO `agile-charger-488911-e6.retail_data.orders`
  (order_id, customer_id, order_date, status, total_amount, created_at)
SELECT
  order_id,
  ANY_VALUE(customer_id) AS customer_id,
  ANY_VALUE(order_date) AS order_date,
  ANY_VALUE(status) AS status,
  SUM(line_total) AS total_amount,
  CURRENT_TIMESTAMP() AS created_at
FROM `agile-charger-488911-e6.retail_data._dp_staging_order_lines`
GROUP BY order_id;

-- -----------------------------------------------------------------------------
-- 10) Order items
-- -----------------------------------------------------------------------------
INSERT INTO `agile-charger-488911-e6.retail_data.order_items`
  (order_id, product_id, quantity, unit_price, line_total)
SELECT order_id, product_id, quantity, unit_price, line_total
FROM `agile-charger-488911-e6.retail_data._dp_staging_order_lines`;

-- -----------------------------------------------------------------------------
-- 11) Shipments (completed orders only)
-- -----------------------------------------------------------------------------
INSERT INTO `agile-charger-488911-e6.retail_data.shipments`
  (shipment_id, order_id, warehouse_id, ship_date, carrier, status, created_at)
SELECT
  FORMAT('SH%06d', ROW_NUMBER() OVER (ORDER BY o.order_id)) AS shipment_id,
  o.order_id,
  FORMAT('W%02d', 1 + MOD(ABS(FARM_FINGERPRINT(o.order_id)), 5)) AS warehouse_id,
  DATE_ADD(o.order_date, INTERVAL 1 + MOD(ABS(FARM_FINGERPRINT(CONCAT(o.order_id, 'd'))), 6) DAY) AS ship_date,
  CASE MOD(ABS(FARM_FINGERPRINT(o.order_id)), 3)
    WHEN 0 THEN 'UPS'
    WHEN 1 THEN 'FedEx'
    ELSE 'DHL'
  END AS carrier,
  CASE MOD(ABS(FARM_FINGERPRINT(CONCAT(o.order_id, 's'))), 25)
    WHEN 0 THEN 'delayed'
    ELSE 'delivered'
  END AS status,
  CURRENT_TIMESTAMP() AS created_at
FROM `agile-charger-488911-e6.retail_data.orders` AS o
WHERE o.status = 'completed';

-- -----------------------------------------------------------------------------
-- 12) Return items (~1/16 of order lines, partial refunds)
-- -----------------------------------------------------------------------------
INSERT INTO `agile-charger-488911-e6.retail_data.return_items`
  (return_id, order_id, product_id, return_date, quantity, refund_amount, reason_code, created_at)
SELECT
  FORMAT('RT%07d', ROW_NUMBER() OVER (ORDER BY oi.order_id, oi.product_id, oi.line_total)) AS return_id,
  oi.order_id,
  oi.product_id,
  DATE_ADD(o.order_date, INTERVAL 7 + MOD(ABS(FARM_FINGERPRINT(CONCAT(oi.order_id, oi.product_id, 'r'))), 40) DAY) AS return_date,
  LEAST(
    oi.quantity,
    1 + MOD(ABS(FARM_FINGERPRINT(CONCAT(oi.order_id, oi.product_id, 'q'))), 3)
  ) AS quantity,
  ROUND(
    oi.line_total * (SAFE_DIVIDE(CAST(35 + MOD(ABS(FARM_FINGERPRINT(CONCAT(oi.order_id, oi.product_id, 'm'))), 50) AS NUMERIC), CAST(100 AS NUMERIC))),
    2
  ) AS refund_amount,
  CASE MOD(ABS(FARM_FINGERPRINT(CONCAT(oi.order_id, oi.product_id, 'z'))), 4)
    WHEN 0 THEN 'defective'
    WHEN 1 THEN 'changed_mind'
    WHEN 2 THEN 'not_as_described'
    ELSE 'duplicate_order'
  END AS reason_code,
  CURRENT_TIMESTAMP() AS created_at
FROM `agile-charger-488911-e6.retail_data.order_items` AS oi
JOIN `agile-charger-488911-e6.retail_data.orders` AS o
  ON o.order_id = oi.order_id
WHERE MOD(ABS(FARM_FINGERPRINT(CONCAT(oi.order_id, oi.product_id, 'ret'))), 16) = 0;

-- -----------------------------------------------------------------------------
-- 13) Order–campaign attribution (prefer specific campaigns over CMP99)
-- -----------------------------------------------------------------------------
INSERT INTO `agile-charger-488911-e6.retail_data.order_campaigns` (order_id, campaign_id)
SELECT
  o.order_id,
  c.campaign_id
FROM `agile-charger-488911-e6.retail_data.orders` AS o
LEFT JOIN `agile-charger-488911-e6.retail_data.campaigns` AS c
  ON o.order_date BETWEEN c.start_date AND c.end_date
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY o.order_id
  ORDER BY CASE WHEN c.campaign_id = 'CMP99' THEN 1 ELSE 0 END, c.campaign_id
) = 1;

-- -----------------------------------------------------------------------------
-- 14) sales_daily (exclude cancelled orders from revenue rollup)
-- -----------------------------------------------------------------------------
INSERT INTO `agile-charger-488911-e6.retail_data.sales_daily`
  (date, product_id, region, units_sold, revenue)
SELECT
  o.order_date AS date,
  oi.product_id,
  c.region,
  SUM(oi.quantity) AS units_sold,
  SUM(oi.line_total) AS revenue
FROM `agile-charger-488911-e6.retail_data.order_items` AS oi
JOIN `agile-charger-488911-e6.retail_data.orders` AS o
  ON oi.order_id = o.order_id
JOIN `agile-charger-488911-e6.retail_data.customers` AS c
  ON o.customer_id = c.customer_id
WHERE o.status != 'cancelled'
GROUP BY o.order_date, oi.product_id, c.region;

-- -----------------------------------------------------------------------------
-- 15) Drop staging table
-- -----------------------------------------------------------------------------
DROP TABLE `agile-charger-488911-e6.retail_data._dp_staging_order_lines`;
