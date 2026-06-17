// City generation logic — faithful port of the Godot main.gd pipeline:
// continuous party-wall frontage strips + interior carpet + real OSM
// footprints, spatial hashes for road/footprint queries.

export const ROAD_Y = 0.02;
export const WALK_Y = 0.09;
const SEG_CELL = 24.0;

// paleta TOON: pasteles brillantes y variados (KayKit-style), no tierra apagada
export const WALL_COLORS = [
  [0.92, 0.84, 0.62], [0.86, 0.55, 0.42], [0.60, 0.74, 0.84],
  [0.64, 0.80, 0.60], [0.92, 0.74, 0.62], [0.72, 0.66, 0.82],
  [0.90, 0.82, 0.50], [0.80, 0.78, 0.74], [0.85, 0.66, 0.66],
  [0.55, 0.76, 0.78], [0.72, 0.78, 0.58], [0.82, 0.62, 0.52],
];
export const TRIM_COLORS = [
  [0.92, 0.91, 0.88], [0.30, 0.24, 0.18], [0.45, 0.46, 0.48],
  [0.92, 0.91, 0.88], [0.25, 0.30, 0.28],
];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hashF = (i) => {
  const v = Math.sin(i * 12.9898) * 43758.5453;
  return (v - Math.floor(v)) * 0.5 + 0.5;
};

export class City {
  constructor(data) {
    this.data = data;
    this.carColliders = [];
    this.buildSegGrid();
    this.cachePolys();
    this.fillGaps();
    this.cachePolys();
  }

