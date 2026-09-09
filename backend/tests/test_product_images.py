"""A menu's picture: storing it, serving it, and keeping it inside its shop.

The bytes live in their own table, so these cases work through the API rather
than the schema -- what matters is that a picture uploaded for one menu comes
back for that menu, under an address that changes when the picture does, and
never for a shop that does not own it.
"""

import base64
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
import server  # noqa: E402


PNG_BYTES = base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
)


def data_uri(blob, content_type='image/png'):
    return 'data:{};base64,{}'.format(content_type, base64.b64encode(blob).decode('ascii'))


class ProductImageTests(unittest.TestCase):
    def setUp(self):
        handle = tempfile.NamedTemporaryFile(suffix='.sqlite', delete=False)
        handle.close()
        self.db_path = Path(handle.name)
        self.original_sqlite_path = database.SQLITE_PATH
        database.SQLITE_PATH = self.db_path
        database.init_schema()
        self.seed()
        self.client = server.app.test_client()
        self.client.post('/api/auth/login', json={'pin': '2468'})

    def tearDown(self):
        database.SQLITE_PATH = self.original_sqlite_path
        self.db_path.unlink(missing_ok=True)

    def seed(self):
        connection = database.connect_db()
        try:
            connection.execute("INSERT INTO stores (id, code, name) VALUES (2, 'pasta', 'Pasta')")
            connection.execute("INSERT INTO products (store_id, sku, name, category, unit_price, cost_price, stock_qty)"
                               " VALUES (1, 'A01', 'Teramisu OG', 'Tiramisu', 69, 20, 10)")
            connection.execute("INSERT INTO products (store_id, sku, name, category, unit_price, cost_price, stock_qty)"
                               " VALUES (2, 'B01', 'Carbonara', 'Pasta', 180, 60, 10)")
            connection.commit()
        finally:
            connection.close()

    def use(self, store_id):
        self.assertEqual(200, self.client.post('/api/auth/select-store', json={'storeId': store_id}).status_code)

    def product_id(self, store_id, sku):
        connection = database.connect_db()
        try:
            return connection.execute('SELECT id FROM products WHERE store_id=? AND sku=?',
                                      (store_id, sku)).fetchone()[0]
        finally:
            connection.close()

    def listed(self, sku):
        for entry in self.client.get('/api/products').get_json():
            if entry['code'] == sku:
                return entry
        raise AssertionError('{} missing from the catalogue'.format(sku))

    def upload(self, product_id, blob=PNG_BYTES, content_type='image/png'):
        return self.client.put('/api/products/{}/image'.format(product_id),
                               json={'image': data_uri(blob, content_type)})

    # -- the ordinary path ------------------------------------------------

    def test_menu_without_a_picture_says_so(self):
        self.use(1)
        self.assertIsNone(self.listed('A01')['imageUrl'])
        self.assertEqual(404, self.client.get(
            '/api/products/{}/image'.format(self.product_id(1, 'A01'))).status_code)

    def test_uploaded_picture_comes_back_byte_for_byte(self):
        self.use(1)
        product = self.product_id(1, 'A01')
        self.assertEqual(200, self.upload(product).status_code)

        served = self.client.get('/api/products/{}/image'.format(product))
        self.assertEqual(200, served.status_code)
        self.assertEqual(PNG_BYTES, served.data)
        self.assertEqual('image/png', served.mimetype)

    def test_catalogue_points_at_the_picture(self):
        self.use(1)
        product = self.product_id(1, 'A01')
        posted = self.upload(product).get_json()

        self.assertEqual(posted['imageUrl'], self.listed('A01')['imageUrl'])
        self.assertTrue(self.listed('A01')['imageUrl'].startswith(
            '/api/products/{}/image?v='.format(product)))

    def test_the_catalogue_never_carries_the_bytes(self):
        # The sell screen reads this on every visit and the offline snapshot
        # keeps a copy, so the picture has to stay behind its own address.
        self.use(1)
        self.upload(self.product_id(1, 'A01'))
        self.assertNotIn('base64', self.client.get('/api/products').get_data(as_text=True))

    # -- caching ----------------------------------------------------------

    def test_unchanged_picture_is_not_sent_twice(self):
        self.use(1)
        product = self.product_id(1, 'A01')
        self.upload(product)

        first = self.client.get('/api/products/{}/image'.format(product))
        again = self.client.get('/api/products/{}/image'.format(product),
                                headers={'If-None-Match': first.headers['ETag']})
        self.assertEqual(304, again.status_code)
        self.assertEqual(b'', again.data)

    def test_replacing_the_picture_changes_its_address(self):
        self.use(1)
        product = self.product_id(1, 'A01')
        first = self.upload(product).get_json()['imageUrl']
        second = self.upload(product, PNG_BYTES + b'\x00').get_json()['imageUrl']

        self.assertNotEqual(first, second)
        self.assertEqual(second, self.listed('A01')['imageUrl'])

    def test_one_menu_keeps_one_picture(self):
        self.use(1)
        product = self.product_id(1, 'A01')
        self.upload(product)
        self.upload(product, PNG_BYTES + b'\x00')

        connection = database.connect_db()
        try:
            held = connection.execute('SELECT COUNT(*) FROM product_images WHERE product_id=?',
                                      (product,)).fetchone()[0]
        finally:
            connection.close()
        self.assertEqual(1, held)

    # -- what is refused --------------------------------------------------

    def test_unsupported_file_type_is_refused(self):
        self.use(1)
        response = self.upload(self.product_id(1, 'A01'), b'GIF89a', 'image/gif')
        self.assertEqual(400, response.status_code)
        self.assertIn('WebP', response.get_json()['error'])

    def test_camera_sized_original_is_refused(self):
        self.use(1)
        oversized = b'\x89PNG' + b'\x00' * (server.PRODUCT_IMAGE_MAX_BYTES + 1)
        response = self.upload(self.product_id(1, 'A01'), oversized)
        self.assertEqual(400, response.status_code)

    def test_malformed_payload_is_refused(self):
        self.use(1)
        product = self.product_id(1, 'A01')
        for payload in ({}, {'image': ''}, {'image': 'not-a-data-uri'},
                        {'image': 'data:image/png,unencoded'}):
            with self.subTest(payload=payload):
                response = self.client.put('/api/products/{}/image'.format(product), json=payload)
                self.assertEqual(400, response.status_code)

    def test_a_picture_for_a_menu_that_is_not_there(self):
        self.use(1)
        self.assertEqual(404, self.upload(9999).status_code)

    # -- removal ----------------------------------------------------------

    def test_deleting_the_picture_leaves_the_menu(self):
        self.use(1)
        product = self.product_id(1, 'A01')
        self.upload(product)

        self.assertEqual(200, self.client.delete('/api/products/{}/image'.format(product)).status_code)
        self.assertEqual(404, self.client.get('/api/products/{}/image'.format(product)).status_code)
        self.assertIsNone(self.listed('A01')['imageUrl'])

    def test_deleting_the_menu_takes_its_picture_with_it(self):
        self.use(1)
        product = self.product_id(1, 'A01')
        self.upload(product)
        self.assertEqual(200, self.client.delete('/api/products/{}'.format(product)).status_code)

        connection = database.connect_db()
        try:
            left = connection.execute('SELECT COUNT(*) FROM product_images WHERE product_id=?',
                                      (product,)).fetchone()[0]
        finally:
            connection.close()
        self.assertEqual(0, left)

    # -- the boundary between shops ---------------------------------------

    def test_a_shop_cannot_read_another_shops_picture(self):
        self.use(1)
        product = self.product_id(1, 'A01')
        self.upload(product)

        self.use(2)
        self.assertEqual(404, self.client.get('/api/products/{}/image'.format(product)).status_code)

    def test_a_shop_cannot_write_over_another_shops_picture(self):
        self.use(1)
        product = self.product_id(1, 'A01')
        self.upload(product)
        original = self.listed('A01')['imageUrl']

        self.use(2)
        self.assertEqual(404, self.upload(product, PNG_BYTES + b'\x00').status_code)

        self.use(1)
        self.assertEqual(original, self.listed('A01')['imageUrl'])

    def test_a_shop_cannot_delete_another_shops_picture(self):
        self.use(1)
        product = self.product_id(1, 'A01')
        self.upload(product)

        self.use(2)
        self.assertEqual(404, self.client.delete('/api/products/{}/image'.format(product)).status_code)

        self.use(1)
        self.assertEqual(200, self.client.get('/api/products/{}/image'.format(product)).status_code)

    def test_signing_out_closes_the_picture(self):
        self.use(1)
        product = self.product_id(1, 'A01')
        self.upload(product)
        self.client.post('/api/auth/logout')
        self.assertEqual(401, self.client.get('/api/products/{}/image'.format(product)).status_code)


if __name__ == '__main__':
    unittest.main()
