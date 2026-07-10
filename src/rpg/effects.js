// "Battle juice": chorros de sangre, manchas en el piso y numeros de dano flotantes.
// Sin postprocesado (no bloom). Rendimiento: geometrias/texturas compartidas a nivel
// de modulo, materiales clonados por particula para opacidad independiente, y caps
// duros de cantidad para no acumular nodos en la escena.
import * as THREE from 'three';
import { ParticleBatch } from './particles.js?v=20260710g50';

const GRAVITY = 14;              // u/s^2 que jala las particulas de sangre hacia abajo
const HIT_LIFE = 0.5;            // vida de un chorro de impacto (s)
const DEATH_LIFE = 0.6;          // vida de las particulas del estallido de muerte (s)
const POOL_LIFE = 20.0;          // vida de la mancha en el piso (s), gore persistente
const NUMBER_LIFE = 0.9;         // vida del numero de dano (s)
const NUMBER_RISE = 1.2;         // cuanto sube el numero en su vida (u)
const FLASH_LIFE = 0.15;         // vida del fogonazo de impacto (s)
const MOTION_TRAIL_LIFE = 0.24;  // estela corta de dash/lunge (s)
const BLOOD_COLOR = 0x8a0e0e;    // rojo sangre oscuro
// El gore NUNCA hereda el tinte de piel del mob: un zombie verde no sangra verde.
// Tres materiales distintos, como en un cuerpo real.
const GORE_MEAT_COLORS = [0x6b0d10, 0x8a1216, 0x520a0c, 0x7a1712];
const GORE_ORGAN_COLORS = [0x4a0a12, 0x5e1018];
const GORE_BONE_COLOR = 0xe3dccb;
// SCREEN SHAKE: apagado por defecto. Marea y tapa los telegraphs de los mobs.
// `sauces_shake` en localStorage: 'off' (default) | 'min' | 'full'.
const SHAKE_PRESETS = { off: 0, min: 0.045, full: 0.14 };
function shakeIntensityMult() {
  let mode = 'off';
  try { mode = localStorage.getItem('sauces_shake') || 'off'; } catch {}
  return SHAKE_PRESETS[mode] != null ? SHAKE_PRESETS[mode] : SHAKE_PRESETS.off;
}
const SHAKE_DURATION_MULT = 0.62;
const VFX_NEAR_RANGE = 24;
const VFX_MID_RANGE = 48;
const VFX_FAR_RANGE = 72;
export const PROJECTILE_SPEED_BY_TYPE = Object.freeze({
  arrow: 52,
  fireball: 36,
  magic: 36,
});

export function projectileSpeed(type = 'fireball') {
  return PROJECTILE_SPEED_BY_TYPE[type] || PROJECTILE_SPEED_BY_TYPE.fireball;
}

function isMobileProfile() {
  return typeof window !== 'undefined' && !!window.__SAUCES_MOBILE__;
}

function isLowEndProfile() {
  return typeof window !== 'undefined' && !!window.__SAUCES_LOW_END__;
}

function particleCap() {
  return isLowEndProfile() ? 70 : isMobileProfile() ? 110 : 300;
}

function motionTrailCap() {
  return isLowEndProfile() ? 5 : isMobileProfile() ? 8 : 18;
}

function flashCap() {
  return isLowEndProfile() ? 18 : isMobileProfile() ? 30 : 72;
}

function poolLife() {
  return isLowEndProfile() ? 6.5 : isMobileProfile() ? 10 : POOL_LIFE;
}

function vfxRanges() {
  if (isLowEndProfile()) return { near: 14, mid: 28, far: 42 };
  if (isMobileProfile()) return { near: 18, mid: 36, far: 54 };
  return { near: VFX_NEAR_RANGE, mid: VFX_MID_RANGE, far: VFX_FAR_RANGE };
}

// Geometria compartida para las particulas de sangre. Una sola instancia para todas.
const PARTICLE_GEO = new THREE.IcosahedronGeometry(0.05, 0);
const SLASH_ARC_GEO = new THREE.RingGeometry(0.7, 2.2, 24, 1, 0, 2.4);
const CLAW_ARC_GEO = new THREE.RingGeometry(0.25, 1.25, 18, 1, 0, 1.55);
const TRAIL_GEO = new THREE.BoxGeometry(1, 0.018, 1);
const DANGER_RING_GEO = new THREE.RingGeometry(0.62, 1.0, 48);
const NOVA_RING_GEO = new THREE.RingGeometry(0.72, 1.0, 40);
const NOVA_FINE_RING_GEO = new THREE.RingGeometry(0.9, 0.98, 40);
const LEVEL_PILLAR_GEO = new THREE.CylinderGeometry(0.55, 0.85, 9, 18, 1, true);
const PROJECTILE_ARROW_GEO = new THREE.CylinderGeometry(0.035, 0.035, 0.7, 6);
const PROJECTILE_CORE_GEO = new THREE.SphereGeometry(0.2, 10, 8);
const _sharedGeometries = new Set([
  PARTICLE_GEO,
  SLASH_ARC_GEO,
  CLAW_ARC_GEO,
  TRAIL_GEO,
  DANGER_RING_GEO,
  NOVA_RING_GEO,
  NOVA_FINE_RING_GEO,
  LEVEL_PILLAR_GEO,
  PROJECTILE_ARROW_GEO,
  PROJECTILE_CORE_GEO,
]);

