# Changelog

## 2026-06-20

### Map fidelity (P0)
- `City` now uses OSM footprints only by default; party-wall strips and interior carpet are opt-in via `?procedural=1`.
- Minimap draws only OSM buildings (skips procedural filler).

### UX and load (P0)
- HDRI (`sky.hdr`) loads in the background; gradient sky until ready.
- Heavy GLBs (forest, cars), NPCs, and mobs load after the first playable frame.
- Post-class boot overlay with progress (no black screen).
- Guest mode: "Explorar sin guardar" skips account save.
- Remember last username in `localStorage`; session token stored when login succeeds.

### Enrichment (P1)
- OSM `trees` and `pois` from `zone.json` placed as atmosphere markers (not map structure).

### World visual pass 2 (20260620v2)
- Facades: base dirt band, height-based wall tint, window sills, existing zocalo/cornice/parapet detail retained.
- Streets: edge fog lines, worn lane dashes, double yellow on wide roads, curbs unchanged (3D sardinel).
- Ground: procedural roughness variation on base plane (no new assets).
- Parks: richer lawn vertex variation.
- Props: street signs and sidewalk planters (procedural instancing).
- Atmosphere: warmer sun, softer fog, slightly higher exposure; HDR still deferred.

### Foundation / QA (20260620v2, docs only)
- Roadmap: `docs/roadmap-neighborhood-mmo.md`, plan `docs/plans/2026-06-20-neighborhood-notes-parcels.md`.
- Audits: `audit_zone_integrity.mjs`, `audit_server_store.mjs`; smoke `scripts/smoke_foundation.mjs`.
- Relay store `schemaVersion: 1`, preserves unknown JSON keys; flush timing + local `/health` on port 8457.
- Quality gates: `docs/quality-gates.md`, backend notes: `docs/backend-hardening.md`.

### Parcels foundation (Phase 3, 20260620v2)
- `tools/fetch_zone.py` preserves `osmId` and `addr:street` on buildings; zone regenerated with 312 OSM buildings.
- `tools/build_parcels.py` writes `assets/parcels.json` (centroid, displayAddress, claimable hint, confidence).
- Client module `src/parcels.js`: `ParcelIndex`, `loadParcels(version)`.
- Audit `scripts/audit_parcels.mjs`; docs `docs/parcels.md`.
- No claims, disputes, notes, or UGC in parcel data.