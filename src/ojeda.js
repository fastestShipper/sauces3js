// Bodega Ojeda storefront: the real corner minimarket at ~197 Poussin, San Borja
// (OSM shop/minimarket "Ojeda" at x -53.24, z 88.6). The procedural city renders
// its footprint as a plain 4.1m block, so the merchant looked like it floated in
// open ground. This dresses the WEST wall of that block (the side facing the road
// ~10m west) as an actual shop: striped awning, hanging "BODEGA OJEDA" sign, a lit
// doorway, a glass window, and produce crates on the sidewalk.
//
// Self-contained group added to the scene once at world build. A handful of draw
// calls for one hero location. No dynamic lights (the doorway reads "lit" via an
// emissive panel, so it never touches the shader light count).
import * as THREE from 'three';

// The building's west face is x ~ -55.5; sit the facade just proud of it, centered
// on the merchant. "Out" (toward the shopper/street) is -x; "along the wall" is z.
const FX = -55.4;        // wall face x
const CZ = 88.6;         // facade center z (the merchant POI)
const HALF_W = 2.7;      // half width along z

const AWNING_RED = 0xb23a2e;
const AWNING_CREAM = 0xf2e4c9;
const BOARD = 0x241f1b;
const FRAME = 0x171310;
const WOOD = 0x6f4a29;
const GLASS = 0x9fd0e6;

// Awning canvas: bold red/cream vertical stripes, classic bodega toldo.
function awningTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');
  const stripes = 9, w = c.width / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#b23a2e' : '#f2e4c9';
    ctx.fillRect(i * w, 0, w + 1, c.height);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Sign canvas: dark board, warm cream hand-painted letters + a small motto.
function signTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#241f1b';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = 'rgba(242,228,201,0.35)';
  ctx.lineWidth = 8;
  ctx.strokeRect(14, 14, c.width - 28, c.height - 28);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f2e4c9';
  ctx.font = 'bold 116px Arial, sans-serif';
  ctx.fillText('BODEGA OJEDA', c.width / 2, 108);
  ctx.fillStyle = '#c9a86a';
  ctx.font = 'italic 44px Georgia, serif';
  ctx.fillText('minimarket  ·  bigote forever', c.width / 2, 196);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0, ...opts });
}

function box(w, h, d, x, y, z, material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

export function buildOjedaStorefront(scene) {
  const g = new THREE.Group();
  g.name = 'ojeda-storefront';

  // Storefront frame: a dark band framing door + window across the shopfront.
  const frameMat = mat(FRAME, { rough: 0.7 });
  g.add(box(0.12, 2.5, HALF_W * 2 + 0.3, FX - 0.02, 1.25, CZ, frameMat)); // wall band
  g.add(box(0.3, 0.16, HALF_W * 2 + 0.3, FX - 0.12, 2.48, CZ, frameMat)); // lintel above

  // Lit doorway: a recessed near-black opening with an emissive warm panel behind
  // it so it reads as an open, lit shop without adding a real light.
  const doorway = box(0.5, 2.2, 1.35, FX + 0.18, 1.1, CZ - 0.75, mat(0x0b0a09, { rough: 1 }));
  g.add(doorway);
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0x120d08, emissive: 0xffb35c, emissiveIntensity: 0.9, roughness: 1,
  });
  g.add(box(0.06, 2.0, 1.15, FX + 0.16, 1.05, CZ - 0.75, glowMat)); // interior glow

  // Shop window: glass panel beside the door with a low sill.
  const glassMat = new THREE.MeshStandardMaterial({
    color: GLASS, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.55,
  });
  g.add(box(0.06, 1.6, 1.7, FX - 0.02, 1.35, CZ + 0.95, glassMat));
  g.add(box(0.18, 0.14, 1.9, FX - 0.06, 0.52, CZ + 0.95, mat(WOOD))); // sill

  // Awning: striped slab sloping down and out toward the street, with a scalloped
  // valance hanging at the front edge.
  const awningMat = new THREE.MeshStandardMaterial({ map: awningTexture(), roughness: 0.7, side: THREE.DoubleSide });
  const awning = box(1.7, 0.08, HALF_W * 2 + 0.4, FX - 0.85, 2.62, CZ, awningMat);
  awning.rotation.z = 0.26; // wall edge high, street edge low
  g.add(awning);
  const valance = box(0.06, 0.34, HALF_W * 2 + 0.4, FX - 1.62, 2.16, CZ, awningMat);
  g.add(valance);

  // Hanging sign board mounted on the wall above the awning.
  const signMat = new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.6 });
  const sign = box(0.08, 0.62, 3.6, FX - 0.05, 3.18, CZ, signMat);
  g.add(sign);

  // Produce crates on the sidewalk in front of the shop.
  const crateMat = mat(WOOD, { rough: 0.95 });
  const produce = [0x4f9d3a, 0xd94f2b, 0xe0a12e, 0x9c3f8f]; // greens, reds, oranges
  const cratePos = [[FX - 1.15, CZ - 1.5], [FX - 1.5, CZ - 1.55], [FX - 1.2, CZ + 1.6]];
  cratePos.forEach(([cx, cz], i) => {
    g.add(box(0.66, 0.5, 0.66, cx, 0.25, cz, crateMat));
    // a mound of produce on top
    for (let k = 0; k < 3; k++) {
      const s = 0.16 + (k % 2) * 0.04;
      const p = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), mat(produce[(i + k) % produce.length], { rough: 0.6 }));
      p.position.set(cx + (k - 1) * 0.2, 0.56, cz + ((k % 2) - 0.5) * 0.24);
      g.add(p);
    }
  });

  for (const m of g.children) { m.castShadow = true; m.receiveShadow = true; }
  scene.add(g);
  return g;
}
