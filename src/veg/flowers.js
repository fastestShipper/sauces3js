// Matas de margaritas procedurales (canvas alpha-tested) para salpicar los
// parques. Dos quads cruzados por mata; se instancian con instancedRoot.
import * as THREE from 'three';

function rng32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function flowerTexture() {
  const S = 96;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  const rnd = rng32(1204);
  // tallos y hojitas al ras
  c.strokeStyle = 'rgba(66,110,42,0.95)';
  c.lineWidth = 2;
  const stems = [];
  for (let i = 0; i < 6; i++) {
    const x = 10 + rnd() * (S - 20);
    const h = 20 + rnd() * 34;
    stems.push([x, S - h]);
    c.beginPath();
    c.moveTo(x, S);
    c.quadraticCurveTo(x + (rnd() - 0.5) * 10, S - h * 0.5, x, S - h);
    c.stroke();
  }
  // flores: petalos blancos alrededor de un centro amarillo
  for (const [x, y] of stems) {
    const r = 4.5 + rnd() * 2.5;
    c.fillStyle = 'rgba(252,252,248,0.98)';
    for (let p = 0; p < 7; p++) {
      const a = (p / 7) * Math.PI * 2 + rnd() * 0.4;
      c.beginPath();
      c.ellipse(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.62, r * 0.34, a, 0, 7);
      c.fill();
    }
    c.fillStyle = '#f4c430';
    c.beginPath();
    c.arc(x, y, r * 0.42, 0, 7);
    c.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildFlowerTuft() {
  const mat = new THREE.MeshStandardMaterial({
    map: flowerTexture(),
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    roughness: 1,
  });
  const geo = new THREE.PlaneGeometry(0.62, 0.34);
  geo.translate(0, 0.17, 0);
  const g = new THREE.Group();
  for (const a of [0, Math.PI / 2]) {
    const m = new THREE.Mesh(geo, mat);
    m.rotation.y = a;
    g.add(m);
  }
  return g;
}
