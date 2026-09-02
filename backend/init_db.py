from database import SQLITE_PATH, execute, init_schema, is_postgres, transaction

# Imported from Menu Master sheet: code, name, category, selling price, COGS/piece,
# stock_qty (units per recipe batch), stock_min, is_active (1=เปิดขาย, 0=พักขาย)
products = [
    ("M001", "", "Teramisu OG", "Tiramisu", 69.00, 19.12, 7, 2, 1, ""),
    ("M002", "", "Blueberry Tiramisu", "Tiramisu", 69.00, 27.17, 16, 2, 1, ""),
    ("M003", "", "Strawberry Tiramisu", "Tiramisu", 69.00, 22.45, 16, 2, 1, ""),
    ("M004", "", "Shine Muscat Tiramisu", "Tiramisu", 69.00, 29.27, 7, 2, 1, ""),
    ("M005", "", "Oreo Chocolate Cream", "Tiramisu", 69.00, 25.02, 16, 2, 1, ""),
    ("M006", "", "Thai Tea Cheese Tiramisu", "Tiramisu", 69.00, 19.32, 16, 2, 1, ""),
    ("M007", "", "Biscoff Banana", "Tiramisu", 99.00, 34.43, 16, 2, 1, ""),
    ("M008", "", "Peach + ลูกชิด", "Tiramisu", 69.00, 14.97, 16, 2, 0, "พักขาย"),
    ("M009", "", "Orange Tiramisu", "Tiramisu", 69.00, 23.81, 16, 2, 0, "พักขาย"),
    ("M010", "", "Banoffee Pie", "อื่นๆ", 69.00, 22.73, 10, 2, 1, ""),
    ("M011", "", "Caramel Custard", "อื่นๆ", 45.00, 15.54, 6, 2, 1, ""),
    ("M012", "", "London Cake", "อื่นๆ", 120.00, 28.90, 10, 2, 0, "พักขาย"),
    ("M013", "", "Green Tea Tiramisu", "Tiramisu", 69.00, 19.47, 7, 2, 1, ""),
    ("M014", "", "Burnt Cheesecake", "Cheesecake", 60.00, 15.94, 12, 2, 1, ""),
    ("M015", "", "Blueberry Burnt Cheesecake", "Cheesecake", 69.00, 21.00, 12, 2, 1, ""),
    ("M016", "", "Nama Doughnut Plain", "Doughnut", 35.00, 6.16, 15, 3, 1, ""),
    ("M017", "", "Thai Tea Doughnut", "Doughnut", 55.00, 16.39, 15, 3, 1, ""),
    ("M018", "", "Lemon Meringue Doughnut", "Doughnut", 55.00, 20.02, 15, 3, 1, ""),
]

customers = [
    ("CUST-0001", "Walk-in Customer", "", "", "walkin", 1),
    ("CUST-0002", "สมาชิกทอง", "081-123-4567", "member@example.com", "member", 1),
    ("CUST-0003", "ร้านอาหารต้นกล้า", "083-888-1234", "store@example.com", "store", 1),
]

init_schema()
with transaction() as (_, cursor):
 for sku, barcode, name, category, price, cost, stock, stock_min, active, image_url in products:
    execute(
        cursor,
        """
        INSERT INTO products (sku, barcode, name, category, unit_price, cost_price, stock_qty, stock_min, is_active, image_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(sku) DO UPDATE SET
            barcode = excluded.barcode,
            name = excluded.name,
            category = excluded.category,
            unit_price = excluded.unit_price,
            cost_price = excluded.cost_price,
            stock_min = excluded.stock_min,
            is_active = excluded.is_active,
            image_url = excluded.image_url,
            updated_at = datetime('now')
        """,
        (sku, barcode, name, category, price, cost, stock, stock_min, active, image_url)
    )

 for customer_code, full_name, phone, email, customer_type, active in customers:
    execute(
        cursor,
        """
        INSERT INTO customers (customer_code, full_name, phone, email, customer_type, is_active)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(customer_code) DO UPDATE SET
            full_name = excluded.full_name,
            phone = excluded.phone,
            email = excluded.email,
            customer_type = excluded.customer_type,
            is_active = excluded.is_active
        """,
        (customer_code, full_name, phone, email, customer_type, active)
    )

print('Database initialized: {}'.format('PostgreSQL' if is_postgres() else SQLITE_PATH))
print("Menu products and customers initialized (no demo orders).")
