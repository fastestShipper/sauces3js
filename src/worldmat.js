// World surface materials: license-safe photo textures + procedural fallbacks.
// Normals load after first playable frame to keep boot fast.
import * as THREE from 'three';

const TEX = './assets/textures/';

function grain(hex, alpha = 0.09) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const c = cv.getContext('2d');
  c.fillStyle = hex;
  c.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 700; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const r = 1 + Math.random() * 3;
    c.fillStyle = (Math.random() < 0.5 ? 'rgba(0,0,0,' : 'rgba(255,255,255,') + (alpha * Math.random()).toFixed(3) + ')';
    c.beginPath();
    c.arc(x, y, r, 0, 7);
    c.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function createTextureKit(renderer) {
  const tl = new THREE.TextureLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const kit = { _mats: {}, _lazy: [] };

  const load = (file, repeat) => {
    const t = tl.load(TEX + file);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    t.repeat.set(repeat[0], repeat[1]);
    return t;
  };

  kit.asphalt = load('asphalt_real.jpg', [0.32, 0.32]);
  kit.sidewalk = load('sidewalk.jpg', [0.4, 0.4]);
  kit.paving = load('paving_real.jpg', [0.36, 0.36]);
  kit.grass = load('grass2.jpg', [0.2, 0.2]);
  kit.plaster = load('plaster.jpg', [0.5, 0.5]);
  kit.concrete = load('concrete.jpg', [90, 90]);

  kit.fallback = {
    road: grain('#5c6068'),
    walk: grain('#b8ad96'),
    path: grain('#c9b88a'),
    lawn: grain('#4a7a38', 0.12),
  };

  kit.surface = (kind, opts) => {
    const {
      map,
      color = 0xffffff,
      roughness = 1,
      metalness = 0,
      vertexColors = false,
      normalMap = null,
      side,
    } = opts;
    const m = new THREE.MeshStandardMaterial({
      map: map || null,
      color,
      roughness,
      metalness,
      vertexColors,
      side: side ?? (vertexColors ? THREE.DoubleSide : THREE.FrontSide),
    });
    if (normalMap) {
      m.normalMap = normalMap;
      m.normalScale = new THREE.Vector2(0.35, 0.35);
    }
    kit._mats[kind] = m;
    return m;
  };

  return kit;
}

/** Attach normal maps after the game loop starts (non-blocking). */
export function scheduleWorldNormals(kit) {
  const tl = new THREE.TextureLoader();
  const pairs = [
    ['walk', 'sidewalk_n.jpg', [0.4, 0.4], 0.28],
    ['wall', 'plaster_n.jpg', [0.5, 0.5], 0.22],
  ];
  const run = () => {
    for (const [matKey, file, rep, scale] of pairs) {
      const mat = kit._mats[matKey];
      if (!mat || mat.normalMap) continue;
      tl.load(
        TEX + file,
        (n) => {
          n.wrapS = n.wrapT = THREE.RepeatWrapping;
          n.repeat.set(rep[0], rep[1]);
          mat.normalMap = n;
          mat.normalScale = new THREE.Vector2(scale, scale);
          mat.needsUpdate = true;
        },
        undefined,
        () => {},
      );
    }
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 1200);
}

/** Large-scale ground variation (no extra downloads). */
export function createGroundVariationTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 512;
  const c = cv.getContext('2d');
  const img = c.createImageData(512, 512);
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      const u = x / 512;
      const v = y / 512;
      const n1 = Math.sin(x * 0.04) * Math.cos(y * 0.035);
      const n2 = Math.sin((x + y) * 0.018) * 0.5;
      const n3 = (Math.random() - 0.5) * 0.08;
      const patch = Math.max(0, Math.sin(u * 11 + v * 7) * 0.15);
      const g = 148 + (n1 + n2 + n3) * 22 + patch * 18;
      const r = g - 8 + patch * 12;
      const b = g - 18;
      const i = (y * 512 + x) * 4;
      img.data[i] = Math.min(255, Math.max(0, r));
      img.data[i + 1] = Math.min(255, Math.max(0, g));
      img.data[i + 2] = Math.min(255, Math.max(0, b));
      img.data[i + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export { grain };