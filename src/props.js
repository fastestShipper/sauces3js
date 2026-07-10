// Toon street furniture built procedurally (flat-color, matches the KayKit /
// Kenney look). Each builder returns an Object3D prototype; app.js instances it
// through instancedRoot, so these are templates, not added to the scene directly.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const mat = (hex, rough = 0.85) => new THREE.MeshStandardMaterial({ color: hex, roughness: rough });

// material blanco que respeta el color por vertice: permite fusionar piezas de
// tonos distintos en UN solo mesh (instancedRoot crea un InstancedMesh por
// mesh del template, asi que menos meshes = menos draw calls globales).
const matVert = (rough = 0.85) => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: rough, vertexColors: true });

// BoxGeometry indexa sus 6 caras en orden fijo (px,nx,py,ny,pz,nz; 6 indices
// por cara). boxSin() devuelve la caja SIN las caras listadas (extremos,
// fondos que nunca se ven) para ahorrar triangulos en props instanciados.
const CARA = { px: 0, nx: 6, py: 12, ny: 18, pz: 24, nz: 30 };
function boxSin(w, h, d, drop = []) {
  const g = new THREE.BoxGeometry(w, h, d);
  const idx = g.getIndex().array;
  const fuera = new Set(drop.map(c => CARA[c]));
  const keep = [];
  for (let f = 0; f < 36; f += 6) {
    if (fuera.has(f)) continue;
    for (let k = 0; k < 6; k++) keep.push(idx[f + k]);
  }
  g.setIndex(keep);
  return g;
}

