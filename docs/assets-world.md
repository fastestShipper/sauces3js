# World assets manifest (Los Sauces / sauces3js)

Commercial-safe assets used for **environment only** (no character sourcing in this pass).

## Photo textures (`assets/textures/`)

| File | Size (approx) | License / source | Usage |
|------|---------------|------------------|--------|
| `asphalt_real.jpg` | ~1.1 MB | Project bundle; typical CC0 road asphalt (Poly Haven / ambientCG style) | Road surface |
| `sidewalk.jpg` | ~1.3 MB | Same | Sidewalks |
| `sidewalk_n.jpg` | ~1.9 MB | Same | Sidewalk normal (lazy load) |
| `paving_real.jpg` | ~820 KB | Same | Pedestrian paths, plaza tint |
| `concrete.jpg` | ~270 KB | Same | Base ground plane |
| `concrete_n.jpg` | ~820 KB | Same | Optional normals |
| `grass.jpg` | ~1.9 MB | Same | Legacy; `grass2.jpg` preferred |
| `grass2.jpg` | ~1.7 MB | Same | Lawns, berms, medians |
| `plaster.jpg` | ~830 KB | Same | Building facades (vertex color multiply) |
| `plaster_n.jpg` | ~2.0 MB | Same | Facade normal (lazy load) |
| `sky.hdr` | ~4.4 MB | Poly Haven CC0 (equirectangular) | Optional HDR sky (async, non-blocking) |

Run `python scripts/compress_world_textures.py` to regenerate web-sized JPEGs (1024px max edge).

## Instanced world GLB (`assets/models/`)

| File | Size | License | Usage |
|------|------|---------|--------|
| `kaykit_forest.glb` | ~96 KB | [KayKit](https://kaylousberg.itch.io/kaykit) CC0 | Trees, bushes, rocks (deferred load) |
| `tree0.glb`, `tree1.glb`, `tree2.glb` | ~3 MB each | Legacy KayKit extracts | Not used in default boot (forest pack preferred) |
| `k_*.glb` vehicles | 172–236 KB | KayKit City / vehicles CC0 | Parked cars (deferred) |

Character GLBs under `assets/models/char_*` and `assets/source/` are **out of scope** for this world pass.

## Procedural

| Asset | License | Usage |
|-------|---------|--------|
| `src/props.js` | Project code | Lamps, benches, hydrants, bins (instanced) |
| `src/worldmat.js` grain fallback | Project code | Canvas noise if JPG load fails |

## Code touchpoints

- Materials: `src/worldmat.js`, wired in `src/app.js`
- Geometry: `src/citymesh.js` (OSM roads, buildings, parks)
- Deferred polish: `loadHeavyDecor()` in `src/app.js`