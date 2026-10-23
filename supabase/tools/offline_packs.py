"""Offline province maps: cut one Protomaps PMTiles pack per province and upload them to R2 with an index.

python offline_packs.py --build 20261020 [--upload]
Needs the pmtiles CLI (go-pmtiles) at .tools/bin/pmtiles and wrangler for the upload. Packs go to .tools/packs/.
The web app lists index.json ([{iso, name_en, name_th, bytes, bbox}]) from the bucket's public URL.
"""
import argparse
import json
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOLS, BUCKET = ROOT / ".tools", "giggles-maps-offline"


def bbox(geom):
    pts = [p for poly in (geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]) for ring in poly for p in ring]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return [round(min(xs), 4), round(min(ys), 4), round(max(xs), 4), round(max(ys), 4)]


def extract(build, f):
    iso = f["properties"]["iso"]
    out, region = TOOLS / "packs" / f"{iso}.pmtiles", TOOLS / "regions" / f"{iso}.geojson"
    if not out.exists() or out.stat().st_size == 0:
        region.parent.mkdir(parents=True, exist_ok=True)
        region.write_text(json.dumps({"type": "FeatureCollection", "features": [f]}))
        subprocess.run([str(TOOLS / "bin" / "pmtiles"), "extract", f"https://build.protomaps.com/{build}.pmtiles", str(out), f"--region={region}"],
                       check=True, capture_output=True)
    p = f["properties"]
    return {"iso": iso, "name_en": p["name_en"], "name_th": p["name_th"], "bytes": out.stat().st_size, "bbox": bbox(f["geometry"])}


def put(key, path, ctype):
    subprocess.run(["npx", "wrangler", "r2", "object", "put", f"{BUCKET}/{key}", "--file", str(path), "--content-type", ctype,
                    "--cache-control", "public, max-age=86400", "--remote"], check=True, capture_output=True, cwd=ROOT / "web")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--build", required=True, help="Protomaps daily build date, e.g. 20261020")
    ap.add_argument("--upload", action="store_true")
    args = ap.parse_args()
    (TOOLS / "packs").mkdir(parents=True, exist_ok=True)
    features = json.loads((ROOT / "web/public/provinces.geojson").read_text())["features"]
    with ThreadPoolExecutor(4) as pool:
        index = sorted(pool.map(lambda f: extract(args.build, f), features), key=lambda x: x["name_en"])
    (TOOLS / "packs" / "index.json").write_text(json.dumps(index, ensure_ascii=False))
    print(json.dumps({"packs": len(index), "total_mb": round(sum(x["bytes"] for x in index) / 1e6)}))
    if args.upload:
        with ThreadPoolExecutor(4) as pool:
            list(pool.map(lambda x: put(f"{x['iso']}.pmtiles", TOOLS / "packs" / f"{x['iso']}.pmtiles", "application/octet-stream"), index))
        put("index.json", TOOLS / "packs" / "index.json", "application/json")
        print("uploaded")


if __name__ == "__main__":
    main()
