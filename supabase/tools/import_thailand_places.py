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
    # "Temple" stops: Buddhist wat, Hindu and Chinese shrines. Mosques and churches aren't labelled temples.
    if tags.get("amenity") == "place_of_worship" and tags.get("religion") in TEMPLE_RELIGIONS:
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


TEMPLE_RELIGIONS = {"buddhist", "hindu", "chinese", "taoist"}


def _names(tags):
    return " ".join(tags.get(k, "") for k in ("name", "name:en", "name:th", "brand", "operator")).casefold()


# national chains, often mapped without a brand tag (hand-checked from names that repeat 8+ times in the extract)
CHAINS = ("cafe amazon", "café amazon", "amazon cafe", "amazon", "inthanin", "punthai", "phanthai", "s&p", "black canyon",
          "true coffee", "swensen", "starbucks", "yayoi", "doi chaang", "mk restaurant", "wawee", "fuji", "getfresh",
          "wine connection", "suki teenoi", "the coffee club", "delicafe", "rabika", "pearly tea", "mixue", "dairy queen",
          "mingmitr", "chao doi", "coffee world", "mister donut", "guss damn good", "zen restaurant", "kfc", "mcdonald",
          "burger king", "the pizza company", "pizza company", "chester", "bar b q plaza", "sizzler", "shabushi", "oishi",
          "after you", "texas chicken", "subway", "dunkin", "au bon pain", "auntie anne", "sukishi", "sushiro", "jollibee")


def is_chain(tags):
    name = (tags.get("name:en") or tags.get("name") or "").casefold().strip()
    return bool(tags.get("brand") or tags.get("brand:wikidata")) or name == "mk" or name.startswith(CHAINS)


OTOP_WORDS = ("otop", "โอทอป")
COMMUNITY_WORDS = ("วิสาหกิจชุมชน", "กลุ่มแม่บ้าน", "กลุ่มอาชีพ", "community enterprise")
NIGHT_MARKET_WORDS = ("night", "ตลาดนัด", "ตลาดโต้รุ่ง", "walking street", "ถนนคนเดิน")
# kind -> (coarse category, detour). Detour places can become plan stops and passport stops; the rest
# (services, stays, health, big-box shops) only show on the map and in search.
KINDS = {
    "restaurant": ("food", True), "fast_food": ("food", True), "cafe": ("cafe", True), "bakery": ("cafe", True),
    "dessert": ("cafe", True), "bar": ("bar", False),
    "temple": ("temple", True), "museum": ("museum", True), "viewpoint": ("viewpoint", True),
    "waterfall": ("viewpoint", True), "beach": ("viewpoint", True), "attraction": ("viewpoint", True),
    "park": ("park", True), "national_park": ("park", True), "art": ("art", True),
    "otop": ("craft", True), "craft": ("craft", True), "souvenir": ("craft", True), "community_enterprise": ("craft", True),
    "market": ("market", True), "night_market": ("market", True),
    "mall": ("shop", False), "supermarket": ("shop", False), "convenience": ("shop", False),
    "hotel": ("stay", False), "guesthouse": ("stay", False),
    "hospital": ("health", False), "clinic": ("health", False), "pharmacy": ("health", False), "dentist": ("health", False),
    "fuel": ("service", False), "ev_charging": ("service", False), "bank": ("service", False), "atm": ("service", False),
    "police": ("service", False), "post_office": ("service", False), "toilets": ("service", False),
    "parking": ("service", False), "community_centre": ("community", False),
}
# services people look for by type; an unnamed one is still worth a pin, named after its brand/operator
NAMELESS_OK = {"fuel": "Gas station", "atm": "ATM", "ev_charging": "EV charging", "toilets": "Toilets", "bank": "Bank"}


