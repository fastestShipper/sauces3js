"""Re-fetch the Los Sauces / Poussin zone from OSM, enriched for FIDELITY:
keeps building TYPE (bt), roof shape (rs), shop/amenity subtype (k) — the data
the toon templates need to make houses look like houses and shops like shops.

Local ground-truth overrides (things OSM gets wrong or omits) live in
LOCAL_POI_OVERRIDES, keyed by lowercased name.

Output: ../assets/zone.json
"""

import json
import math
import time
import urllib.request
import urllib.parse
from pathlib import Path

ORIGIN = (-12.0871209, -76.9852216)  # Poussin 123 (world 0,0)
PAD_LAT = 0.0030
PAD_LON = 0.0038
BBOX = (ORIGIN[0] - PAD_LAT, ORIGIN[1] - PAD_LON,
        ORIGIN[0] + PAD_LAT, ORIGIN[1] + PAD_LON)

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

# conocimiento local del comandante (override de lo que OSM no sabe / trae mal)
LOCAL_POI_OVERRIDES = {
    "ojeda": "minimarket",   # bodega/minimarket en Poussin
}

M_PER_DEG_LAT = 110574.0
M_PER_DEG_LON = 111320.0 * math.cos(math.radians(ORIGIN[0]))


def project(lat, lon):
    x = (lon - ORIGIN[1]) * M_PER_DEG_LON
    z = -(lat - ORIGIN[0]) * M_PER_DEG_LAT
    return round(x, 2), round(z, 2)


def overpass(query):
    body = urllib.parse.urlencode({"data": query}).encode()
    last = None
    for url in OVERPASS_URLS:
        for _ in range(2):
            try:
                req = urllib.request.Request(url, data=body, headers={
                    "User-Agent": "lima-zone-prototype/1.0"})
                with urllib.request.urlopen(req, timeout=180) as r:
                    return json.loads(r.read().decode())
            except Exception as e:  # noqa: BLE001
                last = e
                print(f"  mirror failed: {e}")
                time.sleep(4)
    raise RuntimeError(f"overpass dead: {last}")


def way_points(way):
    return [project(n["lat"], n["lon"]) for n in way.get("geometry", [])]


S, W, N, E = BBOX
bb = f"{S},{W},{N},{E}"

print("== overpass query (zone is tiny) ==")
raw = overpass(
    f'[out:json][timeout:120];('
    f'way["building"]({bb});'
    f'way["highway"]({bb});'
    f'way["barrier"]({bb});'
    f'way["leisure"~"park|garden|playground|pitch"]({bb});'
    f'way["landuse"~"grass|recreation_ground|village_green"]({bb});'
    f'node["natural"="tree"]({bb});'
    f'node["shop"]({bb});'
    f'node["amenity"]({bb});'
    f');out geom;')
elements = raw.get("elements", [])
print(f"   elements: {len(elements)}")

ROAD_WIDTHS = {
    "motorway": 18, "trunk": 16, "primary": 13, "secondary": 11,
    "tertiary": 9, "residential": 6.5, "unclassified": 6.5,
    "living_street": 5.5, "pedestrian": 4, "service": 4,
    "footway": 1.8, "path": 1.6, "cycleway": 2.2, "steps": 1.8,
}

out = {"origin": {"lat": ORIGIN[0], "lon": ORIGIN[1]},
       "buildings": [], "roads": [], "green": [], "barriers": [],
       "trees": [], "pois": []}

for el in elements:
    tags = el.get("tags", {})
    if el["type"] == "node":
        if "lat" not in el:
            continue
        x, z = project(el["lat"], el["lon"])
        if tags.get("natural") == "tree":
            out["trees"].append([x, z])
        elif "shop" in tags or "amenity" in tags:
            name = tags.get("name", "")
            kind = tags.get("shop") or tags.get("amenity") or ""
            ov = LOCAL_POI_OVERRIDES.get(name.strip().lower())
            if ov:
                kind = ov
            cat = "food" if (kind in ("restaurant", "cafe", "fast_food", "bar")
                             or "amenity" in tags and "shop" not in tags) else "shop"
            poi = {"x": x, "z": z, "c": cat, "k": kind[:18]}
            if name:
                poi["n"] = name[:34]
            out["pois"].append(poi)
        continue

    pts = way_points(el)
    if "building" in tags and len(pts) >= 4:
        h = None
        if tags.get("height"):
            try:
                h = float(str(tags["height"]).replace("m", "").strip())
            except ValueError:
                pass
        if h is None and tags.get("building:levels"):
            try:
                h = float(tags["building:levels"]) * 2.9
            except ValueError:
                pass
        if h is None:
            h = 2.9 + (el["id"] * 2654435761 % 100) / 100 * 4.5
        b = {"p": pts[:-1], "h": round(min(h, 60.0), 1)}
        bt = tags.get("building")
        if bt and bt != "yes":
            b["bt"] = bt[:16]            # tipo real: apartments/house/commercial/retail/school...
        if tags.get("roof:shape"):
            b["rs"] = tags["roof:shape"][:12]
        if tags.get("name"):
            b["n"] = tags["name"][:30]
        if tags.get("addr:housenumber"):
            b["addr"] = tags["addr:housenumber"][:6]
        if tags.get("building:colour"):
            b["bc"] = tags["building:colour"][:18]
        if tags.get("roof:colour"):
            b["rfc"] = tags["roof:colour"][:18]
        if tags.get("building:levels"):
            b["lv"] = str(tags["building:levels"])[:3]
        if bt in ("garage", "garages", "shed"):
            b["minor"] = 1
        out["buildings"].append(b)
    elif "highway" in tags and len(pts) >= 2:
        cls = tags["highway"]
        road = {"p": pts, "w": ROAD_WIDTHS.get(cls, 6.5), "t": cls}
        if tags.get("name"):
            road["n"] = tags["name"]
        if tags.get("bridge") in ("yes", "viaduct"):
            road["bridge"] = 1
        try:
            road["layer"] = int(tags.get("layer", "0"))
        except ValueError:
            pass
        out["roads"].append(road)
    elif "barrier" in tags and len(pts) >= 2:
        out["barriers"].append({"p": pts, "t": tags["barrier"]})
    elif len(pts) >= 4:
        out["green"].append({"p": pts[:-1]})

dest = Path(__file__).resolve().parent.parent / "assets" / "zone.json"
dest.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
typed = sum(1 for b in out["buildings"] if b.get("bt"))
print(f"== wrote {dest} ({dest.stat().st_size/1024:.0f} KB) ==")
print(f"   buildings={len(out['buildings'])} (con tipo={typed}) roads={len(out['roads'])} "
      f"trees={len(out['trees'])} green={len(out['green'])} pois={len(out['pois'])}")
from collections import Counter
print("   tipos:", dict(Counter(b.get('bt', '(yes)') for b in out['buildings'])))
print("   pois:", [(p.get('n'), p.get('k')) for p in out['pois']])
