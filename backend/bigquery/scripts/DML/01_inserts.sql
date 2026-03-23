-- =============================================================================
-- DataPilot POC – INSERTs (run in BigQuery Console after DDL/01_ddl.sql)
-- =============================================================================
-- 1. Replace YOUR_PROJECT_ID and YOUR_DATASET_ID in every statement.
-- 2. Run in this order: products → customers → orders → order_items → sales_daily.
--    (sales_daily is an INSERT...SELECT from the other tables; run it last.)
-- 3. If you use the extended model (DDL/02_ddl_new_tables.sql), use DML/02_dml_seed_enriched.sql instead.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Products
-- -----------------------------------------------------------------------------
INSERT INTO `agile-charger-488911-e6.retail_data.products`
  (product_id, name, category, unit_price, created_at)
VALUES
  ('P001', 'Widget A', 'Electronics', 29.99, CURRENT_TIMESTAMP()),
  ('P002', 'Widget B', 'Electronics', 49.99, CURRENT_TIMESTAMP()),
  ('P003', 'Gadget X', 'Electronics', 99.99, CURRENT_TIMESTAMP()),
  ('P004', 'Desk Lamp', 'Home', 24.99, CURRENT_TIMESTAMP()),
  ('P005', 'Office Chair', 'Furniture', 199.99, CURRENT_TIMESTAMP()),
  ('P006', 'Notebook Set', 'Office', 12.99, CURRENT_TIMESTAMP()),
  ('P007', 'Standing Desk', 'Furniture', 349.99, CURRENT_TIMESTAMP()),
  ('P008', 'Monitor Arm', 'Electronics', 79.99, CURRENT_TIMESTAMP());

-- -----------------------------------------------------------------------------
-- Customers
-- -----------------------------------------------------------------------------
INSERT INTO `agile-charger-488911-e6.retail_data.customers`
  (customer_id, name, region, segment, created_at)
VALUES
  ('C001', 'Acme Corp', 'North', 'Enterprise', CURRENT_TIMESTAMP()),
  ('C002', 'Beta Inc', 'South', 'SMB', CURRENT_TIMESTAMP()),
  ('C003', 'Gamma LLC', 'East', 'Enterprise', CURRENT_TIMESTAMP()),
  ('C004', 'Delta Co', 'West', 'SMB', CURRENT_TIMESTAMP()),
  ('C005', 'Epsilon Ltd', 'North', 'Startup', CURRENT_TIMESTAMP()),
  ('C006', 'Zeta Industries', 'South', 'Enterprise', CURRENT_TIMESTAMP()),
  ('C007', 'Omega Systems', 'East', 'SMB', CURRENT_TIMESTAMP()),
  ('C008', 'Sigma Labs', 'West', 'Startup', CURRENT_TIMESTAMP());

-- -----------------------------------------------------------------------------
-- Orders
-- -----------------------------------------------------------------------------
INSERT INTO `agile-charger-488911-e6.retail_data.orders`
  (order_id, customer_id, order_date, status, total_amount, created_at)
VALUES
  ('O001', 'C001', '2024-01-15', 'completed', 329.97, CURRENT_TIMESTAMP()),
  ('O002', 'C002', '2024-01-16', 'completed', 124.98, CURRENT_TIMESTAMP()),
  ('O003', 'C003', '2024-01-17', 'completed', 649.97, CURRENT_TIMESTAMP()),
  ('O004', 'C001', '2024-02-01', 'completed', 79.99, CURRENT_TIMESTAMP()),
  ('O005', 'C004', '2024-02-05', 'completed', 199.99, CURRENT_TIMESTAMP()),
  ('O006', 'C005', '2024-02-10', 'completed', 49.99, CURRENT_TIMESTAMP()),
  ('O007', 'C006', '2024-02-12', 'completed', 429.98, CURRENT_TIMESTAMP()),
  ('O008', 'C007', '2024-02-14', 'pending', 62.97, CURRENT_TIMESTAMP()),
  ('O009', 'C008', '2024-02-15', 'completed', 349.99, CURRENT_TIMESTAMP()),
  ('O010', 'C002', '2024-02-15', 'completed', 174.97, CURRENT_TIMESTAMP());

-- -----------------------------------------------------------------------------
-- Order items
-- -----------------------------------------------------------------------------
INSERT INTO `agile-charger-488911-e6.retail_data.order_items`
  (order_id, product_id, quantity, unit_price, line_total)
VALUES
  ('O001', 'P001', 2, 29.99, 59.98),
  ('O001', 'P003', 2, 99.99, 199.98),
  ('O001', 'P008', 1, 79.99, 79.99),
  ('O002', 'P004', 5, 24.99, 124.95),
  ('O003', 'P005', 2, 199.99, 399.98),
  ('O003', 'P007', 1, 349.99, 349.99),
  ('O004', 'P008', 1, 79.99, 79.99),
  ('O005', 'P005', 1, 199.99, 199.99),
  ('O006', 'P002', 1, 49.99, 49.99),
  ('O007', 'P007', 1, 349.99, 349.99),
  ('O007', 'P006', 2, 12.99, 25.98),
  ('O008', 'P001', 2, 29.99, 59.98),
  ('O009', 'P007', 1, 349.99, 349.99),
  ('O010', 'P002', 1, 49.99, 49.99),
  ('O010', 'P003', 1, 99.99, 99.99),
  ('O010', 'P006', 2, 12.99, 25.98);

-- -----------------------------------------------------------------------------
-- Sales daily (aggregate from orders + order_items + customers)
-- Run this only after products, customers, orders, and order_items are populated.
-- -----------------------------------------------------------------------------
INSERT INTO `agile-charger-488911-e6.retail_data.sales_daily`
  (date, product_id, region, units_sold, revenue)
SELECT
  o.order_date AS date,
  oi.product_id,
  c.region,
  SUM(oi.quantity) AS units_sold,
  SUM(oi.line_total) AS revenue
FROM `agile-charger-488911-e6.retail_data.order_items` oi
JOIN `agile-charger-488911-e6.retail_data.orders` o
  ON oi.order_id = o.order_id
JOIN `agile-charger-488911-e6.retail_data.customers` c
  ON o.customer_id = c.customer_id
GROUP BY o.order_date, oi.product_id, c.region;