def kind(tags):
    """Fine place type for icons and filters (see KINDS), or None when the place isn't one we show."""
    if tags.get("access") in ("private", "no") or tags.get("disused") == "yes":
        return None
    names = _names(tags)
    a, sh, t, l, n = tags.get("amenity"), tags.get("shop"), tags.get("tourism"), tags.get("leisure"), tags.get("natural")
    if any(w in names for w in OTOP_WORDS):
        return "otop"
    if any(w in names for w in COMMUNITY_WORDS) and (sh or a in ("marketplace", "restaurant", "cafe")):
        return "community_enterprise"
    cat = category(tags)
    if cat:
        if cat == "park":
            return "national_park" if is_national_park(tags) else "park"
        if cat == "viewpoint":
            if n == "waterfall" or "waterfall" in names or "น้ำตก" in names:
                return "waterfall"
            return "viewpoint" if t == "viewpoint" or n == "peak" else "attraction"
        if cat == "food":
            return "restaurant"
        if cat == "market":
            return "night_market" if any(w in names for w in NIGHT_MARKET_WORDS) else "market"
        if cat == "craft":
            return "souvenir" if sh == "gift" else "craft"
        return cat
    if n == "beach" and tags.get("name"):
        return "beach"
    if a == "fast_food":
        return "fast_food"
    if a == "ice_cream" or sh in ("confectionery", "pastry"):
        return "dessert"
    if sh == "bakery":
        return "bakery"
    if a in ("bar", "pub", "biergarten"):
        return "bar"
    if sh in ("souvenir",):
        return "souvenir"
    if sh in ("mall", "department_store"):
        return "mall"
    if sh in ("supermarket", "convenience"):
        return sh
    if t in ("hotel", "resort", "motel"):
        return "hotel"
    if t in ("guest_house", "hostel"):
        return "guesthouse"
    if a == "hospital":
        return "hospital"
    if a in ("clinic", "doctors"):
        return "clinic"
    if a in ("pharmacy", "dentist", "fuel", "bank", "atm", "police", "post_office", "toilets", "parking"):
        return a
    if a == "charging_station":
        return "ev_charging"
    if a == "community_centre":
        return "community_centre"
    return None


def details(tags):
    """Opening hours, phone, website, a one-line address and the brand, as OSM has them."""
    addr = " ".join(tags[k] for k in ("addr:housenumber", "addr:street", "addr:subdistrict", "addr:district",
                                       "addr:city", "addr:province", "addr:postcode") if tags.get(k)) or None
    return (tags.get("opening_hours"), tags.get("phone") or tags.get("contact:phone"),
            tags.get("website") or tags.get("contact:website"), addr, tags.get("brand"))


def flags(tags, k):
    """local = an independent food/café/craft/market place (no chain brand); otop and community from the name."""
    chain = is_chain(tags)
    names = _names(tags)
    local = KINDS[k][0] in ("food", "cafe", "craft", "market") and k != "fast_food" and not chain
    return local, k == "otop" or any(w in names for w in OTOP_WORDS), k == "community_enterprise" or any(w in names for w in COMMUNITY_WORDS)

DWELL = {"museum": 40, "viewpoint": 15, "art": 10, "park": 20,
         "temple": 20, "cafe": 25, "food": 35, "market": 25, "craft": 20}   # other categories aren't detours: 15


def is_national_park(tags):
    names = " ".join(tags.get(k, "") for k in ("name", "name:en", "name:th")).casefold()
    return (tags.get("boundary") == "national_park" or "national park" in names
            or "อุทยานแห่งชาติ" in names)


def tier(tags, cat):
    """3 = landmark (must-go), 2 = worth a visit, 1 = everyday. A Wikipedia/Wikidata link is the landmark signal."""
    names = " ".join(tags.get(k, "") for k in ("name", "name:en", "name:th")).casefold()
    if (tags.get("wikidata") or any(k == "wikipedia" or k.startswith("wikipedia:") for k in tags)
            or "heritage" in tags or is_national_park(tags) or tags.get("natural") in ("waterfall", "peak")
            or "waterfall" in names or "น้ำตก" in names):
        return 3
    return 2 if cat in ("temple", "museum", "viewpoint", "park", "art", "market") else 1


