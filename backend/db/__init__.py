"""Database connector module – generic interface for multiple database backends."""
from db.connector import DatabaseConnector
from db.factory import get_connector

__all__ = ["DatabaseConnector", "get_connector"]
