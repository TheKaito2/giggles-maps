import io
import json
import tempfile
import unittest
from pathlib import Path
from import_thailand_places import KINDS, Exporter, category, dwell_minutes, export, flags, kind, tier


class ImportTests(unittest.TestCase):
    def test_nature_visits_are_not_fifteen_minute_viewpoints(self):
        park = {"tourism": "attraction", "name:en": "Obluang National Park"}
        waterfall = {"tourism": "attraction", "name:th": "น้ำตกตัวอย่าง"}
        self.assertEqual(category(park), "park")
        self.assertEqual(dwell_minutes(park, "park"), 90)
        self.assertEqual(dwell_minutes(waterfall, "viewpoint"), 45)

    def test_temples_are_buddhist_hindu_or_chinese_shrines(self):
        self.assertEqual(category({"amenity": "place_of_worship", "religion": "buddhist"}), "temple")
        self.assertEqual(category({"amenity": "place_of_worship", "religion": "chinese"}), "temple")
        self.assertIsNone(category({"amenity": "place_of_worship", "religion": "muslim"}))
        self.assertIsNone(category({"amenity": "place_of_worship"}))

    def test_tiers_landmark_worth_a_visit_everyday(self):
        self.assertEqual(tier({"amenity": "cafe", "wikidata": "Q1"}, "cafe"), 3)          # famous cafe/market
        self.assertEqual(tier({"boundary": "national_park", "name": "Doi Suthep-Pui National Park"}, "park"), 3)
        self.assertEqual(tier({"natural": "waterfall", "name": "x"}, "viewpoint"), 3)
        self.assertEqual(tier({"amenity": "place_of_worship", "religion": "buddhist", "name": "Wat X"}, "temple"), 2)
        self.assertEqual(tier({"amenity": "cafe", "name": "Cafe"}, "cafe"), 1)

    def test_kinds_for_icons(self):
        self.assertEqual(kind({"amenity": "hospital", "name": "Sakon Hospital"}), "hospital")
        self.assertEqual(kind({"shop": "gift", "name": "ร้าน OTOP สกลนคร"}), "otop")
        self.assertEqual(kind({"shop": "clothes", "name": "วิสาหกิจชุมชนผ้าคราม"}), "community_enterprise")
        self.assertEqual(kind({"amenity": "marketplace", "name": "ตลาดนัดคลองถม"}), "night_market")
        self.assertEqual(kind({"natural": "waterfall", "name": "Kaeng Sopha"}), "waterfall")
        self.assertEqual(kind({"amenity": "fuel"}), "fuel")
        self.assertIsNone(kind({"shop": "hardware", "name": "Hardware"}))
        self.assertIsNone(kind({"amenity": "hospital", "name": "X", "access": "private"}))

    def test_services_are_on_the_map_but_never_detours(self):
        for k in ("hospital", "fuel", "atm", "hotel", "convenience", "bar"):
            self.assertFalse(KINDS[k][1], k)
        for k in ("temple", "otop", "night_market", "cafe", "waterfall"):
            self.assertTrue(KINDS[k][1], k)

    def test_local_means_independent(self):
        self.assertEqual(flags({"amenity": "cafe", "name": "Baan Kram Cafe"}, "cafe"), (True, False, False))
        self.assertEqual(flags({"amenity": "cafe", "name": "Cafe Amazon", "brand": "Café Amazon"}, "cafe")[0], False)
        self.assertEqual(flags({"shop": "gift", "name": "OTOP Center"}, "otop"), (True, True, False))
        self.assertEqual(flags({"amenity": "hospital", "name": "H"}, "hospital")[0], False)
        self.assertEqual(flags({"amenity": "cafe", "name": "Cafe Amazon Sakon"}, "cafe")[0], False)   # no brand tag
        self.assertEqual(flags({"amenity": "restaurant", "name": "Street Food"}, "restaurant")[0], True)

    def test_nameless_fuel_is_named_after_its_brand(self):
        output = io.StringIO()
        exporter = Exporter(output)
        exporter.add("node", 9, {"amenity": "fuel", "brand": "PTT Station"}, 17.1, 104.1)
        exporter.flush()
        self.assertIn("'PTT Station'", output.getvalue())
        self.assertIn("ON CONFLICT (osm_id) DO UPDATE", output.getvalue())

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
            upsert = sql.split("ON CONFLICT (osm_id) DO UPDATE SET", 1)[1].split(";", 1)[0]
            for curated in ("name", "category", "tier", "rating", "is_partner", "bid_thb"):
                self.assertNotIn(f" {curated} =", upsert)
            self.assertIn("COMMIT;", sql)


if __name__ == "__main__":
    unittest.main()
