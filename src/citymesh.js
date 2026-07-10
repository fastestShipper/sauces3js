// Mesh builders: extruded facades (windows/doors/garages/zocalo/cornice/
// parapets/roofs), road ribbons with junction discs, sidewalks, medians,
// park lawns. Direct port of the Godot SurfaceTool pipeline to merged
// BufferGeometries (one draw call per material bucket).
import * as THREE from 'three';
import { ROAD_Y, WALK_Y, WALL_COLORS, TRIM_COLORS, hashF, mulberry32 } from './citygen.js?v=20260709g41';
import { heroPlacement, buildLosSauces202, registerLosSauces202Collision } from './landmark.js?v=20260709g41';

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

export const BUILDING_CHUNK_SIZE = 320;
export const BUILDING_LAYERS = ['wall', 'glass', 'trim', 'door', 'roof'];

class BuildingChunk {
  constructor(tx, tz) {
    this.tx = tx;
    this.tz = tz;
    this.key = `${tx}:${tz}`;
    for (const layer of BUILDING_LAYERS) this[layer] = new Bucket();
  }

  geometry(layers = BUILDING_LAYERS) {
    return buildBuildingGeometry([this], layers);
  }
}

export function buildBuildingGeometry(chunks, layers = BUILDING_LAYERS) {
  const vertexCount = layers.reduce((total, layer) => total + chunks.reduce(
    (chunkTotal, chunk) => chunkTotal + chunk[layer].pos.length / 3, 0), 0);
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  let vertexOffset = 0;

  layers.forEach((layer) => {
    const groupStart = vertexOffset;
    for (const chunk of chunks) {
      const bucket = chunk[layer];
      const count = bucket.pos.length / 3;
      if (!count) continue;
      positions.set(bucket.pos, vertexOffset * 3);
      normals.set(bucket.nrm, vertexOffset * 3);
      colors.set(bucket.col, vertexOffset * 3);
      uvs.set(bucket.uv, vertexOffset * 2);
      vertexOffset += count;
    }
    const groupCount = vertexOffset - groupStart;
    if (groupCount) geometry.addGroup(groupStart, groupCount, BUILDING_LAYERS.indexOf(layer));
  });

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function ringCenter(ring) {
  let x = 0, z = 0;
  for (const point of ring) { x += point[0]; z += point[1]; }
  return [x / ring.length, z / ring.length];
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

// paleta de toldos comerciales limeños (color solido, sin rayas):
// rojo teja, verde botella, azul, amarillo mostaza
const TOLDO_COLORS = [
  [0.70, 0.25, 0.18],
  [0.10, 0.32, 0.20],
  [0.16, 0.32, 0.58],
  [0.83, 0.62, 0.16],
];

export function buildBuildings(city, chunkSize = BUILDING_CHUNK_SIZE) {
  const chunks = new Map();
  const chunkAt = (x, z) => {
    const tx = Math.floor(x / chunkSize), tz = Math.floor(z / chunkSize);
    const key = `${tx}:${tz}`;
    let chunk = chunks.get(key);
    if (!chunk) {
      chunk = new BuildingChunk(tx, tz);
      chunks.set(key, chunk);
    }
    return chunk;
  };
  const blds = city.data.buildings;
  // real Los Sauces 202: drop the hand-built 6-storey corner hero onto the
  // Jirón Los Sauces frontage, skipping any default OSM box it overlaps.
  const hero = heroPlacement(city);
  const skip = (b) => {
    if (!hero) return false;
    const p = b.p; if (!p || p.length < 3) return false;
    const [mx, mz] = ringCenter(p);
    return Math.hypot(mx - hero.cx, mz - hero.cz) < 8;
  };
  for (let bi = 0; bi < blds.length; bi++) {
    if (skip(blds[bi])) continue;
    const [cx, cz] = ringCenter(blds[bi].p);
    extrude(chunkAt(cx, cz), city, blds[bi], bi);
  }
  if (hero) {
    registerLosSauces202Collision(city, hero);
    buildLosSauces202(chunkAt(hero.cx, hero.cz), hero.cx, hero.cz, hero.AX, hero.FZ);
  }
  return [...chunks.values()].sort((a, b) => a.tx - b.tx || a.tz - b.tz);
}

function extrude(W, city, b, bi) {
  let ring = b.p;
  if (ring.length < 3) return;
  if (ringArea(ring) < 0) ring = [...ring].reverse();
  const h = Math.max(b.h ?? 5.0, 2.8);
  const parapet = h > 3.5 ? 0.22 : 0.12;
  const base = WALL_COLORS[bi % WALL_COLORS.length];
  const plain = !!b.plain;
  const filler = !b.osm; // relleno generado (frontage/carpet), sin footprint OSM
  // jitter de brillo mas ancho en el relleno: fillers vecinos con tono distinto
  // para que la fila party-wall no lea como la misma caja pintada.
  // OJO: hashF vive en [0.5,1), por eso el centrado en 0.75
  const lite = filler ? (hashF(bi * 11) - 0.75) * 0.28 : hashF(bi * 11) * 0.10 - 0.05;
  let col = base.map(v => Math.min(1, Math.max(0, v + lite)));
  const ht = b.h ?? 5;
  if (ht >= 11) col = col.map((v, i) => v * (i === 2 ? 1.04 : i === 0 ? 0.94 : 0.97));
  else if (ht >= 8.5) col = col.map((v) => v * 0.98);
  else if (ht < 4.8) col = col.map((v, i) => v * (i < 2 ? 1.03 : 0.96));
  if (plain) col = col.map((v) => v * 0.96);
  if (filler) {
    // desvio calido/frio determinista por edificio (variedad party-wall)
    const warm = (hashF(bi * 13) - 0.75) * 0.24;
    col = col.map((v, i) => Math.min(1, Math.max(0, v * (1 + (i === 0 ? warm : i === 2 ? -warm : 0)))));
  }
  {
    // saturar: alejar cada canal de la media (el ACES web lava los tintes)
    const avg = (col[0] + col[1] + col[2]) / 3;
    col = col.map(v => Math.min(1, Math.max(0, avg + (v - avg) * 1.7)));
  }
  const tcol = TRIM_COLORS[Math.floor(hashF(bi * 23) * 4.99)];
  const zoc = hashF(bi * 29) < 0.7 ? col.map(v => v * 0.55) : [0.40, 0.40, 0.42];
  const rnd = hashF(bi);
  // toldo comercial sobre la puerta en ~30% de los edificios que dan a calle
  // (el carpet interior no da a calle); hashF ∈ [0.5,1) → el corte va en 0.65
  const toldoCol = (!plain && hashF(bi * 71) < 0.65)
    ? TOLDO_COLORS[Math.floor((hashF(bi * 83) - 0.5) * 2 * 3.99)] : null;
  let toldoDone = false;

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
    // medianera de relleno con vecino mas bajo (jitter ±15% de citygen):
    // la franja alta queda expuesta pero es medianera CIEGA — pared si,
    // fachada no (ni ventanas ni zocalo flotando dentro del vecino)
    if (filler && city.inTallerBuilding(
      a[0] + ux * L * 0.5 + nx * 0.55, a[1] + uz * L * 0.5 + nz * 0.55, 2.5)) continue;
    // zocalo + cornisa
    const dirt = zoc.map((v) => v * 0.42);
    W.wall.quad(
      [a[0] + nx * .015, 0, a[1] + nz * .015], [nb[0] + nx * .015, 0, nb[1] + nz * .015],
      [nb[0] + nx * .015, 0.38, nb[1] + nz * .015], [a[0] + nx * .015, 0.38, a[1] + nz * .015], n, dirt, wallUV);
    W.wall.quad(
      [a[0] + nx * .015, 0.38, a[1] + nz * .015], [nb[0] + nx * .015, 0.38, nb[1] + nz * .015],
      [nb[0] + nx * .015, 0.95, nb[1] + nz * .015], [a[0] + nx * .015, 0.95, a[1] + nz * .015], n, zoc, wallUV);
    // relleno: cornisa SALIENTE que rompe la silueta de caja; OSM conserva
    // la banda plana pintada de siempre
    if (filler) cornice(W, a, nb, ux, uz, nx, nz, h, tcol);
    else W.wall.quad(
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
        // si el edificio tiene toldo pendiente, fuerza la puerta comercial
        const wantToldo = toldoCol && !toldoDone && cw >= 2.2;
        if (c === doorCell && (gk < 0.6 || wantToldo)) {
          door(W, bx, bz, ux, uz, nx, nz, tcol);
          if (wantToldo) { toldo(W, bx, bz, ux, uz, nx, nz, toldoCol); toldoDone = true; }
        }
        else if (gk < 0.30) garage(W, bx, bz, ux, uz, nx, nz);
        else win(W, bx, bz, 1.05, ux, uz, nx, nz, tcol, hasRejas);
      }
      for (let y = 4.05; y + 1.8 < h - 0.2; y += 3.0) {
        win(W, bx, bz, y, ux, uz, nx, nz, tcol);
        const Pw = (du, dy, dn) => [bx + ux * du + nx * dn, y + dy, bz + uz * du + nz * dn];
        const sill = tcol.map((v) => v * 0.88);
        W.trim.quad(
          Pw(-0.92, -1.08, 0.06), Pw(0.92, -1.08, 0.06), Pw(0.92, -1.02, 0.06), Pw(-0.92, -1.02, 0.06), n, sill);
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

// cornisa saliente de relleno: caja delgada perimetral (frente + tapa + fondo
// + tapas laterales) que sobresale 0.25 m en el remate de la fachada — rompe
// la silueta de caja pintada. Va al bucket trim (DoubleSide). 10 tris/fachada.
function cornice(W, a, nb, ux, uz, nx, nz, h, c) {
  const d0 = 0.03, d1 = 0.25, y0 = h - 0.30;
  const n = [nx, 0, nz];
  const P = (p, y, dn) => [p[0] + nx * dn, y, p[1] + nz * dn];
  W.trim.quad(P(a, y0, d1), P(nb, y0, d1), P(nb, h, d1), P(a, h, d1), n, c);
  W.trim.quad(P(a, h, d1), P(nb, h, d1), P(nb, h, d0), P(a, h, d0), [0, 1, 0], c);
  // fondo en sombra (se ve desde la vereda mirando arriba)
  const dark = c.map((v) => v * 0.82);
  W.trim.quad(P(a, y0, d0), P(nb, y0, d0), P(nb, y0, d1), P(a, y0, d1), [0, -1, 0], dark);
  W.trim.quad(P(a, y0, d0), P(a, y0, d1), P(a, h, d1), P(a, h, d0), [-ux, 0, -uz], c);
  W.trim.quad(P(nb, y0, d0), P(nb, y0, d1), P(nb, h, d1), P(nb, h, d0), [ux, 0, uz], c);
}

// toldo comercial: faldon inclinado + cenefa frontal colgante + triangulos
// laterales sobre la puerta de planta baja (color solido de TOLDO_COLORS).
// bucket trim DoubleSide: el faldon se ve tambien desde abajo. 6 tris.
function toldo(W, bx, bz, ux, uz, nx, nz, c) {
  const tw = 1.05, yB = 2.75, yF = 2.35, d0 = 0.06, d1 = 0.95, flap = 0.25;
  const P = (du, y, dn) => [bx + ux * du + nx * dn, y, bz + uz * du + nz * dn];
  W.trim.quad(P(-tw, yB, d0), P(tw, yB, d0), P(tw, yF, d1), P(-tw, yF, d1), [nx * 0.42, 0.91, nz * 0.42], c);
  W.trim.quad(P(-tw, yF, d1), P(tw, yF, d1), P(tw, yF - flap, d1), P(-tw, yF - flap, d1), [nx, 0, nz], c.map((v) => v * 0.9));
  const sc = c.map((v) => v * 0.82);
  for (const s of [-1, 1]) {
    const u = tw * s;
    W.trim.vert(P(u, yB, d0), [ux * s, 0, uz * s], sc, [0, 0]);
    W.trim.vert(P(u, yF, d1), [ux * s, 0, uz * s], sc, [0, 0]);
    W.trim.vert(P(u, yF - flap, d1), [ux * s, 0, uz * s], sc, [0, 0]);
  }
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
  const furniture = { trees: [], lamps: [], benches: [], misc: [], medianTrees: [], poleRuns: [], pillars: [], signs: [], planters: [], cableCrossings: [] };
  // franjas de berma [ax, az, bx, bz, y] (semi-ancho fijo 0.5) para sembrar pasto 3D
  const bermaStrips = [];
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
  const roadGreenShare = (r) => {
    let inside = 0, total = 0;
    const pts = r.p || [];
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
      const L = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.ceil(L / 4));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        if (city.inAnyGreen(ax + (bx - ax) * t, az + (bz - az) * t)) inside++;
        total++;
      }
    }
    return total ? inside / total : 0;
  };
  const nearGreen = (x, z, r = 52.0) => {
    if (city.inAnyGreen(x, z)) return true;
    const d = r * 0.7;
    return city.inAnyGreen(x + r, z) || city.inAnyGreen(x - r, z)
      || city.inAnyGreen(x, z + r) || city.inAnyGreen(x, z - r)
      || city.inAnyGreen(x + d, z + d) || city.inAnyGreen(x + d, z - d)
      || city.inAnyGreen(x - d, z + d) || city.inAnyGreen(x - d, z - d);
  };
  const roadTouchesGreen = (r, greenShare) => {
    if (greenShare > 0.01) return true;
    const pts = r.p || [];
    for (const p of pts) if (nearGreen(p[0], p[1], 62.0)) return true;
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
      if (nearGreen((ax + bx) * 0.5, (az + bz) * 0.5, 62.0)) return true;
    }
    return false;
  };
  const PARK_PATH_TYPES = new Set(['path', 'footway', 'pedestrian', 'steps', 'cycleway']);
  let ri = 0;
  for (const r of city.data.roads) {
    const pts = r.p;
    const t = r.t || '';
    const walkType = PARK_PATH_TYPES.has(t);
    const greenShare = roadGreenShare(r);
    const parkEdge = roadTouchesGreen(r, greenShare);
    const parkStonePath = t === 'path' && parkEdge;
    const rawFull = r.w ?? (walkType ? 2.0 : 6.0);
    const full = parkStonePath ? Math.min(rawFull, 1.45) : rawFull;
    const hw = full * 0.5;
    const ped = walkType || full < 4.0;
    // Dentro de parques, solo los senderos "path" quedan como piedra.
    // El resto de trazos peatonales importados se deja como cesped.
    if (ped && !parkStonePath && parkEdge) continue;
    // tendido electrico AMBOS lados (desfasados media cuadra) = mas postes,
    // y pares de postes enfrentados para cruzar cables sobre la pista
    const runA = [], runB = [];
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
      // Park paths stay as narrow stone ribbons; non-path concrete imports are grass.
      const RB = ped ? path : road;
      const pathLift = (ped && parkStonePath) ? 0.052 : 0;
      quadUV(RB, ax, az, bx, bz, ux, uz, hw, 0, yaE + pathLift, ybE + pathLift, white, ped ? 0.4 : 0.16);
      disc(RB, ax, az, yaE + pathLift + 0.005, hw, white);
      disc(RB, bx, bz, ybE + pathLift + 0.005, hw, white);
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
            const walkInPark = nearGreen(px, pz, 58.0) || nearGreen(qax, qaz, 58.0) || nearGreen(qbx, qbz, 58.0);
            // san borja real: sardinel → BERMA verde con arboles → vereda de losetas
            quadUV(berma, eax, eaz, ebx, ebz, ux, uz, 0.5, (hw + 0.9) * side, WALK_Y + yo - 0.015, WALK_Y + yo - 0.015, white, 0.35);
            {
              const boff = (hw + 0.9) * side;
              bermaStrips.push([eax + (-uz) * boff, eaz + ux * boff, ebx + (-uz) * boff, ebz + ux * boff, WALK_Y + yo - 0.015]);
            }
            if (!walkInPark) quadUV(walk, eax, eaz, ebx, ebz, ux, uz, 1.0, (hw + 2.4) * side, WALK_Y + yo, WALK_Y + yo, white, 0.30);
            // sardinel 3D: cara vertical visible desde la pista,
            // pintado AMARILLO cerca de las esquinas (zona rigida limeña)
            const snx = (-uz) * side, snz = ux * side;
            const isCorner = (i === 0 && d < 7) || (i === pts.length - 2 && d + step > L - 7);
            const ccol = isCorner ? [0.93, 0.72, 0.10] : [0.80, 0.79, 0.76];
            if (!walkInPark) {
              curb.quad(
                [eax + snx * (hw + 0.4), ROAD_Y + yo - 0.01, eaz + snz * (hw + 0.4)],
                [ebx + snx * (hw + 0.4), ROAD_Y + yo - 0.01, ebz + snz * (hw + 0.4)],
                [ebx + snx * (hw + 0.4), WALK_Y + yo + 0.03, ebz + snz * (hw + 0.4)],
                [eax + snx * (hw + 0.4), WALK_Y + yo + 0.03, eaz + snz * (hw + 0.4)],
                [-snx, 0, -snz], ccol);
            }
            // postes de luz cada 40 m POR LADO, desfasados 20 m entre lados
            if (!walkInPark && full >= 6.0) {
              if (side === 1 && phase >= 5 && phase < 8) {
                runA.push([mx + snx * (hw + 1.42), mz + snz * (hw + 1.42), Math.atan2(ux, uz)]);
              } else if (side === -1 && phase >= 25 && phase < 28) {
                runB.push([mx + snx * (hw + 1.42), mz + snz * (hw + 1.42), Math.atan2(ux, uz)]);
              }
            }
            if (!walkInPark && full >= 8.0) {
              const fang = Math.atan2(-(-uz) * side, -ux * side);
              if (phase < 3) furniture.trees.push([mx + (-uz) * (hw + 0.9) * side, mz + ux * (hw + 0.9) * side, fang]);
              else if (phase >= 20 && phase < 23) furniture.lamps.push([mx + (-uz) * (hw + 0.85) * side, mz + ux * (hw + 0.85) * side, fang]);
              else if (phase >= 30 && phase < 33) furniture.benches.push([mx + (-uz) * (hw + 2.55) * side, mz + ux * (hw + 2.55) * side, fang]);
              else if (phase >= 10 && phase < 11.5 && full >= 10) furniture.misc.push([mx + (-uz) * (hw + 0.9) * side, mz + ux * (hw + 0.9) * side, fang]);
              else if (phase >= 33 && phase < 35 && side === 1) furniture.signs.push([mx + snx * (hw + 2.15), mz + snz * (hw + 2.15), Math.atan2(ux, uz)]);
              else if (phase >= 35 && phase < 37) furniture.planters.push([mx + snx * (hw + 2.35), mz + snz * (hw + 2.35), fang]);
            }
          }
        }
        d += step;
      }
      if (full >= 5.5 && L > 6) {
        const wornEdge = [0.90, 0.89, 0.84];
        for (const lo of [hw * 0.86, -hw * 0.86]) {
          quadUV(paint, ax, az, bx, bz, ux, uz, 0.07, lo, ROAD_Y + yo + 0.013, ROAD_Y + yo + 0.013, wornEdge, 1.0);
        }
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
            const fade = 0.92 + hashF(ri * 19 + Math.floor(dd)) * 0.06;
            const laneCol = [fade, fade, fade * 0.97];
            quadUV(paint, ax + ux * dd, az + uz * dd, ax + ux * de, az + uz * de, ux, uz, 0.14, lo, ROAD_Y + yo + 0.014, ROAD_Y + yo + 0.014, laneCol, 1.0);
          }
        }
        if (full >= 12 && L > 14) {
          const yel = [0.94, 0.78, 0.18];
          for (let yd = 3.0; yd < L - 3.0; yd += 5.5) {
            const ye = Math.min(yd + 1.8, L - 1.2);
            quadUV(paint, ax + ux * yd, az + uz * yd, ax + ux * ye, az + uz * ye, ux, uz, 0.08, -0.24, ROAD_Y + yo + 0.015, ROAD_Y + yo + 0.015, yel, 1.0);
            quadUV(paint, ax + ux * yd, az + uz * yd, ax + ux * ye, az + uz * ye, ux, uz, 0.08, 0.24, ROAD_Y + yo + 0.015, ROAD_Y + yo + 0.015, yel, 1.0);
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
    if (runA.length > 1) furniture.poleRuns.push(runA);
    if (runB.length > 1) furniture.poleRuns.push(runB);
    // cruces de calle: cada poste del lado A con su enfrentado mas cercano del
    // lado B (la maranha diagonal que cuelga sobre la pista, firma limena)
    if (runA.length && runB.length) {
      for (let pi = 0; pi < runA.length; pi++) {
        const a = runA[pi];
        let best = null, bd = 1e9;
        for (const b of runB) {
          const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (d < bd) { bd = d; best = b; }
        }
        if (best && bd > 6 && bd < 34) furniture.cableCrossings.push([a[0], a[1], best[0], best[1]]);
      }
    }
  }
  return { road, walk, paint, median, berma, curb, path, deck, furniture, bermaStrips };
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
  const REDB = [0.70, 0.20, 0.16], GREYB = [0.33, 0.33, 0.36];
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

  // MEDIA LUNA de plantas: seto bajo verde oscuro abrazando ATRAS de la Virgen
  // (lado norte/+Z) y envolviendo a los costados, con la abertura mirando al
  // frente (sur/-Z), tal como el manchon verde de la referencia.
  const HEDGE = [0.18, 0.36, 0.16];                         // verde oscuro 0x2f5d2a aprox
  const hr = 3.1;                                           // radio del seto alrededor del santuario
  // arco de ~250 grados: deja un hueco al sur (-Z) por donde se accede
  const a0 = Math.PI * 0.18, a1 = Math.PI * 1.82;           // de ~32deg a ~328deg (gap al sur)
  ringArc(feat, cx, cz, a0, a1, hr, hr - 1.05, 0.10, 0.62, HEDGE); // banda curva con cuerpo
  // tapa superior redondeada del seto (un poco mas claro) para que lea como follaje
  ringArc(feat, cx, cz, a0, a1, (hr - 0.5), (hr - 1.05) + 0.55, 0.72, 0.0, [0.22, 0.44, 0.20]);

  // BANCAS en ANILLO alrededor del perimetro de la plaza, mirando hacia adentro
  // (8 puntos), tal como los puntos rojos pegados al circulo en la referencia.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.39;
    const bx = cx + Math.cos(a) * (R - 1.6), bz = cz + Math.sin(a) * (R - 1.6);
    benchOut.push([bx, bz, Math.atan2(cx - bx, cz - bz)]);
  }

  // === JUEGOS PARA NINOS (al OESTE, -X) ===
  const px = cx - 20, pz = cz + 1;                          // centro del area de juegos
  buildPlayground(feat, plaza, px, pz);

  // === CASETA DE VIGILANCIA (al SUR-ESTE, +X / -Z) ===
  const kx = cx + 16, kz = cz - 16;
  buildBooth(feat, kx, kz);
}

