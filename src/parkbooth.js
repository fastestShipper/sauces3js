// Caseta del vigilante: the real turquoise guard booth on the corner of Parque
// Los Sauces (Los Sauces x Poussin). A small wooden kiosk with a window and a
// peaked roof on a little paved pad. Self-contained group, a few draw calls, no
// dynamic lights. Built in local space facing +z, then rotated/placed.
import * as THREE from 'three';

const TEAL = 0x2f9c8a;
const TEAL_DARK = 0x1f6f63;
const ROOF = 0x243b38;
const GLASS = 0x16282b;
const CONCRETE = 0x9a9791;
const WOOD = 0x6f4a29;

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0, ...opts });
}
function box(w, h, d, x, y, z, material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

export function buildParkBooth(scene, x, z, facing = 0) {
  const g = new THREE.Group();
  g.name = 'park-booth';

  // paved pad
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.12, 20), mat(CONCRETE, { rough: 0.95 }));
  pad.position.y = 0.06;
  g.add(pad);

  // body: a compact kiosk, teal wooden panels
  const bodyMat = mat(TEAL, { rough: 0.7 });
  g.add(box(1.5, 2.0, 1.25, 0, 1.12, 0, bodyMat));
  // corner posts a touch darker for panel definition
  const postMat = mat(TEAL_DARK, { rough: 0.7 });
  for (const sx of [-0.72, 0.72]) for (const sz of [-0.6, 0.6]) g.add(box(0.1, 2.0, 0.1, sx, 1.12, sz, postMat));

  // front window (faces +z) with a counter ledge
  const glassMat = new THREE.MeshStandardMaterial({ color: GLASS, roughness: 0.2, metalness: 0.2, transparent: true, opacity: 0.7 });
  g.add(box(1.0, 0.85, 0.05, 0, 1.45, 0.64, glassMat));
  g.add(box(1.12, 0.1, 0.22, 0, 0.98, 0.68, mat(WOOD)));        // counter ledge
  // side door hint
  g.add(box(0.05, 1.7, 0.7, -0.76, 1.0, 0, mat(TEAL_DARK, { rough: 0.75 })));

  // peaked roof: a shallow 4-sided pyramid, overhanging
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.45, 0.7, 4), mat(ROOF, { rough: 0.8 }));
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 2.45;
  g.add(roof);
  // thin fascia band under the eaves
  g.add(box(1.7, 0.12, 1.45, 0, 2.16, 0, mat(TEAL_DARK, { rough: 0.7 })));

  for (const m of g.children) { m.castShadow = true; m.receiveShadow = true; }
  g.position.set(x, 0, z);
  g.rotation.y = facing;
  scene.add(g);
  return g;
}