// pinta toda la geometria con un color plano por vertice (hex * mul); el mul
// da el jitter de tono liston a liston sin duplicar materiales.
function tinte(g, hex, mul = 1) {
  const c = new THREE.Color(hex).multiplyScalar(mul);
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

// streetlight: ~4.6 m, base at y=0. Pole + arm + lamp head with a warm lens.
export function buildToonLamp() {
  const g = new THREE.Group();
  const metal = mat(0x39413a, 0.6);
  const pole = new THREE.CylinderGeometry(0.07, 0.1, 4.2, 8); pole.translate(0, 2.1, 0);
  g.add(new THREE.Mesh(pole, metal));
  const arm = new THREE.BoxGeometry(0.7, 0.09, 0.09); arm.translate(0.3, 4.15, 0);
  g.add(new THREE.Mesh(arm, metal));
  const head = new THREE.BoxGeometry(0.3, 0.18, 0.4); head.translate(0.6, 4.05, 0);
  g.add(new THREE.Mesh(head, metal));
  const lens = mat(0xffe7a0, 0.4);
  lens.emissive = new THREE.Color(0xffd25a); lens.emissiveIntensity = 0.6;
  const bulb = new THREE.BoxGeometry(0.24, 0.06, 0.32); bulb.translate(0.6, 3.95, 0);
  g.add(new THREE.Mesh(bulb, lens));
  return g;
}

// banca de parque limena: ~1.7 m de largo, asiento a ~0.47, mira a +z
// (respaldo en -z). 3 listones de madera en el asiento + 2 en el respaldo
// (cajas delgadas con separacion) sobre patas de fierro oscuro con montante
// trasero. Misma huella y altura que la banca de caja anterior.
// ~64 tris repartidos en 2 meshes fusionados (madera + fierro).
export function buildToonBench() {
  const g = new THREE.Group();
  const WOOD = 0x8a5a32, IRON = 0x2b2d2a;
  // jitter determinista de tono por liston (tabla fija, sin RNG): cada
  // tabla lee un pelo distinta sin duplicar materiales
  const JIT = [1.0, 0.9, 1.08, 0.94, 1.04];
  const madera = [];
  // 3 listones de asiento separados 2.5 cm; el fondo (ny) nunca se ve y las
  // caras que miran a las ranuras quedan ocultas, boxSin las elimina
  const seatZ = [0.175, 0, -0.175];
  const seatDrop = [['ny', 'nz'], ['ny', 'pz', 'nz'], ['ny', 'pz']];
  for (let i = 0; i < 3; i++) {
    const s = boxSin(1.66, 0.05, 0.15, seatDrop[i]);
    s.translate(0, 0.45, seatZ[i]);
    madera.push(tinte(s, WOOD, JIT[i]));
  }
  // 2 listones de respaldo mas cortos (1.5 m) para que los montantes de
  // fierro tapen los extremos abiertos (px/nx eliminados)
  const backY = [0.62, 0.84];
  const backDrop = [['ny', 'py', 'px', 'nx'], ['ny', 'px', 'nx']];
  for (let i = 0; i < 2; i++) {
    const b = boxSin(1.5, 0.14, 0.045, backDrop[i]);
    b.translate(0, backY[i], -0.215);
    madera.push(tinte(b, WOOD, JIT[3 + i]));
  }
  g.add(new THREE.Mesh(mergeGeometries(madera), matVert(0.85)));
  // patas de fierro oscuro: panel bajo + montante trasero que sube hasta el
  // respaldo (la tapa del panel muere bajo los listones, se elimina)
  const fierro = [];
  for (const sx of [-0.72, 0.72]) {
    const leg = boxSin(0.07, 0.45, 0.46, ['py', 'ny']);
    leg.translate(sx, 0.225, -0.02);
    fierro.push(tinte(leg, IRON, 1));
    const alto = boxSin(0.05, 0.48, 0.06, ['ny', 'pz']); // pz muere dentro del liston
    alto.translate(sx, 0.66, -0.245);
    fierro.push(tinte(alto, IRON, 0.92));
  }
  g.add(new THREE.Mesh(mergeGeometries(fierro), matVert(0.55)));
  return g;
}

// fire hydrant: ~0.75 m, red.
export function buildToonHydrant() {
  const g = new THREE.Group();
  const red = mat(0xc23a2b);
  const body = new THREE.CylinderGeometry(0.16, 0.18, 0.6, 8); body.translate(0, 0.3, 0);
  g.add(new THREE.Mesh(body, red));
  const dome = new THREE.SphereGeometry(0.17, 8, 6); dome.translate(0, 0.6, 0);
  g.add(new THREE.Mesh(dome, red));
  for (const x of [0.16, -0.16]) {
    const cap = new THREE.CylinderGeometry(0.06, 0.06, 0.1, 6);
    cap.rotateZ(Math.PI / 2); cap.translate(x, 0.35, 0);
    g.add(new THREE.Mesh(cap, red));
  }
  return g;
}

// street sign: post + rectangular board (Los Sauces style, no text mesh).
export function buildToonStreetSign() {
  const g = new THREE.Group();
  const metal = mat(0x3d4248, 0.55);
  const pole = new THREE.CylinderGeometry(0.05, 0.07, 2.0, 6);
  pole.translate(0, 1.0, 0);
  g.add(new THREE.Mesh(pole, metal));
  const board = mat(0x1a4d6e);
  const plate = new THREE.BoxGeometry(0.55, 0.32, 0.04);
  plate.translate(0, 2.05, 0.08);
  g.add(new THREE.Mesh(plate, board));
  const stripe = mat(0xf0ebe0, 0.9);
  const label = new THREE.BoxGeometry(0.48, 0.12, 0.02);
  label.translate(0, 2.08, 0.11);
  g.add(new THREE.Mesh(label, stripe));
  return g;
}

// planter box with low hedge (sidewalk green).
export function buildToonPlanter() {
  const g = new THREE.Group();
  const box = mat(0x6a5a48);
  const shell = new THREE.BoxGeometry(0.9, 0.42, 0.5);
  shell.translate(0, 0.21, 0);
  g.add(new THREE.Mesh(shell, box));
  const soil = mat(0x3a2e22);
  const top = new THREE.BoxGeometry(0.82, 0.08, 0.42);
  top.translate(0, 0.38, 0);
  g.add(new THREE.Mesh(top, soil));
  const leaf = mat(0x2d6b32);
  const bush = new THREE.BoxGeometry(0.78, 0.35, 0.38);
  bush.translate(0, 0.58, 0);
  g.add(new THREE.Mesh(bush, leaf));
  return g;
}

// trash bin: ~0.85 m, dark green.
export function buildToonBin() {
  const g = new THREE.Group();
  const body = new THREE.CylinderGeometry(0.21, 0.18, 0.75, 10); body.translate(0, 0.375, 0);
  g.add(new THREE.Mesh(body, mat(0x2f5d3a)));
  const lid = new THREE.CylinderGeometry(0.23, 0.23, 0.08, 10); lid.translate(0, 0.8, 0);
  g.add(new THREE.Mesh(lid, mat(0x274d30)));
  return g;
}

// pergola de parque: 4 postes en los puntos medios de los lados + 2 vigas
// que se cruzan sobre el centro (la viga z apoya encima de la x, por eso los
// postes norte/sur son un pelo mas altos). ~3.3 m de lado, 2.5 m de alto,
// base en y=0. Madera calida con jitter determinista, UN solo mesh (~44
// tris). NO esta cableada en el mundo: exportada para instanciarla via
// instancedRoot cuando existan spots.
export function buildToonPergola() {
  const g = new THREE.Group();
  const WOOD = 0x9a6a3c;
  const JIT = [1.0, 0.92, 1.06, 0.96, 1.04, 0.9];
  const piezas = [];
  // postes [x, z, alto]: este/oeste sostienen la viga x, norte/sur la viga z
  const postes = [[1.4, 0, 2.3], [-1.4, 0, 2.3], [0, 1.4, 2.42], [0, -1.4, 2.42]];
  for (let i = 0; i < 4; i++) {
    const [px, pz, h] = postes[i];
    const p = boxSin(0.14, h, 0.14, ['py', 'ny']); // tapa bajo viga + base en piso
    p.translate(px, h * 0.5, pz);
    piezas.push(tinte(p, WOOD, JIT[i]));
  }
  // vigas cruzadas: extremos y fondo eliminados (quedan casi al ras del
  // poste y a 2.4 m del ojo del jugador)
  const vx = boxSin(3.3, 0.12, 0.16, ['px', 'nx', 'ny']);
  vx.translate(0, 2.36, 0);
  piezas.push(tinte(vx, WOOD, JIT[4]));
  const vz = boxSin(3.3, 0.12, 0.16, ['px', 'nx', 'ny']);
  vz.rotateY(Math.PI / 2);
  vz.translate(0, 2.48, 0);
  piezas.push(tinte(vz, WOOD, JIT[5]));
  g.add(new THREE.Mesh(mergeGeometries(piezas), matVert(0.85)));
  return g;
}
