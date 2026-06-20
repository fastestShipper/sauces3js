"""Build assets/parcels.json from assets/zone.json (Phase 3 anchors only)."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ZONE_PATH = ROOT / "assets" / "zone.json"
OUT_PATH = ROOT / "assets" / "parcels.json"
WORLD_ID = "los_sauces"

NON_CLAIMABLE_BT = {
    "school", "retail", "commercial", "garage", "garages", "shed", "service",
    "public", "church", "hospital", "clinic", "police", "government", "office",
    "industrial", "warehouse", "civic", "university", "college", "kindergarten",
    "fire_station", "train_station", "transportation", "parking", "hangar",
    "bunker", "roof", "construction", "farm", "barn", "greenhouse",
}

NON_RES_NAME_MARKERS = (
    "colegio", "school", "iglesia", "church", "hospital", "clinica", "clinic",
    "policia", "comisaria", "municipalidad", "ministerio", "banco", "plaza vea",
    "tottus", "metro", "wong", "sodimac", "inkafarma", "mifarma",
)


def footprint_centroid(points: list) -> tuple[float, float]:
    if not points:
        return 0.0, 0.0
    xs = [p[0] for p in points]
    zs = [p[1] for p in points]
    return round(sum(xs) / len(xs), 2), round(sum(zs) / len(zs), 2)


def stable_footprint_hash(building: dict, index: int) -> str:
    payload = json.dumps(
        {"i": index, "p": building.get("p"), "h": building.get("h"), "bt": building.get("bt")},
        separators=(",", ":"),
        sort_keys=True,
    )
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]
    return f"fp:{digest}"


def parcel_id_for(building: dict, index: int) -> str:
    osm_id = building.get("osmId")
    if osm_id is not None:
        try:
            return f"osm:way:{int(osm_id)}"
        except (TypeError, ValueError):
            pass
    return stable_footprint_hash(building, index)


def display_address(building: dict, index: int) -> str:
    street = (building.get("street") or "").strip()
    number = (building.get("addr") or "").strip()
    if street and number:
        return f"{street} {number}"[:80]
    if street:
        return street[:80]
    if number:
        return f"Casa {number}"[:80]
    return f"Casa simbólica #{index + 1}"


def is_claimable(building: dict) -> bool:
    bt = (building.get("bt") or "yes").lower().strip()
    if bt in NON_CLAIMABLE_BT:
        return False
    if building.get("minor"):
        return False
    name = (building.get("n") or "").lower()
    if name:
        for marker in NON_RES_NAME_MARKERS:
            if marker in name:
                return False
    if bt in (
        "house", "residential", "apartments", "detached", "semidetached_house",
        "terrace", "yes", "residential_detached", "dormitory", "bungalow",
    ):
        return True
    if bt == "apartments":
        return True
    return bt == "yes"


def confidence_for(building: dict) -> str:
    osm_id = building.get("osmId")
    street = (building.get("street") or "").strip()
    number = (building.get("addr") or "").strip()
    has_addr = bool(street or number)
    if osm_id is not None and street and number:
        return "osm"
    if osm_id is not None or has_addr:
        return "partial"
    return "inferred"


def main() -> None:
    zone = json.loads(ZONE_PATH.read_text(encoding="utf-8"))
    buildings = zone.get("buildings") or []
    parcels = []
    for i, b in enumerate(buildings):
        cx, cz = footprint_centroid(b.get("p") or [])
        parcels.append({
            "parcelId": parcel_id_for(b, i),
            "buildingIndex": i,
            "center": {"x": cx, "z": cz},
            "displayAddress": display_address(b, i),
            "claimable": is_claimable(b),
            "confidence": confidence_for(b),
        })

    out = {"worldId": WORLD_ID, "parcels": parcels}
    OUT_PATH.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    claimable = sum(1 for p in parcels if p["claimable"])
    conf = {}
    for p in parcels:
        conf[p["confidence"]] = conf.get(p["confidence"], 0) + 1
    print(f"wrote {OUT_PATH} parcels={len(parcels)} claimable={claimable} confidence={conf}")


if __name__ == "__main__":
    main()