"""Bring an existing SQLite database up to the current schema.

PostgreSQL migrates itself: every change lives at the bottom of
schema/schema_postgres.sql as an idempotent statement. SQLite cannot express
those changes as ALTER statements -- adding a column is fine, but changing a
UNIQUE constraint or a primary key requires rebuilding the table -- so the work
happens here instead.

Table definitions are read back out of schema.sql rather than repeated, so the
rebuilt table cannot drift from the one a fresh database gets.
"""

DEFAULT_STORE_ID = 1
DEFAULT_STORE_CODE = 'baannoi'
DEFAULT_STORE_NAME = 'Baannoi'

# Every one of these is recreated rather than altered. Four of them need it
# because a UNIQUE constraint or primary key changed, which SQLite can only
# express by rebuilding. The other two could have taken an ALTER, except that
# SQLite refuses to ADD COLUMN when the column both REFERENCES another table and
# carries a non-NULL default -- and rebuilding them anyway keeps a migrated
# database byte-for-byte identical in shape to a freshly created one.
REBUILD_TABLES = ('products', 'orders', 'stock_movements', 'stock_plans',
                  'daily_closures', 'cash_days')

# Kept here rather than in schema.sql: that file runs as a single script, and on
# a database that has not been migrated yet these statements would reference a
# column that does not exist, aborting every statement in the file.
STORE_INDEXES = (
    'CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id)',
    'CREATE INDEX IF NOT EXISTS idx_orders_store_date ON orders(store_id, order_date)',
    'CREATE INDEX IF NOT EXISTS idx_stock_movements_store ON stock_movements(store_id, created_at)',
)


def _columns(connection, table):
    return [row[1] for row in connection.execute('PRAGMA table_info({})'.format(table))]


def _table_exists(connection, table):
    found = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone()
    return found is not None


def _create_statement(schema_sql, table):
    """Lift one CREATE TABLE statement out of schema.sql."""
    marker = 'CREATE TABLE IF NOT EXISTS {} ('.format(table)
    start = schema_sql.index(marker)
    end = schema_sql.index('\n);', start) + len('\n);')
    return schema_sql[start:end]


def _index_statements(schema_sql):
    return [line for line in schema_sql.splitlines() if line.startswith('CREATE INDEX')]


def _ensure_default_store(connection):
    connection.execute(
        'INSERT INTO stores (id, code, name) SELECT ?, ?, ? '
        'WHERE NOT EXISTS (SELECT 1 FROM stores WHERE id = ?)',
        (DEFAULT_STORE_ID, DEFAULT_STORE_CODE, DEFAULT_STORE_NAME, DEFAULT_STORE_ID),
    )


# The rules the application used to hold as constants. The first store inherits
# them so its pricing is unchanged; any store added later starts with none.
PRICING_COLUMNS = (
    ('bundle_unit_price', 'REAL'),
    ('bundle_quantity', 'INTEGER'),
    ('bundle_price', 'REAL'),
    ('wholesale_category', 'TEXT'),
    ('wholesale_discount', 'REAL'),
    # Optional, and nullable: a store without one shows its initials instead.
    ('logo_url', 'TEXT'),
)
DEFAULT_STORE_PRICING = (69, 3, 200, 'Tiramisu', 9)


def _ensure_pricing_columns(connection):
    existing = _columns(connection, 'stores')
    for name, kind in PRICING_COLUMNS:
        if name not in existing:
            connection.execute('ALTER TABLE stores ADD COLUMN {} {}'.format(name, kind))
    connection.execute(
        'UPDATE stores SET bundle_unit_price=?, bundle_quantity=?, bundle_price=?,'
        ' wholesale_category=?, wholesale_discount=? '
        'WHERE id=? AND bundle_unit_price IS NULL AND wholesale_category IS NULL',
        DEFAULT_STORE_PRICING + (DEFAULT_STORE_ID,),
    )


def _ensure_store_indexes(connection):
    for statement in STORE_INDEXES:
        connection.execute(statement)


def _rebuild(connection, schema_sql, table):
    """Recreate one table with the current definition, carrying its rows across.

    Rows keep every value they had; store_id is the only new column and takes
    its default, which is what puts existing data in the first store.
    """
    carried = ', '.join(_columns(connection, table))
    statement = _create_statement(schema_sql, table).replace(
        'CREATE TABLE IF NOT EXISTS {} ('.format(table),
        'CREATE TABLE {}__migrating ('.format(table),
        1,
    )
    connection.execute(statement)
    connection.execute(
        'INSERT INTO {target} ({columns}) SELECT {columns} FROM {source}'.format(
            target='{}__migrating'.format(table), columns=carried, source=table)
    )
    connection.execute('DROP TABLE {}'.format(table))
    connection.execute('ALTER TABLE {}__migrating RENAME TO {}'.format(table, table))


def apply_store_migration(connection, schema_sql):
    """Add the store dimension to a database created before it existed.

    Safe to run on every start: each step checks whether it already happened, so
    an up-to-date database is left completely alone.
    """
    if not _table_exists(connection, 'stores'):
        return
    _ensure_default_store(connection)
    _ensure_pricing_columns(connection)

    outstanding = [table for table in REBUILD_TABLES
                   if _table_exists(connection, table) and 'store_id' not in _columns(connection, table)]

    if not outstanding:
        _ensure_store_indexes(connection)
        return

    # Settle the implicit transaction the store insert opened: PRAGMA
    # foreign_keys is silently ignored inside one, and BEGIN cannot nest.
    connection.commit()

    # Foreign keys have to be off while a parent table is dropped and recreated,
    # and legacy_alter_table keeps the rename from rewriting the FK clauses that
    # other tables use to point here.
    connection.execute('PRAGMA foreign_keys = OFF')
    connection.execute('PRAGMA legacy_alter_table = ON')
    try:
        connection.execute('BEGIN')
        for table in outstanding:
            _rebuild(connection, schema_sql, table)
        for statement in _index_statements(schema_sql):
            connection.execute(statement)
        connection.execute('COMMIT')
    except Exception:
        connection.execute('ROLLBACK')
        raise
    finally:
        connection.execute('PRAGMA legacy_alter_table = OFF')
        connection.execute('PRAGMA foreign_keys = ON')

    broken = connection.execute('PRAGMA foreign_key_check').fetchall()
    if broken:
        raise RuntimeError(
            'Store migration left {} dangling foreign key reference(s)'.format(len(broken))
        )

    _ensure_store_indexes(connection)