  buildSegGrid() {
    this.segs = [];
    this.segGrid = new Map();
    for (const r of this.data.roads) {
      const hw = (r.w ?? 6.0) * 0.5;
      const pts = r.p;
      for (let i = 0; i < pts.length - 1; i++) {
        this.segs.push([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], hw, r.n ?? '', !!r.bridge]);
      }
    }
    for (let idx = 0; idx < this.segs.length; idx++) {
      const s = this.segs[idx];
      const L = Math.hypot(s[2] - s[0], s[3] - s[1]);
      const steps = Math.floor(L / SEG_CELL) + 1;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const cx = Math.floor((s[0] + (s[2] - s[0]) * t) / SEG_CELL);
        const cz = Math.floor((s[1] + (s[3] - s[1]) * t) / SEG_CELL);
        for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
          const key = (cx + ox) + ',' + (cz + oz);
          let arr = this.segGrid.get(key);
          if (!arr) { arr = []; this.segGrid.set(key, arr); }
          if (arr[arr.length - 1] !== idx) arr.push(idx);
        }
      }
    }
  }

  segsNear(x, z) {
    return this.segGrid.get(Math.floor(x / SEG_CELL) + ',' + Math.floor(z / SEG_CELL)) || [];
  }

  onAnyRoad(x, z, margin = 0) {
    for (const idx of this.segsNear(x, z)) {
      const s = this.segs[idx];
      const dx = s[2] - s[0], dz = s[3] - s[1];
      const l2 = dx * dx + dz * dz;
      if (l2 < 0.01) continue;
      let t = ((x - s[0]) * dx + (z - s[1]) * dz) / l2;
      t = Math.max(0, Math.min(1, t));
      const px = s[0] + dx * t, pz = s[1] + dz * t;
      const rr = s[4] + margin;
      if ((x - px) * (x - px) + (z - pz) * (z - pz) < rr * rr) return true;
    }
    return false;
  }

  nearOtherRoad(x, z, ax, az, bx, bz) {
    const ol = Math.hypot(bx - ax, bz - az) || 1;
    const oux = (bx - ax) / ol, ouz = (bz - az) / ol;
    for (const idx of this.segsNear(x, z)) {
      const s = this.segs[idx];
      if (Math.abs(s[0] - ax) < 0.01 && Math.abs(s[1] - az) < 0.01 &&
          Math.abs(s[2] - bx) < 0.01 && Math.abs(s[3] - bz) < 0.01) continue;
      const dx = s[2] - s[0], dz = s[3] - s[1];
      const l2 = dx * dx + dz * dz;
      if (l2 < 0.01) continue;
      const il = Math.sqrt(l2);
      if (Math.abs((dx / il) * oux + (dz / il) * ouz) > 0.8) continue; // paralelas exentas
      let t = ((x - s[0]) * dx + (z - s[1]) * dz) / l2;
      t = Math.max(0, Math.min(1, t));
      const px = s[0] + dx * t, pz = s[1] + dz * t;
      const rr = s[4] + 1.0;
      if ((x - px) * (x - px) + (z - pz) * (z - pz) < rr * rr) return true;
    }
    return false;
  }

  nearestRoadDir(x, z) {
    let best = 1e18, dir = [1, 0];
    let cand = this.segsNear(x, z);
    let ring = 2;
    while (cand.length === 0 && ring <= 8) {
      const cx = Math.floor(x / SEG_CELL), cz = Math.floor(z / SEG_CELL);
      const merged = new Set();
      for (let ox = -ring; ox <= ring; ox++) for (let oz = -ring; oz <= ring; oz++) {
        for (const idx of (this.segGrid.get((cx + ox) + ',' + (cz + oz)) || [])) merged.add(idx);
      }
      cand = [...merged];
      ring += 2;
    }
    for (const idx of cand) {
      const s = this.segs[idx];
      const dx = s[2] - s[0], dz = s[3] - s[1];
      const l2 = dx * dx + dz * dz;
      if (l2 < 0.01) continue;
      let t = ((x - s[0]) * dx + (z - s[1]) * dz) / l2;
      t = Math.max(0, Math.min(1, t));
      const px = s[0] + dx * t, pz = s[1] + dz * t;
      const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d2 < best) { best = d2; const il = Math.sqrt(l2); dir = [dx / il, dz / il]; }
    }
    return dir;
  }

  pointInRing(x, z, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }

  cachePolys() {
    this.greenBB = this.data.green.map(g => {
      let minx = 1e18, minz = 1e18, maxx = -1e18, maxz = -1e18;
      for (const p of g.p) { minx = Math.min(minx, p[0]); minz = Math.min(minz, p[1]); maxx = Math.max(maxx, p[0]); maxz = Math.max(maxz, p[1]); }
      return [minx, minz, maxx, maxz];
    });
    this.ringGrid = new Map();
    this.rings = [];
    for (const b of this.data.buildings) {
      let minx = 1e18, minz = 1e18, maxx = -1e18, maxz = -1e18;
      for (const p of b.p) { minx = Math.min(minx, p[0]); minz = Math.min(minz, p[1]); maxx = Math.max(maxx, p[0]); maxz = Math.max(maxz, p[1]); }
      const idx = this.rings.length;
      this.rings.push({ ring: b.p, bb: [minx, minz, maxx, maxz], h: b.h ?? 5 });
      for (let cx = Math.floor((minx - 3) / SEG_CELL); cx <= Math.floor((maxx + 3) / SEG_CELL); cx++) {
        for (let cz = Math.floor((minz - 3) / SEG_CELL); cz <= Math.floor((maxz + 3) / SEG_CELL); cz++) {
          const key = cx + ',' + cz;
          let arr = this.ringGrid.get(key);
          if (!arr) { arr = []; this.ringGrid.set(key, arr); }
          arr.push(idx);
        }
      }
    }
  }

  inAnyGreen(x, z) {
    for (let i = 0; i < this.data.green.length; i++) {
      const bb = this.greenBB[i];
      if (x < bb[0] || x > bb[2] || z < bb[1] || z > bb[3]) continue;
      if (this.data.green[i].p.length >= 3 && this.pointInRing(x, z, this.data.green[i].p)) return true;
    }
    return false;
  }

  inRealBuilding(x, z, margin) {
    const key = Math.floor(x / SEG_CELL) + ',' + Math.floor(z / SEG_CELL);
    for (const ri of (this.ringGrid.get(key) || [])) {
      const rr = this.rings[ri];
      const bb = rr.bb;
      if (x < bb[0] - margin || x > bb[2] + margin || z < bb[1] - margin || z > bb[3] + margin) continue;
      if (this.pointInRing(x, z, rr.ring)) return true;
      if (margin > 0 && this.pointInRing(Math.max(bb[0], Math.min(bb[2], x)), Math.max(bb[1], Math.min(bb[3], z)), rr.ring)) return true;
    }
    return false;
  }

  inTallerBuilding(x, z, minH) {
    const key = Math.floor(x / SEG_CELL) + ',' + Math.floor(z / SEG_CELL);
    for (const ri of (this.ringGrid.get(key) || [])) {
      const rr = this.rings[ri];
      const bb = rr.bb;
      if (rr.h < minH) continue;
      if (x < bb[0] || x > bb[2] || z < bb[1] || z > bb[3]) continue;
      if (this.pointInRing(x, z, rr.ring)) return true;
    }
    return false;
  }

  carRoofAt(x, z) {
    // techo del auto bajo ese punto (0 = no hay auto)
    for (const c of this.carColliders) {
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz > 16) continue;
      const s = Math.sin(-c.ang), co = Math.cos(-c.ang);
      const lx = dx * co - dz * s;
      const lz = dx * s + dz * co;
      if (Math.abs(lz) < c.hw + 0.1 && Math.abs(lx) < c.hd + 0.1) return c.roofY ?? 1.75;
    }
    return 0;
  }

  hitsCar(x, z, pad = 0.22) {
    for (const c of this.carColliders) {
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz > 16) continue;
      const s = Math.sin(-c.ang), co = Math.cos(-c.ang);
      const lx = dx * co - dz * s;
      const lz = dx * s + dz * co;
      if (Math.abs(lz) < c.hw + pad && Math.abs(lx) < c.hd + pad) return true;
    }
    return false;
  }

  parcelHeight(full, rng, mcx, mcz) {
    const bh = hashF(Math.floor(mcx / 34) * 131 + Math.floor(mcz / 34) * 17);
    if (full >= 12) {
      if (bh < 0.25) return 6.5 + bh * 4.0;
      return 15.0 + bh * 9.0;
    }
    if (full >= 9) return 8.0 + bh * 6.0;
    if (hashF(Math.trunc(mcx * 7.3) + Math.trunc(mcz * 3.1)) > 0.95) return 10.0 + bh * 2.0;
    return 5.2 + bh * 2.6 + rng() * 0.5;
  }

  fillGaps() {
    const rng = mulberry32(99);
    const fillers = [];
    // SAN BORJA FABRIC: tiras continuas pared-con-pared en ambos frentes
    for (const r of this.data.roads) {
      const full = r.w ?? 6.0;
      if (full < 4.0 || r.bridge) continue;
      const pts = r.p;
      for (let i = 0; i < pts.length - 1; i++) {
        const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 7.0) continue;
        const ux = (bx - ax) / L, uz = (bz - az) / L;
        const nx = -uz, nz = ux;
        for (const side of [1, -1]) {
          const front = full * 0.5 + 3.0;
          let d = 0.0;
          while (d < L) {
            let frontage = 6.0 + rng() * 3.5;
            if (d + frontage > L) frontage = L - d;
            if (frontage < 2.5) break;
            const c0x = ax + ux * d + nx * front * side, c0z = az + uz * d + nz * front * side;
            const c1x = ax + ux * (d + frontage) + nx * front * side, c1z = az + uz * (d + frontage) + nz * front * side;
            let corners = null, mcx = 0, mcz = 0, ok = false;
            for (const depth of [17, 14, 11, 8, 5.5]) {
              const c2x = c1x + nx * depth * side, c2z = c1z + nz * depth * side;
              const c3x = c0x + nx * depth * side, c3z = c0z + nz * depth * side;
              corners = [[c0x, c0z], [c1x, c1z], [c2x, c2z], [c3x, c3z]];
              mcx = (c0x + c2x) * 0.5; mcz = (c0z + c2z) * 0.5;
              ok = true;
              for (const c of corners) {
                if (this.inAnyGreen(c[0], c[1]) || this.onAnyRoad(c[0], c[1], 0.5) || this.inRealBuilding(c[0], c[1], 0.6)) { ok = false; break; }
              }
              if (ok && (this.inRealBuilding(mcx, mcz, 0.6) || this.inAnyGreen(mcx, mcz))) ok = false;
              if (ok) break;
            }
            if (ok) fillers.push({ p: corners, h: this.parcelHeight(full, rng, mcx, mcz) });
            d += frontage;
          }
        }
      }
    }
    for (const fb of fillers) this.data.buildings.push(fb);
    this.cachePolys();
    // interior carpet: alfombra contigua de patios
    let minx = 1e18, minz = 1e18, maxx = -1e18, maxz = -1e18;
    for (const r of this.data.roads) for (const p of r.p) {
      minx = Math.min(minx, p[0]); minz = Math.min(minz, p[1]);
      maxx = Math.max(maxx, p[0]); maxz = Math.max(maxz, p[1]);
    }
    const inner = [];
    for (let gx = minx; gx < maxx; gx += 9.0) {
      for (let gz = minz; gz < maxz; gz += 9.0) {
        if (this.onAnyRoad(gx, gz, 5.5) || this.inAnyGreen(gx, gz) || this.inRealBuilding(gx, gz, 1.2)) continue;
        const dirv = this.nearestRoadDir(gx, gz);
        const nvx = -dirv[1], nvz = dirv[0];
        const hw2 = 4.51, hd2 = 4.51;
        const ic = [
          [gx - dirv[0] * hw2 - nvx * hd2, gz - dirv[1] * hw2 - nvz * hd2],
          [gx + dirv[0] * hw2 - nvx * hd2, gz + dirv[1] * hw2 - nvz * hd2],
          [gx + dirv[0] * hw2 + nvx * hd2, gz + dirv[1] * hw2 + nvz * hd2],
          [gx - dirv[0] * hw2 + nvx * hd2, gz - dirv[1] * hw2 + nvz * hd2],
        ];
        let ok = true;
        for (const c of ic) {
          if (this.inAnyGreen(c[0], c[1]) || this.onAnyRoad(c[0], c[1], 3.2) || this.inRealBuilding(c[0], c[1], 0.6)) { ok = false; break; }
        }
        // jitter de altura por celda: la alfombra se solapa 2cm con la vecina
        // y a igual h los techos coplanares parpadean (z-fight)
        if (ok) inner.push({ p: ic, h: 5.2 + hashF(Math.floor(gx / 34) * 131 + Math.floor(gz / 34) * 17) * 4.0 + hashF(gx * 7.1 + gz * 13.3) * 0.07, plain: true });
      }
    }
    for (const fb of inner) this.data.buildings.push(fb);
  }
}
