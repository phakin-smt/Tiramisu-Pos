import atexit
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


_import_db_file = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
_import_db_file.close()
os.environ.pop("DATABASE_URL", None)
os.environ["SQLITE_PATH"] = _import_db_file.name
os.environ.setdefault("POS_PIN", "2468")
os.environ.setdefault("SECRET_KEY", "test-only-secret-key")


def _remove_import_database():
    try:
        os.unlink(_import_db_file.name)
    except FileNotFoundError:
        pass


atexit.register(_remove_import_database)

import server


class ReactStagingRouteTests(unittest.TestCase):
    def setUp(self):
        self.build_directory = tempfile.TemporaryDirectory()
        self.react_root = Path(self.build_directory.name)
        assets = self.react_root / "assets"
        assets.mkdir()
        (self.react_root / "index.html").write_text(
            '<!doctype html><div id="react-staging">React staging</div>',
            encoding="utf-8",
        )
        (assets / "index-ABC123.js").write_text(
            'document.querySelector("#react-staging");',
            encoding="utf-8",
        )
        self.react_root_patch = patch.object(server, "REACT_ROOT", self.react_root)
        self.react_root_patch.start()
        self.client = server.app.test_client()

    def tearDown(self):
        self.react_root_patch.stop()
        self.build_directory.cleanup()

    def test_legacy_root_and_static_files_remain_unchanged(self):
        root = self.client.get("/")
        app_script = self.client.get("/app.js")
        stylesheet = self.client.get("/styles.css")
        try:
            self.assertEqual(root.status_code, 200)
            self.assertEqual(root.data, (server.PUBLIC_ROOT / "index.html").read_bytes())
            self.assertEqual(app_script.data, (server.PUBLIC_ROOT / "app.js").read_bytes())
            self.assertEqual(stylesheet.data, (server.PUBLIC_ROOT / "styles.css").read_bytes())
        finally:
            root.close()
            app_script.close()
            stylesheet.close()

    def test_next_root_and_deep_links_serve_the_uncached_spa_entry(self):
        redirect_response = self.client.get("/next")
        self.assertEqual(redirect_response.status_code, 308)
        self.assertEqual(redirect_response.headers["Location"], "/next/")

        for route in ("", "sell", "stock", "orders", "reports", "analytics", "settings"):
            with self.subTest(route=route):
                response = self.client.get(f"/next/{route}")
                self.assertEqual(response.status_code, 200)
                self.assertIn(b"react-staging", response.data)
                self.assertEqual(response.headers["Cache-Control"], "no-cache")
                response.close()

    def test_api_routes_are_not_swallowed_by_the_spa_fallback(self):
        health = self.client.get("/api/health")
        self.assertEqual(health.status_code, 200)
        self.assertTrue(health.is_json)
        self.assertNotIn(b"react-staging", health.data)

        self.client.post("/api/auth/login", json={"pin": "2468"})
        missing = self.client.get("/api/not-a-route")
        self.assertEqual(missing.status_code, 404)
        self.assertTrue(missing.is_json)
        self.assertNotIn(b"react-staging", missing.data)

    def test_vite_assets_are_limited_to_the_asset_directory_and_immutable(self):
        asset = self.client.get("/next/assets/index-ABC123.js")
        try:
            self.assertEqual(asset.status_code, 200)
            self.assertIn("javascript", asset.content_type)
            self.assertEqual(
                asset.headers["Cache-Control"],
                "public, max-age=31536000, immutable",
            )
        finally:
            asset.close()

        self.assertEqual(self.client.get("/next/assets/missing.js").status_code, 404)
        traversal = self.client.get("/next/assets/%2e%2e/%2e%2e/server.py")
        self.assertEqual(traversal.status_code, 404)
        self.assertNotIn(b"from flask import", traversal.data)

        fallback = self.client.get("/next/server.py")
        try:
            self.assertEqual(fallback.status_code, 200)
            self.assertIn(b"react-staging", fallback.data)
            self.assertNotIn(b"from flask import", fallback.data)
        finally:
            fallback.close()


if __name__ == "__main__":
    unittest.main()
