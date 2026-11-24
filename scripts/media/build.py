#!/usr/bin/env python3
"""Builds the STIS media library from scripts/media/sources.json.

For each Wikimedia Commons source it re-reads the licence and author from the Commons API and stops if the
licence is not one STIS accepts. It then downloads a 1600 px rendition into a cache folder outside the
repository, resizes it with macOS `sips`, encodes AVIF (avifenc) and WebP (cwebp) without metadata into
public/media, and writes the typed manifest src/shared/mediaLibrary.ts. Local sources (generated
illustrations) go through the same pipeline.

Usage: python3 -I scripts/media/build.py --cache <folder outside the repo>
"""
import argparse, html, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
WIDTHS = [480, 960, 1600]
UA = "STIS-media-sync/1.0 (educational non-commercial project)"
ACCEPTED = re.compile(r"^(CC0|Public domain|CC BY(-SA)? (2\.0|2\.5|3\.0|4\.0))$", re.I)

def api(title):
    query = urllib.parse.urlencode({"action": "query", "titles": title, "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata",
                                    "iiurlwidth": 1600, "format": "json", "formatversion": "2", "maxlag": "5"})
    return fetch(f"https://commons.wikimedia.org/w/api.php?{query}", json_reply=True)

def fetch(url, json_reply=False):
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as reply:
                return json.load(reply) if json_reply else reply.read()
        except urllib.error.HTTPError as error:
            if error.code != 429 and error.code < 500: raise
            time.sleep(int(error.headers.get("Retry-After") or 0) or 10 * (attempt + 1))
    raise RuntimeError(f"gave up fetching {url}")

def text(value):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", value or ""))).strip()

def run(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def size(path):
    out = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", path], check=True, capture_output=True, text=True).stdout
    return int(re.search(r"pixelWidth: (\d+)", out)[1]), int(re.search(r"pixelHeight: (\d+)", out)[1])

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", required=True)
    cache = os.path.abspath(parser.parse_args().cache)
    if cache.startswith(ROOT): sys.exit("Use a cache folder outside the repository.")
    os.makedirs(cache, exist_ok=True)
    out_dir = os.path.join(ROOT, "public", "media")
    os.makedirs(out_dir, exist_ok=True)
    sources = json.load(open(os.path.join(ROOT, "scripts", "media", "sources.json")))
    library = []
    for source in sources:
        original = os.path.join(cache, f"{source['id']}.jpg")
        if "commons" in source:
            page = api(source["commons"])["query"]["pages"][0]
            info = page["imageinfo"][0]
            meta = info.get("extmetadata", {})
            licence = text(meta.get("LicenseShortName", {}).get("value"))
            if not ACCEPTED.match(licence): sys.exit(f"{source['id']}: licence '{licence}' is not accepted")
            author = text(meta.get("Artist", {}).get("value")) or "Unknown author"
            credit = {"kind": "photo", "author": author, "licence": licence, "licenceUrl": meta.get("LicenseUrl", {}).get("value", ""),
                      "source": "Wikimedia Commons", "sourceUrl": info["descriptionurl"], "title": page["title"].removeprefix("File:"),
                      "changes": "Resized, cropped for display and re-encoded as AVIF and WebP; metadata removed",
                      "originalSize": [info["width"], info["height"]]}
            if not os.path.exists(original):
                open(original, "wb").write(fetch(info["thumburl"]))
                time.sleep(1)
        else:
            run("sips", "-s", "format", "jpeg", os.path.join(ROOT, source["local"]), "--out", original)
            credit = {"kind": "illustration", "author": "Generated with an AI image model for STIS", "licence": "STIS project asset",
                      "licenceUrl": "", "source": "STIS", "sourceUrl": "", "title": source["subject"],
                      "changes": "Re-encoded as AVIF and WebP", "originalSize": list(size(original))}
        width, height = size(original)
        built = []
        for target in [w for w in WIDTHS if w <= width] or [width]:
            resized = os.path.join(cache, f"{source['id']}-{target}.jpg")
            run("sips", "--resampleWidth", str(target), original, "--out", resized)
            base = os.path.join(out_dir, f"{source['id']}-{target}")
            run("cwebp", "-quiet", "-q", "76", "-m", "6", "-metadata", "none", resized, "-o", f"{base}.webp")
            run("avifenc", "-q", "55", "-s", "6", "--ignore-exif", "--ignore-xmp", resized, f"{base}.avif")
            built.append(target)
        library.append({"id": source["id"], "subject": source["subject"], "alt": source["alt"], "recordIds": source["recordIds"],
                        "focus": source["focus"], "width": width, "height": height, "widths": built, **credit})
        print(f"{source['id']}: {credit['licence']} · {credit['author'][:40]} · {built}", file=sys.stderr)
    header = "// Generated by scripts/media/build.py from scripts/media/sources.json. Do not edit by hand.\n"
    body = "import type { MediaAsset } from \"./media.ts\";\n\nexport const mediaLibrary: MediaAsset[] = " + json.dumps(library, indent=2, ensure_ascii=False) + ";\n"
    open(os.path.join(ROOT, "src", "shared", "mediaLibrary.ts"), "w").write(header + body)

main()
