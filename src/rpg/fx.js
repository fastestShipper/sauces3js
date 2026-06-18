// FX de rareza/glow para armas y aura de personaje. Sin postprocesado (no bloom):
// el "glow" es emissive del MeshStandardMaterial + sprites additive suaves.
// Paleta pastel para que combine con el look casual del mundo.
import * as THREE from 'three';

export const TIERS = {
  common:    { name: 'Común',      glow: null,     rank: 0 },
  uncommon:  { name: 'Poco común', glow: 0xa8e6a1, rank: 1 }, // verde pastel
  rare:      { name: 'Raro',       glow: 0xa9cdf5, rank: 2 }, // azul pastel
  epic:      { name: 'Épico',      glow: 0xd4b3f2, rank: 3 }, // violeta pastel
  legendary: { name: 'Legendario', glow: 0xf3d9a6, rank: 4 }, // dorado pastel
};

// Textura de gradiente radial blanco, cacheada a nivel de módulo. Se tiñe con
// SpriteMaterial.color; AdditiveBlending para que el centro brille sin tapar.
let _glowTex = null;
function glowTexture() {
  if (_glowTex) return _glowTex;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  _glowTex = new THREE.CanvasTexture(c);
  _glowTex.colorSpace = THREE.SRGBColorSpace;
  return _glowTex;
}

// Sprite de glow additive. size = escala del sprite en unidades de mundo.
export function makeGlowSprite(colorHex, size = 0.6, opacity = 0.7) {
  const mat = new THREE.SpriteMaterial({
    map: glowTexture(),
    color: new THREE.Color(colorHex),
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
  });
  const sp = new THREE.Sprite(mat);
  sp.scale.setScalar(size);
  return sp;
}

// Aplica el look de tier a un arma ya equipada (Object3D con mallas).
// Clona el material de cada mesh antes de tocarlo: si no, tiñes TODAS las armas
// que comparten el material original. Defensivo ante mallas sin material y
// arrays de materiales.
export function applyWeaponTier(weaponRoot, tierKey) {
  if (!weaponRoot) return;
  const tier = TIERS[tierKey] || TIERS.common;

  // Quita cualquier halo previo (sprite hijo con name 'tierGlow').
  const old = weaponRoot.getObjectByName('tierGlow');
  if (old) {
    if (old.parent) old.parent.remove(old);
    if (old.material) old.material.dispose();
  }

  const emColor = new THREE.Color(tier.glow != null ? tier.glow : 0x000000);
  const emInt = tier.glow != null ? 0.5 : 0.0;

  weaponRoot.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    if (Array.isArray(o.material)) {
      o.material = o.material.map((m) => tintMaterial(m, emColor, emInt));
    } else {
      o.material = tintMaterial(o.material, emColor, emInt);
    }
  });

  // Tiers con glow: añade un halo additive suave como hijo del arma.
  if (tier.glow != null) {
    const halo = makeGlowSprite(tier.glow, 0.5, 0.55);
    halo.name = 'tierGlow';
    weaponRoot.add(halo);
  }
}

// Clona el material y le aplica emissive. Devuelve el clon (no muta el original).
function tintMaterial(mat, emColor, emInt) {
  if (!mat || typeof mat.clone !== 'function') return mat;
  const m = mat.clone();
  if (m.emissive) m.emissive.copy(emColor);
  if ('emissiveIntensity' in m) m.emissiveIntensity = emInt;
  return m;
}

// Aura de personaje (para el GOD Cernunnos). Grupo para colgar del root del
// personaje: anillo plano en el piso + sprite de glow suave a la altura del torso.
export function makeCharAura(colorHex) {
  const group = new THREE.Group();
  group.name = 'charAura';

  const ringGeo = new THREE.RingGeometry(0.55, 0.9, 48);
  const ringMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(colorHex),
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.name = 'auraRing';
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  group.add(ring);

  const torso = makeGlowSprite(colorHex, 1.1, 0.28);
  torso.position.y = 1.1;
  group.add(torso);

  return group;
}

// Gira lento el anillo del aura (llamar cada frame). dt en segundos.
export function updateAura(group, dt) {
  if (!group) return;
  const ring = group.getObjectByName('auraRing');
  if (ring) ring.rotation.z += dt * 0.6;
}
