# Quality gates (Phases 0–3)

Run from repo root. No bundler required.

## Phase 0: Map and world

| Gate | Command |
|------|---------|
| OSM building count (default `City()` = zone count) | `node scripts/audit_building_count.mjs` |
| `zone.json` structure, 312 buildings, no persisted filler | `node scripts/audit_zone_integrity.mjs` |
| World texture assets (if changed) | `node scripts/audit_world_assets.mjs` |

Manual (not automated here):

- Desktop FPS ~60 avg / 45 min in dense areas.
- Mobile FPS ~30 avg / 20 min.
- Browser console: 0 errors on 10-minute walk.
- Minimap aligns with world geometry.

## Phase 1: Gameplay and multiplayer

| Gate | Command |
|------|---------|
| Foundation smoke (audits + HTTP + WS) | See below |

Manual:

- Guest explore, login/register, reconnect with 2 clients for 30 minutes.
- No ghost players after disconnect.

## Phase 2: Backend and smoke harness

| Gate | Command |
|------|---------|
| Store shape (no secrets printed) | `node scripts/audit_server_store.mjs` |
| Full foundation smoke | `node scripts/smoke_foundation.mjs` |

Local relay + static server:

```bash
cd server && npm install && node server.js
# another shell, repo root:
python -m http.server 8877
SMOKE_HTTP_BASE=http://127.0.0.1:8877 SMOKE_WS_URL=ws://127.0.0.1:8456 node scripts/smoke_foundation.mjs
```

Production HTTP-only smoke (no local WS):

```bash
SMOKE_HTTP_BASE=https://sauces.controla.group SMOKE_SKIP_WS=1 node scripts/smoke_foundation.mjs
```

Health (relay host only, default `127.0.0.1:8457`):

```bash
curl -s http://127.0.0.1:8457/health
```

Slow store flush warning threshold: `STORE_FLUSH_WARN_MS` (default 50). Verbose flush log: `STORE_LOG_FLUSH=1`.

## Phase 3: Parcels

| Gate | Command |
|------|---------|
| Generate parcel index | `python tools/build_parcels.py` |
| Parcel index vs buildings | `node scripts/audit_parcels.mjs` |
| Optional OSM refresh (ids, street) | `python tools/fetch_zone.py` then rebuild parcels |

Pre-deploy with parcels:

1. `node scripts/audit_building_count.mjs`
2. `node scripts/audit_zone_integrity.mjs`
3. `node scripts/audit_parcels.mjs`
4. `node scripts/smoke_foundation.mjs` (local or prod)

See `docs/parcels.md` for data shape and no-claims boundary.

## Pre-deploy checklist

1. `node scripts/smoke_foundation.mjs` (local or prod HTTP as appropriate).
2. Bump `?v=` in `index.html` and module imports if client assets changed.
3. `scp` per README / plan (include `server/` when relay changes).
4. Update `CHANGELOG.md`.