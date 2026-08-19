from datetime import timedelta

from test_business_characterization import PosApiTestCase
import server


class ProductEligibilityTests(PosApiTestCase):
    def test_inactive_product_can_be_planned_and_due_plan_preserves_inactive_flag(self):
        product_id = self.add_product(sku="INACTIVE-PLAN", stock=0, active=0)
        today = server.bangkok_today().isoformat()

        created = self.client.post(
            "/api/stock/plans",
            json={"productId": product_id, "date": today, "quantity": 10},
        )

        self.assertEqual(created.status_code, 200)
        product = self.one("SELECT stock_qty,is_active FROM products WHERE id=?", (product_id,))
        self.assertEqual(tuple(product), (10, 0))

    def test_future_plan_for_inactive_product_is_accepted(self):
        product_id = self.add_product(sku="INACTIVE-FUTURE", stock=0, active=0)
        plan_date = (server.bangkok_today() + timedelta(days=2)).isoformat()

        response = self.client.post(
            "/api/stock/plans",
            json={"productId": product_id, "date": plan_date, "quantity": 4},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.one("SELECT status FROM stock_plans")[0], "pending")

    def test_catalog_includes_active_zero_stock_and_inactive_stock_only(self):
        active_zero = self.add_product(sku="ACTIVE-ZERO", stock=0, active=1)
        inactive_stock = self.add_product(sku="INACTIVE-STOCK", stock=3, active=0)
        self.add_product(sku="INACTIVE-ZERO", stock=0, active=0)

        catalog = self.client.get("/api/products").get_json()
        by_id = {product["id"]: product for product in catalog}

        self.assertIn(active_zero, by_id)
        self.assertIn(inactive_stock, by_id)
        self.assertFalse(by_id[inactive_stock]["active"])
        self.assertNotIn("INACTIVE-ZERO", {product["code"] for product in catalog})

    def test_categories_use_sell_catalog_eligibility(self):
        self.execute("DELETE FROM products")
        self.execute("INSERT INTO products (sku,name,category,unit_price,stock_qty,stock_min,is_active) VALUES ('S','Stocked','Stocked Category',10,1,0,0)")
        self.execute("INSERT INTO products (sku,name,category,unit_price,stock_qty,stock_min,is_active) VALUES ('H','Hidden','Hidden Category',10,0,0,0)")

        categories = self.client.get("/api/products/categories").get_json()["categories"]

        self.assertIn("Stocked Category", categories)
        self.assertNotIn("Hidden Category", categories)

    def test_inactive_stocked_product_can_be_sold_until_stock_is_zero(self):
        product_id = self.add_product(sku="INACTIVE-SALE", price=80, stock=2, active=0)

        response = self.create_order([{"productId": product_id, "qty": 2}], key="inactive-sale")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["subtotal"], 160)
        self.assertEqual(tuple(self.one("SELECT stock_qty,is_active FROM products WHERE id=?", (product_id,))), (0, 0))
        self.assertNotIn(product_id, {product["id"] for product in self.client.get("/api/products").get_json()})

    def test_inactive_zero_stock_product_cannot_be_sold(self):
        product_id = self.add_product(sku="INACTIVE-EMPTY", stock=0, active=0)

        response = self.create_order([{"productId": product_id, "qty": 1}], key="inactive-empty")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.one("SELECT COUNT(*) FROM orders")[0], 0)