// banda curva (arco anular) entre dos angulos: pared exterior + interior + tapa.
// Sirve para setos en media luna. height = alto del seto.
function ringArc(B, cx, cz, a0, a1, rOut, rIn, height, baseY, c) {
  const N = 18;
  const top = c.map(v => Math.min(1, v + 0.06));
  for (let i = 0; i < N; i++) {
    const t0 = a0 + (a1 - a0) * (i / N), t1 = a0 + (a1 - a0) * ((i + 1) / N);
    const co0 = Math.cos(t0), si0 = Math.sin(t0), co1 = Math.cos(t1), si1 = Math.sin(t1);
    const oA = [cx + co0 * rOut, cz + si0 * rOut], oB = [cx + co1 * rOut, cz + si1 * rOut];
    const iA = [cx + co0 * rIn, cz + si0 * rIn], iB = [cx + co1 * rIn, cz + si1 * rIn];
    const y0 = baseY, y1 = baseY + height;
    // cara exterior (normal radial hacia afuera)
    B.quad([oA[0], y0, oA[1]], [oB[0], y0, oB[1]], [oB[0], y1, oB[1]], [oA[0], y1, oA[1]],
      [(co0 + co1) * 0.5, 0, (si0 + si1) * 0.5], c);
    // cara interior (normal hacia adentro)
    B.quad([iB[0], y0, iB[1]], [iA[0], y0, iA[1]], [iA[0], y1, iA[1]], [iB[0], y1, iB[1]],
      [-(co0 + co1) * 0.5, 0, -(si0 + si1) * 0.5], c);
    // tapa superior (CCW vista desde arriba)
    B.quad([iA[0], y1, iA[1]], [oA[0], y1, oA[1]], [oB[0], y1, oB[1]], [iB[0], y1, iB[1]], [0, 1, 0], top);
  }
}