// Acepta THREE.Vector3 o {x,y,z} y devuelve componentes sueltas.
function readPos(p) {
  return { x: p.x || 0, y: p.y || 0, z: p.z || 0 };
}

const _sharedTextures = new Set();
const _numberTexCache = new Map();

function isSharedTexture(tex) {
  return !!tex && _sharedTextures.has(tex);
}

function isSharedGeometry(geo) {
  return !!geo && _sharedGeometries.has(geo);
}

// Textura de gradiente radial blanco para fogonazos additive. Cacheada a nivel modulo.
let _flashTex = null;
function flashTexture() {
  if (_flashTex) return _flashTex;
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  _flashTex = new THREE.CanvasTexture(c);
  _flashTex.colorSpace = THREE.SRGBColorSpace;
  _sharedTextures.add(_flashTex);
  return _flashTex;
}

// Textura de ARCO de espada: gradiente angular (filo brillante -> estela).
let _arcTex = null;
function arcTexture() {
  if (_arcTex) return _arcTex;
  const w = 256, h = 128;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0.0, 'rgba(255,255,255,0)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.25)');
  g.addColorStop(0.85, 'rgba(255,255,255,0.9)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  _arcTex = new THREE.CanvasTexture(c);
  _arcTex.colorSpace = THREE.SRGBColorSpace;
  _sharedTextures.add(_arcTex);
  return _arcTex;
}

