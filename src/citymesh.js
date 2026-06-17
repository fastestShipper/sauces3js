// Mesh builders: extruded facades (windows/doors/garages/zocalo/cornice/
// parapets/roofs), road ribbons with junction discs, sidewalks, medians,
// park lawns. Direct port of the Godot SurfaceTool pipeline to merged
// BufferGeometries (one draw call per material bucket).
import * as THREE from 'three';
import { ROAD_Y, WALK_Y, WALL_COLORS, TRIM_COLORS, hashF, mulberry32 } from './citygen.js?v=20260617d';
import { heroPlacement, buildLosSauces202 } from './landmark.js?v=20260617d';

class Bucket {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.uv = []; }
  vert(p, n, c, u) {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.col.push(c[0], c[1], c[2]);
    this.uv.push(u[0], u[1]);
  }
  // CCW front faces (three.js / OpenGL convention)
  quad(p0, p1, p2, p3, n, c, uvs) {
    const u = (p) => uvs ? uvs(p) : [(p[0] + p[2]) * 0.3, p[1] * 0.3];
    this.vert(p0, n, c, u(p0)); this.vert(p1, n, c, u(p1)); this.vert(p2, n, c, u(p2));
    this.vert(p0, n, c, u(p0)); this.vert(p2, n, c, u(p2)); this.vert(p3, n, c, u(p3));
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p1 = ring[i], p2 = ring[(i + 1) % ring.length];
    a += p1[0] * p2[1] - p2[0] * p1[1];
  }
  return a * 0.5;
}

// ear clipping triangulation (concave-safe) on [x,z] rings
function triangulate(ring) {
  const idx = ring.map((_, i) => i);
  if (ringArea(ring) < 0) idx.reverse();
  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 2000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = ring[idx[(i + idx.length - 1) % idx.length]];
      const b = ring[idx[i]];
      const c = ring[idx[(i + 1) % idx.length]];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross <= 0) continue;
      let inside = false;
      for (const j of idx) {
        const p = ring[j];
        if (p === a || p === b || p === c) continue;
        const d1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
        const d2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]);
        const d3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]);
        if (d1 >= 0 && d2 >= 0 && d3 >= 0) { inside = true; break; }
      }
      if (inside) continue;
      tris.push([a, b, c]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) tris.push([ring[idx[0]], ring[idx[1]], ring[idx[2]]]);
  return tris;
}

export function buildBuildings(city) {
  const W = { wall: new Bucket(), glass: new Bucket(), trim: new Bucket(), door: new Bucket(), roof: new Bucket() };
  const blds = city.data.buildings;
  // real Los Sauces 202: drop the hand-built 6-storey corner hero onto the
  // Jirón Los Sauces frontage, skipping any default OSM box it overlaps.
  const hero = heroPlacement(city);
  const skip = (b) => {
    if (!hero) return false;
    const p = b.p; if (!p || p.length < 3) return false;
    let mx = 0, mz = 0; for (const q of p) { mx += q[0]; mz += q[1]; } mx /= p.length; mz /= p.length;
    return Math.hypot(mx - hero.cx, mz - hero.cz) < 8;
  };
  for (let bi = 0; bi < blds.length; bi++) {
    if (skip(blds[bi])) continue;
    extrude(W, city, blds[bi], bi);
  }
  if (hero) buildLosSauces202(W, hero.cx, hero.cz, hero.AX, hero.FZ);
  return W;
}

