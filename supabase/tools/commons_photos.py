"""More landmark photos from Wikimedia Commons -> reviewable SQL for public.place_commons_photos. Never touches the database.

supabase db query --linked -o json "select p.id, p.wikidata, (select string_agg(f.url, ' ') from public.place_photos f
  where f.place_id = p.id and f.source = 'wikimedia') existing from public.places p
  where p.tier >= 3 and p.wikidata is not null order by p.id" > .cache/places.json
python commons_photos.py .cache/places.json --output ../data/commons_photos.sql   # writes commons_photos_1.sql, _2.sql...

For each place (tier >= 3 with a Wikidata id; the Icons in ../data/icon_places.csv are added if missing): the files of
its Commons category (Wikidata P373) plus its main image (P18), one subcategory level down when the category itself has
fewer than 8 usable files. Kept: JPEG/PNG/WebP, >= 800 px wide, a licence that allows commercial reuse (CC0, public
domain, CC BY, CC BY-SA; never NC/ND/unknown), not a map/logo/diagram/flag/coat of arms (file name, categories, shape).
Landscape first, at most 8 per place, minus the one Wikimedia photo the place already has in place_photos.
Every API response is cached in .cache/commons/ (gitignored), so a rerun only fetches what is new.
"""
import argparse
import collections
import csv
import hashlib
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

UA = "GigglesMaps/1.0 (https://giggles-maps.pages.dev; mendoza.pjr@gmail.com) commons_photos.py"
CACHE = Path(__file__).parent / ".cache" / "commons"
COMMONS = "https://commons.wikimedia.org/w/api.php"
PER_PLACE = 8
SMALL = 500   # Commons only serves standard thumbnail widths now (480 -> HTTP 400); 500 is the nearest
MIMES = {"image/jpeg", "image/png", "image/webp"}
FREE = re.compile(r"^(cc0( 1\.0)?|public domain|pd\b.*|cc[ -]by(-sa)?( \d\.\d)?( [a-z]{2,3})?)$", re.I)
NOT_PHOTO = re.compile(r"\b(maps?|karte|carte|location|locator|plans?|floor ?plan|logos?|diagrams?|charts?|flags?|coat of arms|"
                       r"emblems?|seals?|icons?|symbols?|signs?|drawings?|schema|svg|scans?|documents?|stamps?|banknotes?|coins?)\b", re.I)
# categories are checked by how they start ("Maps of Bangkok"), not anywhere ("...missing SDC location of creation")
NOT_PHOTO_CAT = re.compile(r"^(location |locator )?(maps?|logos?|diagrams?|charts?|flags?|coats? of arms|floor plans?|plans?|"
                           r"emblems?|seals?|icons?|symbols?|signs?|drawings?|svg|scans?|documents?|stamps?)\b", re.I)


def get(params):
    """One Commons/Wikidata API call, cached on disk by its URL."""
    url = params.pop("_url", COMMONS) + "?" + urllib.parse.urlencode({**params, "format": "json", "formatversion": 2})
    path = CACHE / (hashlib.sha1(url.encode()).hexdigest() + ".json")
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.load(r)
            break
        except Exception as e:   # 429 / timeouts: back off, then give up loudly
            if attempt == 4:
                raise RuntimeError(f"failed: {url}") from e
            time.sleep(2 ** (attempt + 1))
    time.sleep(0.3)   # be polite: only uncached calls wait
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return data


def strip_html(s):
    text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s or "")).replace("&amp;", "&").replace("&quot;", '"').replace("&#039;", "'").strip()
    return "" if text.casefold().startswith("no machine-readable") else text[:120]


def file_key(url):
    """Commons file name in an upload URL (original or thumbnail), so the same file matches however it was linked."""
    m = re.search(r"/commons/(?:thumb/)?[0-9a-f]/[0-9a-f]{2}/([^/?]+)", url or "")
    return urllib.parse.unquote(m.group(1)).replace(" ", "_") if m else None


def wikidata(qids):
    """Q-id -> (Commons category, main image file) from P373 and P18."""
    out = {}
    for i in range(0, len(qids), 50):
        data = get({"_url": "https://www.wikidata.org/w/api.php", "action": "wbgetentities", "ids": "|".join(qids[i:i + 50]), "props": "claims"})
        for qid, ent in data.get("entities", {}).items():
            claims = ent.get("claims", {})
            val = lambda p: next((c["mainsnak"]["datavalue"]["value"] for c in claims.get(p, []) if "datavalue" in c["mainsnak"]), None)
            out[qid] = (val("P373"), val("P18"))
    return out


