import { readFileSync } from 'node:fs';

const SEG_CELL = 24.0;
const LCELL = 2.5;
const PLAZA_R = 11;
const PLAZA_CENTER = [-62, -15];

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function buildSegs(roads) {
  const segs = [];
  const grid = new Map();
  for (const r of roads) {
    const hw = (r.w ?? 6.0) * 0.5;
    const pts = r.p || [];
    for (let i = 0; i < pts.length - 1; i++) {
      segs.push([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], hw, r.n ?? '', !!r.bridge, r.t || '']);
    }
  }
  for (let idx = 0; idx < segs.length; idx++) {
    const s = segs[idx];
    const L = Math.hypot(s[2] - s[0], s[3] - s[1]);
    const steps = Math.floor(L / SEG_CELL) + 1;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = Math.floor((s[0] + (s[2] - s[0]) * t) / SEG_CELL);
      const cz = Math.floor((s[1] + (s[3] - s[1]) * t) / SEG_CELL);
      for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
        const key = `${cx + ox},${cz + oz}`;
        if (!grid.has(key)) grid.set(key, []);
        const arr = grid.get(key);
        if (arr[arr.length - 1] !== idx) arr.push(idx);
      }
    }
  }
  return { segs, grid };
}

function segsNear(index, x, z) {
  return index.grid.get(`${Math.floor(x / SEG_CELL)},${Math.floor(z / SEG_CELL)}`) || [];
}

function onAnyRoad(index, x, z, margin = 0) {
  for (const idx of segsNear(index, x, z)) {
    const s = index.segs[idx];
    const dx = s[2] - s[0], dz = s[3] - s[1];
    const l2 = dx * dx + dz * dz;
    if (l2 < 0.01) continue;
    const t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (z - s[1]) * dz) / l2));
    const px = s[0] + dx * t, pz = s[1] + dz * t;
    const rr = s[4] + margin;
    if ((x - px) * (x - px) + (z - pz) * (z - pz) < rr * rr) return true;
  }
  return false;
}

function nearOtherRoad(index, x, z, ax, az, bx, bz) {
  const ol = Math.hypot(bx - ax, bz - az) || 1;
  const oux = (bx - ax) / ol;
  const ouz = (bz - az) / ol;
  for (const idx of segsNear(index, x, z)) {
    const s = index.segs[idx];
    if (Math.abs(s[0] - ax) < 0.01 && Math.abs(s[1] - az) < 0.01 &&
        Math.abs(s[2] - bx) < 0.01 && Math.abs(s[3] - bz) < 0.01) continue;
    const dx = s[2] - s[0], dz = s[3] - s[1];
    const l2 = dx * dx + dz * dz;
    if (l2 < 0.01) continue;
    const il = Math.sqrt(l2);
    if (Math.abs((dx / il) * oux + (dz / il) * ouz) > 0.8) continue;
    const t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (z - s[1]) * dz) / l2));
    const px = s[0] + dx * t, pz = s[1] + dz * t;
    const rr = s[4] + 1.0;
    if ((x - px) * (x - px) + (z - pz) * (z - pz) < rr * rr) return true;
  }
  return false;
}

function buildParksAccepts(index, ring, gx, gz, x1, z1) {
  const cx = (gx + x1) * 0.5;
  const cz = (gz + z1) * 0.5;
  const inPlaza = Math.hypot(cx - PLAZA_CENTER[0], cz - PLAZA_CENTER[1]) < PLAZA_R + 0.5;
  if (inPlaza) return false;
  for (const [sx, sz] of sampleCell(gx, gz, x1, z1)) {
    if (!pointInRing(sx, sz, ring) || onAnyRoad(index, sx, sz, 0.2)) return false;
  }
  return true;
}

function sampleCell(gx, gz, x1, z1) {
  return [
    [gx, gz], [(gx + x1) * 0.5, gz], [x1, gz],
    [gx, (gz + z1) * 0.5], [(gx + x1) * 0.5, (gz + z1) * 0.5], [x1, (gz + z1) * 0.5],
    [gx, z1], [(gx + x1) * 0.5, z1], [x1, z1],
  ];
}

function sampleRibbon(ax, az, bx, bz, ux, uz, half, offset) {
  const nx = -uz, nz = ux;
  const oax = ax + nx * offset, oaz = az + nz * offset;
  const obx = bx + nx * offset, obz = bz + nz * offset;
  const mx = (oax + obx) * 0.5;
  const mz = (oaz + obz) * 0.5;
  return [
    [oax - nx * half, oaz - nz * half], [oax, oaz], [oax + nx * half, oaz + nz * half],
    [mx - nx * half, mz - nz * half], [mx, mz], [mx + nx * half, mz + nz * half],
    [obx - nx * half, obz - nz * half], [obx, obz], [obx + nx * half, obz + nz * half],
  ];
}