function extrude(W, city, b, bi) {
  let ring = b.p;
  if (ring.length < 3) return;
  if (ringArea(ring) < 0) ring = [...ring].reverse();
  const h = Math.max(b.h ?? 5.0, 2.8);
  const parapet = h > 3.5 ? 0.22 : 0.12;
  const base = WALL_COLORS[bi % WALL_COLORS.length];
  const lite = hashF(bi * 11) * 0.18 - 0.06;
  let col = base.map(v => Math.min(1, Math.max(0, v + lite)));
  {
    // saturar: alejar cada canal de la media (el ACES web lava los tintes)
    const avg = (col[0] + col[1] + col[2]) / 3;
    col = col.map(v => Math.min(1, Math.max(0, avg + (v - avg) * 1.45)));
  }
  const tcol = TRIM_COLORS[Math.floor(hashF(bi * 23) * 4.99)];
  const zoc = hashF(bi * 29) < 0.7 ? col.map(v => v * 0.55) : [0.40, 0.40, 0.42];
  const rnd = hashF(bi);
  const plain = !!b.plain;

  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], nb = ring[(i + 1) % ring.length];
    const ex = nb[0] - a[0], ez = nb[1] - a[1];
    const L = Math.hypot(ex, ez);
    if (L < 0.01) continue;
    const ux = ex / L, uz = ez / L;
    // outward normal: VERIFICADO numericamente (audit_normal.mjs) —
    // para anillos con area>0 en (x,z), el exterior es (uz, -ux)
    const nx = uz, nz = -ux;
    const n = [nx, 0, nz];
    const top = h + parapet;
    const wallUV = (p) => [(p[0] * ux + p[2] * uz) * 0.3, p[1] * 0.3];
    // medianera totalmente ENTERRADA en el vecino: NO emitirla. Las casas
    // adosadas comparten el plano exacto → dos quads coplanares DoubleSide
    // = z-fight (el "blinking") + ~100k quads invisibles gratis
    const buriedAt = (t) => city.inTallerBuilding(
      a[0] + ux * L * t + nx * 0.55, a[1] + uz * L * t + nz * 0.55, h - 0.6);
    const buriedMid = buriedAt(0.5);
    if (buriedMid && (L < 2.6 || (buriedAt(0.12) && buriedAt(0.88)))) continue;
    W.wall.quad([a[0], 0, a[1]], [nb[0], 0, nb[1]], [nb[0], top, nb[1]], [a[0], top, a[1]], n, col, wallUV);
    // parapet cap
    W.wall.quad(
      [a[0], top, a[1]], [nb[0], top, nb[1]],
      [nb[0] - nx * 0.3, top, nb[1] - nz * 0.3], [a[0] - nx * 0.3, top, a[1] - nz * 0.3],
      [0, 1, 0], col.map(v => v * 0.9));
    if (L < 2.6) continue;
    // expuesta solo parcialmente: pared si, fachada no
    if (buriedMid) continue;
    // zocalo + cornisa
    W.wall.quad(
      [a[0] + nx * .015, 0, a[1] + nz * .015], [nb[0] + nx * .015, 0, nb[1] + nz * .015],
      [nb[0] + nx * .015, 0.95, nb[1] + nz * .015], [a[0] + nx * .015, 0.95, a[1] + nz * .015], n, zoc, wallUV);
    W.wall.quad(
      [a[0] + nx * .03, h - 0.22, a[1] + nz * .03], [nb[0] + nx * .03, h - 0.22, nb[1] + nz * .03],
      [nb[0] + nx * .03, h, nb[1] + nz * .03], [a[0] + nx * .03, h, a[1] + nz * .03], n, tcol, wallUV);
    // celdas de fachada
    const cells = Math.max(1, Math.floor((L - 0.8) / 2.9));
    const cw = (L - 0.8) / cells;
    const doorCell = Math.floor(hashF(bi * 31 + i) * cells);
    const hasBalc = h >= 7.5 && hashF(bi * 53) < 0.45;
    const hasRejas = hashF(bi * 61) < 0.55;
    for (let c = 0; c < cells; c++) {
      const cu = 0.4 + cw * (c + 0.5);
      const bx = a[0] + ux * cu, bz = a[1] + uz * cu;
      const gk = hashF(bi * 17 + i * 7 + c);
      if (h >= 2.6) {
        if (c === doorCell && gk < 0.6) door(W, bx, bz, ux, uz, nx, nz, tcol);
        else if (gk < 0.30) garage(W, bx, bz, ux, uz, nx, nz);
        else win(W, bx, bz, 1.05, ux, uz, nx, nz, tcol, hasRejas);
      }
      for (let y = 4.05; y + 1.8 < h - 0.2; y += 3.0) {
        win(W, bx, bz, y, ux, uz, nx, nz, tcol);
        if (hasBalc && hashF(bi * 7 + i * 3 + c) < 0.55 && cw >= 2.6) balcony(W, bx, bz, y - 1.02, ux, uz, nx, nz, tcol);
      }
    }
  }
  // techo plano con color propio (concreto / ladrillo pastelero)
  const rp = hashF(bi * 41);
  let roofc = [0.72, 0.70, 0.67];
  if (rp < 0.25) roofc = [0.78, 0.46, 0.34];
  else if (rp < 0.4) roofc = [0.60, 0.58, 0.56];
  for (const [t0, t1, t2] of triangulate(ring)) {
    // CCW desde arriba = frontal en three.js
    W.roof.vert([t0[0], h, t0[1]], [0, 1, 0], roofc, [t0[0] * 0.1, t0[1] * 0.1]);
    W.roof.vert([t2[0], h, t2[1]], [0, 1, 0], roofc, [t2[0] * 0.1, t2[1] * 0.1]);
    W.roof.vert([t1[0], h, t1[1]], [0, 1, 0], roofc, [t1[0] * 0.1, t1[1] * 0.1]);
  }
  // azotea: tanque + AC
  if (h >= 5.0 && rnd > 0.25) {
    let cx = 0, cz = 0;
    for (const p of ring) { cx += p[0]; cz += p[1]; }
    cx /= ring.length; cz /= ring.length;
    if (city.pointInRing(cx, cz, ring)) {
      const jx = hashF(bi * 3) * 1.6 - 0.8, jz = hashF(bi * 5) * 1.6 - 0.8;
      // tanque de agua negro cilindrico (Rotoplas, firma de azotea limeña)
      roofCyl(W.wall, cx + jx, h, cz + jz, 0.58, 1.25, [0.09, 0.09, 0.11]);
      if (rnd > 0.6) roofBox(W.wall, cx - jx, h, cz - jz, 0.45, 0.4, 0.38, [0.55, 0.56, 0.58]);
    }
  }
}

