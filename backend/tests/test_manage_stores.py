"""The store tool changes real shops, so its edges are pinned down here."""

import contextlib
import io
import os
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault('POS_PIN', '2468')
os.environ.setdefault('SECRET_KEY', 'test-only-secret-key')
_import_db = tempfile.NamedTemporaryFile(suffix='.sqlite', delete=False)
_import_db.close()
os.environ.setdefault('SQLITE_PATH', _import_db.name)

import database  # noqa: E402
import manage_stores  # noqa: E402


class ManageStoresTests(unittest.TestCase):
    def setUp(self):
        handle = tempfile.NamedTemporaryFile(suffix='.sqlite', delete=False)
        handle.close()
        self.db_path = Path(handle.name)
        self.original_sqlite_path = database.SQLITE_PATH
        database.SQLITE_PATH = self.db_path
        database.init_schema()

    def tearDown(self):
        database.SQLITE_PATH = self.original_sqlite_path
        self.db_path.unlink(missing_ok=True)

    def run_tool(self, *argv):
        """Run a command without its report landing in the test output."""
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return manage_stores.main(list(argv))

    def stores(self):
        connection = database.connect_db()
        try:
            return connection.execute(
                'SELECT id, code, name, is_active, bundle_unit_price, bundle_quantity,'
                ' bundle_price, wholesale_category, wholesale_discount FROM stores ORDER BY id'
            ).fetchall()
        finally:
            connection.close()

    def test_rename_keeps_the_store_and_its_pricing(self):
        self.assertEqual(0, self.run_tool('rename', '1', 'พร้อมตัก', '--code', 'promtak'))
        store = self.stores()[0]
        self.assertEqual(('promtak', 'พร้อมตัก'), (store['code'], store['name']))
        # Renaming a shop does not reprice it.
        self.assertEqual(69, store['bundle_unit_price'])
        self.assertEqual('Tiramisu', store['wholesale_category'])

    def test_renaming_an_unknown_store_changes_nothing(self):
        self.assertEqual(1, self.run_tool('rename', '99', 'Ghost'))
        self.assertEqual(1, len(self.stores()))

    def test_a_new_store_starts_with_no_automatic_discount(self):
        self.assertEqual(0, self.run_tool('add', 'promtom', 'พร้อมต้ม'))
        added = self.stores()[1]
        self.assertEqual(('promtom', 'พร้อมต้ม'), (added['code'], added['name']))
        self.assertIsNone(added['bundle_unit_price'])
        self.assertIsNone(added['wholesale_category'])
        # It must not have picked up the dessert shop's promotions.
        self.assertEqual(69, self.stores()[0]['bundle_unit_price'])

    def test_a_duplicate_code_is_refused(self):
        self.assertEqual(0, self.run_tool('add', 'promtom', 'พร้อมต้ม'))
        self.assertEqual(1, self.run_tool('add', 'promtom', 'Another'))
        self.assertEqual(2, len(self.stores()))

    def test_pricing_can_be_set_and_cleared(self):
        self.run_tool('add', 'promtom', 'พร้อมต้ม')
        self.assertEqual(0, self.run_tool('pricing', '2', '--bundle', '120:3:330'))
        added = self.stores()[1]
        self.assertEqual((120, 3, 330), (added['bundle_unit_price'], added['bundle_quantity'], added['bundle_price']))

        self.assertEqual(0, self.run_tool('pricing', '2', '--clear'))
        self.assertIsNone(self.stores()[1]['bundle_unit_price'])

    def test_pricing_without_a_change_is_rejected(self):
        self.assertEqual(1, self.run_tool('pricing', '1'))
        self.assertEqual(69, self.stores()[0]['bundle_unit_price'])

    def test_listing_reports_how_many_shops_are_open(self):
        self.assertEqual(0, self.run_tool('list'))
        self.run_tool('add', 'promtom', 'พร้อมต้ม')
        self.assertEqual(0, self.run_tool('list'))


if __name__ == '__main__':
    unittest.main()
