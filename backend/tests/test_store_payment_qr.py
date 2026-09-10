"""A shop's own payment QR: storing it, serving it, and never crossing shops.

The picture is how a shop gets paid, so the cases that matter most here are the
ones about substitution: a shop must never be served another shop's QR, and a
shop that has its own must never quietly fall back to the shared PromptPay id.
Money that lands in the wrong account is invisible at the counter and only
surfaces when the day is reconciled.
"""

import base64
import os
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault('POS_PIN', '2468')
os.environ.setdefault('SECRET_KEY', 'test-only-secret-key')
os.environ.setdefault('PROMPTPAY_ID', '0801234567')
_import_db = tempfile.NamedTemporaryFile(suffix='.sqlite', delete=False)
_import_db.close()
os.environ.setdefault('SQLITE_PATH', _import_db.name)

import database  # noqa: E402
import server  # noqa: E402

PNG_BYTES = base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
)
OTHER_PNG_BYTES = base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
)


def data_uri(blob, content_type='image/png'):
    return 'data:{};base64,{}'.format(content_type, base64.b64encode(blob).decode('ascii'))


class StorePaymentQrTests(unittest.TestCase):
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
            connection.commit()
        finally:
            connection.close()

    def use(self, store_id):
        self.assertEqual(200, self.client.post('/api/auth/select-store', json={'storeId': store_id}).status_code)

    def upload(self, blob=PNG_BYTES, content_type='image/png'):
        return self.client.put('/api/store/payment-qr', json={'image': data_uri(blob, content_type)})

    def config(self):
        return self.client.get('/api/offline-payment-config').get_json()

    def test_requires_login(self):
        anonymous = server.app.test_client()
        self.assertEqual(401, anonymous.get('/api/store/payment-qr').status_code)
        self.assertEqual(401, anonymous.put('/api/store/payment-qr', json={'image': data_uri(PNG_BYTES)}).status_code)
        self.assertEqual(401, anonymous.delete('/api/store/payment-qr').status_code)

    def test_a_shop_without_one_is_paid_through_the_shared_promptpay_id(self):
        self.use(1)
        self.assertEqual(404, self.client.get('/api/store/payment-qr').status_code)
        self.assertEqual('promptpay', self.config()['mode'])
        generated = self.client.get('/api/payment-qr?amount=69.00')
        self.assertEqual(200, generated.status_code)
        self.assertEqual('image/png', generated.content_type)

    def test_stores_and_serves_the_picture_under_an_address_naming_its_bytes(self):
        self.use(1)
        created = self.upload()
        self.assertEqual(200, created.status_code)
        image_url = created.get_json()['imageUrl']
        self.assertIn('/api/store/payment-qr?v=', image_url)
        self.assertEqual(len(PNG_BYTES), created.get_json()['byteSize'])

        served = self.client.get('/api/store/payment-qr')
        self.assertEqual(200, served.status_code)
        self.assertEqual(PNG_BYTES, served.data)
        self.assertEqual('image/png', served.content_type)
        self.assertEqual('private, max-age=31536000, immutable', served.headers['Cache-Control'])
        self.assertIn(image_url.split('v=')[1], served.headers['ETag'])

    def test_an_unchanged_picture_is_never_sent_twice(self):
        self.use(1)
        self.upload()
        tag = self.client.get('/api/store/payment-qr').headers['ETag']
        again = self.client.get('/api/store/payment-qr', headers={'If-None-Match': tag})
        self.assertEqual(304, again.status_code)
        self.assertEqual(b'', again.data)

    def test_a_replaced_picture_arrives_at_a_new_address(self):
        self.use(1)
        first = self.upload().get_json()['imageUrl']
        second = self.upload(OTHER_PNG_BYTES).get_json()['imageUrl']
        self.assertNotEqual(first, second)
        self.assertEqual(OTHER_PNG_BYTES, self.client.get('/api/store/payment-qr').data)

    def test_the_config_reports_the_picture_instead_of_the_promptpay_receiver(self):
        self.use(1)
        image_url = self.upload().get_json()['imageUrl']
        config = self.config()
        self.assertEqual('image', config['mode'])
        self.assertTrue(config['configured'])
        self.assertEqual(image_url, config['imageUrl'])
        # The till builds no payload of its own in this mode, so it is not given one.
        self.assertNotIn('merchantAccountInfo', config)

    def test_a_shop_with_its_own_qr_is_never_served_the_shared_one(self):
        self.use(1)
        self.upload()
        served = self.client.get('/api/payment-qr?amount=69.00')
        self.assertEqual(200, served.status_code)
        # Its own picture, not a code generated from the shared PromptPay id.
        self.assertEqual(PNG_BYTES, served.data)
        self.assertEqual('manual', served.headers['X-Payment-QR-Amount'])

    def test_says_when_the_amount_is_inside_the_code_and_when_it_is_not(self):
        self.use(1)
        generated = self.client.get('/api/payment-qr?amount=69.00')
        self.assertEqual('embedded', generated.headers['X-Payment-QR-Amount'])
        self.upload()
        self.assertEqual('manual', self.client.get('/api/payment-qr?amount=69.00').headers['X-Payment-QR-Amount'])

    def test_one_shops_qr_never_reaches_another(self):
        self.use(2)
        self.upload(OTHER_PNG_BYTES)
        self.use(1)
        # Store 1 has none of its own, and store 2's must not stand in for it.
        self.assertEqual(404, self.client.get('/api/store/payment-qr').status_code)
        self.assertEqual('promptpay', self.config()['mode'])
        self.upload(PNG_BYTES)
        self.assertEqual(PNG_BYTES, self.client.get('/api/store/payment-qr').data)
        self.use(2)
        self.assertEqual(OTHER_PNG_BYTES, self.client.get('/api/store/payment-qr').data)

    def test_deleting_it_hands_the_shop_back_to_the_shared_promptpay_id(self):
        self.use(1)
        self.upload()
        removed = self.client.delete('/api/store/payment-qr')
        self.assertEqual(200, removed.status_code)
        self.assertIsNone(removed.get_json()['imageUrl'])
        self.assertEqual(404, self.client.get('/api/store/payment-qr').status_code)
        self.assertEqual('promptpay', self.config()['mode'])
        self.assertEqual(200, self.client.get('/api/payment-qr?amount=69.00').status_code)

    def test_deleting_one_shops_qr_leaves_anothers_alone(self):
        self.use(2)
        self.upload(OTHER_PNG_BYTES)
        self.use(1)
        self.client.delete('/api/store/payment-qr')
        self.use(2)
        self.assertEqual(OTHER_PNG_BYTES, self.client.get('/api/store/payment-qr').data)

    def test_rejects_what_is_not_a_picture_it_can_serve(self):
        self.use(1)
        gif = 'data:image/gif;base64,' + base64.b64encode(PNG_BYTES).decode('ascii')
        for payload in (None, '', 'not-a-data-uri', gif):
            response = self.client.put('/api/store/payment-qr', json={'image': payload})
            self.assertEqual(400, response.status_code, payload)
        self.assertEqual(404, self.client.get('/api/store/payment-qr').status_code)

    def test_rejects_a_picture_past_the_ceiling(self):
        self.use(1)
        oversized = b'\x89PNG\r\n\x1a\n' + b'\x00' * server.PAYMENT_QR_MAX_BYTES
        response = self.client.put('/api/store/payment-qr', json={'image': data_uri(oversized)})
        self.assertEqual(400, response.status_code)

    def test_the_ceiling_leaves_more_room_than_a_menu_picture(self):
        # A QR has to survive being scanned; a menu picture only has to look right.
        self.assertGreater(server.PAYMENT_QR_MAX_BYTES, server.PRODUCT_IMAGE_MAX_BYTES)


if __name__ == '__main__':
    unittest.main()