function win(W, bx, bz, y, ux, uz, nx, nz, tcol, rejas) {
  const hw = 0.86, hh = 0.96, fd = 0.09, gd = 0.035, bw = 0.13;
  const n = [nx, 0, nz];
  const P = (du, dy, dn) => [bx + ux * du + nx * dn, y + dy, bz + uz * du + nz * dn];
  // 12% ventanas calidas (luz adentro = casa habitada)
  const lit = hashF(Math.trunc(bx * 13.7) + Math.trunc(bz * 7.3) + Math.trunc(y * 3)) > 0.88;
  const gcol = lit ? [1.6, 1.15, 0.65] : [1, 1, 1];
  W.glass.quad(P(-hw, -hh, gd), P(hw, -hh, gd), P(hw, hh, gd), P(-hw, hh, gd), n, gcol);
  for (const [u0, u1, y0, y1] of [
    [-hw - bw, -hw + bw, -hh - bw, hh + bw],
    [hw - bw, hw + bw, -hh - bw, hh + bw],
    [-hw - bw, hw + bw, hh, hh + bw],
    [-hw - bw, hw + bw, -hh - bw, -hh]]) {
    W.trim.quad(P(u0, y0, fd), P(u1, y0, fd), P(u1, y1, fd), P(u0, y1, fd), n, tcol);
  }
  W.trim.quad(P(-hw - .16, -hh - bw - .05, .14), P(hw + .16, -hh - bw - .05, .14), P(hw + .16, -hh - bw, .14), P(-hw - .16, -hh - bw, .14), n, tcol);
  // reja metalica de planta baja (firma san borja): 5 barrotes + travesaño
  if (rejas) {
    const rc = [0.14, 0.16, 0.14];
    for (let b = -2; b <= 2; b++) {
      const u = b * 0.32;
      W.trim.quad(P(u - 0.022, -hh, fd + 0.05), P(u + 0.022, -hh, fd + 0.05), P(u + 0.022, hh, fd + 0.05), P(u - 0.022, hh, fd + 0.05), n, rc);
    }
    W.trim.quad(P(-hw, -0.04, fd + 0.06), P(hw, -0.04, fd + 0.06), P(hw, 0.04, fd + 0.06), P(-hw, 0.04, fd + 0.06), n, rc);
  }
}

function door(W, bx, bz, ux, uz, nx, nz, tcol) {
  const hw = 0.62, dh = 2.25;
  const n = [nx, 0, nz];
  const P = (du, dy, dn) => [bx + ux * du + nx * dn, dy, bz + uz * du + nz * dn];
  W.door.quad(P(-hw, 0, .03), P(hw, 0, .03), P(hw, dh, .03), P(-hw, dh, .03), n, [1, 1, 1]);
  W.trim.quad(P(-hw - .1, dh, .10), P(hw + .1, dh, .10), P(hw + .1, dh + .16, .10), P(-hw - .1, dh + .16, .10), n, tcol);
}

function garage(W, bx, bz, ux, uz, nx, nz) {
  const hw = 1.30, gh = 2.35;
  const n = [nx, 0, nz];
  const P = (du, dy, dn) => [bx + ux * du + nx * dn, dy, bz + uz * du + nz * dn];
  for (let k = 0; k < 6; k++) {
    const y0 = gh * k / 6, y1 = gh * (k + 1) / 6;
    const shade = k % 2 === 0 ? [0.62, 0.63, 0.66] : [0.54, 0.55, 0.58];
    W.door.quad(P(-hw, y0, .03), P(hw, y0, .03), P(hw, y1, .03), P(-hw, y1, .03), n, shade);
  }
  W.trim.quad(P(-hw - .1, gh, .10), P(hw + .1, gh, .10), P(hw + .1, gh + .18, .10), P(-hw - .1, gh + .18, .10), n, [1, 1, 1]);
}

// balcon: losa volada + baranda frontal y laterales (los materiales del
// bucket trim son DoubleSide, el winding no importa aqui)
function balcony(W, bx, bz, y, ux, uz, nx, nz, tcol) {
  const hw = 1.08, depth = 0.58, rail = 0.85;
  const n = [nx, 0, nz];
  const P = (du, dy, dn) => [bx + ux * du + nx * dn, y + dy, bz + uz * du + nz * dn];
  const slab = [0.78, 0.77, 0.74];
  W.trim.quad(P(-hw, 0, 0.02), P(hw, 0, 0.02), P(hw, 0, depth), P(-hw, 0, depth), [0, 1, 0], slab);
  W.trim.quad(P(-hw, -0.13, depth), P(hw, -0.13, depth), P(hw, 0, depth), P(-hw, 0, depth), n, slab);
  W.trim.quad(P(-hw, -0.13, 0.02), P(hw, -0.13, 0.02), P(hw, -0.13, depth), P(-hw, -0.13, depth), [0, -1, 0], slab);
  W.trim.quad(P(-hw, 0, depth), P(hw, 0, depth), P(hw, rail, depth), P(-hw, rail, depth), n, tcol);
  W.trim.quad(P(-hw, 0, 0.02), P(-hw, 0, depth), P(-hw, rail, depth), P(-hw, rail, 0.02), [-ux, 0, -uz], tcol);
  W.trim.quad(P(hw, 0, 0.02), P(hw, 0, depth), P(hw, rail, depth), P(hw, rail, 0.02), [ux, 0, uz], tcol);
}

