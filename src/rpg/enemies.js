// Slimes procedurales: blobs RPG clasicos (NO humanoides) para que nunca
// compartan skin con los aventureros KayKit del jugador. Body = icosfera baja
// achatada, color toon plano, dos ojos, bob + squash-stretch. Tinte por nivel.
import * as THREE from 'three';

// tintes por nivel: 1 verde grisaceo, 2 azulado, 3 morado
const LEVEL_TINT = {
  1: 0x6f8f73,
  2: 0x5b78c4,
  3: 0x8a5ec0,
};
const CHASE_RANGE = 14;     // u: dentro de esto persigue
const ATTACK_RANGE = 1.9;   // u: dentro de esto ataca
const CHASE_SPEED = 2.6;    // u/s al perseguir
const ATTACK_CD = 1.2;      // s entre ataques
const HPBAR_W = 1.1, HPBAR_H = 0.14;

// dano por nivel (rango 6..12)
function rollDamage(level) {
  const base = 5 + level * 2;            // 7 / 9 / 11
  return base + Math.floor(Math.random() * 3) - 1;  // +-1
}

// canvas de la barra de vida; se redibuja en cada hit
function makeHpBar(hpMax) {
  const c = document.createElement('canvas');
  c.width = 96; c.height = 16;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(HPBAR_W, HPBAR_H, 1);
  sprite.renderOrder = 999;
  const redraw = (hp) => {
    const f = Math.max(0, Math.min(1, hp / hpMax));
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = 'rgba(15,15,20,0.78)';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = f > 0.5 ? '#5fd07a' : (f > 0.22 ? '#e0b24a' : '#d6534a');
    ctx.fillRect(2, 2, (c.width - 4) * f, c.height - 4);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(1, 1, c.width - 2, c.height - 2);
    tex.needsUpdate = true;
  };
  redraw(hpMax);
  sprite._redraw = redraw;
  return sprite;
}

// construye el mesh del slime y devuelve { root, body, baseY, radius }
function buildSlime(level) {
  const tint = LEVEL_TINT[level] || LEVEL_TINT[1];
  const radius = 0.55 + level * 0.16;     // mas alto = mas grande
  const root = new THREE.Group();

  // cuerpo: icosfera baja, achatada en Y (look de blob)
  const geo = new THREE.IcosahedronGeometry(radius, 1);
  const mat = new THREE.MeshToonMaterial({ color: tint });
  const body = new THREE.Mesh(geo, mat);
  body.scale.y = 0.72;                    // achatado base
  body.position.y = radius * 0.72;
  body.castShadow = true;
  root.add(body);

  // ojos: dos esferitas blancas con pupila, mirando +Z
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const pupMat = new THREE.MeshBasicMaterial({ color: 0x12131a });
  const er = radius * 0.16;
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(er, 8, 8), eyeMat);
    eye.position.set(sx * radius * 0.34, radius * 0.78, radius * 0.74);
    const pup = new THREE.Mesh(new THREE.SphereGeometry(er * 0.55, 6, 6), pupMat);
    pup.position.set(0, 0, er * 0.62);
    eye.add(pup);
    body.add(eye);
  }

  // sombra plana oscura bajo el slime
  const sh = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 1.05, 18),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false })
  );
  sh.rotation.x = -Math.PI / 2;
  sh.position.y = 0.02;
  root.add(sh);

  // anillo de seleccion (oculto por defecto), additive amarillo pastel
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 1.15, radius * 1.4, 24),
    new THREE.MeshBasicMaterial({ color: 0xffe79a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  ring.visible = false;
  root.add(ring);

  return { root, body, ring, baseY: body.position.y, radius };
}

class Enemy {
  constructor(scene, x, z, level) {
    this.scene = scene;
    this.level = level;
    this.hpMax = 22 + level * 14;     // 36 / 50 / 64
    this.hp = this.hpMax;
    this.alive = true;
    this.pendingDamage = 0;
    this.pos = { x, z };
    this._t = Math.random() * Math.PI * 2;   // fase de bob desfasada
    this._cd = 0;                            // cooldown de ataque
    this._dying = false;
    this._dieT = 0;

    const built = buildSlime(level);
    this.root = built.root;
    this._body = built.body;
    this._ring = built.ring;
    this._baseY = built.baseY;
    this.radius = built.radius;
    this.root.position.set(x, 0, z);

    this.hpBar = makeHpBar(this.hpMax);
    this.hpBar.position.set(0, this.radius * 1.7 + 0.5, 0);
    this.root.add(this.hpBar);

    scene.add(this.root);
  }

  // resta hp; devuelve true si murio
  takeDamage(n) {
    if (!this.alive) return false;
    this.hp = Math.max(0, this.hp - (n || 0));
    if (this.hpBar && this.hpBar._redraw) this.hpBar._redraw(this.hp);
    if (this.hp <= 0) {
      this.alive = false;
      this._dying = true;
      this.setTargeted(false);
      return true;
    }
    return false;
  }

  setTargeted(on) {
    if (this._ring) this._ring.visible = !!on;
  }

  // orienta la barra a la camara
  faceCamera(camera) {
    if (camera && this.hpBar) this.hpBar.quaternion.copy(camera.quaternion);
  }

  dispose() {
    if (this.root && this.root.parent) this.root.parent.remove(this.root);
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const m = Array.isArray(o.material) ? o.material : [o.material];
        m.forEach((mm) => { if (mm.map) mm.map.dispose(); mm.dispose(); });
      }
    });
  }
}