def dwell_minutes(tags, cat):
    names = " ".join(tags.get(k, "") for k in ("name", "name:en", "name:th")).casefold()
    if is_national_park(tags):
        return 90
    if tags.get("natural") == "waterfall" or "waterfall" in names or "น้ำตก" in names:
        return 45
    return DWELL.get(cat, 15)


class Exporter:
    def __init__(self, output, bbox=None):
        self.output = output
        self.bbox = bbox
        self.seen = set()
        self.rows = []
        self.counts = {}

    def add(self, osm_type, osm_id, tags, lat, lng):
        k = kind(tags)
        if not k:
            return
        cat, detour = KINDS[k]
        name = (tags.get("name:en") or tags.get("name") or tags.get("name:th") or "").strip()
        if not name and k in NAMELESS_OK:
            name = (tags.get("brand") or tags.get("operator") or NAMELESS_OK[k]).strip()
        if not name or not (5 <= lat <= 21 and 97 <= lng <= 106):
            return
        if self.bbox and not (self.bbox[0] <= lat <= self.bbox[2] and self.bbox[1] <= lng <= self.bbox[3]):
            return
        # Nodes and building outlines often describe the same named POI.
        normalized = re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", name).casefold())
        key = (normalized, k, round(lat, 4 if k in NAMELESS_OK else 3), round(lng, 4 if k in NAMELESS_OK else 3))
        if key in self.seen:
            return
        self.seen.add(key)
        # Unknown OSM opening_hours are NOT guessed into daily hours.
        self.rows.append((f"{osm_type}/{osm_id}", name, tags.get("name:th"), cat,
                          f"SRID=4326;POINT({lng} {lat})", dwell_minutes(tags, cat), tier(tags, cat) if detour else 1,
                          tags.get("wikidata"), k, detour, *details(tags), *flags(tags, k)))
        self.counts[k] = self.counts.get(k, 0) + 1
        if len(self.rows) >= 500:
            self.flush()

    def flush(self):
        if not self.rows:
            return
        def quote(value):
            if isinstance(value, bool):
                return "true" if value else "false"
            return "NULL" if value is None else "'" + str(value).replace("\x00", "").replace("'", "''") + "'"
        values = ",\n".join("(" + ",".join(quote(v) for v in row) + ")" for row in self.rows)
        self.output.write("INSERT INTO public.places (osm_id,name,name_th,category,location,dwell_min,tier,wikidata,"
                          "kind,detour,opening_hours,phone,website,address,brand,local,otop,community) VALUES\n")
        self.output.write(values)
        # Existing places keep name, category, tier, ratings, partner links, bids and demo records (and so their
        # stamps and check-ins); only the kind, details and flags are refreshed.
        self.output.write("\nON CONFLICT (osm_id) DO UPDATE SET kind = EXCLUDED.kind, opening_hours = EXCLUDED.opening_hours, "
                          "phone = EXCLUDED.phone, website = EXCLUDED.website, address = EXCLUDED.address, brand = EXCLUDED.brand, "
                          "local = EXCLUDED.local, otop = EXCLUDED.otop, community = EXCLUDED.community;\n")
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
                    if kind(obj.tags) and obj.location.valid():
                        exporter.add("node", obj.id, dict(obj.tags), obj.location.lat, obj.location.lon)

                def way(self, obj):
                    if not kind(obj.tags):
                        return
                    coords = [(n.lat, n.lon) for n in obj.nodes if n.location.valid()]
                    if coords:
                        # POI marker only; routing snaps it to the reachable road network.
                        exporter.add("way", obj.id, dict(obj.tags),
                                     sum(p[0] for p in coords) / len(coords),
                                     sum(p[1] for p in coords) / len(coords))

                def area(self, obj):
                    # Multipolygon relations: big landmarks (Wat Pho, the Grand Palace) are often mapped this way.
                    # Closed ways also arrive here as areas; way() already handled those.
                    if obj.from_way() or not kind(obj.tags):
                        return
                    coords = [(n.lat, n.lon) for ring in obj.outer_rings() for n in ring if n.location.valid()]
                    if coords:
                        exporter.add("relation", obj.orig_id(), dict(obj.tags),
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
