// Toon street furniture built procedurally (flat-color, matches the KayKit /
// Kenney look). Each builder returns an Object3D prototype; app.js instances it
// through instancedRoot, so these are templates, not added to the scene directly.
import * as THREE from 'three';

const mat = (hex, rough = 0.85) => new THREE.MeshStandardMaterial({ color: hex, roughness: rough });

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

// bench: ~1.7 m long, seat at 0.45. Faces +z (backrest at -z).
export function buildToonBench() {
  const g = new THREE.Group();
  const wood = mat(0x8a5a32), metal = mat(0x33352f, 0.6);
  const seat = new THREE.BoxGeometry(1.7, 0.1, 0.5); seat.translate(0, 0.45, 0);
  g.add(new THREE.Mesh(seat, wood));
  const back = new THREE.BoxGeometry(1.7, 0.45, 0.09); back.translate(0, 0.72, -0.2);
  g.add(new THREE.Mesh(back, wood));
  for (const sx of [-0.72, 0.72]) {
    const leg = new THREE.BoxGeometry(0.1, 0.45, 0.5); leg.translate(sx, 0.225, 0);
    g.add(new THREE.Mesh(leg, metal));
  }
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
