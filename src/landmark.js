// Hero landmark: the real corner apartment building at Jirón Los Sauces 202,
// urb. Jacaranda Etapa 2, San Borja. Modeled low-poly from the owner's photo
// + Google Street View (panoid Y6i3zzZMvKoipt3TtowsKA): a corner block with a
// white balcony facade (stacked charcoal balconies, wood-slat infill, glass),
// a dark charcoal stair-core monolith on the corner, a recessed dark ground
// floor with garage, and the street fence. Writes into the same merged
// {wall, glass, trim, door, roof} buckets as buildBuildings — no extra draw calls.
//
// Placement is anchored to the *Jirón Los Sauces* roadway specifically (the
// E-W street the building is addressed on), so the facade faces Los Sauces and
// NOT the perpendicular Poussin frontage.

// the Street View camera point in front of the building (real lat/lon)
const STREET_PT = { lat: -12.086687, lon: -76.9851246 };

function projectLatLon(lat, lon, origin) {
  const mLat = 110574.0;
  const mLon = 111320.0 * Math.cos((origin.lat * Math.PI) / 180);
  return { x: (lon - origin.lon) * mLon, z: -(lat - origin.lat) * mLat };
}

// linear-space colors (the wall bucket multiplies a plaster texture)
const WHITE = [0.86, 0.84, 0.80];
const PARAPET = [0.80, 0.78, 0.73];
const CHARCOAL = [0.45, 0.48, 0.55];   // toon slate (era casi negro, cantaba entre pasteles)
const CHARDARK = [0.38, 0.41, 0.48];
const WOOD = [0.40, 0.28, 0.15];
const GREY = [0.48, 0.49, 0.52];
const REJA = [0.09, 0.10, 0.09];
const GLASS = [1, 1, 1];
const GLASS_SLOT = [0.65, 0.72, 0.85];

const N = 6, FH = 2.84, H = N * FH;   // 17.04
const WX = 11.4, DZ = 12.4, FRONT = DZ / 2;
const CORE_W = 4.0, CORE_CX = WX / 2 - CORE_W / 2 + 0.2;   // +0.2: monolito PROUD en el lateral (mata z-fight con la masa blanca)
const SETBACK = 12.5;    // building center, meters from the Los Sauces centerline
const WEST_SHIFT = 14.0; // slide off the Poussin corner, west along Los Sauces

// nearest point + unit direction on a "...Sauces..." road to a target point
function nearestSauces(city, tx, tz) {
  let best = 1e18, P = null, D = null;
  for (const r of city.data.roads) {
    if (!/sauce/i.test(r.n || '')) continue;
    const p = r.p;
    for (let i = 0; i < p.length - 1; i++) {
      const ax = p[i][0], az = p[i][1], bx = p[i + 1][0], bz = p[i + 1][1];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      if (l2 < 0.01) continue;
      const t = Math.max(0, Math.min(1, ((tx - ax) * dx + (tz - az) * dz) / l2));
      const qx = ax + dx * t, qz = az + dz * t, d = (tx - qx) ** 2 + (tz - qz) ** 2;
      if (d < best) { best = d; P = { x: qx, z: qz }; const il = 1 / Math.sqrt(l2); D = [dx * il, dz * il]; }
    }
  }
  return P ? { P, D } : null;
}

// the footprint (plus margin) clears every roadway
function footprintClear(city, cx, cz, AX, FZ) {
  const hw = WX / 2 + 0.8, hd = DZ / 2 + 0.8;
  for (const sx of [-1, 0, 1]) for (const sz of [-1, 0, 1]) {
    const x = cx + sx * hw * AX[0] + sz * hd * FZ[0];
    const z = cz + sx * hw * AX[1] + sz * hd * FZ[1];
    if (city.onAnyRoad(x, z, 0.4)) return false;
  }
  return true;
}

// Compute the hero placement on the south frontage of Jirón Los Sauces, west of
// the Poussin corner, set back so it never sits on a roadway.
// Returns { cx, cz, AX (along the street), FZ (facade normal toward it) } | null.
export function heroPlacement(city) {
  const o = city.data.origin;
  if (!o) return null;
  const a = projectLatLon(STREET_PT.lat, STREET_PT.lon, o);
  let r = nearestSauces(city, a.x, a.z);
  if (!r) return null;
  // slide west along the street, away from the Poussin corner (corner is east, +x)
  const west = r.D[0] <= 0 ? r.D : [-r.D[0], -r.D[1]];
  r = nearestSauces(city, r.P.x + west[0] * WEST_SHIFT, r.P.z + west[1] * WEST_SHIFT);
  if (!r) return null;
  const { P, D } = r;
  // perpendicular pointing to the building side (south of Los Sauces, -z)
  let perp = [-D[1], D[0]];
  if (perp[1] > 0) perp = [-perp[0], -perp[1]];
  const AX = [D[0], D[1]], FZ = [-perp[0], -perp[1]];   // FZ faces the road
  // push back from the road until the whole footprint clears every pista
  let set = SETBACK;
  for (let i = 0; i < 8 && !footprintClear(city, P.x + perp[0] * set, P.z + perp[1] * set, AX, FZ); i++) set += 1.5;
  return { cx: P.x + perp[0] * set, cz: P.z + perp[1] * set, AX, FZ };
}