// tira de concreto recta entre dos puntos (sendero radial de la plaza).
function buildPath(B, x0, z0, x1, z1, width) {
  const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
  if (L < 0.01) return;
  const ux = dx / L, uz = dz / L, nx = -uz, nz = ux, hw = width * 0.5;
  const PATHC = [0.72, 0.69, 0.62];
  B.quad(
    [x0 - nx * hw, 0.035, z0 - nz * hw], [x1 - nx * hw, 0.035, z1 - nz * hw],
    [x1 + nx * hw, 0.035, z1 + nz * hw], [x0 + nx * hw, 0.035, z0 + nz * hw],
    [0, 1, 0], PATHC, (p) => [p[0] * 0.18, p[2] * 0.18]);
}

// caseta de vigilancia toon: caja 2x2x2.4 + techo a dos aguas + puerta + ventana.
function buildBooth(feat, kx, kz) {
  const TEAL = [0.17, 0.71, 0.69], WALL = [0.90, 0.90, 0.88], DARK = [0.13, 0.13, 0.16];
  const GLASS = [0.55, 0.74, 0.80], ROOF = [0.30, 0.30, 0.33];
  roofBox(feat, kx, 0.0, kz, 1.05, 0.12, 1.05, DARK);      // losa base
  roofBox(feat, kx, 0.12, kz, 1.0, 1.1, 1.0, WALL);        // cuerpo (hasta y=2.32)
  roofBox(feat, kx, 1.22, kz, 1.0, 0.12, 1.0, TEAL);       // friso turquesa
  gableRoof(feat, kx, 2.34, kz, 1.2, 1.2, 0.7, ROOF, TEAL); // techo a dos aguas
  // ventana al frente (-Z): vidrio + marco turquesa
  roofBox(feat, kx, 0.65, kz - 1.0, 0.55, 0.4, 0.03, GLASS);
  roofBox(feat, kx, 0.60, kz - 1.01, 0.62, 0.06, 0.02, TEAL); // alfeizar
  // puerta a un costado (+X)
  roofBox(feat, kx + 1.0, 0.0, kz + 0.25, 0.02, 0.95, 0.34, DARK);
}