// cilindro de azotea (tanque de agua) — prisma de 8 lados + tapa
function roofCyl(B, cx, y, cz, r, h, c) {
  const N = 8;
  for (let i = 0; i < N; i++) {
    const a0 = Math.PI * 2 * i / N, a1 = Math.PI * 2 * (i + 1) / N;
    const x0 = Math.cos(a0) * r, z0 = Math.sin(a0) * r;
    const x1 = Math.cos(a1) * r, z1 = Math.sin(a1) * r;
    const nm = [(x0 + x1) / (2 * r), 0, (z0 + z1) / (2 * r)];
    B.quad([cx + x0, y, cz + z0], [cx + x1, y, cz + z1], [cx + x1, y + h, cz + z1], [cx + x0, y + h, cz + z0], nm, c);
    B.vert([cx, y + h, cz], [0, 1, 0], c, [0, 0]);
    B.vert([cx + x1, y + h, cz + z1], [0, 1, 0], c, [0, 0]);
    B.vert([cx + x0, y + h, cz + z0], [0, 1, 0], c, [0, 0]);
  }
}

function roofBox(B, cx, y, cz, sx, sy, sz, c) {
  const v = (x, yy, z) => [cx + x, y + yy, cz + z];
  B.quad(v(-sx, 0, -sz), v(-sx, sy, -sz), v(sx, sy, -sz), v(sx, 0, -sz), [0, 0, -1], c);
  B.quad(v(sx, 0, sz), v(sx, sy, sz), v(-sx, sy, sz), v(-sx, 0, sz), [0, 0, 1], c);
  B.quad(v(-sx, 0, sz), v(-sx, sy, sz), v(-sx, sy, -sz), v(-sx, 0, -sz), [-1, 0, 0], c);
  B.quad(v(sx, 0, -sz), v(sx, sy, -sz), v(sx, sy, sz), v(sx, 0, sz), [1, 0, 0], c);
  B.quad(v(-sx, sy, -sz), v(-sx, sy, sz), v(sx, sy, sz), v(sx, sy, -sz), [0, 1, 0], c);
}

