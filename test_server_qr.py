import os
import tempfile
import unittest


_db_file = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
_db_file.close()
os.environ["SQLITE_PATH"] = _db_file.name
os.environ["POS_PIN"] = "2468"
os.environ["SECRET_KEY"] = "test-only-secret-key"
os.environ["PROMPTPAY_ID"] = "0801234567"

from server import app  # noqa: E402


class PaymentQrEndpointTests(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        try:
            os.unlink(_db_file.name)
        except FileNotFoundError:
            pass

    def setUp(self):
        self.client = app.test_client()

    def login(self):
        response = self.client.post("/api/auth/login", json={"pin": "2468"})
        self.assertEqual(response.status_code, 200)

    def test_requires_login(self):
        response = self.client.get("/api/payment-qr?amount=69.00")
        self.assertEqual(response.status_code, 401)

    def test_returns_dynamic_png(self):
        self.login()
        first = self.client.get("/api/payment-qr?amount=69.00")
        second = self.client.get("/api/payment-qr?amount=138.00")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.content_type, "image/png")
        self.assertTrue(first.data.startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertEqual(first.headers["Cache-Control"], "private, no-store")
        self.assertNotEqual(first.data, second.data)

    def test_rejects_missing_or_invalid_amount(self):
        self.login()
        for url in ("/api/payment-qr", "/api/payment-qr?amount=0"):
            response = self.client.get(url)
            self.assertEqual(response.status_code, 400)

    def test_reports_missing_configuration(self):
        self.login()
        original = os.environ.pop("PROMPTPAY_ID")
        try:
            response = self.client.get("/api/payment-qr?amount=69.00")
            self.assertEqual(response.status_code, 503)
        finally:
            os.environ["PROMPTPAY_ID"] = original


if __name__ == "__main__":
    unittest.main()
