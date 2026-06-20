/**
 * Parcel index for Los Sauces (Phase 3). No claims or housing UI.
 */

function dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

export class ParcelIndex {
  /**
   * @param {Array<{ parcelId: string, buildingIndex: number, center: { x: number, z: number }, displayAddress: string, claimable: boolean, confidence: string }>} parcels
   */
  constructor(parcels) {
    this.parcels = Array.isArray(parcels) ? parcels.slice() : [];
  }

  get count() {
    return this.parcels.length;
  }

  /**
   * @param {number} x
   * @param {number} z
   * @param {number} [maxDist=8]
   * @returns {object|null}
   */
  nearest(x, z, maxDist = 8) {
    const maxD2 = maxDist * maxDist;
    let best = null;
    let bestD2 = maxD2;
    for (const p of this.parcels) {
      const c = p.center;
      if (!c) continue;
      const d2 = dist2(x, z, c.x, c.z);
      if (d2 <= bestD2) {
        bestD2 = d2;
        best = p;
      }
    }
    return best;
  }

  /**
   * @param {number} x
   * @param {number} z
   * @param {number} [radius=40]
   * @param {number} [limit=24]
   * @returns {object[]}
   */
  nearby(x, z, radius = 40, limit = 24) {
    const r2 = radius * radius;
    const hits = [];
    for (const p of this.parcels) {
      const c = p.center;
      if (!c) continue;
      const d2 = dist2(x, z, c.x, c.z);
      if (d2 <= r2) hits.push({ parcel: p, dist2: d2 });
    }
    hits.sort((a, b) => a.dist2 - b.dist2);
    return hits.slice(0, limit).map((h) => h.parcel);
  }
}

let _cache = null;
let _cacheVersion = null;

/**
 * @param {string} [version='20260620v2'] cache-buster query for fetch
 * @returns {Promise<ParcelIndex>}
 */
export async function loadParcels(version = '20260620v2') {
  if (_cache && _cacheVersion === version) return _cache;
  const url = `./assets/parcels.json?v=${encodeURIComponent(version)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`loadParcels: HTTP ${res.status} for ${url}`);
  const data = await res.json();
  if (!data || data.worldId !== 'los_sauces' || !Array.isArray(data.parcels)) {
    throw new Error('loadParcels: invalid parcels.json shape');
  }
  _cache = new ParcelIndex(data.parcels);
  _cacheVersion = version;
  return _cache;
}