export function buildRoads(city) {
  const road = new Bucket(), walk = new Bucket(), paint = new Bucket(), median = new Bucket(), berma = new Bucket(), curb = new Bucket(), path = new Bucket(), deck = new Bucket();
  const furniture = { trees: [], lamps: [], benches: [], misc: [], medianTrees: [], poleRuns: [], pillars: [] };
  // elevacion por capa OSM: la data trae `layer` pero NO altura -> la sintetizo.
  // layer 1 = puente/overpass, 2 = pasarela peatonal sobre el, -1 = subterraneo.
  const LAYER_H = (lay) => (lay === 1 ? 5.5 : lay === 2 ? 8.5 : lay === -1 ? -4 : 0);
  const RAMP = 22, DECK_T = 0.5, PARAPET = 0.7, DECK_COL = [0.6, 0.6, 0.58];
  // Y por jerarquia de via: en un cruce, la via de mayor clase queda ARRIBA
  // (resuelve el z-fight de ramales coplanares sin pasos visibles, escala ~cm).
  const TYPE_Y = { motorway: 0.024, motorway_link: 0.021, trunk: 0.024, trunk_link: 0.021, primary: 0.018, primary_link: 0.017, secondary: 0.014, tertiary: 0.011, residential: 0.007, service: 0.004, cycleway: 0.003, pedestrian: 0.0015, footway: 0, path: 0, steps: 0 };
  const quadUV = (B, ax, az, bx, bz, ux, uz, half, offset, ya, yb, col, uvScale) => {
    const nx = -uz, nz = ux;
    const oax = ax + nx * offset, oaz = az + nz * offset;
    const obx = bx + nx * offset, obz = bz + nz * offset;
    const p0 = [oax - nx * half, ya, oaz - nz * half];
    const p1 = [obx - nx * half, yb, obz - nz * half];
    const p2 = [obx + nx * half, yb, obz + nz * half];
    const p3 = [oax + nx * half, ya, oaz + nz * half];
    // CCW visto desde arriba
    B.quad(p0, p3, p2, p1, [0, 1, 0], col, (p) => [p[0] * uvScale, p[2] * uvScale]);
  };
  const disc = (B, cx, cz, y, rad, col) => {
    const steps = 10;
    for (let i = 0; i < steps; i++) {
      const a0 = Math.PI * 2 * i / steps, a1 = Math.PI * 2 * (i + 1) / steps;
      B.vert([cx, y, cz], [0, 1, 0], col, [cx * 0.16, cz * 0.16]);
      B.vert([cx + Math.cos(a0) * rad, y, cz + Math.sin(a0) * rad], [0, 1, 0], col, [0, 0]);
      B.vert([cx + Math.cos(a1) * rad, y, cz + Math.sin(a1) * rad], [0, 1, 0], col, [0, 0]);
    }
  };
  const white = [1, 1, 1];
  let ri = 0;
  for (const r of city.data.roads) {
    const pts = r.p;
    const full = r.w ?? 6.0;
    const hw = full * 0.5;
    const ped = full < 4.0;
    const run = [];
    // jitter de altura POR CALLE: dos pistas que se cruzan ya no comparten
    // el plano exacto (z-fight en cada interseccion = el "blinking")
    const yo = (TYPE_Y[r.t] ?? 0.02) + (ri++ % 3) * 0.0015;
    const ez = LAYER_H(r.layer || 0);
    const isElev = ez !== 0;
    let RL = 0;
    for (let i = 0; i < pts.length - 1; i++) RL += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    const elevAt = (d) => isElev ? ez * Math.max(0, Math.min(1, d / RAMP, (RL - d) / RAMP)) : 0;
    let dAcc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.01) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      const dStart = dAcc, dEnd = dAcc + L; dAcc = dEnd;
      const yaE = ROAD_Y + yo + elevAt(dStart), ybE = ROAD_Y + yo + elevAt(dEnd);
      // sendas peatonales (parques) son loseta de concreto, NO asfalto
      const RB = ped ? path : road;
      quadUV(RB, ax, az, bx, bz, ux, uz, hw, 0, yaE, ybE, white, ped ? 0.4 : 0.16);
      disc(RB, ax, az, yaE + 0.005, hw, white);
      disc(RB, bx, bz, ybE + 0.005, hw, white);
      if (ped) continue;
      // vias elevadas (trebol/puentes): tablero con espesor + parapetos + pilares,
      // SIN veredas/berma/carriles encima (v1). el suelo pasa por debajo.
      if (isElev) {
        const nx = -uz, nz = ux;
        deck.quad(
          [ax - nx * hw, yaE - DECK_T, az - nz * hw], [ax + nx * hw, yaE - DECK_T, az + nz * hw],
          [bx + nx * hw, ybE - DECK_T, bz + nz * hw], [bx - nx * hw, ybE - DECK_T, bz - nz * hw],
          [0, -1, 0], DECK_COL);
        for (const s of [1, -1]) {
          const ox = nx * hw * s, oz = nz * hw * s;
          deck.quad(
            [ax + ox, yaE, az + oz], [bx + ox, ybE, bz + oz],
            [bx + ox, ybE + PARAPET, bz + oz], [ax + ox, yaE + PARAPET, az + oz],
            [nx * s, 0, nz * s], DECK_COL);
        }
        const midY = ROAD_Y + yo + elevAt((dStart + dEnd) * 0.5);
        if (midY - (ROAD_Y + yo) > 2.0) furniture.pillars.push([ax + ux * L * 0.5, az + uz * L * 0.5, midY - DECK_T]);
        continue;
      }
      // veredas por tramos, descartadas sobre otras calles + mobiliario
      for (let d = 0; d < L;) {
        const step = Math.min(3.0, L - d);
        const mx = ax + ux * (d + step * 0.5), mz = az + uz * (d + step * 0.5);
        const phase = d % 40;
        for (const side of [1, -1]) {
          const px = mx + (-uz) * (hw + 1.5) * side, pz = mz + ux * (hw + 1.5) * side;
          const eax = ax + ux * d, eaz = az + uz * d;
          const ebx = ax + ux * (d + step), ebz = az + uz * (d + step);
          const qax = eax + (-uz) * (hw + 1.5) * side, qaz = eaz + ux * (hw + 1.5) * side;
          const qbx = ebx + (-uz) * (hw + 1.5) * side, qbz = ebz + ux * (hw + 1.5) * side;
          if (!city.onAnyRoad(px, pz, 1.2) && !city.onAnyRoad(qax, qaz, 1.2) && !city.onAnyRoad(qbx, qbz, 1.2)) {
            // san borja real: sardinel → BERMA verde con arboles → vereda de losetas
            quadUV(berma, eax, eaz, ebx, ebz, ux, uz, 0.5, (hw + 0.9) * side, WALK_Y + yo - 0.015, WALK_Y + yo - 0.015, white, 0.35);
            quadUV(walk, eax, eaz, ebx, ebz, ux, uz, 1.0, (hw + 2.4) * side, WALK_Y + yo, WALK_Y + yo, white, 0.30);
            // sardinel 3D: cara vertical visible desde la pista,
            // pintado AMARILLO cerca de las esquinas (zona rigida limeña)
            const snx = (-uz) * side, snz = ux * side;
            const isCorner = (i === 0 && d < 7) || (i === pts.length - 2 && d + step > L - 7);
            const ccol = isCorner ? [0.93, 0.72, 0.10] : [0.80, 0.79, 0.76];
            curb.quad(
              [eax + snx * (hw + 0.4), ROAD_Y + yo - 0.01, eaz + snz * (hw + 0.4)],
              [ebx + snx * (hw + 0.4), ROAD_Y + yo - 0.01, ebz + snz * (hw + 0.4)],
              [ebx + snx * (hw + 0.4), WALK_Y + yo + 0.03, ebz + snz * (hw + 0.4)],
              [eax + snx * (hw + 0.4), WALK_Y + yo + 0.03, eaz + snz * (hw + 0.4)],
              [-snx, 0, -snz], ccol);
            // postes de luz (un solo lado, cada 40 m) para tender cables
            if (side === 1 && full >= 6.0 && phase >= 5 && phase < 8) {
              run.push([mx + snx * (hw + 1.42), mz + snz * (hw + 1.42), Math.atan2(ux, uz)]);
            }
            if (full >= 8.0) {
              const fang = Math.atan2(-(-uz) * side, -ux * side);
              if (phase < 3) furniture.trees.push([mx + (-uz) * (hw + 0.9) * side, mz + ux * (hw + 0.9) * side, fang]);
              else if (phase >= 20 && phase < 23) furniture.lamps.push([mx + (-uz) * (hw + 0.85) * side, mz + ux * (hw + 0.85) * side, fang]);
              else if (phase >= 30 && phase < 33) furniture.benches.push([mx + (-uz) * (hw + 2.55) * side, mz + ux * (hw + 2.55) * side, fang]);
              else if (phase >= 10 && phase < 11.5 && full >= 10) furniture.misc.push([mx + (-uz) * (hw + 0.9) * side, mz + ux * (hw + 0.9) * side, fang]);
            }
          }
        }
        d += step;
      }
      // lineas de carril + berma central
      if (full >= 6.5) {
        let lanes = [0];
        if (full >= 12) {
          lanes = [-hw * 0.45, hw * 0.45];
          for (let md = 0; md < L;) {
            const mstep = Math.min(3.0, L - md);
            const mmx = ax + ux * (md + mstep * 0.5), mmz = az + uz * (md + mstep * 0.5);
            if (!city.nearOtherRoad(mmx, mmz, ax, az, bx, bz)) {
              quadUV(median, ax + ux * md, az + uz * md, ax + ux * (md + mstep), az + uz * (md + mstep), ux, uz, 1.1, 0, 0.10 + yo, 0.10 + yo, white, 0.22);
              if (md % 14 < 3) furniture.medianTrees.push([mmx, mmz]);
            }
            md += mstep;
          }
        }
        // zona de cebra en cada extremo: ahi NO van guiones de carril
        const zebraAtStart = full >= 7.0 && i === 0 &&
          city.nearOtherRoad(ax + ux * 0.3, az + uz * 0.3, ax, az, bx, bz);
        const zebraAtEnd = full >= 7.0 && i === pts.length - 2 &&
          city.nearOtherRoad(bx - ux * 0.3, bz - uz * 0.3, ax, az, bx, bz);
        for (let dd = 2.0; dd < L - 2.0; dd += 6.0) {
          if (zebraAtStart && dd < hw + 8) continue;
          if (zebraAtEnd && dd + 2.2 > L - (hw + 8)) continue;
          const dmx = ax + ux * (dd + 1.1), dmz = az + uz * (dd + 1.1);
          if (city.nearOtherRoad(dmx, dmz, ax, az, bx, bz)) continue;
          const de = Math.min(dd + 2.2, L - 0.8);
          for (const lo of lanes) {
            quadUV(paint, ax + ux * dd, az + uz * dd, ax + ux * de, az + uz * de, ux, uz, 0.14, lo, ROAD_Y + yo + 0.014, ROAD_Y + yo + 0.014, white, 1.0);
          }
        }
      }
      // cruceros peatonales cebra en los extremos que tocan otra calle
      if (full >= 7.0 && L > hw + 8) {
        const ends = [];
        if (i === 0) ends.push([ax, az, ux, uz]);
        if (i === pts.length - 2) ends.push([bx, bz, -ux, -uz]);
        for (const [ex, ez, dxn, dzn] of ends) {
          if (!city.nearOtherRoad(ex + dxn * 0.3, ez + dzn * 0.3, ax, az, bx, bz)) continue;
          for (let k = 0; k < 5; k++) {
            const sd = hw + 1.2 + k * 1.05;
            if (sd + 0.55 > L - 1) break;
            quadUV(paint, ex + dxn * sd, ez + dzn * sd, ex + dxn * (sd + 0.55), ez + dzn * (sd + 0.55), dxn, dzn, hw - 0.75, 0, ROAD_Y + yo + 0.015, ROAD_Y + yo + 0.015, white, 1.0);
          }
        }
      }
    }
    if (run.length > 1) furniture.poleRuns.push(run);
  }
  return { road, walk, paint, median, berma, curb, path, deck, furniture };
}