def photo(page):
    """A usable photo from one imageinfo page, or None (and why)."""
    info = (page.get("imageinfo") or [None])[0]
    if not info:
        return None, "missing"
    meta = {k: v.get("value") for k, v in info.get("extmetadata", {}).items()}
    title = page["title"].removeprefix("File:")
    w, h = info.get("width") or 0, info.get("height") or 0
    licence = strip_html(meta.get("LicenseShortName"))
    if info.get("mime") not in MIMES:
        return None, "type"
    if w < 800:
        return None, "small"
    if not FREE.match(licence) or str(meta.get("NonFree", "")).lower() == "true":
        return None, "licence"
    if NOT_PHOTO.search(title.replace("_", " ")) or any(NOT_PHOTO_CAT.match(c) for c in (meta.get("Categories") or "").split("|")):
        return None, "not_photo"
    if not 0.4 <= w / h <= 3 or (info["mime"] == "image/png" and abs(w / h - 1) < 0.05):   # strips, banners, square logos
        return None, "shape"
    original = info["url"].split("?")[0]
    big = info.get("thumburl", original).split("?")[0] if w > 1280 else original
    small = original.replace("/commons/", "/commons/thumb/", 1) + f"/{SMALL}px-" + original.rsplit("/", 1)[1]
    if info["mime"] == "image/webp":
        small += ".png"   # Commons renders WebP thumbnails as PNG
    return {"file": title, "url": big, "small_url": small, "page_url": info["descriptionurl"],
            "author": strip_html(meta.get("Artist")) or strip_html(meta.get("Credit")) or "Unknown author",
            "licence": licence, "licence_url": meta.get("LicenseUrl") or None, "width": w, "height": h}, "ok"


IMAGEINFO = {"prop": "imageinfo", "iiprop": "url|extmetadata|size|mime", "iiurlwidth": 1280,
             "iiextmetadatafilter": "LicenseShortName|LicenseUrl|Artist|Credit|Categories|NonFree"}


def category_files(cat, why):
    """Usable photos in one Commons category (first 100 files), in category order."""
    data = get({"action": "query", "generator": "categorymembers", "gcmtitle": "Category:" + cat, "gcmtype": "file",
                "gcmlimit": 100, **IMAGEINFO})
    out = []
    for page in sorted(data.get("query", {}).get("pages", []), key=lambda p: p["title"]):
        ph, reason = photo(page)
        why[reason] += 1
        if ph:
            out.append(ph)
    return out


def subcategories(cat):
    data = get({"action": "query", "list": "categorymembers", "cmtitle": "Category:" + cat, "cmtype": "subcat", "cmlimit": 20})
    return [c["title"].removeprefix("Category:") for c in data.get("query", {}).get("categorymembers", [])
            if not NOT_PHOTO.search(c["title"])]


def p18_photos(files, why):
    """Main image (P18) file name -> usable photo."""
    out, names = {}, sorted(set(files))
    for i in range(0, len(names), 20):   # long (often Thai) file names: 50 per request overflows the URL limit
        data = get({"action": "query", "titles": "|".join("File:" + n for n in names[i:i + 20]), **IMAGEINFO})
        for page in data.get("query", {}).get("pages", []):
            ph, reason = photo(page)
            why[reason] += 1
            if ph:
                out[ph["file"].replace(" ", "_")] = ph
    return out


def pick(cands, skip):
    """Up to 8, landscape first (stable within each group), without duplicates or the photo the place already has."""
    seen, out = set(skip), []
    for ph in sorted(cands, key=lambda p: p["width"] < p["height"]):
        key = ph["file"].replace(" ", "_")
        if key not in seen:
            seen.add(key)
            out.append(ph)
    return out[:PER_PLACE]


