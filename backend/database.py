import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from migrations import apply_store_migration


BACKEND_ROOT = Path(__file__).resolve().parent
# ROOT stays the project root: server.py serves public/ and frontend/dist from
# it, and the local SQLite file lives beside them rather than inside backend/.
ROOT = BACKEND_ROOT.parent
SQLITE_PATH = Path(os.getenv("SQLITE_PATH", str(ROOT / "pos.db")))


def is_postgres():
    return bool(os.getenv("DATABASE_URL"))


def connect_db():
    database_url = os.getenv("DATABASE_URL")
    if database_url:
        import psycopg
        from psycopg.rows import dict_row

        return psycopg.connect(
            database_url,
            row_factory=dict_row,
            prepare_threshold=None,
        )

    connection = sqlite3.connect(SQLITE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 10000")
    return connection


def sql(query):
    """Translate the small SQL dialect differences used by this application."""
    if not is_postgres():
        return query
    return query.replace("?", "%s").replace("datetime('now')", "CURRENT_TIMESTAMP")


def execute(cursor, query, params=()):
    translated = sql(query)
    if params:
        return cursor.execute(translated, params)
    return cursor.execute(translated)


@contextmanager
def transaction():
    connection = connect_db()
    try:
        if not is_postgres():
            connection.execute('BEGIN IMMEDIATE')
        yield connection, connection.cursor()
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def init_schema():
    schema_name = "schema_postgres.sql" if is_postgres() else "schema.sql"
    schema = (BACKEND_ROOT / "schema" / schema_name).read_text(encoding="utf-8")
    connection = connect_db()
    try:
        if is_postgres():
            connection.execute(schema)
            connection.execute('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS giveaway_qty INTEGER NOT NULL DEFAULT 0')
        else:
            connection.executescript(schema)
            columns = {row[1] for row in connection.execute('PRAGMA table_info(orders)')}
            if 'idempotency_key' not in columns:
                connection.execute('ALTER TABLE orders ADD COLUMN idempotency_key TEXT')
                connection.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key ON orders(idempotency_key)')
            item_columns = {row[1] for row in connection.execute('PRAGMA table_info(order_items)')}
            if 'giveaway_qty' not in item_columns:
                connection.execute('ALTER TABLE order_items ADD COLUMN giveaway_qty INTEGER NOT NULL DEFAULT 0')
            # Last, so a rebuilt table carries the columns added just above.
            apply_store_migration(connection, schema)
        connection.commit()
    finally:
        connection.close()
