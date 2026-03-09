"""
Factory for database connectors based on configuration.
"""
import os
from db.connector import DatabaseConnector
from db.bigquery_connector import BigQueryConnector
from db.postgres_connector import PostgresConnector


def get_connector() -> DatabaseConnector | None:
    """
    Return the appropriate connector based on DATABASE_TYPE env var.
    Default: bigquery if BIGQUERY_PROJECT_ID is set.
    """
    db_type = (os.getenv("DATABASE_TYPE") or "").lower()

    if db_type == "postgres" or db_type == "postgresql":
        url = os.getenv("POSTGRES_URL") or os.getenv("DATABASE_URL")
        if not url:
            return None
        schema = os.getenv("POSTGRES_SCHEMA", "public")
        return PostgresConnector(url, schema)

    # Default: BigQuery
    project_id = os.getenv("BIGQUERY_PROJECT_ID")
    dataset_id = os.getenv("BIGQUERY_DATASET", "retail_data")
    if project_id and project_id != "your-gcp-project-id":
        return BigQueryConnector(project_id, dataset_id)

    return None
