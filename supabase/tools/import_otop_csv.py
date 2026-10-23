"""OTOP producer list (e.g. from a provincial CDD office) -> reviewable SQL for public.places. Never touches the database.

python import_otop_csv.py otop.csv --output otop.sql [--province "Sakon Nakhon"]
CSV columns (Thai or English headers): name, product, stars, district, subdistrict, address, lat, lng, community.
Rows without lat/lng are geocoded with Photon (OpenStreetMap search) from address + subdistrict + district + province;
rows that can't be placed are listed in the output as comments for a person to fix.
"""
import argparse
import csv
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

UA = "GigglesMaps/1.0 (https://giggles-maps.pages.dev; OTOP import)"
HEADERS = {
    "name": ("name", "ชื่อ", "ชื่อกลุ่ม", "ชื่อร้าน", "ผู้ประกอบการ"), "product": ("product", "ผลิตภัณฑ์", "ชื่อผลิตภัณฑ์"),
    "stars": ("stars", "ระดับดาว", "ดาว"), "district": ("district", "อำเภอ"), "subdistrict": ("subdistrict", "ตำบล"),
    "address": ("address", "ที่อยู่", "ที่ตั้ง"), "lat": ("lat", "latitude", "ละติจูด"), "lng": ("lng", "lon", "longitude", "ลองจิจูด"),
    "community": ("community", "วิสาหกิจชุมชน"),
}


def column(row, key):
    for h in HEADERS[key]:
        for k, v in row.items():
            if k and k.strip().casefold() == h.casefold() and v and v.strip():
                return v.strip()
    return None


def geocode(query):
    params = urllib.parse.urlencode({"q": query, "limit": 1, "bbox": "97.3,5.6,105.7,20.5"})
    req = urllib.request.Request(f"https://photon.komoot.io/api/?{params}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        feats = json.load(r)["features"]
    time.sleep(1)   # Photon fair use
    return tuple(reversed(feats[0]["geometry"]["coordinates"])) if feats else None


def quote(v):
    return "NULL" if v is None else "'" + str(v).replace("'", "''") + "'"


def rows_to_sql(rows, province, locate=geocode):
    values, missing = [], []
    for i, row in enumerate(rows, 1):
        name = column(row, "name")
        if not name:
            continue
        lat, lng = column(row, "lat"), column(row, "lng")
        point = (float(lat), float(lng)) if lat and lng else locate(" ".join(filter(None, [
            column(row, "address"), column(row, "subdistrict"), column(row, "district"), province, "Thailand"])))
        if not point or not (5 <= point[0] <= 21 and 97 <= point[1] <= 106):
            missing.append(f"-- row {i}: could not place {name!r}")
            continue
        raw = (column(row, "stars") or "").strip("★ ")
        stars = int(raw) if raw.isdigit() and 1 <= int(raw) <= 5 else (len(column(row, "stars") or "") if set(column(row, "stars") or "x") == {"★"} else None)
        community = (column(row, "community") or "").casefold() in ("1", "yes", "true", "ใช่", "y")
        product = column(row, "product")
        values.append(f"({quote(name)}, 'craft', {quote('community_enterprise' if community else 'otop')}, true, "
                      f"'SRID=4326;POINT({point[1]} {point[0]})', 'cdd', 1, true, true, {str(community).lower()}, "
                      f"{stars if stars else 'NULL'}, {quote(f'OTOP product: {product}' if product else None)})")
    return values, missing


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("csv", type=Path)
    ap.add_argument("--output", type=Path, required=True)
    ap.add_argument("--province", default="")
    args = ap.parse_args()
    with args.csv.open(encoding="utf-8-sig", newline="") as f:
        values, missing = rows_to_sql(list(csv.DictReader(f)), args.province)
    with args.output.open("w", encoding="utf-8") as out:
        out.write("-- OTOP producers from a CDD list. Review before applying.\n" + "\n".join(missing) + "\n")
        if values:
            out.write("insert into public.places (name, category, kind, detour, location, source, tier, local, otop, community, otop_stars, description) values\n")
            out.write(",\n".join(values) + ";\n")
    print(json.dumps({"placed": len(values), "unplaced": len(missing)}))


if __name__ == "__main__":
    main()