export class EnemyManager {
  constructor(scene, spawnPoints) {
    this.scene = scene;
    this.spawnPoints = Array.isArray(spawnPoints) ? spawnPoints : [];
    this.enemies = [];
    this.camera = null;   // opcional: set externamente para orientar barras
  }

  // crea n slimes en spawnPoints aleatorios, nivel 1..3
  spawn(n) {
    if (!this.spawnPoints.length) return;
    const count = Math.max(0, n | 0);
    for (let i = 0; i < count; i++) {
      const sp = this.spawnPoints[(Math.random() * this.spawnPoints.length) | 0];
      const level = 1 + ((Math.random() * 3) | 0);
      const jx = (Math.random() - 0.5) * 4, jz = (Math.random() - 0.5) * 4;
      const e = new Enemy(this.scene, sp[0] + jx, sp[1] + jz, level);
      this.enemies.push(e);
    }
  }

  meshes() {
    return this.enemies.map((e) => e.root);
  }

  // dado raycaster.intersectObjects(this.meshes(), true), devuelve el Enemy o null
  pickFromIntersections(intersects) {
    if (!intersects || !intersects.length) return null;
    for (const hit of intersects) {
      let o = hit.object;
      while (o) {
        const found = this.enemies.find((e) => e.root === o);
        if (found && found.alive) return found;
        o = o.parent;
      }
    }
    return null;
  }

  update(dt, playerPos) {
    if (!Number.isFinite(dt) || dt <= 0) dt = 0.016;
    if (dt > 0.1) dt = 0.1;   // clamp anti-salto tras lag/tab oculto

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e._t += dt;

      // muerte: encoger y remover
      if (e._dying) {
        e._dieT += dt;
        const s = Math.max(0, 1 - e._dieT * 3.2);
        e.root.scale.setScalar(s);
        if (s <= 0.01) { e.dispose(); this.enemies.splice(i, 1); }
        continue;
      }

      // bob + squash-stretch idle (siempre)
      const bob = Math.sin(e._t * 3.2);
      e._body.position.y = e._baseY + Math.max(0, bob) * e.radius * 0.18;
      e._body.scale.y = 0.72 + bob * 0.08;
      e._body.scale.x = e._body.scale.z = 1 - bob * 0.05;

      if (e._cd > 0) e._cd -= dt;

      // IA: distancia al player (defensiva ante playerPos invalido)
      if (playerPos && Number.isFinite(playerPos.x) && Number.isFinite(playerPos.z)) {
        const dx = playerPos.x - e.pos.x, dz = playerPos.z - e.pos.z;
        const dist = Math.hypot(dx, dz);

        if (dist < CHASE_RANGE && dist > 0.0001) {
          // mirar al player
          e.root.rotation.y = Math.atan2(dx, dz);
          // perseguir si no esta ya en rango de ataque
          if (dist > ATTACK_RANGE) {
            const step = Math.min(CHASE_SPEED * dt, dist - ATTACK_RANGE * 0.9);
            e.pos.x += (dx / dist) * step;
            e.pos.z += (dz / dist) * step;
            e.root.position.x = e.pos.x;
            e.root.position.z = e.pos.z;
          } else if (e._cd <= 0) {
            // atacar
            e.pendingDamage += rollDamage(e.level);
            e._cd = ATTACK_CD;
            e._body.scale.z = 1.25;   // lunge visual breve
          }
        }
      }

      e.faceCamera(this.camera);
    }
  }
}
