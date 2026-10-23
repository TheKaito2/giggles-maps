import io
import json
import tempfile
import unittest
from pathlib import Path
from import_thailand_places import Exporter, category, dwell_minutes, export


class ImportTests(unittest.TestCase):
    def test_nature_visits_are_not_fifteen_minute_viewpoints(self):
        park = {"tourism": "attraction", "name:en": "Obluang National Park"}
        waterfall = {"tourism": "attraction", "name:th": "น้ำตกตัวอย่าง"}
        self.assertEqual(category(park), "park")
        self.assertEqual(dwell_minutes(park, "park"), 90)
        self.assertEqual(dwell_minutes(waterfall, "viewpoint"), 45)

    def test_region_filter_limits_initial_rollout(self):
        output = io.StringIO()
        exporter = Exporter(output, (13, 100, 14, 101))
        tags = {"tourism": "museum", "name": "Museum"}
        exporter.add("node", 1, tags, 13.75, 100.5)
        exporter.add("node", 2, tags, 18.8, 99)
        self.assertEqual(exporter.counts, {"museum": 1})

    def test_only_relevant_public_places(self):
        self.assertIsNone(category({"amenity": "cafe", "access": "private"}))
        self.assertIsNone(category({"tourism": "hotel"}))
        self.assertEqual(category({"natural": "waterfall"}), "viewpoint")

    def test_duplicate_node_and_way_and_safe_sql(self):
        output = io.StringIO()
        exporter = Exporter(output)
        tags = {"amenity": "cafe", "name": "O'Brien", "name:th": "กาแฟ"}
        exporter.add("node", 1, tags, 13.75, 100.5)
        exporter.add("way", 2, tags, 13.75001, 100.50001)
        exporter.add("node", 3, tags, 40, 100.5)
        exporter.flush()
        self.assertEqual(exporter.counts, {"cafe": 1})
        self.assertIn("O''Brien", output.getvalue())
        self.assertNotIn("way/2", output.getvalue())
        self.assertNotIn("is_partner", output.getvalue())

    def test_exports_json_nodes_and_way_centers(self):
        with tempfile.TemporaryDirectory() as folder:
            source, target = Path(folder) / "fixture.json", Path(folder) / "places.sql"
            source.write_text(json.dumps({"elements": [
                {"type": "node", "id": 1, "lat": 13.75, "lon": 100.5,
                 "tags": {"name": "Park", "leisure": "park"}},
                {"type": "way", "id": 3, "center": {"lat": 13.751, "lon": 100.501},
                 "tags": {"name": "Museum", "tourism": "museum"}},
            ]}), encoding="utf-8")
            self.assertEqual(export(source, target), {"park": 1, "museum": 1})
            sql = target.read_text(encoding="utf-8")
            self.assertIn("way/3", sql)
            self.assertIn("ON CONFLICT (osm_id) DO NOTHING", sql)
            self.assertIn("COMMIT;", sql)


if __name__ == "__main__":
    unittest.main()
