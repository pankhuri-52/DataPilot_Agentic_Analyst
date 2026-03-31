"""
Unit tests for backend/agents/sql_allowlist.py

Covers:
- validate_sql_against_schema: happy path, unknown table, forbidden catalogs,
  unknown column, alias resolution, JOINs, subqueries, empty schema
- extract_referenced_tables_with_aliases: simple, aliased, multi-join
- extract_known_metadata_tables: returns only schema-known tables
"""
import pytest
from agents.sql_allowlist import (
    validate_sql_against_schema,
    extract_referenced_tables_with_aliases,
    extract_known_metadata_tables,
)

# ---------------------------------------------------------------------------
# Minimal schema fixture used across tests
# ---------------------------------------------------------------------------

SCHEMA = {
    "tables": [
        {
            "name": "orders",
            "columns": [
                {"name": "order_id"},
                {"name": "total_amount"},
                {"name": "status"},
                {"name": "customer_id"},
                {"name": "order_date"},
            ],
        },
        {
            "name": "customers",
            "columns": [
                {"name": "customer_id"},
                {"name": "name"},
                {"name": "region"},
            ],
        },
        {
            "name": "products",
            "columns": [
                {"name": "product_id"},
                {"name": "name"},
                {"name": "category"},
                {"name": "unit_price"},
            ],
        },
    ]
}


# ---------------------------------------------------------------------------
# validate_sql_against_schema – happy paths
# ---------------------------------------------------------------------------


class TestValidateSqlHappyPath:
    def test_simple_select(self):
        sql = "SELECT order_id, total_amount FROM orders"
        ok, err = validate_sql_against_schema(sql, SCHEMA)
        assert ok is True
        assert err is None

    def test_select_star(self):
        sql = "SELECT * FROM customers"
        ok, err = validate_sql_against_schema(sql, SCHEMA)
        assert ok is True
        assert err is None

    def test_join_two_allowed_tables(self):
        sql = (
            "SELECT o.order_id, c.name "
            "FROM orders o "
            "JOIN customers c ON o.customer_id = c.customer_id"
        )
        ok, err = validate_sql_against_schema(sql, SCHEMA)
        assert ok is True
        assert err is None

    def test_aliased_table_qualified_column(self):
        sql = "SELECT o.total_amount FROM orders o WHERE o.status = 'shipped'"
        ok, err = validate_sql_against_schema(sql, SCHEMA)
        assert ok is True
        assert err is None

    def test_aggregate_query(self):
        sql = (
            "SELECT region, SUM(o.total_amount) AS revenue "
            "FROM orders o "
            "JOIN customers c ON o.customer_id = c.customer_id "
            "GROUP BY region"
        )
        ok, err = validate_sql_against_schema(sql, SCHEMA)
        assert ok is True
        assert err is None


# ---------------------------------------------------------------------------
# validate_sql_against_schema – unknown / forbidden table
# ---------------------------------------------------------------------------


class TestValidateSqlBadTable:
    def test_unknown_table_blocked(self):
        sql = "SELECT * FROM hackers"
        ok, err = validate_sql_against_schema(sql, SCHEMA)
        assert ok is False
        assert "hackers" in (err or "").lower() or "unknown" in (err or "").lower()

    def test_system_table_blocked(self):
        sql = "SELECT * FROM sys_config"
        ok, err = validate_sql_against_schema(sql, SCHEMA)
        assert ok is False

    def test_multiple_tables_one_invalid(self):
        sql = "SELECT * FROM orders JOIN secret_table ON orders.order_id = secret_table.id"
        ok, err = validate_sql_against_schema(sql, SCHEMA)
        assert ok is False


# ---------------------------------------------------------------------------
# validate_sql_against_schema – forbidden catalog / system schemas
# ---------------------------------------------------------------------------


class TestValidateSqlForbiddenCatalog:
    def test_information_schema_qualified(self):
        sql = "SELECT * FROM information_schema.columns"
        ok, err = validate_sql_against_schema(sql, SCHEMA)
        assert ok is False
        assert "information_schema" in (err or "").lower()

    def test_pg_catalog_qualified(self):
        sql = "SELECT * FROM pg_catalog.pg_tables"
        ok, err = validate_sql_against_schema(sql, SCHEMA)
        assert ok is False
        assert "pg_catalog" in (err or "").lower()

    def test_sys_schema_qualified(self):
        sql = "SELECT name FROM sys.tables"
        ok, err = validate_sql_against_schema(sql, SCHEMA)
        assert ok is False

    def test_mysql_schema_qualified(self):
        sql = "SELECT * FROM mysql.user"
        ok, err = validate_sql_against_schema(sql, SCHEMA)
        assert ok is False


