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

// trash bin: ~0.85 m, dark green.
export function buildToonBin() {
  const g = new THREE.Group();
  const body = new THREE.CylinderGeometry(0.21, 0.18, 0.75, 10); body.translate(0, 0.375, 0);
  g.add(new THREE.Mesh(body, mat(0x2f5d3a)));
  const lid = new THREE.CylinderGeometry(0.23, 0.23, 0.08, 10); lid.translate(0, 0.8, 0);
  g.add(new THREE.Mesh(lid, mat(0x274d30)));
  return g;
}
