import unittest
from import_otop_csv import rows_to_sql


class OtopCsvTests(unittest.TestCase):
    def test_thai_headers_coordinates_and_geocoding(self):
        rows = [
            {"ชื่อกลุ่ม": "กลุ่มทอผ้าครามบ้านดอนกอย", "ผลิตภัณฑ์": "ผ้าคราม", "ระดับดาว": "5", "ละติจูด": "17.25", "ลองจิจูด": "104.05"},
            {"name": "O'Kram Shop", "address": "Mueang", "stars": "★3", "community": "yes"},
            {"name": "Nowhere", "address": "?"},
            {"name": ""},
        ]
        values, missing = rows_to_sql(rows, "Sakon Nakhon", locate=lambda q: (17.16, 104.15) if "Mueang" in q else None)
        self.assertEqual(len(values), 2)
        self.assertIn("POINT(104.05 17.25)", values[0])
        self.assertIn(", 5, 'OTOP product: ผ้าคราม')", values[0])
        self.assertIn("'O''Kram Shop', 'craft', 'community_enterprise'", values[1])
        self.assertIn("true, true, true, 3, NULL)", values[1])   # community enterprise, ★3, no product
        self.assertEqual(len(missing), 1)


if __name__ == "__main__":
    unittest.main()