// juegos para ninos: parche de arena + tobogan + columpio + balancin.
function buildPlayground(feat, plaza, px, pz) {
  const SAND = [0.88, 0.70, 0.44], RED = [0.82, 0.22, 0.20];
  const BLUE = [0.20, 0.42, 0.78], YEL = [0.92, 0.78, 0.18], POST = [0.40, 0.42, 0.46];
  const GREEN = [0.25, 0.48, 0.24], RUBBER = [0.72, 0.46, 0.28], DARK_RUBBER = [0.28, 0.27, 0.25];
  // piso de caucho/arena compacto, mas realista que una losa gris
  roofCyl(plaza, px, 0.03, pz, 7.2, 0.025, SAND);
  roofCyl(plaza, px, 0.056, pz, 5.0, 0.012, RUBBER);
  // safety tiles break the flat disk and read as real playground flooring.
  roofBox(plaza, px - 3.2, 0.07, pz + 2.2, 1.25, 0.012, 0.72, DARK_RUBBER);
  roofBox(plaza, px + 2.25, 0.07, pz + 0.5, 1.15, 0.012, 1.35, DARK_RUBBER);
  roofBox(plaza, px + 0.3, 0.071, pz - 3.2, 1.7, 0.012, 0.5, [0.22, 0.30, 0.25]);
  // rubber tile grid and low curbs make the surface read like a real main park playground.
  for (let ix = -3; ix <= 3; ix++) {
    roofBox(plaza, px + ix * 1.55, 0.083, pz, 0.018, 0.01, 4.55, [0.36, 0.34, 0.30]);
  }
  for (let iz = -3; iz <= 3; iz++) {
    roofBox(plaza, px, 0.084, pz + iz * 1.35, 4.8, 0.01, 0.018, [0.36, 0.34, 0.30]);
  }
  // borde bajo de caucho para que el area lea como juegos infantiles reales.
  roofBox(feat, px - 7.15, 0.08, pz, 0.08, 0.16, 5.0, GREEN);
  roofBox(feat, px + 7.15, 0.08, pz, 0.08, 0.16, 5.0, GREEN);
  roofBox(feat, px, 0.08, pz - 5.05, 7.1, 0.16, 0.08, GREEN);
  roofBox(feat, px, 0.08, pz + 5.05, 7.1, 0.16, 0.08, GREEN);

  // TOBOGAN: torre + rampa azul + escalera roja (al lado -X del area)
  const tx = px - 2.6, tz = pz - 1.5;
  roofBox(feat, tx, 0.05, tz, 0.7, 1.4, 0.7, RED);                 // torre
  roofBox(feat, tx, 1.45, tz, 0.8, 0.1, 0.8, YEL);                 // plataforma
  roofBox(feat, tx, 2.05, tz, 0.92, 0.08, 0.92, GREEN);            // techo plano
  roofBox(feat, tx - 0.72, 1.62, tz, 0.05, 0.36, 0.72, POST);      // baranda
  roofBox(feat, tx + 0.72, 1.62, tz, 0.05, 0.36, 0.72, POST);
  // rampa azul inclinada (caja girada a mano por vertices)
  slide(feat, tx, tz, BLUE);
  // escalones rojos
  for (let s = 0; s < 3; s++) roofBox(feat, tx + 0.0, 0.25 + s * 0.4, tz + 0.75 + s * 0.22, 0.55, 0.06, 0.12, RED);
  roofBox(feat, tx - 0.68, 0.72, tz + 1.05, 0.05, 0.72, 0.05, POST);
  roofBox(feat, tx + 0.68, 0.72, tz + 1.05, 0.05, 0.72, 0.05, POST);
  for (let r = 0; r < 4; r++) roofBox(feat, tx, 0.35 + r * 0.24, tz + 1.05 + r * 0.13, 0.66, 0.025, 0.035, YEL);

  // COLUMPIO: estructura mas ancha + 2 asientos (al lado +X)
  const sx = px + 2.2, sz = pz + 0.5;
  for (const xo of [-0.45, 0.45]) {
    roofBox(feat, sx + xo, 0.05, sz - 1.0, 0.08, 1.7, 0.08, POST);
    roofBox(feat, sx + xo, 0.05, sz + 1.0, 0.08, 1.7, 0.08, POST);
    roofBox(feat, sx + xo * 1.12, 0.85, sz - 0.55, 0.05, 0.92, 0.045, POST);
    roofBox(feat, sx + xo * 1.12, 0.85, sz + 0.55, 0.05, 0.92, 0.045, POST);
  }
  roofBox(feat, sx, 1.72, sz, 0.62, 0.09, 1.18, POST);             // barra superior
  for (const so of [-0.45, 0.45]) {                               // 2 asientos colgando
    roofBox(feat, sx - 0.18, 0.72, sz + so, 0.035, 0.76, 0.025, POST);
    roofBox(feat, sx + 0.18, 0.72, sz + so, 0.035, 0.76, 0.025, POST);
    roofBox(feat, sx, 0.44, sz + so, 0.30, 0.05, 0.17, YEL);      // tablita
  }
  roofBox(feat, sx, 1.92, sz, 0.82, 0.04, 1.38, RED);              // sun shade / cross brace

  // BALANCIN (sube y baja) al frente del area (-Z)
  const bx = px, bz = pz + 3.0;
  roofBox(feat, bx, 0.05, bz, 0.18, 0.45, 0.18, POST);            // pivote
  // viga inclinada: roja un extremo, azul el otro
  seesaw(feat, bx, bz, RED, BLUE);
  roofBox(feat, bx - 0.34, 0.83, bz - 1.45, 0.05, 0.05, 0.24, YEL);
  roofBox(feat, bx + 0.34, 0.83, bz + 1.45, 0.05, 0.05, 0.24, YEL);

  // CARRUSEL BAJO: punto de juego reconocible desde camara alta
  const cx = px + 0.25, cz = pz - 0.45;
  roofCyl(feat, cx, 0.10, cz, 0.95, 0.16, YEL);
  roofCyl(feat, cx, 0.29, cz, 0.22, 0.35, POST);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const hx = cx + Math.cos(a) * 0.55, hz = cz + Math.sin(a) * 0.55;
    roofBox(feat, hx, 0.34, hz, Math.abs(Math.cos(a)) * 0.36 + 0.05, 0.05, Math.abs(Math.sin(a)) * 0.36 + 0.05, i % 2 ? BLUE : RED);
  }

  // trepador simple con barras verdes y amarillas
  const gx = px - 0.8, gz = pz - 3.45;
  for (let i = 0; i < 4; i++) {
    roofBox(feat, gx - 1.2 + i * 0.8, 0.12, gz, 0.06, 0.8 + i * 0.08, 0.06, GREEN);
    roofBox(feat, gx - 1.2 + i * 0.8, 0.86 + i * 0.08, gz, 0.08, 0.05, 0.56, YEL);
  }
  // pasamanos bajos tipo monkey bars, legibles desde la camara alta
  const mx = px + 1.1, mz = pz - 3.2;
  for (let i = 0; i < 5; i++) {
    const x = mx - 1.0 + i * 0.5;
    roofBox(feat, x, 0.12, mz, 0.045, 0.86, 0.045, POST);
    roofBox(feat, x, 0.98, mz, 0.045, 0.04, 0.72, i % 2 ? BLUE : YEL);
  }

  // climbing net and spring riders add real playground density without new assets.
  const nx = px - 4.75, nz = pz + 2.55;
  roofBox(feat, nx - 0.9, 0.08, nz, 0.055, 1.25, 0.055, POST);
  roofBox(feat, nx + 0.9, 0.08, nz, 0.055, 1.25, 0.055, POST);
  roofBox(feat, nx, 1.28, nz, 0.96, 0.05, 0.055, GREEN);
  for (let i = 0; i < 4; i++) {
    roofBox(feat, nx - 0.72 + i * 0.48, 0.55 + i * 0.12, nz, 0.035, 0.035, 0.58, i % 2 ? YEL : BLUE);
    roofBox(feat, nx - 0.72 + i * 0.48, 0.95 - i * 0.10, nz, 0.035, 0.035, 0.58, i % 2 ? BLUE : YEL);
  }
  for (const [rx, rz, col] of [[px + 4.65, pz + 2.65, RED], [px + 5.25, pz + 0.95, BLUE]]) {
    roofCyl(feat, rx, 0.16, rz, 0.16, 0.32, POST);
    roofBox(feat, rx, 0.48, rz, 0.46, 0.14, 0.24, col);
    roofBox(feat, rx + 0.38, 0.56, rz, 0.16, 0.13, 0.18, YEL);
    roofBox(feat, rx - 0.42, 0.48, rz, 0.18, 0.08, 0.06, POST);
  }

  // playhouse: small house shape makes the main park playground recognizable.
  const hx = px + 4.45, hz = pz - 2.45;
  roofBox(feat, hx, 0.08, hz, 0.78, 0.82, 0.62, [0.88, 0.66, 0.30]);
  gableRoof(feat, hx, 0.92, hz, 0.9, 0.72, 0.45, RED, [0.88, 0.66, 0.30]);
  roofBox(feat, hx, 0.1, hz - 0.63, 0.22, 0.55, 0.025, DARK_RUBBER);
  roofBox(feat, hx - 0.42, 0.45, hz - 0.64, 0.16, 0.2, 0.02, BLUE);
  roofBox(feat, hx + 0.42, 0.45, hz - 0.64, 0.16, 0.2, 0.02, BLUE);

  // shade canopy, hopscotch and balance blocks make the playground read better
  // from the high ARPG camera without adding heavy assets.
  const shx = px - 4.5, shz = pz - 1.35;
  for (const [ox, oz] of [[-0.85, -0.65], [0.85, -0.65], [-0.85, 0.65], [0.85, 0.65]]) {
    roofBox(feat, shx + ox, 0.08, shz + oz, 0.055, 1.35, 0.055, POST);
  }
  roofBox(feat, shx, 1.46, shz, 1.08, 0.055, 0.84, [0.86, 0.18, 0.22]);
  roofBox(feat, shx, 1.53, shz, 0.86, 0.055, 0.64, YEL);
  const hopX = px - 1.9, hopZ = pz + 2.25;
  for (let i = 0; i < 5; i++) {
    const off = (i % 2) ? 0.22 : -0.22;
    roofBox(plaza, hopX + off, 0.085, hopZ - i * 0.38, 0.18, 0.01, 0.14, i % 2 ? BLUE : YEL);
  }
  for (let i = 0; i < 4; i++) {
    roofBox(feat, px + 3.05 + i * 0.46, 0.12, pz + 3.85, 0.15, 0.16, 0.15, i % 2 ? RED : BLUE);
  }

  // Extra recognizable playground volume for the high camera: rope dome,
  // crawling tunnel and small sport goals. All lightweight procedural boxes.
  const domeX = px - 5.05, domeZ = pz - 3.05;
  roofCyl(feat, domeX, 0.09, domeZ, 0.18, 0.42, POST);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = domeX + Math.cos(a) * 1.05;
    const z = domeZ + Math.sin(a) * 1.05;
    roofBox(feat, x, 0.08, z, 0.045, 0.92, 0.045, i % 2 ? YEL : BLUE);
    roofBox(feat, (x + domeX) * 0.5, 0.92, (z + domeZ) * 0.5,
      Math.abs(x - domeX) * 0.5 + 0.035, 0.035, Math.abs(z - domeZ) * 0.5 + 0.035, GREEN);
  }
  const tunX = px + 5.45, tunZ = pz - 0.85;
  roofBox(feat, tunX, 0.23, tunZ, 0.88, 0.34, 0.46, [0.82, 0.22, 0.20]);
  roofBox(feat, tunX, 0.62, tunZ, 0.7, 0.16, 0.36, YEL);
  for (const gz of [pz - 4.65, pz + 4.65]) {
    roofBox(feat, px + 2.25, 0.1, gz, 0.9, 0.08, 0.06, POST);
    roofBox(feat, px + 1.4, 0.1, gz, 0.06, 0.6, 0.06, POST);
    roofBox(feat, px + 3.1, 0.1, gz, 0.06, 0.6, 0.06, POST);
    roofBox(feat, px + 2.25, 0.7, gz, 0.9, 0.055, 0.055, YEL);
  }

  // rope bridge and crawl bars make the main park feel built, not decorative.
  const brx = px - 0.1, brz = pz - 1.9;
  roofBox(feat, brx, 0.82, brz, 1.55, 0.06, 0.18, [0.56, 0.36, 0.20]);
  for (let i = 0; i < 5; i++) {
    const x = brx - 1.15 + i * 0.58;
    roofBox(feat, x, 0.28, brz, 0.045, 0.72, 0.045, POST);
    roofBox(feat, x, 1.02, brz, 0.045, 0.04, 0.46, i % 2 ? GREEN : YEL);
  }
  roofBox(feat, brx, 1.14, brz - 0.28, 1.45, 0.045, 0.05, BLUE);
  roofBox(feat, brx, 1.14, brz + 0.28, 1.45, 0.045, 0.05, BLUE);
  for (let i = 0; i < 6; i++) {
    const x = brx - 1.2 + i * 0.48;
    roofBox(feat, x, 0.94, brz - 0.28, 0.035, 0.28, 0.035, GREEN);
    roofBox(feat, x, 0.94, brz + 0.28, 0.035, 0.28, 0.035, GREEN);
  }
  const spinX = px - 3.75, spinZ = pz + 0.3;
  roofCyl(feat, spinX, 0.12, spinZ, 0.7, 0.18, BLUE);
  roofCyl(feat, spinX, 0.34, spinZ, 0.13, 0.45, POST);
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3;
    roofBox(feat, spinX + Math.cos(a) * 0.42, 0.46, spinZ + Math.sin(a) * 0.42,
      Math.abs(Math.cos(a)) * 0.34 + 0.05, 0.045, Math.abs(Math.sin(a)) * 0.34 + 0.05, YEL);
  }

  // cerco bajo, deja entradas libres y mejora la escala del area infantil
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    if (Math.abs(Math.sin(a)) < 0.22 && Math.cos(a) > 0) continue;
    const fx = px + Math.cos(a) * 7.0, fz = pz + Math.sin(a) * 7.0;
    roofBox(feat, fx, 0.08, fz, 0.055, 0.42, 0.055, POST);
  }
  for (const [qx, qz] of [[px - 6.25, pz + 4.3], [px + 5.95, pz + 4.25]]) {
    roofBox(feat, qx, 0.18, qz, 0.72, 0.12, 0.24, [0.56, 0.34, 0.18]);
    roofBox(feat, qx - 0.52, 0.06, qz, 0.06, 0.36, 0.06, POST);
    roofBox(feat, qx + 0.52, 0.06, qz, 0.06, 0.36, 0.06, POST);
  }

  // Extra realistic pieces: tire swing, climbing wall and tiny toy markers.
  const tireX = sx + 0.75, tireZ = sz + 0.1;
  roofBox(feat, tireX - 0.18, 0.78, tireZ, 0.025, 0.72, 0.025, DARK_RUBBER);
  roofBox(feat, tireX + 0.18, 0.78, tireZ, 0.025, 0.72, 0.025, DARK_RUBBER);
  roofCyl(feat, tireX, 0.42, tireZ, 0.28, 0.12, DARK_RUBBER);
  roofCyl(feat, tireX, 0.44, tireZ, 0.14, 0.14, [0.08, 0.08, 0.08]);
  const wallX = tx + 0.92, wallZ = tz - 0.05;
  roofBox(feat, wallX, 0.72, wallZ, 0.08, 0.98, 0.58, BLUE);
  for (let i = 0; i < 5; i++) {
    roofBox(feat, wallX + 0.055, 0.34 + i * 0.16, wallZ - 0.34 + (i % 3) * 0.28, 0.045, 0.055, 0.06, i % 2 ? YEL : RED);
  }
  for (const [toyX, toyZ, col] of [[px - 3.7, pz + 3.8, RED], [px - 3.15, pz + 3.35, BLUE], [px - 2.62, pz + 3.72, YEL]]) {
    roofCyl(plaza, toyX, 0.12, toyZ, 0.16, 0.12, col);
    roofBox(plaza, toyX, 0.25, toyZ, 0.18, 0.05, 0.18, col);
  }

  // Toddler zone: small blocks, stepping logs and parent benches add believable scale.
  const kidX = px + 0.6, kidZ = pz + 4.25;
  for (let i = 0; i < 5; i++) {
    roofCyl(feat, kidX - 1.0 + i * 0.5, 0.11, kidZ + (i % 2) * 0.18, 0.18, 0.16 + i * 0.025, i % 2 ? GREEN : YEL);
  }
  for (const [bx2, bz2, rotWide] of [[px - 5.8, pz - 4.25, true], [px + 5.9, pz + 4.0, false]]) {
    roofBox(feat, bx2, 0.18, bz2, rotWide ? 0.84 : 0.24, 0.12, rotWide ? 0.22 : 0.84, [0.56, 0.34, 0.18]);
    roofBox(feat, bx2 - (rotWide ? 0.52 : 0), 0.06, bz2 - (rotWide ? 0 : 0.52), 0.055, 0.34, 0.055, POST);
    roofBox(feat, bx2 + (rotWide ? 0.52 : 0), 0.06, bz2 + (rotWide ? 0 : 0.52), 0.055, 0.34, 0.055, POST);
  }
  const miniX = px + 4.1, miniZ = pz + 3.15;
  roofBox(feat, miniX, 0.12, miniZ, 0.62, 0.52, 0.62, BLUE);
  roofBox(feat, miniX, 0.68, miniZ, 0.72, 0.06, 0.72, YEL);
  roofBox(feat, miniX - 0.48, 0.45, miniZ, 0.05, 0.52, 0.05, RED);
  roofBox(feat, miniX + 0.48, 0.45, miniZ, 0.05, 0.52, 0.05, GREEN);
  const tableX = px + 6.05, tableZ = pz - 4.15;
  roofBox(feat, tableX, 0.32, tableZ, 0.92, 0.08, 0.42, [0.56, 0.34, 0.18]);
  roofBox(feat, tableX - 0.56, 0.22, tableZ, 0.08, 0.22, 0.34, POST);
  roofBox(feat, tableX + 0.56, 0.22, tableZ, 0.08, 0.22, 0.34, POST);
  roofBox(feat, tableX, 0.16, tableZ - 0.58, 0.86, 0.07, 0.13, [0.56, 0.34, 0.18]);
  roofBox(feat, tableX, 0.16, tableZ + 0.58, 0.86, 0.07, 0.13, [0.56, 0.34, 0.18]);
  const fountainX = px - 6.2, fountainZ = pz - 0.15;
  roofCyl(feat, fountainX, 0.18, fountainZ, 0.18, 0.42, [0.30, 0.54, 0.62]);
  roofBox(feat, fountainX + 0.16, 0.58, fountainZ, 0.08, 0.09, 0.18, [0.74, 0.84, 0.86]);
  roofBox(feat, fountainX + 0.32, 0.58, fountainZ, 0.08, 0.03, 0.05, [0.08, 0.10, 0.12]);
  roofBox(feat, px - 6.65, 0.32, pz - 2.15, 0.08, 0.55, 0.28, [0.92, 0.78, 0.18]);
  roofBox(feat, px - 6.62, 0.74, pz - 2.15, 0.06, 0.22, 0.24, [0.20, 0.42, 0.78]);
  for (let i = 0; i < 5; i++) {
    roofBox(feat, px - 2.2 + i * 0.55, 0.12, pz + 4.85 + (i % 2) * 0.16, 0.2, 0.14, 0.2, i % 2 ? [0.54, 0.36, 0.22] : [0.64, 0.42, 0.24]);
  }
}