// Plaza radial empedrada + gruta de la Virgen al centro del parque grande.
// Replica el corazon real del Parque Los Sauces (plaza circular + gruta),
// rasgo caracteristico de los parques de San Borja.
// banda anular plana (anillo de ladrillo) para el patron radial de la plaza
function ringBand(B, cx, cz, rOut, rIn, y, c) {
  const N = 28;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
    B.quad(
      [cx + Math.cos(a0) * rIn, y, cz + Math.sin(a0) * rIn],
      [cx + Math.cos(a0) * rOut, y, cz + Math.sin(a0) * rOut],
      [cx + Math.cos(a1) * rOut, y, cz + Math.sin(a1) * rOut],
      [cx + Math.cos(a1) * rIn, y, cz + Math.sin(a1) * rIn],
      [0, 1, 0], c);
  }
}

// techo a dos aguas: pendientes (roofc) + timpanos triangulares (wallc). ridge en Z.
function gableRoof(B, cx, y, cz, hw, hd, ph, roofc, wallc) {
  const v = (x, yy, z) => [x, y + yy, z];
  B.quad(v(cx + hw, 0, cz - hd), v(cx + hw, 0, cz + hd), v(cx, ph, cz + hd), v(cx, ph, cz - hd), [1, 0.6, 0], roofc);
  B.quad(v(cx - hw, 0, cz + hd), v(cx - hw, 0, cz - hd), v(cx, ph, cz - hd), v(cx, ph, cz + hd), [-1, 0.6, 0], roofc);
  const tri = (p0, p1, p2, n) => { B.vert(p0, n, wallc, [0, 0]); B.vert(p1, n, wallc, [0, 0]); B.vert(p2, n, wallc, [0, 0]); };
  tri(v(cx - hw, 0, cz + hd), v(cx + hw, 0, cz + hd), v(cx, ph, cz + hd), [0, 0, 1]);
  tri(v(cx + hw, 0, cz - hd), v(cx - hw, 0, cz - hd), v(cx, ph, cz - hd), [0, 0, -1]);
}