// Dibuja una vez cada variante de numero y reutiliza su CanvasTexture.
function numberTexture(text, fill, crit) {
  const key = `${crit ? 1 : 0}|${fill}|${text}`;
  const cached = _numberTexCache.get(key);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext('2d');
  const fontPx = crit ? 68 : 42;
  ctx.font = 'bold ' + fontPx + 'px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';   // borde oscuro para contraste
  ctx.strokeText(text, 64, 34);
  ctx.fillStyle = fill;
  ctx.fillText(text, 64, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _numberTexCache.set(key, tex);
  _sharedTextures.add(tex);
  return tex;
}

export class Effects {
  // scene = THREE.Scene; getCamera = () => THREE.Camera (para orientar nada extra,
  // los Sprite ya miran a la camara solos, pero se guarda por contrato/futuro uso).
  constructor(scene, getCamera, getFocus) {
    this.scene = scene;
    this.getCamera = getCamera || (() => null);
    this.getFocus = getFocus || (() => null);
    // registros planos, sin nodos de escena: los dibuja un solo InstancedMesh
    this.particles = []; // { x,y,z, vx,vy,vz, scale, color, life, max }
    this.particleBatch = new ParticleBatch(scene, PARTICLE_GEO, particleCap());
    this.pools = [];      // { mesh, life, max }
    this.numbers = [];    // { sprite, life, max, vy }
    this.flashes = [];    // { sprite, life, max }
    this.projectiles = []; // { group, dir, speed, dist, traveled, color, type, to, trail }
    this.rings = [];      // { mesh, life, max, radius } anillos de nova expansivos
    this.arcs = [];       // { mesh, life, max } arcos de espada (slash trails)
    this.trails = [];     // { mesh, life, max } estelas de movimiento
    this.chunks = [];     // { mesh, vel, spin, life, max } pedazos de zombie volando
    // luces dinamicas: lo que hace que un efecto ILUMINE la escena en vez de ser
    // un calco pegado. POOL FIJO: se agregan a la escena UNA sola vez y jamas se
    // quitan ni se agregan luces despues. Cambiar el numero de luces de la escena
    // obliga a Three.js a recompilar TODOS los shaders iluminados (edificios, mobs,
    // suelo...), un stall sincrono de varios ms que se dispara en cada cast/impacto
    // y se derrumba con hordas. Con el conteo de luces constante = cero
    // recompilaciones. En movil/low-end el pool queda vacio (fillrate del forward).
    this.lights = [];     // pool fijo: { light, life, max, peak, active }
    const lightPoolSize = (isMobileProfile() || isLowEndProfile()) ? 0 : 4;
    for (let i = 0; i < lightPoolSize; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 9, 2);
      light.position.set(0, -1000, 0); // fuera de vista hasta que se use
      this.scene.add(light);
      this.lights.push({ light, life: 0, max: 1, peak: 0, active: false });
    }
    this.shakeT = 0;      // screen shake restante (s)
    this.shakeAmp = 0;    // amplitud actual del shake (unidades de mundo)
    this.shakeMaxT = 0;
    this.shakePhase = 0;
  }

  // 3 = completo, 2 = reducido, 1 = minimo, 0 = demasiado lejos.
  _vfxDetail(pos) {
    let f = null;
    try { f = this.getFocus && this.getFocus(); } catch { f = null; }
    if (!f) return 3;
    const p = readPos(pos || f);
    const fx = Number(f.x) || 0;
    const fz = Number(f.z) || 0;
    const d = Math.hypot(p.x - fx, p.z - fz);
    const r = vfxRanges();
    if (d <= r.near) return 3;
    if (d <= r.mid) return 2;
    if (d <= r.far) return 1;
    return 0;
  }

  // Chorro de sangre generoso: cada golpe SE SIENTE (gore ARPG).
  bloodHit(pos) {
    const detail = this._vfxDetail(pos);
    if (detail <= 0) return false;
    const base = 20 + Math.floor(Math.random() * 9);
    const n = detail === 1 ? 4 : detail === 2 ? Math.max(8, base >> 1) : base;
    this._spurt(pos, n, detail === 1 ? 3.0 : 5.6, HIT_LIFE);
    return true;
  }

  // Estallido mayor (20-30 particulas) + mancha plana en el piso que se desvanece.
  bloodDeath(pos) {
    const p = readPos(pos);
    const detail = this._vfxDetail(p);
    if (detail <= 0) return false;
    const base = 20 + Math.floor(Math.random() * 11);
    this._spurt(p, detail === 1 ? 5 : detail === 2 ? 12 : base, detail === 1 ? 3.2 : 5.0, DEATH_LIFE);
    if (detail >= 2) this._pool(p);
    return true;
  }

  bloodPool(pos) {
    return this._pool(pos);
  }

  bloodDrip(pos) {
    return this._pool(pos, {
      radius: 0.34 + Math.random() * 0.22,
      opacity: 0.48,
      startScale: 0.26,
      endScale: 0.62,
      life: poolLife() * 0.62,
    });
  }

  // GORE de kill zombie: explosion de sangre + esquirlas de hueso que rebotan
  // + charco grande que persiste. streak alto = estallido mas grande.
  goreBurst(pos, intensity = 1) {
    const p = readPos(pos);
    const detail = this._vfxDetail(p);
    if (detail <= 0) return false;
    const k = Math.min(2.5, Math.max(1, intensity));
    const scale = detail === 1 ? 0.18 : detail === 2 ? 0.45 : 1;
    this._spurt(p, Math.max(4, Math.round(38 * k * scale)), 7.2 * k * (detail === 1 ? 0.5 : 1), DEATH_LIFE * 1.35);
    if (detail >= 2) this._spurt(p, Math.round(12 * k * scale), 5.2, 0.85, 0xe8e2d4);   // esquirlas de hueso
    if (detail >= 2) this._pool(p);
    if (detail >= 3) this._pool({ x: p.x + (Math.random() - 0.5) * 1.2, y: p.y, z: p.z + (Math.random() - 0.5) * 1.2 });
    this.hitFlash(p, 0xff3020);
    return true;
  }

  // Genera n particulas saliendo desde pos. spread = magnitud de la velocidad.
  // Son REGISTROS, no nodos de escena: las dibuja un solo InstancedMesh.
  _spurt(pos, n, spread, life, color = BLOOD_COLOR) {
    if (isMobileProfile()) n = Math.max(3, n >> 1);   // movil: mitad de gore
    const p = readPos(pos);
    for (let i = 0; i < n; i++) {
      if (this.particles.length >= particleCap()) this.particles.shift();   // tira la mas vieja
      const ang = Math.random() * Math.PI * 2;
      const rad = (0.4 + Math.random() * 0.6) * spread;
      this.particles.push({
        x: p.x, y: p.y + 0.2, z: p.z,
        vx: Math.cos(ang) * rad,
        vy: spread * (0.6 + Math.random() * 0.7),
        vz: Math.sin(ang) * rad,
        scale: 0.6 + Math.random() * 0.8,
        color,
        life,
        max: life,
      });
    }
  }

  // caps duros: nunca acumular nodos hasta el drop de fps
  _capArray(arr, cap) {
    while (arr.length > cap) {
      const e = arr.shift();
      this._killEntry(e);
    }
  }

  _pushCapped(arr, entry, cap) {
    while (arr.length >= cap) {
      this._killEntry(arr.shift());
    }
    arr.push(entry);
  }

  _killEntry(e) {
    if (!e) return;
    if (e.group) this._killGroup(e.group);
    else if (e.mesh) this._kill(e.mesh, true);
    else if (e.sprite) this._kill(e.sprite, false);
  }

  // Mancha plana roja en el piso (CircleGeometry horizontal). Escala y se desvanece.
  _pool(pos, opts = {}) {
    const p = readPos(pos);
    if (this._vfxDetail(p) < 2) return false;
    const radius = Number.isFinite(Number(opts.radius)) ? Number(opts.radius) : (1.15 + Math.random() * 0.85);
    const geo = new THREE.CircleGeometry(Math.max(0.18, radius), 16);
    const opacity = Math.max(0.18, Math.min(0.85, Number(opts.opacity) || 0.85));
    const mat = new THREE.MeshBasicMaterial({
      color: BLOOD_COLOR,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(p.x, 0.03, p.z);
    const startScale = Math.max(0.1, Math.min(1, Number(opts.startScale) || 0.2));
    const endScale = Math.max(startScale, Math.min(1.3, Number(opts.endScale) || 1));
    mesh.scale.setScalar(startScale);
    this.scene.add(mesh);
    const life = Math.max(0.5, Math.min(poolLife(), Number(opts.life) || poolLife()));
    this.pools.push({ mesh, life, max: life, opacity, startScale, endScale });
    this._capArray(this.pools, isLowEndProfile() ? 12 : isMobileProfile() ? 18 : 36);
    return true;
  }

  // Numero flotante que sube y se desvanece. Sprite billboard hacia la camara.
  // opts: { toPlayer (rojo), crit (mas grande), heal (verde, con '+') }.
  damageNumber(pos, amount, opts = {}) {
    const p = readPos(pos);
    const detail = this._vfxDetail(p);
    if (detail <= 0) return false;
    if (detail === 1 && !(opts.heal || opts.toPlayer || opts.crit)) return false;
    const n = Math.round(amount);
    let fill = '#ffffff';
    let text = String(n);
    if (opts.heal) { fill = '#7be07b'; text = '+' + n; }
    else if (opts.toPlayer) { fill = '#ff5a5a'; }
    const tex = numberTexture(text, fill, !!opts.crit);
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    const base = opts.crit ? 2.1 : 1.15;
    sprite.scale.set(base, base * 0.5, 1);
    sprite.position.set(p.x, p.y + 1.4, p.z);
    sprite.renderOrder = 999; // por encima de la geometria (depthTest:false)
    this.scene.add(sprite);
    this._pushCapped(this.numbers, { sprite, life: NUMBER_LIFE, max: NUMBER_LIFE },
      isLowEndProfile() ? 34 : isMobileProfile() ? 48 : 80);
    return true;
  }

  // ARCO DE ESPADA: abanico luminoso que sigue el tajo (el alma visual del melee)
  slashArc(pos, heading, colorHex) {
    const p = readPos(pos);
    if (this._vfxDetail(p) <= 0) return false;
    const mat = new THREE.MeshBasicMaterial({
      map: arcTexture(), color: new THREE.Color(colorHex != null ? colorHex : 0xfff2d8),
      transparent: true, opacity: 0.95, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(SLASH_ARC_GEO, mat);
    mesh.position.set(p.x, 1.15, p.z);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = -(heading || 0) + Math.PI / 2 - 1.2;
    this.scene.add(mesh);
    this._pushCapped(this.arcs, { mesh, life: 0.18, max: 0.18, opacity: 0.95, grow: 0.7 }, 14);
    return true;
  }

  // Garra/mordida de mob: arco mas corto para leer el ataque sin tapar el combate.
  clawArc(pos, heading, colorHex) {
    const p = readPos(pos);
    if (this._vfxDetail(p) <= 0) return false;
    const mat = new THREE.MeshBasicMaterial({
      map: arcTexture(), color: new THREE.Color(colorHex != null ? colorHex : 0xff3c22),
      transparent: true, opacity: 0.62, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(CLAW_ARC_GEO, mat);
    mesh.position.set(p.x, p.y || 0.95, p.z);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = -(heading || 0) + Math.PI / 2 - 0.75;
    this.scene.add(mesh);
    this._pushCapped(this.arcs, { mesh, life: 0.13, max: 0.13, opacity: 0.62, grow: 0.4 },
      isLowEndProfile() ? 8 : isMobileProfile() ? 12 : 22);
    return true;
  }

  // Circulo de peligro bajo una mordida telegrafiada. Es corto y barato:
  // comunica el windup sin depender de postproceso ni UI DOM.
  dangerCircle(pos, radius = 1.25, life = 0.28, colorHex) {
    const p = readPos(pos);
    const detail = this._vfxDetail(p);
    if (detail <= 0) return false;
    const r = Math.max(0.45, Math.min(2.7, Number(radius) || 1.25));
    const max = Math.max(0.08, Math.min(0.7, Number(life) || 0.28));
    const baseOpacity = detail === 1 ? 0.22 : detail === 2 ? 0.34 : 0.46;
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colorHex != null ? colorHex : 0xff3c22),
      transparent: true,
      opacity: baseOpacity,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(DANGER_RING_GEO, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(p.x, 0.105, p.z);
    mesh.scale.setScalar(r * 0.78);
    mesh.renderOrder = 8;
    this.scene.add(mesh);
    this._pushCapped(this.rings, {
      mesh, life: max, max, radius: r, danger: true, opacity: baseOpacity,
    }, isLowEndProfile() ? 8 : isMobileProfile() ? 12 : 24);
    return true;
  }

  // Estela plana de desplazamiento: comunica dash/lunge sin tocar animacion ni postproceso.
  dashTrail(from, to, colorHex, opts = {}) {
    const a = readPos(from), b = readPos(to);
    if (Math.max(this._vfxDetail(a), this._vfxDetail(b)) <= 0) return false;
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.25) return false;
    const width = Math.max(0.18, Math.min(0.55, Number(opts.width) || 0.34));
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colorHex != null ? colorHex : 0x8fffd8),
      transparent: true,
      opacity: Math.max(0.12, Math.min(0.5, Number(opts.opacity) || 0.34)),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(TRAIL_GEO, mat);
    mesh.position.set((a.x + b.x) * 0.5, 0.075, (a.z + b.z) * 0.5);
    mesh.rotation.y = -Math.atan2(dz, dx);
    mesh.scale.set(len, 1, width);
    mesh.renderOrder = 7;
    this.scene.add(mesh);
    this._pushCapped(this.trails, { mesh, life: MOTION_TRAIL_LIFE, max: MOTION_TRAIL_LIFE, opacity: mat.opacity, width },
      motionTrailCap());
    return true;
  }

  // NOVA: anillo de energia que se expande por el piso hasta `radius` y se apaga.
  // DESTELLO DE LUZ: un PointLight corto que ilumina de verdad el entorno. Es lo
  // que separa un efecto "real" de un decal additive. Se apaga en movil/low-end
  // (cuesta fillrate por cada luz extra en el forward renderer).
  flashLight(pos, colorHex, peak = 6, radius = 9, life = 0.34) {
    if (!this.lights.length) return false; // pool vacio (movil/low-end)
    const p = readPos(pos);
    if (this._vfxDetail(p) < 2) return false;
    // tomar una luz libre del pool; si todas estan ocupadas, reciclar la que
    // menos vida le queda. Nunca se agrega ni se quita del scene graph.
    let slot = null;
    for (const e of this.lights) { if (!e.active) { slot = e; break; } }
    if (!slot) {
      slot = this.lights[0];
      for (const e of this.lights) if (e.life < slot.life) slot = e;
    }
    slot.light.color.set(colorHex != null ? colorHex : 0xff9a3c);
    slot.light.distance = radius;
    slot.light.position.set(p.x, (p.y || 0) + 1.0, p.z);
    slot.life = life; slot.max = life; slot.peak = peak; slot.active = true;
    return true;
  }

  // Nucleo brillante que crece y se apaga: el corazon de una explosion/nova.
  _energyCore(pos, colorHex, size = 1.2, life = 0.32) {
    const p = readPos(pos);
    const mat = new THREE.MeshBasicMaterial({
      map: flashTexture(), color: new THREE.Color(colorHex != null ? colorHex : 0xffd24a),
      transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const sp = new THREE.Sprite(mat);
    sp.position.set(p.x, (p.y || 0) + 0.9, p.z);
    sp.scale.setScalar(size * 0.5);
    this.scene.add(sp);
    this._pushCapped(this.flashes, { sprite: sp, life, max: life, grow: size },
      isLowEndProfile() ? 10 : isMobileProfile() ? 16 : 40);
  }

  nova(pos, colorHex, radius = 4.5) {
    const p = readPos(pos);
    const detail = this._vfxDetail(p);
    if (detail <= 0) return false;
    // luz + nucleo: la nova ahora ilumina y tiene corazon, no es solo un anillo
    this.flashLight(p, colorHex, 7, Math.max(8, radius * 2), 0.36);
    if (detail >= 2) this._energyCore({ x: p.x, y: 0.6, z: p.z }, colorHex, Math.min(3, radius * 0.6), 0.34);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colorHex != null ? colorHex : 0xff7a1e),
      transparent: true, opacity: 0.95, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(NOVA_RING_GEO, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(p.x, 0.15, p.z);
    mesh.scale.setScalar(0.4);
    this.scene.add(mesh);
    this._pushCapped(this.rings, { mesh, life: 0.55, max: 0.55, radius },
      isLowEndProfile() ? 12 : isMobileProfile() ? 18 : 30);
    // segundo anillo fino y rapido (doble onda = profundidad)
    if (detail >= 2) {
      const mesh2 = new THREE.Mesh(NOVA_FINE_RING_GEO, mat.clone());
      mesh2.rotation.x = -Math.PI / 2;
      mesh2.position.set(p.x, 0.22, p.z);
      mesh2.scale.setScalar(0.3);
      this.scene.add(mesh2);
      this._pushCapped(this.rings, { mesh: mesh2, life: 0.4, max: 0.4, radius: radius * 1.25 },
        isLowEndProfile() ? 12 : isMobileProfile() ? 18 : 30);
    }
    // chispas radiales rasantes
    if (detail >= 2) this._spurt({ x: p.x, y: 0.5, z: p.z }, detail === 2 ? 6 : 14, 6.5, 0.5, colorHex != null ? colorHex : 0xffa040);
    if (detail >= 2) this.hitFlash({ x: p.x, y: 0.4, z: p.z }, colorHex);
    return true;
  }

  // LLUVIA DE METEOROS: n bolas de fuego caen del cielo sobre puntos del area.
  meteorRain(center, radius = 6, n = 8) {
    const c = readPos(center);
    const detail = this._vfxDetail(c);
    if (detail <= 0) return false;
    const count = detail === 1 ? Math.min(n, 3) : detail === 2 ? Math.min(n, 6) : n;
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      const x = c.x + Math.cos(ang) * r, z = c.z + Math.sin(ang) * r;
      const delayJitter = Math.random() * 6;   // desincronizados via distancia extra
      this.projectile({ x: x + 2, y: 14 + delayJitter, z: z - 2 }, { x, y: 0.4, z }, 'fireball');
    }
    return true;
  }

  // Sanacion: chispas verdes que suben + destello suave.
  healBurst(pos) {
    const p = readPos(pos);
    const detail = this._vfxDetail(p);
    if (detail <= 0) return false;
    this._spurt({ x: p.x, y: p.y + 0.5, z: p.z }, detail === 1 ? 4 : detail === 2 ? 7 : 12, 2.4, 0.7, 0x7be07b);
    this.hitFlash({ x: p.x, y: p.y + 0.8, z: p.z }, 0x7be07b);
    // resplandor verde suave que baña al aliado
    this.flashLight({ x: p.x, y: p.y + 0.6, z: p.z }, 0x8fffa8, 3.2, 6, 0.4);
    return true;
  }

  // LEVEL-UP estilo MU: columna de luz dorada + chispas ascendentes + nova
  levelUpBurst(pos) {
    const p = readPos(pos);
    if (this._vfxDetail(p) <= 0) return false;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd875, transparent: true, opacity: 0.75, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(LEVEL_PILLAR_GEO, mat);
    mesh.position.set(p.x, 4.5, p.z);
    this.scene.add(mesh);
    // reutiliza el pool de anillos para animar el pilar (vida propia)
    this._pushCapped(this.rings, { mesh, life: 2.0, max: 2.0, radius: 1, pillar: true },
      isLowEndProfile() ? 12 : isMobileProfile() ? 18 : 30);
    this.nova({ x: p.x, y: 0, z: p.z }, 0xffd24a, 5);
    // resplandor dorado FUERTE que baña al heroe: subir de nivel se SIENTE
    this.flashLight({ x: p.x, y: 1.2, z: p.z }, 0xffdf8a, 9, 12, 0.6);
    this._energyCore({ x: p.x, y: 1.0, z: p.z }, 0xffe6a0, 2.6, 0.5);
    // chispas doradas subiendo en espiral
    for (let i = 0; i < 4; i++) {
      this._spurt({ x: p.x, y: 0.4 + i * 0.8, z: p.z }, 12, 3.2, 1.2, 0xffe08a);
    }
    this.hitFlash({ x: p.x, y: 1.4, z: p.z }, 0xffd875);
    return true;
  }

  // SCREEN SHAKE: pide una sacudida; Combat filtra por distancia antes de llamarlo.
  shake(amp = 0.1, dur = 0.14) {
    const mult = shakeIntensityMult();
    if (mult <= 0) return;              // apagado: ni siquiera arranca el decaimiento
    const nextAmp = Math.max(0, amp) * mult;
    const nextT = Math.max(0, dur) * SHAKE_DURATION_MULT;
    if (nextAmp >= this.shakeAmp * 0.92) this.shakePhase = (this.shakePhase + 1.37) % (Math.PI * 2);
    this.shakeAmp = Math.max(this.shakeAmp, nextAmp);
    this.shakeT = Math.max(this.shakeT, nextT);
    this.shakeMaxT = Math.max(this.shakeMaxT || 0, this.shakeT, nextT);
  }

  // offset de camara del frame (decae solo). Sumar a camera.position tras calcularla.
  shakeOffset() {
    if (this.shakeT <= 0) return null;
    const maxT = Math.max(0.001, this.shakeMaxT || this.shakeT);
    const age = Math.max(0, maxT - this.shakeT);
    const fade = Math.min(1, this.shakeT / Math.min(0.1, maxT));
    const k = this.shakeAmp * fade;
    const p = this.shakePhase || 0;
    return {
      x: Math.sin(age * 42 + p) * k,
      y: Math.sin(age * 31 + p * 1.7) * k * 0.16,
      z: Math.sin(age * 53 + p * 0.6) * k * 0.5,
    };
  }

  // DESMEMBRAMIENTO: carne, viscera y hueso salen volando con fisica simple,
  // manchan el piso al caer y se hunden. Cada material tiene su rugosidad:
  // la viscera brilla (humeda), la carne menos, el hueso es mate.
  dismember(pos, opts = {}) {
    const p = readPos(pos);
    const detail = this._vfxDetail(p);
    if (detail < 2) return false;
    const intensity = Math.min(2, Math.max(0.6, Number(opts.intensity) || 1));
    const n = detail === 2 ? 3 : isLowEndProfile() ? 3 : isMobileProfile() ? 4 : 6 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const kind = i === 0 ? 'organ' : (i % 4 === 3 ? 'bone' : 'meat');
      let geo, color, roughness;
      if (kind === 'bone') {
        geo = new THREE.BoxGeometry(0.07, 0.24 + Math.random() * 0.16, 0.07);
        color = GORE_BONE_COLOR;
        roughness = 0.95;
      } else if (kind === 'organ') {
        geo = new THREE.IcosahedronGeometry(0.21 + Math.random() * 0.1, 0);
        color = GORE_ORGAN_COLORS[(Math.random() * GORE_ORGAN_COLORS.length) | 0];
        roughness = 0.3;
      } else {
        geo = new THREE.IcosahedronGeometry(0.1 + Math.random() * 0.09, 0);
        color = GORE_MEAT_COLORS[(Math.random() * GORE_MEAT_COLORS.length) | 0];
        roughness = 0.55;
      }
      const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, flatShading: true });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(p.x, 0.8 + Math.random() * 0.5, p.z);
      mesh.scale.set(1, 0.72 + Math.random() * 0.5, 1);
      const ang = Math.random() * Math.PI * 2;
      const v = (3.2 + Math.random() * 3.6) * intensity;
      this.scene.add(mesh);
      this.chunks.push({
        mesh,
        vel: new THREE.Vector3(Math.cos(ang) * v, (3.4 + Math.random() * 3) * intensity, Math.sin(ang) * v),
        spin: new THREE.Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9),
        life: 4.2, max: 4.2,
        splat: kind !== 'bone',
      });
    }
    this._capArray(this.chunks, isLowEndProfile() ? 20 : isMobileProfile() ? 32 : 60);
    return true;
  }

  // Fogonazo blanco additive corto para feedback de impacto. colorHex opcional.
  hitFlash(pos, colorHex) {
    const p = readPos(pos);
    if (this._vfxDetail(p) <= 0) return false;
    const mat = new THREE.SpriteMaterial({
      map: flashTexture(),
      color: new THREE.Color(colorHex != null ? colorHex : 0xffffff),
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.setScalar(0.8);
    sprite.position.set(p.x, p.y + 0.6, p.z);
    sprite.renderOrder = 998;
    this.scene.add(sprite);
    this._pushCapped(this.flashes, { sprite, life: FLASH_LIFE, max: FLASH_LIFE }, flashCap());
    return true;
  }

  // Quita una particula de la escena y libera su material (geometria es compartida).

  // Quita un nodo con geometria y/o textura propias y las libera.
  _kill(mesh, hasGeo) {
    if (!mesh) return;
    if (mesh.parent) mesh.parent.remove(mesh);
    if (hasGeo && mesh.geometry && !isSharedGeometry(mesh.geometry)) mesh.geometry.dispose();
    const mat = mesh.material;
    if (mat) {
      if (mat.map && !isSharedTexture(mat.map)) mat.map.dispose();
      mat.dispose();
    }
  }

  // Proyectil que viaja de from a to: fireball (naranja), magic (verde), arrow (asta).
  projectile(from, to, type = 'fireball') {
    const a = readPos(from), b = readPos(to);
    const detail = Math.max(this._vfxDetail(a), this._vfxDetail(b));
    if (detail <= 0) return false;
    const dir = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
    const dist = dir.length() || 0.01;
    dir.normalize();
    const COL = { fireball: 0xff7a1e, magic: 0x74e6b0, arrow: 0xb89a6a };
    const color = COL[type] != null ? COL[type] : COL.fireball;
    const group = new THREE.Group();
    group.position.set(a.x, a.y, a.z);
    if (type === 'arrow') {
      const m = new THREE.Mesh(
        PROJECTILE_ARROW_GEO,
        new THREE.MeshBasicMaterial({ color }));
      group.add(m);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    } else {
      const core = new THREE.Mesh(
        PROJECTILE_CORE_GEO,
        new THREE.MeshBasicMaterial({ color }));
      group.add(core);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: flashTexture(), color: new THREE.Color(color), transparent: true,
        opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      halo.scale.setScalar(0.9);
      group.add(halo);
    }
    this.scene.add(group);
    const speed = projectileSpeed(type);
    this._pushCapped(this.projectiles, { group, dir, speed, dist, traveled: 0, color, type, to: b, trail: detail === 1 ? 0.08 : 0 },
      isLowEndProfile() ? 24 : isMobileProfile() ? 36 : 60);
    return true;
  }

  // Pequeno destello del color que va dejando el proyectil (estela).
  _trailPuff(x, y, z, color) {
    if (this._vfxDetail({ x, y, z }) <= 1) return false;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flashTexture(), color: new THREE.Color(color), transparent: true,
      opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    }));
    s.scale.setScalar(0.5);
    s.position.set(x, y, z);
    s.renderOrder = 998;
    this.scene.add(s);
    this._pushCapped(this.flashes, { sprite: s, life: 0.18, max: 0.18 }, flashCap());
    return true;
  }

  // Libera un grupo sin tocar texturas compartidas.
  _killGroup(group) {
    if (group.parent) group.parent.remove(group);
    group.traverse((o) => {
      if (o.geometry && !isSharedGeometry(o.geometry)) o.geometry.dispose();
      if (o.material) {
        if (o.material.map && !isSharedTexture(o.material.map)) o.material.map.dispose();
        o.material.dispose();
      }
    });
  }

  // Avanza todo lo vivo: fisica simple, fade y reciclaje. dt clampeado para no
  // explotar tras un freeze de pestana.
  update(dt) {
    const d = Math.min(Math.max(dt || 0, 0), 0.1);

    // Particulas de sangre: gravedad + fade. Recorre al reves para borrar in place.
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const e = this.particles[i];
      e.life -= d;
      if (e.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      e.vy -= GRAVITY * d;
      e.x += e.vx * d;
      e.y += e.vy * d;
      e.z += e.vz * d;
      if (e.y < 0.02) { e.y = 0.02; e.vx = 0; e.vy = 0; e.vz = 0; }
    }
    // un solo draw call para las 300 gotas (antes: una malla por gota)
    this.particleBatch.sync(this.particles);

    // Manchas: crecen al inicio y se desvanecen al final.
    for (let i = this.pools.length - 1; i >= 0; i--) {
      const e = this.pools[i];
      e.life -= d;
      if (e.life <= 0) {
        this._kill(e.mesh, true);
        this.pools.splice(i, 1);
        continue;
      }
      const t = 1 - e.life / e.max; // 0 -> 1 en su vida
      const grow = Math.min(1, t * 4); // crece rapido en el primer cuarto
      const start = Number.isFinite(e.startScale) ? e.startScale : 0.2;
      const end = Number.isFinite(e.endScale) ? e.endScale : 1;
      e.mesh.scale.setScalar(start + grow * Math.max(0, end - start));
      e.mesh.material.opacity = (e.opacity || 0.85) * Math.min(1, e.life / (e.max * 0.5));
    }

    // Numeros: suben y se desvanecen.
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const e = this.numbers[i];
      e.life -= d;
      if (e.life <= 0) {
        this._kill(e.sprite, false);
        this.numbers.splice(i, 1);
        continue;
      }
      const t = 1 - e.life / e.max;
      e.sprite.position.y += (NUMBER_RISE / e.max) * d;
      e.sprite.material.opacity = t < 0.7 ? 1 : Math.max(0, (1 - t) / 0.3);
    }

    // Fogonazos: crecen un poco y se desvanecen.
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const e = this.flashes[i];
      e.life -= d;
      if (e.life <= 0) {
        this._kill(e.sprite, false);
        this.flashes.splice(i, 1);
        continue;
      }
      const k = e.life / e.max;
      e.sprite.material.opacity = 0.9 * k;
      if (e.grow) {
        // nucleo de energia: crece hasta su tamano y se apaga
        e.sprite.scale.setScalar(e.grow * (0.4 + (1 - k) * 0.85));
      } else {
        e.sprite.scale.setScalar(0.8 + (1 - k) * 0.6);
      }
    }

    // LUCES dinamicas: suben rapido y decaen (curva de flash real, no lineal).
    // El pool es fijo: al expirar se apaga (intensity 0) pero NO se quita de la
    // escena, para no recompilar shaders.
    for (let i = 0; i < this.lights.length; i++) {
      const e = this.lights[i];
      if (!e.active) continue;
      e.life -= d;
      if (e.life <= 0) { e.active = false; e.light.intensity = 0; continue; }
      const t = e.life / e.max;              // 1 -> 0
      // pico temprano: brilla fuerte al nacer y cae con t^2
      e.light.intensity = e.peak * t * t * (0.6 + 0.4 * Math.min(1, (1 - t) * 6));
    }

    // shake de camara decae solo
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - d);
      if (this.shakeT <= 0) {
        this.shakeAmp = 0;
        this.shakeMaxT = 0;
      }
    }

    // pedazos de zombie: parabola + rebote seco + fade hundiendose
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      c.life -= d;
      if (c.life <= 0) {
        this._kill(c.mesh, true);
        this.chunks.splice(i, 1);
        continue;
      }
      c.vel.y -= 12 * d;
      c.mesh.position.addScaledVector(c.vel, d);
      c.mesh.rotation.x += c.spin.x * d;
      c.mesh.rotation.y += c.spin.y * d;
      if (c.mesh.position.y < 0.06) {
        c.mesh.position.y = 0.06;
        // el primer golpe seco contra el suelo mancha; el hueso no sangra
        if (c.splat && c.vel.y < -2.2) {
          c.splat = false;
          this._pool({ x: c.mesh.position.x, y: 0, z: c.mesh.position.z }, {
            radius: 0.22 + Math.random() * 0.2,
            opacity: 0.62,
            startScale: 0.4,
            life: poolLife() * 0.6,
          });
        }
        c.vel.y = Math.abs(c.vel.y) * 0.3;
        c.vel.x *= 0.6; c.vel.z *= 0.6;
        c.spin.multiplyScalar(0.5);
      }
      const t = c.life / c.max;
      if (t < 0.3) { c.mesh.material.transparent = true; c.mesh.material.opacity = t / 0.3; }
    }

    // Arcos de espada: crecen 1->1.7 y se apagan en 220ms
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i];
      a.life -= d;
      if (a.life <= 0) { this._kill(a.mesh, true); this.arcs.splice(i, 1); continue; }
      const t = 1 - a.life / a.max;
      a.mesh.scale.setScalar(1 + t * (a.grow || 0.7));
      a.mesh.material.opacity = (a.opacity || 0.95) * (1 - t * t);
    }

    // Estelas de dash/lunge: se estrechan y desaparecen rapido.
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const t = this.trails[i];
      t.life -= d;
      if (t.life <= 0) {
        this._kill(t.mesh, true);
        this.trails.splice(i, 1);
        continue;
      }
      const k = t.life / t.max;
      t.mesh.scale.z = Math.max(0.05, (t.width || 1) * k);
      t.mesh.material.opacity = (t.opacity || 0.34) * k * k;
    }

    // Anillos de nova: expanden hasta su radio y se desvanecen.
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const e = this.rings[i];
      e.life -= d;
      if (e.life <= 0) {
        this._kill(e.mesh, true);
        this.rings.splice(i, 1);
        continue;
      }
      const t = 1 - e.life / e.max;
      if (e.danger) {
        const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 5);
        e.mesh.scale.setScalar((e.radius || 1) * (0.78 + t * 0.24 + pulse * 0.035));
        e.mesh.material.opacity = (e.opacity || 0.4) * (1 - t * t) * (0.72 + pulse * 0.28);
      } else if (e.pillar) {
        // el pilar de level-up gira, se estrecha y se desvanece hacia arriba
        e.mesh.rotation.y += 0.12;
        e.mesh.scale.set(1 - t * 0.55, 1 + t * 0.4, 1 - t * 0.55);
        e.mesh.material.opacity = 0.75 * (1 - t * t);
      } else {
        e.mesh.scale.setScalar(0.4 + t * e.radius);
        e.mesh.material.opacity = 0.95 * (1 - t * t);
      }
    }

    // Proyectiles: avanzan en linea recta, dejan estela y estallan al llegar.
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const e = this.projectiles[i];
      const step = e.speed * d;
      e.traveled += step;
      e.group.position.addScaledVector(e.dir, step);
      if (e.type !== 'arrow') {
        e.trail -= d;
        if (e.trail <= 0) {
          e.trail = 0.018;
          this._trailPuff(e.group.position.x, e.group.position.y, e.group.position.z, e.color);
        }
      }
      if (e.traveled >= e.dist) {
        this.hitFlash(e.to, e.color);
        this._spurt(e.to, e.type === 'arrow' ? 4 : 9, e.type === 'arrow' ? 2.5 : 3.4, 0.4, e.color);
        // magia y fuego ESTALLAN con luz y nucleo; la flecha solo salpica
        if (e.type !== 'arrow') {
          this.flashLight(e.to, e.color, 5, 7, 0.28);
          this._energyCore(e.to, e.color, 1.5, 0.26);
        }
        this._killGroup(e.group);
        this.projectiles.splice(i, 1);
      }
    }
  }
}
