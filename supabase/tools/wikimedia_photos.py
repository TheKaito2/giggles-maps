"""Landmark photos from Wikimedia Commons -> reviewable SQL for public.place_photos. Never touches the database.

python wikimedia_photos.py places.tsv --output photos.sql
places.tsv: "place_id<TAB>wikidata_id" per line (export: select id, wikidata from places where wikidata is not null).
Each photo keeps its author and licence; the app shows them under the photo (required by CC licences).
"""
import argparse
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

UA = "GigglesMaps/1.0 (https://giggles-maps.pages.dev; place photos for a travel app)"
FREE = re.compile(r"^(cc0|public domain|pd|cc[ -]by(-sa)?( \d\.\d)?|cc[ -]by(-sa)? \d\.\d \w+)$", re.I)


def get(url, params):
    req = urllib.request.Request(url + "?" + urllib.parse.urlencode(params), headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception:
            time.sleep(2 ** attempt)
    raise RuntimeError(f"failed: {url}")


def strip_html(s):
    text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s or "")).strip()[:120]
    return "" if text.casefold().startswith("no machine-readable") else text


def p18_files(qids):
    """Wikidata Q-id -> Commons file name of its main image (P18)."""
    out = {}
    for i in range(0, len(qids), 50):
        data = get("https://www.wikidata.org/w/api.php", {"action": "wbgetentities", "ids": "|".join(qids[i:i + 50]),
                                                          "props": "claims", "format": "json"})
        for qid, ent in data.get("entities", {}).items():
            claims = ent.get("claims", {}).get("P18", [])
            if claims:
                out[qid] = claims[0]["mainsnak"]["datavalue"]["value"]
        time.sleep(0.5)
    return out


def lead_images(qids):
    """Fallback for places whose Wikidata item has no P18: the free lead image of its English or Thai Wikipedia
    article (Wikipedia's page_image_free, which only ever names a freely licensed file)."""
    titles = {}   # (wiki, title) -> qid
    for i in range(0, len(qids), 50):
        data = get("https://www.wikidata.org/w/api.php", {"action": "wbgetentities", "ids": "|".join(qids[i:i + 50]),
                                                          "props": "sitelinks", "sitefilter": "enwiki|thwiki", "format": "json"})
        for qid, ent in data.get("entities", {}).items():
            for wiki in ("enwiki", "thwiki"):
                link = ent.get("sitelinks", {}).get(wiki)
                if link:
                    titles[(wiki, link["title"])] = qid
        time.sleep(0.5)
    out = {}
    for wiki in ("enwiki", "thwiki"):
        names = [t for (w, t) in titles if w == wiki]
        host = "en.wikipedia.org" if wiki == "enwiki" else "th.wikipedia.org"
        for i in range(0, len(names), 20):
            data = get(f"https://{host}/w/api.php", {"action": "query", "titles": "|".join(names[i:i + 20]),
                                                     "prop": "pageprops", "ppprop": "page_image_free", "format": "json"})
            norm = {n["to"]: n["from"] for n in data.get("query", {}).get("normalized", [])}
            for page in data.get("query", {}).get("pages", {}).values():
                image = page.get("pageprops", {}).get("page_image_free")
                qid = titles.get((wiki, norm.get(page.get("title"), page.get("title"))))
                if image and qid and qid not in out:   # English first, Thai fills the gaps
                    out[qid] = image
            time.sleep(0.5)
    return out


def image_info(files):
    """Commons file name -> (thumbnail url, author, licence) for freely licensed files only."""
    out = {}
    names = list(files)
    for i in range(0, len(names), 20):   # long (often Thai) file names: 50 per request overflows the URL limit
        data = get("https://commons.wikimedia.org/w/api.php", {
            "action": "query", "titles": "|".join("File:" + n for n in names[i:i + 20]), "prop": "imageinfo",
            "iiprop": "url|extmetadata", "iiurlwidth": 1000, "format": "json"})
        for page in data.get("query", {}).get("pages", {}).values():
            info = (page.get("imageinfo") or [None])[0]
            if not info:
                continue
            meta = info.get("extmetadata", {})
            licence = strip_html(meta.get("LicenseShortName", {}).get("value"))
            if not FREE.match(licence):
                continue
            out[page["title"].removeprefix("File:")] = (info.get("thumburl") or info["url"],
                                                        strip_html(meta.get("Artist", {}).get("value")) or "Wikimedia Commons", licence)
        time.sleep(0.5)
    return out


def quote(v):
    return "NULL" if v is None else "'" + str(v).replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("places", type=Path)
    ap.add_argument("--output", type=Path, required=True)
    args = ap.parse_args()
    rows = [line.split("\t") for line in args.places.read_text(encoding="utf-8").splitlines() if "\t" in line]
    by_qid = {}
    for pid, qid in rows:
        if re.fullmatch(r"Q\d+", qid.strip()):
            by_qid.setdefault(qid.strip(), []).append(int(pid))
    files = p18_files(sorted(by_qid))
    files.update(lead_images(sorted(set(by_qid) - set(files))))   # no P18: the Wikipedia article's free lead image
    infos = image_info(set(files.values()))
    values = []
    for qid, f in files.items():
        info = infos.get(f.replace("_", " "))
        if info:
            values += [f"({pid}, 'wikimedia', {quote(info[0])}, {quote(info[1])}, {quote(info[2])})" for pid in by_qid[qid]]
    with args.output.open("w", encoding="utf-8") as out:
        out.write("-- Landmark photos: Wikimedia Commons, each with its author and licence.\n")
        out.write("delete from public.place_photos where source = 'wikimedia';\n")
        for i in range(0, len(values), 500):
            out.write("insert into public.place_photos (place_id, source, url, credit, licence) values\n" + ",\n".join(values[i:i + 500]) + ";\n")
    print(json.dumps({"places_with_wikidata": len(rows), "with_image": len(files), "free_photos": len(values)}))


if __name__ == "__main__":
    main()
