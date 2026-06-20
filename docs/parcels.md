# Parcels layer (Phase 3)

Stable parcel and address anchors for Los Sauces. This layer does **not** implement housing claims, disputes, co-residents, notes, or any user-generated content.

## Files

| File | Role |
|------|------|
| `assets/zone.json` | OSM buildings; optional `osmId`, `street`, `addr` per building (from `tools/fetch_zone.py`) |
| `assets/parcels.json` | Generated index: one parcel per building |
| `tools/build_parcels.py` | Reads zone, writes parcels |
| `src/parcels.js` | Browser `ParcelIndex` + `loadParcels(version)` |
| `scripts/audit_parcels.mjs` | CI gate for shape and no-claims boundary |

## Regenerate

```bash
python tools/fetch_zone.py    # optional; requires Overpass
python tools/build_parcels.py
node scripts/audit_parcels.mjs
```

## `parcels.json` shape

```json
{
  "worldId": "los_sauces",
  "parcels": [
    {
      "parcelId": "osm:way:123456789",
      "buildingIndex": 0,
      "center": { "x": -120.5, "z": -250.1 },
      "displayAddress": "Calle Ejemplo 123",
      "claimable": true,
      "confidence": "osm"
    }
  ]
}
```

- **parcelId**: `osm:way:<osmId>` when `building.osmId` exists; otherwise `fp:<sha256-prefix>` from footprint metadata.
- **buildingIndex**: index into `zone.json` `buildings` (unique, 0..n-1).
- **displayAddress**: street + number when both exist; street-only; `Casa <number>`; else `Casa simbólica #<n>`.
- **claimable**: product hint only (not enforced in game yet). Non-residential types (school, retail, garage, etc.) and sensitive named POIs are `false`.
- **confidence**: `osm` (id + street + number), `partial` (id or any address field), `inferred` (centroid only).

Forbidden in this file: `owner`, `claim` state, `dispute`, `note`, `author`, UGC fields. The boolean `claimable` is allowed as static metadata.

## Client usage (future UI)

```javascript
import { loadParcels, ParcelIndex } from './parcels.js?v=20260620v2';
const index = await loadParcels('20260620v2');
const here = index.nearest(playerX, playerZ, 8);
const around = index.nearby(playerX, playerZ, 40, 24);
```

## Product rules (not implemented)

Planned for later phases only: one active house claim per user, free houses only, disputes on taken houses, co-resident collaboration after resolution.