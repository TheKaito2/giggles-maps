"""Offline OSM -> reviewable SQL. Never connects to or changes the live database.

python -m pip install osmium
python import_thailand_places.py thailand-latest.osm.pbf --output thailand-places.sql
Also accepts an Overpass JSON extract for small fixtures/imports.
"""
import argparse
import json
import re
import unicodedata
from pathlib import Path


def category(tags):
    if tags.get("access") in ("private", "no") or tags.get("disused") == "yes":
        return None
    if is_national_park(tags):
        return "park"
    if tags.get("tourism") in ("museum", "aquarium"):
        return "museum"
    if tags.get("tourism") in ("viewpoint", "attraction") or tags.get("natural") in ("waterfall", "peak"):
        return "viewpoint"
    if tags.get("tourism") == "artwork":
        return "art"
    if tags.get("leisure") in ("park", "garden", "nature_reserve"):
        return "park"
    if tags.get("amenity") == "place_of_worship":
        return "temple"
    if tags.get("amenity") == "cafe":
        return "cafe"
    if tags.get("amenity") in ("restaurant", "food_court"):
        return "food"
    if tags.get("amenity") == "marketplace":
        return "market"
    if tags.get("shop") in ("craft", "art", "pottery", "gift"):
        return "craft"
    return None


DWELL = {"museum": 40, "viewpoint": 15, "art": 10, "park": 20,
         "temple": 20, "cafe": 25, "food": 35, "market": 25, "craft": 20}


def is_national_park(tags):
    names = " ".join(tags.get(k, "") for k in ("name", "name:en", "name:th")).casefold()
    return (tags.get("boundary") == "national_park" or "national park" in names
            or "อุทยานแห่งชาติ" in names)


def dwell_minutes(tags, cat):
    names = " ".join(tags.get(k, "") for k in ("name", "name:en", "name:th")).casefold()
    if is_national_park(tags):
        return 90
    if tags.get("natural") == "waterfall" or "waterfall" in names or "น้ำตก" in names:
        return 45
    return DWELL[cat]


class Exporter:
    def __init__(self, output, bbox=None):
        self.output = output
        self.bbox = bbox
        self.seen = set()
        self.rows = []
        self.counts = {}

    def add(self, kind, osm_id, tags, lat, lng):
        cat = category(tags)
        name = (tags.get("name:en") or tags.get("name") or tags.get("name:th") or "").strip()
        if not cat or not name or not (5 <= lat <= 21 and 97 <= lng <= 106):
            return
        if self.bbox and not (self.bbox[0] <= lat <= self.bbox[2] and self.bbox[1] <= lng <= self.bbox[3]):
            return
        # Nodes and building outlines often describe the same named POI.
        normalized = re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", name).casefold())
        key = (normalized, cat, round(lat, 3), round(lng, 3))
        if key in self.seen:
            return
        self.seen.add(key)
        # Unknown OSM opening_hours are NOT guessed into daily hours.
        self.rows.append((f"{kind}/{osm_id}", name, tags.get("name:th"), cat,
                          f"SRID=4326;POINT({lng} {lat})", dwell_minutes(tags, cat)))
        self.counts[cat] = self.counts.get(cat, 0) + 1
        if len(self.rows) >= 500:
            self.flush()

    def flush(self):
        if not self.rows:
            return
        def quote(value):
            return "NULL" if value is None else "'" + str(value).replace("\x00", "").replace("'", "''") + "'"
        values = ",\n".join("(" + ",".join(quote(v) for v in row) + ")" for row in self.rows)
        self.output.write("INSERT INTO public.places (osm_id,name,name_th,category,location,dwell_min) VALUES\n")
        self.output.write(values)
        # Preserve manually curated fields, partner links, wallet bids and existing demo records.
        self.output.write("\nON CONFLICT (osm_id) DO NOTHING;\n")
        self.rows.clear()


def export(source, destination, bbox=None):
    with destination.open("w", encoding="utf-8", newline="\n") as out:
        out.write("-- Thailand POIs: OpenStreetMap contributors, ODbL.\n")
        out.write("-- Source: " + ("Overpass Thailand snapshot" if source.suffix == ".json" else "Geofabrik Thailand extract") + "\n")
        out.write("-- Ratings load as NULL (unrated, migration 013): no verified reviews. Hours are unknown.\n")
        out.write("-- Review before applying. No partner, QR, coupon or billing data is imported.\nSET standard_conforming_strings = on;\nBEGIN;\n")
        exporter = Exporter(out, bbox)
        if source.suffix == ".json":
            for obj in json.loads(source.read_text(encoding="utf-8"))["elements"]:
                point = obj.get("center", obj)
                if "lat" in point and "lon" in point:
                    exporter.add(obj["type"], obj["id"], obj.get("tags", {}), point["lat"], point["lon"])
        else:
            import osmium
            class Handler(osmium.SimpleHandler):
                def node(self, obj):
                    if category(obj.tags) and obj.location.valid():
                        exporter.add("node", obj.id, dict(obj.tags), obj.location.lat, obj.location.lon)

                def way(self, obj):
                    if not category(obj.tags):
                        return
                    coords = [(n.lat, n.lon) for n in obj.nodes if n.location.valid()]
                    if coords:
                        # POI marker only; routing snaps it to the reachable road network.
                        exporter.add("way", obj.id, dict(obj.tags),
                                     sum(p[0] for p in coords) / len(coords),
                                     sum(p[1] for p in coords) / len(coords))
            Handler().apply_file(str(source), locations=True, idx="flex_mem")
        exporter.flush()
        out.write("COMMIT;\nANALYZE public.places;\n")
    return exporter.counts


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--bbox", type=float, nargs=4, metavar=("MIN_LAT", "MIN_LNG", "MAX_LAT", "MAX_LNG"), help="Limit initial rollout to a region")
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output already exists; choose a new path")
    if args.bbox and not (5 <= args.bbox[0] <= args.bbox[2] <= 21 and 97 <= args.bbox[1] <= args.bbox[3] <= 106):
        parser.error("bbox must be an ordered Thailand latitude/longitude box")
    print(json.dumps(export(args.source, args.output, args.bbox), ensure_ascii=False))