// Replica del centro REAL del Parque Los Sauces: plaza radial de concreto con
// patron de ladrillo rojo/gris + santuario (capilla blanca, techo rojo a dos
// aguas, imagen de la Virgen) al centro. benchOut recibe spots de banca.
function buildParkLandmark(plaza, feat, benchOut, cx, cz) {
  const R = 11;
  const CONC = [0.74, 0.71, 0.64], REDB = [0.70, 0.20, 0.16], GREYB = [0.33, 0.33, 0.36];
  roofCyl(plaza, cx, 0.0, cz, R, 0.04, CONC);               // disco de concreto (cap 0.04)
  roofCyl(plaza, cx, 0.04, cz, 2.6, 0.022, REDB);           // disco central rojo
  ringBand(plaza, cx, cz, R * 0.97, R * 0.90, 0.055, REDB); // aro rojo exterior (sobre el cap)
  ringBand(plaza, cx, cz, R * 0.60, R * 0.52, 0.055, GREYB); // aro gris medio
  for (let i = 0; i < 8; i++) {                             // petalos alternados (mandala)
    const a = (i / 8) * Math.PI * 2, w = (Math.PI / 8) * 0.85, col = i % 2 ? REDB : GREYB;
    plaza.quad(
      [cx + Math.cos(a - w) * 2.9, 0.056, cz + Math.sin(a - w) * 2.9],
      [cx + Math.cos(a - w) * R * 0.86, 0.056, cz + Math.sin(a - w) * R * 0.86],
      [cx + Math.cos(a + w) * R * 0.86, 0.056, cz + Math.sin(a + w) * R * 0.86],
      [cx + Math.cos(a + w) * 2.9, 0.056, cz + Math.sin(a + w) * 2.9],
      [0, 1, 0], col);
  }

  // SANTUARIO: base oscura + capilla blanca + techo rojo a dos aguas + Virgen
  const WHITE = [0.93, 0.93, 0.95], DARK = [0.11, 0.11, 0.14], RED = [0.66, 0.22, 0.18], GOLD = [0.80, 0.67, 0.30];
  roofCyl(feat, cx, 0.09, cz, 1.5, 0.5, DARK);             // base redonda
  roofBox(feat, cx, 0.59, cz, 1.0, 0.22, 0.78, DARK);      // plinto
  roofBox(feat, cx, 0.81, cz, 0.82, 1.5, 0.58, WHITE);     // cuerpo blanco (vitrina)
  gableRoof(feat, cx, 2.31, cz, 0.98, 0.74, 0.72, RED, WHITE);
  const fz = cz + 0.6;                                      // imagen de la Virgen al frente
  roofBox(feat, cx, 1.02, fz, 0.46, 1.0, 0.04, DARK);       // marco
  roofBox(feat, cx, 1.16, fz + 0.02, 0.32, 0.64, 0.03, [0.60, 0.71, 0.9]); // manto celeste
  roofBox(feat, cx, 1.26, fz + 0.03, 0.12, 0.3, 0.02, [0.96, 0.96, 0.98]); // figura clara
  roofBox(feat, cx, 0.62, fz + 0.01, 0.34, 0.12, 0.02, GOLD); // placa dorada

  for (let i = 0; i < 6; i++) {                             // banquitas mirando al santuario
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const bx = cx + Math.cos(a) * (R - 1.7), bz = cz + Math.sin(a) * (R - 1.7);
    benchOut.push([bx, bz, Math.atan2(cx - bx, cz - bz)]);
  }
}