def quote(v):
    return "NULL" if v is None else str(v) if isinstance(v, int) else "'" + str(v).replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("places", type=Path, help="JSON from `supabase db query -o json` (id, wikidata, existing)")
    ap.add_argument("--output", type=Path, required=True)
    ap.add_argument("--icons", type=Path, default=Path(__file__).parent.parent / "data" / "icon_places.csv")
    args = ap.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    rows = json.loads(args.places.read_text(encoding="utf-8"))["rows"]
    have = {r["id"] for r in rows}
    with args.icons.open(encoding="utf-8") as f:
        rows += [{"id": int(r["id"]), "wikidata": r["wikidata"], "existing": None} for r in csv.DictReader(f) if int(r["id"]) not in have]
    by_qid = collections.defaultdict(list)
    for r in rows:
        if re.fullmatch(r"Q\d+", (r["wikidata"] or "").strip()):
            by_qid[r["wikidata"].strip()].append(r)
    wd = wikidata(sorted(by_qid))
    why = collections.Counter()
    mains = p18_photos([p18 for _, p18 in wd.values() if p18], why)
    chosen = {}
    for n, (qid, (cat, p18)) in enumerate(sorted(wd.items()), 1):
        cands = [mains[p18.replace(" ", "_")]] if p18 and p18.replace(" ", "_") in mains else []
        if cat:
            cands += category_files(cat, why)
            for sub in subcategories(cat) if len(cands) < PER_PLACE else []:   # one level down, only when short
                cands += category_files(sub, why)
                if len(cands) >= 3 * PER_PLACE:
                    break
        chosen[qid] = cands
        if n % 100 == 0:
            print(f"{n}/{len(wd)} items", flush=True)
    values, places, lic = [], 0, collections.Counter()
    for qid, cands in sorted(chosen.items()):
        for r in by_qid[qid]:
            skip = {file_key(u) for u in (r["existing"] or "").split()} - {None}
            got = pick(cands, skip)
            places += bool(got)
            for rank, ph in enumerate(got, 1):
                lic[re.sub(r" \d.*$", "", ph["licence"]).upper()] += 1
                values.append("(" + ", ".join(quote(v) for v in (r["id"], rank, ph["file"], ph["url"], ph["small_url"], ph["author"],
                              ph["licence"], ph["licence_url"], ph["page_url"], ph["width"], ph["height"])) + ")")
    # `supabase db query --linked -f` refuses bodies over ~5 MB (HTTP 413), so the seed is split into ~2 MB parts,
    # each its own transaction; part 1 empties the table first. Apply them in order.
    head = "insert into public.place_commons_photos (place_id, rank, file, url, small_url, author, licence, licence_url, page_url, width, height) values\n"
    chunks = [head + ",\n".join(values[i:i + 500]) + "\non conflict (place_id, file) do nothing;\n" for i in range(0, len(values), 500)]
    parts, size = [[]], 0
    for c in chunks:
        if parts[-1] and size + len(c.encode()) > 2_000_000:
            parts.append([])
            size = 0
        parts[-1].append(c)
        size += len(c.encode())
    for old in args.output.parent.glob(args.output.stem + "_*.sql"):
        old.unlink()
    for n, part in enumerate(parts, 1):
        with args.output.with_name(f"{args.output.stem}_{n}.sql").open("w", encoding="utf-8") as out:
            out.write(f"-- Landmark photos from Wikimedia Commons (supabase/tools/commons_photos.py), part {n} of {len(parts)}: "
                      f"{places} places, {len(values)} photos in all.\n-- Apply after migration 20261028000088_commons_photos.sql, parts in order.\n")
            out.write("begin;\n" + ("delete from public.place_commons_photos;\n" if n == 1 else "") + "".join(part) + "commit;\n")
    print(json.dumps({"places_in": len(rows), "wikidata_items": len(wd), "with_category": sum(1 for c, _ in wd.values() if c),
                      "with_p18": sum(1 for _, p in wd.values() if p), "places_with_photos": places, "photos": len(values),
                      "licences": dict(lic.most_common()), "files_seen": dict(why.most_common())}))


def demo():
    assert file_key("https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/Tong-Kung.jpg/1280px-Tong-Kung.jpg?x=1") == "Tong-Kung.jpg"
    assert file_key("https://upload.wikimedia.org/wikipedia/commons/b/ba/%27WAT_ARUN%27.jpg_02.jpg") == "'WAT_ARUN'.jpg_02.jpg"
    for ok in ("CC BY-SA 4.0", "CC BY 2.0", "CC0", "Public domain", "CC BY-SA 3.0 de"):
        assert FREE.match(ok), ok
    for bad in ("CC BY-NC-SA 4.0", "CC BY-ND 2.0", "", "GFDL", "Copyrighted"):
        assert not FREE.match(bad), bad
    assert not any(NOT_PHOTO_CAT.match(c) for c in "Wat Arun|Cultural heritage monuments in Thailand missing SDC location of creation".split("|"))
    assert NOT_PHOTO_CAT.match("Maps of Bangkok") and NOT_PHOTO_CAT.match("Location maps of Thailand")
    assert NOT_PHOTO.search("Location map Thailand") and NOT_PHOTO.search("Seal of Bangkok") and not NOT_PHOTO.search("Wat Arun at dusk")
    page = {"title": "File:Wat Arun.jpg", "imageinfo": [{"mime": "image/jpeg", "width": 4000, "height": 3000,
            "url": "https://upload.wikimedia.org/wikipedia/commons/a/ab/Wat_Arun.jpg?utm=1", "descriptionurl": "https://commons.wikimedia.org/wiki/File:Wat_Arun.jpg",
            "thumburl": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Wat_Arun.jpg/1280px-Wat_Arun.jpg?utm=1",
            "extmetadata": {"LicenseShortName": {"value": "CC BY-SA 4.0"}, "Artist": {"value": "<a href='x'>Someone</a>"}}}]}
    ph, why = photo(page)
    assert why == "ok" and ph["author"] == "Someone" and ph["url"].endswith("/1280px-Wat_Arun.jpg"), ph
    assert ph["small_url"] == "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Wat_Arun.jpg/500px-Wat_Arun.jpg", ph
    tall = dict(ph, file="Tall.jpg", width=900, height=1600)
    assert [p["file"] for p in pick([tall, ph, ph], {"Other.jpg"})] == ["Wat Arun.jpg", "Tall.jpg"]
    assert pick([ph], {"Wat_Arun.jpg"}) == []
    print("ok")


if __name__ == "__main__":
    import sys
    demo() if sys.argv[1:] == ["--self-test"] else main()