# ---------------------------------------------------------------------------
# validate_sql_against_schema – unknown column detection
# ---------------------------------------------------------------------------


class TestValidateSqlUnknownColumn:
    def test_unknown_column_on_known_table(self):
        sql = "SELECT o.nonexistent_col FROM orders o"
        ok, err = validate_sql_against_schema(sql, SCHEMA)
        assert ok is False
        assert "nonexistent_col" in (err or "")

    def test_known_column_passes(self):
        sql = "SELECT o.order_date FROM orders o"
        ok, err = validate_sql_against_schema(sql, SCHEMA)
        assert ok is True

    def test_unknown_column_on_joined_table(self):
        sql = (
            "SELECT c.phantom_field "
            "FROM orders o JOIN customers c ON o.customer_id = c.customer_id"
        )
        ok, err = validate_sql_against_schema(sql, SCHEMA)
        assert ok is False
        assert "phantom_field" in (err or "")


# ---------------------------------------------------------------------------
# validate_sql_against_schema – edge cases
# ---------------------------------------------------------------------------


class TestValidateSqlEdgeCases:
    def test_empty_schema_blocked(self):
        sql = "SELECT * FROM orders"
        ok, err = validate_sql_against_schema(sql, {})
        assert ok is False
        assert err is not None

    def test_no_from_clause_blocked(self):
        sql = "SELECT 1 + 1"
        ok, err = validate_sql_against_schema(sql, SCHEMA)
        assert ok is False

    def test_subquery_valid_tables(self):
        sql = (
            "SELECT order_id FROM ("
            "  SELECT order_id, total_amount FROM orders WHERE status = 'complete'"
            ") sub"
        )
        ok, err = validate_sql_against_schema(sql, SCHEMA)
        assert ok is True

    def test_case_insensitive_table_name(self):
        sql = "SELECT * FROM ORDERS"
        ok, err = validate_sql_against_schema(sql, SCHEMA)
        assert ok is True


# ---------------------------------------------------------------------------
# extract_referenced_tables_with_aliases
# ---------------------------------------------------------------------------


class TestExtractReferencedTables:
    def test_single_table_no_alias(self):
        sql = "SELECT * FROM orders"
        refs = extract_referenced_tables_with_aliases(sql)
        table_names = [r[0].lower() for r in refs]
        assert "orders" in table_names

    def test_table_with_alias(self):
        sql = "SELECT o.order_id FROM orders o"
        refs = extract_referenced_tables_with_aliases(sql)
        table_names = [r[0].lower() for r in refs]
        assert "orders" in table_names

    def test_two_tables_join(self):
        sql = (
            "SELECT o.order_id, c.name "
            "FROM orders o JOIN customers c ON o.customer_id = c.customer_id"
        )
        refs = extract_referenced_tables_with_aliases(sql)
        table_names = [r[0].lower() for r in refs]
        assert "orders" in table_names
        assert "customers" in table_names

    def test_no_duplicates(self):
        sql = "SELECT * FROM orders o1, orders o2"
        refs = extract_referenced_tables_with_aliases(sql)
        lower_names = [r[0].lower() for r in refs]
        assert lower_names.count("orders") == 1


# ---------------------------------------------------------------------------
# extract_known_metadata_tables
# ---------------------------------------------------------------------------


class TestExtractKnownMetadataTables:
    def test_returns_only_schema_tables(self):
        sql = "SELECT * FROM orders JOIN unknown_table ON orders.order_id = unknown_table.id"
        known = extract_known_metadata_tables(sql, SCHEMA)
        assert "orders" in known
        assert "unknown_table" not in known

    def test_multiple_known_tables(self):
        sql = (
            "SELECT o.order_id, c.name, p.category "
            "FROM orders o "
            "JOIN customers c ON o.customer_id = c.customer_id "
            "JOIN products p ON p.product_id = o.order_id"
        )
        known = extract_known_metadata_tables(sql, SCHEMA)
        assert set(known) == {"orders", "customers", "products"}

    def test_empty_result_for_all_unknown(self):
        sql = "SELECT * FROM ghost_table"
        known = extract_known_metadata_tables(sql, SCHEMA)
        assert known == []
