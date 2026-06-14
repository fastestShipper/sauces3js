// Player: animated Quaternius char + third-person camera + collision.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class Player {
  constructor(scene, city, spawn) {
    this.scene = scene;
    this.city = city;
    this.pos = new THREE.Vector3(spawn[0], 0, spawn[1]);
    this.heading = 0;
    this.yaw = 0.6;
    this.pitch = 0.22;
    this.distance = 9.0;
    this.velY = 0;
    this.grounded = true;
    this.cur = '';
    this.root = new THREE.Group();
    this.root.position.copy(this.pos);
    scene.add(this.root);
    this.keys = {};
    addEventListener('keydown', e => { this.keys[e.code] = true; });
    addEventListener('keyup', e => { this.keys[e.code] = false; });
    this.dragging = false;
    addEventListener('mousedown', e => { if (e.button === 2) this.dragging = true; });
    addEventListener('mouseup', e => { if (e.button === 2) this.dragging = false; });
    addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('mousemove', e => {
      if (!this.dragging) return;
      this.yaw -= e.movementX * 0.006;
      this.pitch = Math.max(0.08, Math.min(1.3, this.pitch + e.movementY * 0.004));
    });
    addEventListener('wheel', e => {
      this.distance = Math.max(4, Math.min(40, this.distance + Math.sign(e.deltaY) * 1.5));
    });
  }

  async load() {
    const gltf = await new GLTFLoader().loadAsync('./assets/models/casual2.glb');
    const ch = gltf.scene;
    // GOTCHA: Box3 sobre SkinnedMesh mide bind-space (char salia 2.5x
    // gigante). El rig Quaternius mide 3.3 unidades: escala fija.
    const sc = 1.8 / 3.3;
    ch.scale.setScalar(sc);
    ch.position.y = 0;
    ch.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) { if (!m) continue; m.side = THREE.FrontSide; if (m.map) m.map.anisotropy = 8; }
    });
    this.char = ch;
    this.root.add(ch);
    this.mixer = new THREE.AnimationMixer(ch);
    this.actions = {};
    for (const clip of gltf.animations) {
      this.actions[clip.name] = this.mixer.clipAction(clip);
    }
    // zapatos sobre los huesos del pie
    ch.traverse(o => {
      if (o.isBone && (o.name === 'FootL' || o.name === 'FootR' || o.name === 'Foot_L' || o.name === 'Foot_R' || o.name.startsWith('Foot'))) {
        const shoe = new THREE.Mesh(
          new THREE.BoxGeometry(0.34, 0.22, 0.66),
          new THREE.MeshStandardMaterial({ color: 0x2b2624, roughness: 0.7 }));
        shoe.position.set(0, 0.05, 0.14);
        o.add(shoe);
      }
    });
    this.play('Idle');
  }

  play(name) {
    if (this.cur === name || !this.actions[name]) return;
    const next = this.actions[name];
    const oneShot = !['Idle', 'Walk', 'Run'].includes(name);
    next.reset();
    next.setLoop(oneShot ? THREE.LoopOnce : THREE.LoopRepeat, oneShot ? 1 : Infinity);
    next.clampWhenFinished = oneShot;
    if (this.cur && this.actions[this.cur]) next.crossFadeFrom(this.actions[this.cur], 0.18, false);
    next.play();
    this.cur = name;
  }

  update(dt, camera) {
    let fwd = 0, strafe = 0;
    if (this.keys['KeyW']) fwd += 1;
    if (this.keys['KeyS']) fwd -= 1;
    if (this.keys['KeyA']) strafe -= 1;
    if (this.keys['KeyD']) strafe += 1;
    const moving = fwd !== 0 || strafe !== 0;
    let spd = 9.0 * (this.keys['ShiftLeft'] || this.keys['ShiftRight'] ? 2 : 1);
    if (moving) {
      const dx = Math.sin(this.yaw) * -fwd + Math.cos(this.yaw) * strafe;
      const dz = Math.cos(this.yaw) * -fwd - Math.sin(this.yaw) * strafe;
      const il = 1 / (Math.hypot(dx, dz) || 1);
      const sx = dx * il * spd * dt, sz = dz * il * spd * dt;
      // colision con deslizamiento (edificios + autos)
      const blocked = (x, z) => this.city.inRealBuilding(x, z, 0) || (this.pos.y < 1.25 && this.city.hitsCar(x, z));
      if (!blocked(this.pos.x + sx, this.pos.z + sz)) {
        this.pos.x += sx; this.pos.z += sz;
      } else if (!blocked(this.pos.x + sx, this.pos.z)) {
        this.pos.x += sx;
      } else if (!blocked(this.pos.x, this.pos.z + sz)) {
        this.pos.z += sz;
      }
      this.heading = Math.atan2(dx, dz);
    }
    if (this.keys['Space'] && this.grounded) { this.velY = 8.4; this.grounded = false; }
    const roofY = this.city.carRoofAt(this.pos.x, this.pos.z);
    if (!this.grounded) {
      this.pos.y += this.velY * dt;
      this.velY -= 19 * dt;
      const gy = (roofY > 0 && this.velY <= 0 && this.pos.y <= roofY + 0.08) ? roofY : 0;
      if (this.pos.y <= gy) { this.pos.y = gy; this.velY = 0; this.grounded = true; }
    } else {
      const gy = (roofY > 0 && Math.abs(this.pos.y - roofY) < 0.35) ? roofY : 0;
      if (this.pos.y > gy + 0.05) this.grounded = false;  // se bajo del techo
      else this.pos.y = gy;
    }
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.heading;
    if (!this.grounded) this.play('Jump');
    else if (moving) this.play(spd > 9 ? 'Run' : 'Walk');
    else this.play('Idle');
    if (this.mixer) this.mixer.update(dt);
    // camara con clamp por oclusion: nunca dentro de un edificio
    let dist = this.distance;
    const dirX = Math.sin(this.yaw) * Math.cos(this.pitch);
    const dirZ = Math.cos(this.yaw) * Math.cos(this.pitch);
    for (let t = 1.2; t < this.distance; t += 0.5) {
      const sxp = this.pos.x + dirX * t;
      const szp = this.pos.z + dirZ * t;
      if (this.city.inRealBuilding(sxp, szp, 0.2)) { dist = Math.max(1.2, t - 0.6); break; }
    }
    const cx = this.pos.x + dirX * dist;
    const cz = this.pos.z + dirZ * dist;
    const cy = this.pos.y + Math.sin(this.pitch) * dist + 1.1;
    camera.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(1, dt * 10));
    camera.lookAt(this.pos.x, this.pos.y + 1.5, this.pos.z);
  }
}
