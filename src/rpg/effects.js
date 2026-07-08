// "Battle juice": chorros de sangre, manchas en el piso y numeros de dano flotantes.
// Sin postprocesado (no bloom). Rendimiento: geometrias/texturas compartidas a nivel
// de modulo, materiales clonados por particula para opacidad independiente, y caps
// duros de cantidad para no acumular nodos en la escena.
import * as THREE from 'three';

const GRAVITY = 14;              // u/s^2 que jala las particulas de sangre hacia abajo
const MAX_PARTICLES = 300;       // cap duro de particulas de sangre vivas
const HIT_LIFE = 0.5;            // vida de un chorro de impacto (s)
const DEATH_LIFE = 0.6;          // vida de las particulas del estallido de muerte (s)
const POOL_LIFE = 20.0;          // vida de la mancha en el piso (s) — gore persistente
const NUMBER_LIFE = 0.9;         // vida del numero de dano (s)
const NUMBER_RISE = 1.2;         // cuanto sube el numero en su vida (u)
const FLASH_LIFE = 0.15;         // vida del fogonazo de impacto (s)
const BLOOD_COLOR = 0x8a0e0e;    // rojo sangre oscuro

// Geometria compartida para las particulas de sangre. Una sola instancia para todas.
const PARTICLE_GEO = new THREE.IcosahedronGeometry(0.05, 0);

// Acepta THREE.Vector3 o {x,y,z} y devuelve componentes sueltas.
function readPos(p) {
  return { x: p.x || 0, y: p.y || 0, z: p.z || 0 };
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
  return _flashTex;
}

// Dibuja un numero en un canvas y devuelve una CanvasTexture lista para Sprite.
// fill/stroke en CSS; crit usa fuente mas grande.
function numberTexture(text, fill, crit) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext('2d');
  const fontPx = crit ? 52 : 40;
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
  return tex;
}

export class Effects {
  // scene = THREE.Scene; getCamera = () => THREE.Camera (para orientar nada extra,
  // los Sprite ya miran a la camara solos, pero se guarda por contrato/futuro uso).
  constructor(scene, getCamera) {
    this.scene = scene;
    this.getCamera = getCamera || (() => null);
    this.particles = []; // { mesh, vel, life, max }
    this.pools = [];      // { mesh, life, max }
    this.numbers = [];    // { sprite, life, max, vy }
    this.flashes = [];    // { sprite, life, max }
    this.projectiles = []; // { group, dir, speed, dist, traveled, color, type, to, trail }
    this.rings = [];      // { mesh, life, max, radius } anillos de nova expansivos
    this.chunks = [];     // { mesh, vel, spin, life, max } pedazos de zombie volando
    this.shakeT = 0;      // screen shake restante (s)
    this.shakeAmp = 0;    // amplitud actual del shake (unidades de mundo)
  }

  // Chorro de sangre generoso: cada golpe SE SIENTE (gore ARPG).
  bloodHit(pos) {
    this._spurt(pos, 14 + Math.floor(Math.random() * 7), 4.4, HIT_LIFE);
  }

  // Estallido mayor (20-30 particulas) + mancha plana en el piso que se desvanece.
  bloodDeath(pos) {
    const p = readPos(pos);
    this._spurt(p, 20 + Math.floor(Math.random() * 11), 5.0, DEATH_LIFE);
    this._pool(p);
  }

  // GORE de kill zombie: explosion de sangre + esquirlas de hueso que rebotan
  // + charco grande que persiste. streak alto = estallido mas grande.
  goreBurst(pos, intensity = 1) {
    const p = readPos(pos);
    const k = Math.min(2, Math.max(1, intensity));
    this._spurt(p, Math.round(26 * k), 6.0 * k, DEATH_LIFE * 1.2);
    this._spurt(p, Math.round(8 * k), 4.5, 0.7, 0xe8e2d4);   // esquirlas de hueso
    this._pool(p);
    this._pool({ x: p.x + (Math.random() - 0.5) * 1.2, y: p.y, z: p.z + (Math.random() - 0.5) * 1.2 });
    this.hitFlash(p, 0xff3020);
  }

