-- =============================================================================
-- DataPilot – DDL for extended retail model (run after DDL/01_ddl.sql)
-- =============================================================================
-- Adds: brands, sales_reps, warehouses, campaigns, shipments, return_items,
--       order_campaigns; extends products (brand_id) and customers (sales_rep_id).
-- Replace agile-charger-488911-e6.retail_data with your project.dataset if needed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Brands (dimension)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `agile-charger-488911-e6.retail_data.brands` (
  brand_id     STRING    NOT NULL,
  name         STRING    NOT NULL,
  country      STRING,
  created_at   TIMESTAMP
)
OPTIONS(
  description = 'Product brand / manufacturer dimension.'
);

-- -----------------------------------------------------------------------------
-- Sales reps (dimension): account owners
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `agile-charger-488911-e6.retail_data.sales_reps` (
  sales_rep_id STRING    NOT NULL,
  full_name    STRING    NOT NULL,
  email        STRING,
  region       STRING    NOT NULL,
  hired_at     DATE,
  created_at   TIMESTAMP
)
OPTIONS(
  description = 'Sales representative dimension; links to customers for account ownership.'
);

-- -----------------------------------------------------------------------------
-- Warehouses (dimension)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `agile-charger-488911-e6.retail_data.warehouses` (
  warehouse_id STRING    NOT NULL,
  name         STRING    NOT NULL,
  region       STRING    NOT NULL,
  opened_date  DATE,
  created_at   TIMESTAMP
)
OPTIONS(
  description = 'Fulfillment warehouse / distribution node.'
);

-- -----------------------------------------------------------------------------
-- Marketing campaigns (dimension)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `agile-charger-488911-e6.retail_data.campaigns` (
  campaign_id  STRING    NOT NULL,
  name         STRING    NOT NULL,
  channel      STRING    NOT NULL,
  start_date   DATE      NOT NULL,
  end_date     DATE      NOT NULL,
  budget       NUMERIC(14, 2),
  created_at   TIMESTAMP
)
OPTIONS(
  description = 'Marketing campaign with active date range for attribution.'
);

-- -----------------------------------------------------------------------------
-- Extend existing dimensions (nullable until backfilled by DML)
-- If your region does not support IF NOT EXISTS, use plain ADD COLUMN once, or
-- remove OPTIONS(...) to match older dialects.
-- -----------------------------------------------------------------------------
ALTER TABLE `agile-charger-488911-e6.retail_data.products`
  ADD COLUMN IF NOT EXISTS brand_id STRING
  OPTIONS(description = 'Foreign key to brands.brand_id.');

ALTER TABLE `agile-charger-488911-e6.retail_data.customers`
  ADD COLUMN IF NOT EXISTS sales_rep_id STRING
  OPTIONS(description = 'Foreign key to sales_reps.sales_rep_id.');

-- -----------------------------------------------------------------------------
-- Shipments (fact): order fulfillment from a warehouse
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `agile-charger-488911-e6.retail_data.shipments` (
  shipment_id  STRING    NOT NULL,
  order_id     STRING    NOT NULL,
  warehouse_id STRING    NOT NULL,
  ship_date    DATE      NOT NULL,
  carrier      STRING    NOT NULL,
  status       STRING    NOT NULL,
  created_at   TIMESTAMP
)
OPTIONS(
  description = 'Shipment header linking an order to a warehouse and carrier.'
);

-- -----------------------------------------------------------------------------
-- Return items (fact): product returns / refunds at line granularity
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `agile-charger-488911-e6.retail_data.return_items` (
  return_id     STRING    NOT NULL,
  order_id      STRING    NOT NULL,
  product_id    STRING    NOT NULL,
  return_date   DATE      NOT NULL,
  quantity      INT64     NOT NULL,
  refund_amount NUMERIC(12, 2) NOT NULL,
  reason_code   STRING    NOT NULL,
  created_at    TIMESTAMP
)
OPTIONS(
  description = 'Return line items linked to original orders and products.'
);

-- -----------------------------------------------------------------------------
-- Order–campaign attribution (bridge)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `agile-charger-488911-e6.retail_data.order_campaigns` (
  order_id     STRING    NOT NULL,
  campaign_id  STRING    NOT NULL
)
OPTIONS(
  description = 'Links orders to marketing campaigns (attribution). One row per order in seed data.'
);