const zone = JSON.parse(readFileSync(new URL('../assets/zone.json', import.meta.url), 'utf8'));
const appSource = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const roadIndex = buildSegs(zone.roads || []);
let accepted = 0;
let roadOverlaps = 0;
let outsideGreen = 0;
const examples = [];
let bermaCells = 0;
let bermaRoadOverlaps = 0;
const greenRoadExamples = [];

for (let gi = 0; gi < (zone.green || []).length; gi++) {
  const ring = zone.green[gi].p || [];
  if (ring.length < 3) continue;
  let minx = 1e18, minz = 1e18, maxx = -1e18, maxz = -1e18;
  for (const p of ring) {
    minx = Math.min(minx, p[0]); minz = Math.min(minz, p[1]);
    maxx = Math.max(maxx, p[0]); maxz = Math.max(maxz, p[1]);
  }
  for (let gx = minx; gx < maxx; gx += LCELL) {
    for (let gz = minz; gz < maxz; gz += LCELL) {
      const x1 = Math.min(gx + LCELL, maxx), z1 = Math.min(gz + LCELL, maxz);
      if (!buildParksAccepts(roadIndex, ring, gx, gz, x1, z1)) continue;
      accepted++;
      let badRoad = false;
      let badGreen = false;
      for (const [sx, sz] of sampleCell(gx, gz, x1, z1)) {
        if (onAnyRoad(roadIndex, sx, sz, 0)) badRoad = true;
        if (!pointInRing(sx, sz, ring)) badGreen = true;
      }
      if (badRoad) roadOverlaps++;
      if (badGreen) outsideGreen++;
      if ((badRoad || badGreen) && examples.length < 5) examples.push({ greenIndex: gi, center: [+(gx + LCELL * 0.5).toFixed(2), +(gz + LCELL * 0.5).toFixed(2)], badRoad, badGreen });
    }
  }
}

for (const r of (zone.roads || [])) {
  const full = r.w ?? 6.0;
  if (full < 4.0 || (r.layer || 0) !== 0) continue;
  const hw = full * 0.5;
  const pts = r.p || [];
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.01) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    for (let d = 0; d < L;) {
      const step = Math.min(3.0, L - d);
      const mx = ax + ux * (d + step * 0.5), mz = az + uz * (d + step * 0.5);
      const eax = ax + ux * d, eaz = az + uz * d;
      const ebx = ax + ux * (d + step), ebz = az + uz * (d + step);
      for (const side of [1, -1]) {
        const px = mx + (-uz) * (hw + 1.5) * side, pz = mz + ux * (hw + 1.5) * side;
        const qax = eax + (-uz) * (hw + 1.5) * side, qaz = eaz + ux * (hw + 1.5) * side;
        const qbx = ebx + (-uz) * (hw + 1.5) * side, qbz = ebz + ux * (hw + 1.5) * side;
        if (onAnyRoad(roadIndex, px, pz, 1.2) || onAnyRoad(roadIndex, qax, qaz, 1.2) || onAnyRoad(roadIndex, qbx, qbz, 1.2)) continue;
        bermaCells++;
        let bad = false;
        for (const [sx, sz] of sampleRibbon(eax, eaz, ebx, ebz, ux, uz, 0.5, (hw + 0.9) * side)) {
          if (onAnyRoad(roadIndex, sx, sz, 0)) { bad = true; break; }
        }
        if (bad) {
          bermaRoadOverlaps++;
          if (greenRoadExamples.length < 5) greenRoadExamples.push({ road: r.n || r.t || '', center: [+mx.toFixed(2), +mz.toFixed(2)] });
        }
      }
      d += step;
    }
  }
}

const medianUsesGrass = /addBucket\(R\.median,[^\n]*worldTex\.grass/.test(appSource);
const roadEndGreenHedgeRenderer = /hedgeGeo[\s\S]*?0x375a22/.test(appSource);

console.log('park clearance audit:', { accepted, roadOverlaps, outsideGreen, examples });
console.log('green road overlay audit:', { bermaCells, bermaRoadOverlaps, medianUsesGrass, roadEndGreenHedgeRenderer, examples: greenRoadExamples });
if (roadOverlaps > 0) fail(`lawn cells overlap road samples: ${roadOverlaps}`);
if (bermaRoadOverlaps > 0) fail(`green road bermas overlap asphalt samples: ${bermaRoadOverlaps}`);
if (medianUsesGrass) fail('road medians use grass material on asphalt');
if (roadEndGreenHedgeRenderer) fail('road-end green hedge blockers render on asphalt');
console.log('PASS: park clearance audit');