  // Genera n particulas saliendo desde pos. spread = magnitud de la velocidad.
  _spurt(pos, n, spread, life, color = BLOOD_COLOR) {
    const p = readPos(pos);
    for (let i = 0; i < n; i++) {
      if (this.particles.length >= MAX_PARTICLES) {
        // Tira la mas vieja para respetar el cap.
        const old = this.particles.shift();
        if (old) this._killParticle(old);
      }
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
      const mesh = new THREE.Mesh(PARTICLE_GEO, mat);
      mesh.position.set(p.x, p.y + 0.2, p.z);
      mesh.scale.setScalar(0.6 + Math.random() * 0.8);
      const ang = Math.random() * Math.PI * 2;
      const rad = (0.4 + Math.random() * 0.6) * spread;
      const vel = new THREE.Vector3(
        Math.cos(ang) * rad,
        spread * (0.6 + Math.random() * 0.7),
        Math.sin(ang) * rad,
      );
      this.scene.add(mesh);
      this.particles.push({ mesh, vel, life, max: life });
    }
  }

  // Mancha plana roja en el piso (CircleGeometry horizontal). Escala y se desvanece.
  _pool(pos) {
    const p = readPos(pos);
    const geo = new THREE.CircleGeometry(0.7 + Math.random() * 0.5, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: BLOOD_COLOR,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(p.x, 0.03, p.z);
    mesh.scale.setScalar(0.2);
    this.scene.add(mesh);
    this.pools.push({ mesh, life: POOL_LIFE, max: POOL_LIFE });
  }

  // Numero flotante que sube y se desvanece. Sprite billboard hacia la camara.
  // opts: { toPlayer (rojo), crit (mas grande), heal (verde, con '+') }.
  damageNumber(pos, amount, opts = {}) {
    const p = readPos(pos);
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
    const base = opts.crit ? 1.5 : 1.1;
    sprite.scale.set(base, base * 0.5, 1);
    sprite.position.set(p.x, p.y + 1.4, p.z);
    sprite.renderOrder = 999; // por encima de la geometria (depthTest:false)
    this.scene.add(sprite);
    this.numbers.push({ sprite, life: NUMBER_LIFE, max: NUMBER_LIFE });
  }

  // NOVA: anillo de energia que se expande por el piso hasta `radius` y se apaga.
  nova(pos, colorHex, radius = 4.5) {
    const p = readPos(pos);
    const geo = new THREE.RingGeometry(0.72, 1.0, 40);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colorHex != null ? colorHex : 0xff7a1e),
      transparent: true, opacity: 0.95, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(p.x, 0.15, p.z);
    mesh.scale.setScalar(0.4);
    this.scene.add(mesh);
    this.rings.push({ mesh, life: 0.55, max: 0.55, radius });
    this.hitFlash({ x: p.x, y: 0.4, z: p.z }, colorHex);
  }