export function buildParks(city) {
  const lawn = new Bucket();
  const plaza = new Bucket();
  const feature = new Bucket();
  const rng = mulberry32(444);
  const parkTrees = [];
  const parkBenches = [];
  const parkScatter = [];
  // Parque Los Sauces REAL (centro del barrio, proyectado a coords de juego ~
  // [-90,-25]): la plaza radial + gruta van AQUI, no en el green mas grande
  // (que es otro parque al este). Elige el parque mas cercano al ancla real.
  // Centro de la gruta PINNED por el comandante (coord exacta del juego).
  const PLAZA_R = 11;
  const bigC = [-62, -15];
  const inPlaza = (x, z) => Math.hypot(x - bigC[0], z - bigC[1]) < PLAZA_R + 0.5;
  for (let gi = 0; gi < city.data.green.length; gi++) {
    const g = city.data.green[gi];
    const ring = g.p;
    if (ring.length < 3) continue;
    let minx = 1e18, minz = 1e18, maxx = -1e18, maxz = -1e18;
    for (const p of ring) { minx = Math.min(minx, p[0]); minz = Math.min(minz, p[1]); maxx = Math.max(maxx, p[0]); maxz = Math.max(maxz, p[1]); }
    const LCELL = 2.5;
    for (let gx = minx; gx < maxx; gx += LCELL) {
      for (let gz = minz; gz < maxz; gz += LCELL) {
        const cx = gx + LCELL * 0.5, cz = gz + LCELL * 0.5;
        if (!city.pointInRing(cx, cz, ring) || city.onAnyRoad(cx, cz, 0.3) || inPlaza(cx, cz)) continue;
        // variacion sutil de tono, sin parches de color (leian como tierra)
        const shade = 0.90 + rng() * 0.10;
        const col = [shade * 0.92, shade, shade * 0.88];
        const x1 = Math.min(gx + LCELL, maxx), z1 = Math.min(gz + LCELL, maxz);
        lawn.quad([gx, 0.015, gz], [gx, 0.015, z1], [x1, 0.015, z1], [x1, 0.015, gz], [0, 1, 0], col, (p) => [p[0] * 0.35, p[2] * 0.35]);
      }
    }
    const want = Math.max(2, Math.min(60, Math.floor((maxx - minx) * (maxz - minz) / 170)));
    for (let k = 0; k < want; k++) {
      const tx = minx + rng() * (maxx - minx), tz = minz + rng() * (maxz - minz);
      if (!city.pointInRing(tx, tz, ring) || city.onAnyRoad(tx, tz, 1.0) || inPlaza(tx, tz)) continue;
      parkTrees.push([tx, tz]);
    }
    // puntos chicos (mas densos que los arboles) para arbustos / rocas / pasto
    const wantS = Math.max(4, Math.min(260, Math.floor((maxx - minx) * (maxz - minz) / 38)));
    for (let k = 0; k < wantS; k++) {
      const sx = minx + rng() * (maxx - minx), sz = minz + rng() * (maxz - minz);
      if (!city.pointInRing(sx, sz, ring) || city.onAnyRoad(sx, sz, 2.2) || inPlaza(sx, sz)) continue;
      parkScatter.push([sx, sz]);
    }
    // bancas perimetrales mirando hacia adentro del parque
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const eL = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (eL < 10) continue;
      const ux = (b[0] - a[0]) / eL, uz = (b[1] - a[1]) / eL;
      for (let d = 12; d < eL - 6; d += 26) {
        const exm = a[0] + ux * d, ezm = a[1] + uz * d;
        for (const sgn of [1, -1]) {
          const px = exm + (-uz) * 2.2 * sgn, pz = ezm + ux * 2.2 * sgn;
          if (!city.pointInRing(px, pz, ring) || city.onAnyRoad(px, pz, 0.8)) continue;
          parkBenches.push([px, pz, Math.atan2(-uz * sgn, ux * sgn)]);
          break;
        }
      }
    }
  }
  if (bigC) buildParkLandmark(plaza, feature, parkBenches, bigC[0], bigC[1]);
  return { lawn, plaza, feature, parkTrees, parkBenches, parkScatter, landmark: bigC };
}
