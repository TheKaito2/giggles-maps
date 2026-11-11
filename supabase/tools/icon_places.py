"""Pick the "Icon" tier (tier 4, the country's major landmarks) from the tier-3 places. Never touches the database.

supabase db query --linked "select id,name,name_th,kind,category,wikidata,province_id,st_y(location::geometry) lat,
  st_x(location::geometry) lng from public.places where tier=3 and wikidata is not null" > cands.json
python icon_places.py cands.json --output ../data/icon_places.csv

Rule: a landmark kind AND the Wikidata P625 point within 3 km of our place (40 km for national parks, whose P625 is a
centroid or HQ of a huge area) AND (>= 10 Wikipedia sitelinks OR a UNESCO World Heritage id, P757).
Prints how many were excluded and why.
"""
import argparse
import collections
import csv
import json
import math
import time
import urllib.parse
import urllib.request

UA = "GigglesMaps/1.0 (https://giggles-maps.pages.dev; icon landmark tier)"
LANDMARK = {"temple", "viewpoint", "national_park", "museum", "attraction", "park", "beach", "waterfall", "art"}
COLUMNS = ["id", "name", "name_th", "kind", "province_id", "wikidata", "sitelinks", "unesco"]


def wikidata(qids):
    out = {}
    for i in range(0, len(qids), 50):
        req = urllib.request.Request("https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode({
            "action": "wbgetentities", "ids": "|".join(qids[i:i + 50]), "props": "sitelinks|claims", "format": "json"}),
            headers={"User-Agent": UA})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    data = json.load(r)
                break
            except Exception:
                time.sleep(2 ** attempt)
        else:
            raise RuntimeError(f"wikidata batch {i} failed")
        for q, e in data.get("entities", {}).items():
            claims = e.get("claims", {})
            coord = next((v["datavalue"]["value"] for v in (c.get("mainsnak", {}) for c in claims.get("P625", []))
                          if "datavalue" in v), None)
            out[q] = {"sitelinks": len(e.get("sitelinks", {})), "unesco": "P757" in claims, "missing": "missing" in e,
                      "coord": coord and (coord["latitude"], coord["longitude"])}
        time.sleep(0.5)
    return out


def km(a, b, c, d):
    p = math.pi / 180
    h = math.sin((c - a) * p / 2) ** 2 + math.cos(a * p) * math.cos(c * p) * math.sin((d - b) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def pick(rows, wd):
    why, keep = collections.Counter(), {}
    for r in rows:
        w = wd.get(r["wikidata"])
        if r["kind"] not in LANDMARK:
            why[f"kind {r['kind']}"] += 1
        elif not w or w["missing"]:
            why["QID missing on Wikidata"] += 1
        elif not w["coord"]:
            why["no P625 coordinates"] += 1
        elif (d := km(r["lat"], r["lng"], *w["coord"])) > (40 if r["kind"] == "national_park" else 3):
            why["P625 too far from our place"] += 1
        elif w["sitelinks"] < 10 and not w["unesco"]:
            why["sitelinks < 10 and not UNESCO"] += 1
        else:
            # several OSM places can share one QID (Yaowarat Road x4): keep the one nearest the Wikidata point
            best = keep.get(r["wikidata"])
            if best:
                why["duplicate QID (kept the place nearest P625)"] += 1
            if not best or (d, r["id"]) < (best["d"], best["id"]):
                keep[r["wikidata"]] = {**r, "sitelinks": w["sitelinks"], "unesco": int(w["unesco"]), "d": d}
    return sorted(keep.values(), key=lambda r: (-r["sitelinks"], r["id"])), why


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("candidates")
    ap.add_argument("--output", required=True)
    args = ap.parse_args()
    rows = json.load(open(args.candidates))["rows"]
    icons, why = pick(rows, wikidata(sorted({r["wikidata"] for r in rows})))
    with open(args.output, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(COLUMNS)
        w.writerows([r[k] for k in COLUMNS] for r in icons)
    print(f"{len(rows)} candidates -> {len(icons)} icons")
    for reason, n in why.most_common():
        print(f"  excluded {n}: {reason}")
