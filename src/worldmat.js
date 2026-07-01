// World surface materials — TOON edition. Flat saturated colors with subtle
// procedural grain/tiles (no photo textures: at block-scale UVs they smear
// into giant dark wedges, and they fight the KayKit/Kenney art direction).
import * as THREE from 'three';

// deterministic rng so the sky/grain never changes between reloads
function rng32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(cv) {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function grain(hex, alpha = 0.09, seed = 5) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const c = cv.getContext('2d');
  const rnd = rng32(seed);
  c.fillStyle = hex;
  c.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 700; i++) {
    const x = rnd() * 256;
    const y = rnd() * 256;
    const r = 1 + rnd() * 3;
    c.fillStyle = (rnd() < 0.5 ? 'rgba(0,0,0,' : 'rgba(255,255,255,') + (alpha * rnd()).toFixed(3) + ')';
    c.beginPath();
    c.arc(x, y, r, 0, 7);
    c.fill();
  }
  return canvasTexture(cv);
}

// sidewalk loseta: warm base + tile grid, reads as San Borja pavement without photos
function tiles(baseHex, lineRGBA, cells = 4, seed = 9) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const c = cv.getContext('2d');
  const rnd = rng32(seed);
  c.fillStyle = baseHex;
  c.fillRect(0, 0, 256, 256);
  const cell = 256 / cells;
  // per-tile value variation (subtle checker of warm tones)
  for (let ty = 0; ty < cells; ty++) {
    for (let tx = 0; tx < cells; tx++) {
      const v = (rnd() - 0.5) * 0.10;
      c.fillStyle = v > 0
        ? 'rgba(255,255,240,' + v.toFixed(3) + ')'
        : 'rgba(60,50,30,' + (-v).toFixed(3) + ')';
      c.fillRect(tx * cell, ty * cell, cell, cell);
    }
  }
  c.strokeStyle = lineRGBA;
  c.lineWidth = 2;
  for (let i = 0; i <= cells; i++) {
    const p = Math.round(i * cell) + 0.5;
    c.beginPath(); c.moveTo(p, 0); c.lineTo(p, 256); c.stroke();
    c.beginPath(); c.moveTo(0, p); c.lineTo(256, p); c.stroke();
  }
  return canvasTexture(cv);
}

// stylized equirect sky: vertical gradient + soft painted clouds. Used both as
// scene.background and scene.environment (three PMREMs it internally).
export function createToonSkyTexture() {
  const W = 1024, H = 512, HORIZON = H * 0.52;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0.0, '#2f7ccc');
  g.addColorStop(0.28, '#57a2e4');
  g.addColorStop(0.46, '#a8d4f2');
  g.addColorStop(0.515, '#e8f4fb');
  g.addColorStop(0.53, '#cfd8d2');   // below horizon: neutral warm haze
  g.addColorStop(1.0, '#b9c2b4');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  // soft sun glow (matches the directional light azimuth, roughly NE)
  const sun = c.createRadialGradient(W * 0.68, H * 0.30, 8, W * 0.68, H * 0.30, 150);
  sun.addColorStop(0, 'rgba(255,244,214,0.85)');
  sun.addColorStop(0.25, 'rgba(255,240,200,0.28)');
  sun.addColorStop(1, 'rgba(255,240,200,0)');
  c.fillStyle = sun;
  c.fillRect(0, 0, W, H);
  // painted clouds: flat-bottomed puff clusters along the low sky band
  const rnd = rng32(77);
  const puff = (x, y, r, a) => {
    const cg = c.createRadialGradient(x, y, r * 0.15, x, y, r);
    cg.addColorStop(0, 'rgba(255,255,255,' + a + ')');
    cg.addColorStop(0.7, 'rgba(255,255,255,' + (a * 0.55).toFixed(3) + ')');
    cg.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = cg;
    c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
  };
  for (let i = 0; i < 16; i++) {
    const cx = rnd() * W;
    const cy = H * 0.22 + rnd() * (HORIZON - H * 0.28);
    const scale = 18 + rnd() * 34;
    const n = 3 + Math.floor(rnd() * 4);
    const alpha = 0.5 + rnd() * 0.35;
    for (let k = 0; k < n; k++) {
      puff(cx + (k - n / 2) * scale * 0.8 + rnd() * 8,
        cy - rnd() * scale * 0.5,
        scale * (0.6 + rnd() * 0.6), alpha);
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createTextureKit() {
  const kit = { _mats: {} };

  // toon ground set: color lives IN the canvas, materials stay white-tinted
  kit.asphalt = grain('#4b5058', 0.05, 11);
  kit.sidewalk = tiles('#d9cfb4', 'rgba(90,78,52,0.20)', 4, 12);
  kit.paving = tiles('#cdb894', 'rgba(96,74,40,0.22)', 3, 13);
  kit.grass = grain('#5fae3e', 0.10, 14);
  kit.concrete = grain('#b3a98e', 0.06, 15);

  kit.surface = (kind, opts) => {
    const {
      map,
      color = 0xffffff,
      roughness = 1,
      metalness = 0,
      vertexColors = false,
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
    kit._mats[kind] = m;
    return m;
  };

  return kit;
}

// photo-normal loading era: kept as a no-op so callers do not break
export function scheduleWorldNormals() {}

/** Large-scale ground roughness variation (no extra downloads). */
export function createGroundVariationTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 512;
  const c = cv.getContext('2d');
  const img = c.createImageData(512, 512);
  const rnd = rng32(3);
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      const u = x / 512;
      const v = y / 512;
      const n1 = Math.sin(x * 0.04) * Math.cos(y * 0.035);
      const n2 = Math.sin((x + y) * 0.018) * 0.5;
      const n3 = (rnd() - 0.5) * 0.08;
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
  return canvasTexture(cv);
}