// emit an oriented box (6 quads) into a bucket. AX/AZ are horizontal unit axes.
function box(B, cx, cy, cz, hw, hh, hd, AX, AZ, color) {
  const corner = (sx, sy, sz) => [
    cx + sx * hw * AX[0] + sz * hd * AZ[0],
    cy + sy * hh,
    cz + sx * hw * AX[1] + sz * hd * AZ[1],
  ];
  const faces = [
    { n: [AZ[0], 0, AZ[1]], c: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
    { n: [-AZ[0], 0, -AZ[1]], c: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
    { n: [AX[0], 0, AX[1]], c: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
    { n: [-AX[0], 0, -AX[1]], c: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
    { n: [0, 1, 0], c: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
    { n: [0, -1, 0], c: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  ];
  for (const f of faces) {
    const [a, b, c, d] = f.c.map(s => corner(s[0], s[1], s[2]));
    B.quad(a, b, c, d, f.n, color);
  }
}

// Build the hero at center (cx,cz) with local frame AX (along street) / FZ (facade normal).
export function buildLosSauces202(W, cx, cz, AX, FZ) {
  // place a box at local (lx along AX, lz along FZ)
  const at = (lx, ly, lz, hw, hh, hd, bucket, color) =>
    box(bucket, cx + lx * AX[0] + lz * FZ[0], ly, cz + lx * AX[1] + lz * FZ[1], hw, hh, hd, AX, FZ, color);

  // A. white main mass
  at(0, H / 2, 0, WX / 2, H / 2, DZ / 2, W.wall, WHITE);

  // B. dark corner monolith (stair core), proud + a touch taller, with slot windows
  at(CORE_CX, (H + 0.6) / 2, 0.45, CORE_W / 2, (H + 0.6) / 2, DZ / 2 - 0.15, W.wall, CHARDARK);
  for (let f = 0; f < N; f++) {
    at(CORE_CX, f * FH + 1.95, FRONT + 0.34, (CORE_W - 1.2) / 2, 0.27, 0.04, W.glass, GLASS_SLOT);
  }

  // C. roof parapet around the white volume
  at(-CORE_W / 2 - 0.1, H + 0.28, FRONT - 0.09, (WX - CORE_W) / 2, 0.28, 0.09, W.trim, PARAPET);
  at(-WX / 2 + 0.09, H + 0.28, 0, 0.09, 0.28, DZ / 2, W.trim, PARAPET);
  at(-CORE_W / 2 - 0.1, H + 0.28, -DZ / 2 + 0.09, (WX - CORE_W) / 2, 0.28, 0.09, W.trim, PARAPET);

  // D. stacked balconies on the white facade (two bays, floors 1..N-1)
  for (const bx of [-3.9, -0.8]) {
    for (let f = 1; f < N; f++) {
      const y0 = f * FH;
      at(bx, y0 + 0.06, FRONT + 0.55, 1.45, 0.09, 0.58, W.trim, CHARCOAL);
      at(bx, y0 + 0.62, FRONT + 1.06, 1.45, 0.5, 0.06, W.trim, CHARCOAL);
      at(bx - 1.45, y0 + 0.62, FRONT + 0.55, 0.06, 0.5, 0.58, W.trim, CHARCOAL);
      at(bx + 1.45, y0 + 0.62, FRONT + 0.55, 0.06, 0.5, 0.58, W.trim, CHARCOAL);
      at(bx, y0 + 1.5, FRONT - 0.12, 1.4, 1.25, 0.04, W.trim, WOOD);
      at(bx, y0 + 1.45, FRONT - 0.03, 1.2, 1.15, 0.02, W.glass, GLASS);
    }
  }

  // E. recessed dark ground floor + garage
  at(-CORE_W / 2 - 0.1, 1.45, FRONT - 0.35, (WX - CORE_W) / 2 + 0.1, 1.45, 0.25, W.wall, CHARDARK);
  at(-3.9, 1.25, FRONT - 0.05, 1.5, 1.2, 0.08, W.door, GREY);
  for (let s = 1; s <= 4; s++) at(-3.9, 0.55 + s * 0.5, FRONT + 0.02, 1.5, 0.03, 0.04, W.trim, CHARCOAL);
  at(-0.5, 1.35, FRONT - 0.1, 1.1, 1.15, 0.02, W.glass, GLASS);

  // F. street fence (reja), dark metal, gate gap at the garage
  const RZ = FRONT + 1.9;
  at(0.2, 1.62, RZ, (WX + 0.6) / 2, 0.035, 0.04, W.trim, REJA);
  at(0.2, 0.18, RZ, (WX + 0.6) / 2, 0.06, 0.05, W.trim, REJA);
  for (let x = -WX / 2 - 0.3; x <= WX / 2 + 0.3; x += 0.34) {
    if (Math.abs(x + 3.9) < 1.6) continue;
    at(x, 0.9, RZ, 0.025, 0.75, 0.025, W.trim, REJA);
  }

  // G. roof machine room + water tank
  at(-3.6, H + 1.1, -3.2, 1.3, 1.0, 1.3, W.wall, WHITE);
  at(-3.6, H + 2.5, -3.2, 0.48, 0.65, 0.48, W.trim, CHARDARK);

  // H. side windows on the white left face
  for (let f = 1; f < N; f++) {
    for (const z of [2.6, -1.8]) {
      at(-WX / 2 - 0.02, f * FH + 1.5, z, 0.03, 0.62, 0.57, W.trim, PARAPET);
      at(-WX / 2 - 0.07, f * FH + 1.5, z, 0.02, 0.5, 0.47, W.glass, GLASS);
    }
  }
}
