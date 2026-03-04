-- =============================================================================
-- DataPilot POC – DDL (run in BigQuery Console)
-- =============================================================================
-- 1. Create your dataset in BigQuery UI if it does not exist (e.g. customer_data).
-- 2. Replace YOUR_PROJECT_ID and YOUR_DATASET_ID below with your project and dataset.
-- 3. Run this entire script (or run each CREATE TABLE one by one).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Products (dimension): catalog of sellable products
-- -----------------------------------------------------------------------------
CREATE SCHEMA `agile-charger-488911-e6`.`retail_data`; 

CREATE TABLE IF NOT EXISTS `agile-charger-488911-e6.retail_data.products` (
  product_id   STRING    NOT NULL,  -- Primary key. Unique product identifier.
  name         STRING    NOT NULL,  -- Display name of the product.
  category     STRING    NOT NULL,  -- Product category (e.g. Electronics, Home, Furniture, Office).
  unit_price   NUMERIC(12, 2) NOT NULL,  -- Price per unit in currency (use NUMERIC for exact money).
  created_at   TIMESTAMP               -- When the record was created.
)
OPTIONS(
  description = 'Product dimension table. One row per product in the catalog.'
);

-- -----------------------------------------------------------------------------
-- Customers (dimension): B2B customers by region and segment
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `agile-charger-488911-e6.retail_data.customers` (
  customer_id  STRING    NOT NULL,  -- Primary key. Unique customer identifier.
  name         STRING    NOT NULL,  -- Customer / company name.
  region       STRING    NOT NULL,  -- Sales region (e.g. North, South, East, West).
  segment      STRING    NOT NULL,  -- Customer segment (e.g. Enterprise, SMB, Startup).
  created_at   TIMESTAMP               -- When the record was created.
)
OPTIONS(
  description = 'Customer dimension table. One row per B2B customer.'
);

-- -----------------------------------------------------------------------------
-- Orders (header): one row per order, links to customer
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `agile-charger-488911-e6.retail_data.orders` (
  order_id     STRING    NOT NULL,  -- Primary key. Unique order identifier.
  customer_id  STRING    NOT NULL,  -- Foreign key to customers.customer_id.
  order_date   DATE      NOT NULL,  -- Date the order was placed.
  status       STRING    NOT NULL,  -- Order status (e.g. completed, pending, cancelled).
  total_amount NUMERIC(12, 2) NOT NULL,  -- Order total in currency.
  created_at   TIMESTAMP               -- When the record was created.
)
OPTIONS(
  description = 'Order header. One row per order; links to customers. Detail lines in order_items.'
);

-- -----------------------------------------------------------------------------
-- Order items (fact): one row per product line on an order
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `agile-charger-488911-e6.retail_data.order_items` (
  order_id     STRING    NOT NULL,  -- Foreign key to orders.order_id.
  product_id   STRING    NOT NULL,  -- Foreign key to products.product_id.
  quantity     INT64     NOT NULL,  -- Number of units ordered (positive integer).
  unit_price   NUMERIC(12, 2) NOT NULL,  -- Price per unit at time of order.
  line_total   NUMERIC(12, 2) NOT NULL   -- quantity * unit_price for this line.
)
OPTIONS(
  description = 'Order line items. One row per product per order; links orders to products.'
);

-- -----------------------------------------------------------------------------
-- Sales daily (aggregate): pre-aggregated revenue and units by date, product, region
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `agile-charger-488911-e6.retail_data.sales_daily` (
  date         DATE      NOT NULL,  -- Calendar date of sales.
  product_id   STRING    NOT NULL,  -- Foreign key to products.product_id.
  region       STRING    NOT NULL,  -- Sales region (from customer on the order).
  units_sold   INT64     NOT NULL,  -- Total quantity sold that day for this product in this region.
  revenue      NUMERIC(12, 2) NOT NULL   -- Total revenue for this (date, product_id, region).
)
OPTIONS(
  description = 'Daily sales summary by product and region. Use for fast reporting without joining orders/order_items.'
);
