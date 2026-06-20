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