// rampa de tobogan: prisma azul inclinado desde la plataforma al suelo (+Z).
function slide(B, tx, tz, c) {
  const x0 = tx - 0.28, x1 = tx + 0.28;   // ancho
  const hiZ = tz + 0.4, loZ = tz + 2.6;   // recorre hacia +Z
  const hiY = 1.5, loY = 0.12;            // baja de plataforma al suelo
  const v = (x, y, z) => [x, y, z];
  // superficie deslizante (arriba)
  B.quad(v(x0, hiY, hiZ), v(x0, loY, loZ), v(x1, loY, loZ), v(x1, hiY, hiZ), [0, 0.8, -0.6], c);
  // costados
  B.quad(v(x0, hiY, hiZ), v(x0, hiY - 0.18, hiZ), v(x0, loY - 0.04, loZ), v(x0, loY, loZ), [-1, 0, 0], c);
  B.quad(v(x1, loY, loZ), v(x1, loY - 0.04, loZ), v(x1, hiY - 0.18, hiZ), v(x1, hiY, hiZ), [1, 0, 0], c);
}

// viga de balancin inclinada sobre el pivote, dos colores en los extremos.
function seesaw(B, bx, bz, cA, cB) {
  const y0 = 0.7, dz = 1.7, tilt = 0.35;  // inclinacion
  const hw = 0.12, hh = 0.08;
  const v = (x, y, z) => [x, y, z];
  // mitad A (extremo -Z, abajo) y mitad B (extremo +Z, arriba)
  const segs = [[bz - dz, y0 - tilt, bz, y0, cA], [bz, y0, bz + dz, y0 + tilt, cB]];
  for (const [zA, yA, zB, yB, c] of segs) {
    // caja alargada inclinada (4 caras laterales + topes simplificados)
    B.quad(v(bx - hw, yA + hh, zA), v(bx + hw, yA + hh, zA), v(bx + hw, yB + hh, zB), v(bx - hw, yB + hh, zB), [0, 1, 0.1], c);
    B.quad(v(bx - hw, yA - hh, zA), v(bx - hw, yA + hh, zA), v(bx - hw, yB + hh, zB), v(bx - hw, yB - hh, zB), [-1, 0, 0], c);
    B.quad(v(bx + hw, yB - hh, zB), v(bx + hw, yB + hh, zB), v(bx + hw, yA + hh, zA), v(bx + hw, yA - hh, zA), [1, 0, 0], c);
  }
}