  // LLUVIA DE METEOROS: n bolas de fuego caen del cielo sobre puntos del area.
  meteorRain(center, radius = 6, n = 8) {
    const c = readPos(center);
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      const x = c.x + Math.cos(ang) * r, z = c.z + Math.sin(ang) * r;
      const delayJitter = Math.random() * 6;   // desincronizados via distancia extra
      this.projectile({ x: x + 2, y: 14 + delayJitter, z: z - 2 }, { x, y: 0.4, z }, 'fireball');
    }
  }

  // Sanacion: chispas verdes que suben + destello suave.
  healBurst(pos) {
    const p = readPos(pos);
    this._spurt({ x: p.x, y: p.y + 0.5, z: p.z }, 12, 2.4, 0.7, 0x7be07b);
    this.hitFlash({ x: p.x, y: p.y + 0.8, z: p.z }, 0x7be07b);
  }

  // SCREEN SHAKE: pide una sacudida; el loop la aplica a la camara via shakeOffset()
  shake(amp = 0.1, dur = 0.14) {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeT = Math.max(this.shakeT, dur);
  }

  // offset de camara del frame (decae solo). Sumar a camera.position tras calcularla.
  shakeOffset() {
    if (this.shakeT <= 0) return null;
    const k = this.shakeAmp * Math.min(1, this.shakeT / 0.1);
    return {
      x: (Math.random() * 2 - 1) * k,
      y: (Math.random() * 2 - 1) * k * 0.6,
      z: (Math.random() * 2 - 1) * k,
    };
  }

  // DESMEMBRAMIENTO fake: pedazos del zombie (tintados) salen volando con
  // fisica simple y se hunden. Violencia visual del kill.
  dismember(pos, tintHex) {
    const p = readPos(pos);
    const tint = new THREE.Color(tintHex != null ? tintHex : 0x7da364);
    const n = 4 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const head = i === 0;   // el primero es "la cabeza": mas grande y redondo
      const geo = head
        ? new THREE.SphereGeometry(0.16, 8, 6)
        : new THREE.BoxGeometry(0.1 + Math.random() * 0.12, 0.08 + Math.random() * 0.1, 0.09);
      const mat = new THREE.MeshStandardMaterial({ color: tint.clone().multiplyScalar(0.75 + Math.random() * 0.4), roughness: 0.9 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(p.x, 0.8 + Math.random() * 0.5, p.z);
      const ang = Math.random() * Math.PI * 2;
      const v = 2.2 + Math.random() * 2.6;
      this.scene.add(mesh);
      this.chunks.push({
        mesh,
        vel: new THREE.Vector3(Math.cos(ang) * v, 2.6 + Math.random() * 2.4, Math.sin(ang) * v),
        spin: new THREE.Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9),
        life: 2.4, max: 2.4,
      });
    }
  }

  // Fogonazo blanco additive corto para feedback de impacto. colorHex opcional.
  hitFlash(pos, colorHex) {
    const p = readPos(pos);
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
    this.flashes.push({ sprite, life: FLASH_LIFE, max: FLASH_LIFE });
  }

  // Quita una particula de la escena y libera su material (geometria es compartida).
  _killParticle(e) {
    if (e.mesh.parent) e.mesh.parent.remove(e.mesh);
    if (e.mesh.material) e.mesh.material.dispose();
  }

  // Quita un nodo con geometria y/o textura propias y las libera.
  _kill(mesh, hasGeo) {
    if (mesh.parent) mesh.parent.remove(mesh);
    if (hasGeo && mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material;
    if (mat) {
      if (mat.map) mat.map.dispose();
      mat.dispose();
    }
  }

  // Proyectil que viaja de from a to: fireball (naranja), magic (verde), arrow (asta).
  projectile(from, to, type = 'fireball') {
    const a = readPos(from), b = readPos(to);
    const dir = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
    const dist = dir.length() || 0.01;
    dir.normalize();
    const COL = { fireball: 0xff7a1e, magic: 0x74e6b0, arrow: 0xb89a6a };
    const color = COL[type] != null ? COL[type] : COL.fireball;
    const group = new THREE.Group();
    group.position.set(a.x, a.y, a.z);
    if (type === 'arrow') {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, 0.7, 6),
        new THREE.MeshBasicMaterial({ color }));
      group.add(m);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    } else {
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 10, 8),
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
    const speed = type === 'arrow' ? 40 : 26;
    this.projectiles.push({ group, dir, speed, dist, traveled: 0, color, type, to: b, trail: 0 });
  }

  // Pequeno destello del color que va dejando el proyectil (estela).
  _trailPuff(x, y, z, color) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flashTexture(), color: new THREE.Color(color), transparent: true,
      opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    }));
    s.scale.setScalar(0.5);
    s.position.set(x, y, z);
    s.renderOrder = 998;
    this.scene.add(s);
    this.flashes.push({ sprite: s, life: 0.18, max: 0.18 });
  }

  // Libera un grupo (proyectil) sin tocar la textura compartida de fogonazo.
  _killGroup(group) {
    if (group.parent) group.parent.remove(group);
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map && o.material.map !== _flashTex) o.material.map.dispose();
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
        this._killParticle(e);
        this.particles.splice(i, 1);
        continue;
      }
      e.vel.y -= GRAVITY * d;
      e.mesh.position.x += e.vel.x * d;
      e.mesh.position.y += e.vel.y * d;
      e.mesh.position.z += e.vel.z * d;
      if (e.mesh.position.y < 0.02) { e.mesh.position.y = 0.02; e.vel.set(0, 0, 0); }
      e.mesh.material.opacity = Math.max(0, e.life / e.max);
    }

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
      e.mesh.scale.setScalar(0.2 + grow * 0.8);
      e.mesh.material.opacity = 0.85 * Math.min(1, e.life / (e.max * 0.5));
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
      e.sprite.scale.setScalar(0.8 + (1 - k) * 0.6);
    }

    // shake de camara decae solo
    if (this.shakeT > 0) this.shakeT -= d;

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
        c.vel.y = Math.abs(c.vel.y) * 0.3;
        c.vel.x *= 0.6; c.vel.z *= 0.6;
        c.spin.multiplyScalar(0.5);
      }
      const t = c.life / c.max;
      if (t < 0.3) { c.mesh.material.transparent = true; c.mesh.material.opacity = t / 0.3; }
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
      e.mesh.scale.setScalar(0.4 + t * e.radius);
      e.mesh.material.opacity = 0.95 * (1 - t * t);
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
        this._killGroup(e.group);
        this.projectiles.splice(i, 1);
      }
    }
  }
}