function sampleLawnCell(x0, z0, x1, z1) {
  const cx = (x0 + x1) * 0.5;
  const cz = (z0 + z1) * 0.5;
  return [
    [x0, z0], [cx, z0], [x1, z0],
    [x0, cz], [cx, cz], [x1, cz],
    [x0, z1], [cx, z1], [x1, z1],
  ];
}

function lawnCellInsidePark(city, ring, x0, z0, x1, z1) {
  for (const [x, z] of sampleLawnCell(x0, z0, x1, z1)) {
    if (!city.pointInRing(x, z, ring)) return false;
  }
  return true;
}

function lawnCellTouchesRoad(city, x0, z0, x1, z1, margin = 0.2) {
  for (const [x, z] of sampleLawnCell(x0, z0, x1, z1)) {
    if (city.onAnyRoad(x, z, margin)) return true;
  }
  return false;
}

function clearLawnCell(city, ring, x0, z0, x1, z1) {
  return lawnCellInsidePark(city, ring, x0, z0, x1, z1) &&
    !lawnCellTouchesRoad(city, x0, z0, x1, z1, 0.2);
}

function paintableLawnCell(city, ring, x0, z0, x1, z1) {
  return lawnCellInsidePark(city, ring, x0, z0, x1, z1);
}

function parkEdgeGrassApron(B, city, ring) {
  const area = ringArea(ring);
  const sign = area >= 0 ? 1 : -1;
  const col = [0.34, 0.64, 0.25];
  const y = 0.064;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const L = Math.hypot(dx, dz);
    if (L < 0.05) continue;
    const ux = dx / L, uz = dz / L;
    const nx = uz * sign, nz = -ux * sign;
    const mx = (a[0] + b[0]) * 0.5, mz = (a[1] + b[1]) * 0.5;
    const quad = (o0, o1) => {
      B.quad(
        [a[0] + nx * o0, y, a[1] + nz * o0],
        [b[0] + nx * o0, y, b[1] + nz * o0],
        [b[0] + nx * o1, y, b[1] + nz * o1],
        [a[0] + nx * o1, y, a[1] + nz * o1],
        [0, 1, 0], col, (p) => [p[0] * 0.35, p[2] * 0.35]);
    };
    if (!city.onAnyRoad(mx - nx * 1.75, mz - nz * 1.75, 0.8) &&
      !city.onAnyRoad(mx - nx * 5.75, mz - nz * 5.75, 0.65) &&
      !city.onAnyRoad(mx - nx * 10.5, mz - nz * 10.5, 0.5) &&
      !city.onAnyRoad(mx - nx * 15.0, mz - nz * 15.0, 0.4)) quad(-18.0, -0.05);
    if (!city.onAnyRoad(mx + nx * 1.85, mz + nz * 1.85, 1.1) &&
      !city.onAnyRoad(mx + nx * 3.55, mz + nz * 3.55, 0.9) &&
      !city.onAnyRoad(mx + nx * 5.75, mz + nz * 5.75, 0.75) &&
      !city.onAnyRoad(mx + nx * 7.35, mz + nz * 7.35, 0.65) &&
      !city.onAnyRoad(mx + nx * 9.9, mz + nz * 9.9, 0.55) &&
      !city.onAnyRoad(mx + nx * 12.4, mz + nz * 12.4, 0.5) &&
      !city.onAnyRoad(mx + nx * 15.3, mz + nz * 15.3, 0.45) &&
      !city.onAnyRoad(mx + nx * 20.5, mz + nz * 20.5, 0.35) &&
      !city.onAnyRoad(mx + nx * 27.5, mz + nz * 27.5, 0.28)) {
      quad(0.05, 32.0);
    }
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
  // celdas de cesped [x0, z0, x1, z1] para sembrar pasto 3D encima
  const grassRects = [];
  // Parque Los Sauces REAL (centro del barrio, proyectado a coords de juego ~
  // [-90,-25]): la plaza radial + gruta van AQUI, no en el green mas grande
  // (que es otro parque al este). Elige el parque mas cercano al ancla real.
  // Centro de la gruta PINNED por el comandante (coord exacta del juego).
  const PLAZA_R = 11;
  const bigC = [-62, -15];
  const inPlaza = (x, z) => Math.hypot(x - bigC[0], z - bigC[1]) < PLAZA_R + 0.5;
  // area de juegos (parche de arena en buildParkLandmark, centro cx-20/cz+1
  // r6.5): el cesped se dibuja debajo pero el pasto 3D NO debe brotar ahi
  const inSand = (x, z) => Math.hypot(x - (bigC[0] - 20), z - (bigC[1] + 1)) < 7.4;
  for (let gi = 0; gi < city.data.green.length; gi++) {
    const g = city.data.green[gi];
    const ring = g.p;
    if (ring.length < 3) continue;
    let minx = 1e18, minz = 1e18, maxx = -1e18, maxz = -1e18;
    for (const p of ring) { minx = Math.min(minx, p[0]); minz = Math.min(minz, p[1]); maxx = Math.max(maxx, p[0]); maxz = Math.max(maxz, p[1]); }
    // Base exacta de cesped para que no asome el concreto global entre
    // senderos empedrados y bordes del parque.
    const baseCol = [0.78, 0.90, 0.65];
    for (const [a, b, c] of triangulate(ring)) {
      lawn.vert([a[0], 0.012, a[1]], [0, 1, 0], baseCol, [a[0] * 0.35, a[1] * 0.35]);
      lawn.vert([b[0], 0.012, b[1]], [0, 1, 0], baseCol, [b[0] * 0.35, b[1] * 0.35]);
      lawn.vert([c[0], 0.012, c[1]], [0, 1, 0], baseCol, [c[0] * 0.35, c[1] * 0.35]);
    }
    parkEdgeGrassApron(lawn, city, ring);
    const LCELL = 2.5;
    for (let gx = minx; gx < maxx; gx += LCELL) {
      for (let gz = minz; gz < maxz; gz += LCELL) {
        const cx = gx + LCELL * 0.5, cz = gz + LCELL * 0.5;
        const x1 = Math.min(gx + LCELL, maxx), z1 = Math.min(gz + LCELL, maxz);
        if (!paintableLawnCell(city, ring, gx, gz, x1, z1)) continue;
        // variacion sutil de tono, sin parches de color (leian como tierra)
        const shade = 0.86 + rng() * 0.14;
        const patch = hashF(Math.floor(gx * 3.1) + Math.floor(gz * 5.7)) * 0.08;
        const col = [shade * (0.90 + patch), shade * (0.98 + patch * 0.5), shade * (0.82 - patch * 0.3)];
        lawn.quad([gx, 0.015, gz], [gx, 0.015, z1], [x1, 0.015, z1], [x1, 0.015, gz], [0, 1, 0], col, (p) => [p[0] * 0.35, p[2] * 0.35]);
        if (!inSand(cx, cz) && !inPlaza(cx, cz) && clearLawnCell(city, ring, gx, gz, x1, z1)) grassRects.push([gx, gz, x1, z1]);
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
  return { lawn, plaza, feature, parkTrees, parkBenches, parkScatter, grassRects, landmark: bigC };
}
