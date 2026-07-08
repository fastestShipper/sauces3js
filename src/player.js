// Player: animated Quaternius char + third-person camera + collision.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { sanitizeImported } from './glbutil.js?v=20260709a';
import { makeNametag } from './nametag.js?v=20260709a';
import { equipWeapon, comboClips, specialClipName, ATTACK_SPEED } from './weapons.js?v=20260709a';
import { composeCharacter } from './rpg/charcustom.js?v=20260709a';

// Los clips de combate del pack traen ROOT MOTION (el hueso root/hips se traslada
// dentro del clip). Jugados en el sitio, el personaje se desliza y vuelve de golpe
// (se ve mal). Quitamos esas pistas de POSICION del root/hips para que el ataque
// quede PLANTADO; las rotaciones (el swing) se conservan intactas.
function plantClip(clip) {
  const c = clip.clone();
  c.tracks = c.tracks.filter(t => t.name !== 'root.position' && t.name !== 'hips.position');
  return c;
}

export class Player {
  constructor(scene, city, spawn, opts = {}) {
    this.scene = scene;
    this.city = city;
    this.charFile = opts.char || 'char_knight.glb';
    this.name = opts.name || '';
    // identidad del HEROE (classes.js): tinte, arma custom y estilo de combo
    this.heroTint = opts.tint || 0;
    this.heroWeapon = opts.weapon || null;
    this.combatStyle = opts.combatStyle || '';
    this.heroSpec = opts.heroSpec || null;   // spec completa (paletas/piezas)
    this.custom = opts.custom || { t: 0, h: [] };
    this.pos = new THREE.Vector3(spawn[0], 0, spawn[1]);
    this.heading = 0;
    this.yaw = 0.6;
    this.pitch = 0.22;
    this.distance = 9.0;
    this.velY = 0;
    this.grounded = true;
    this.cur = '';
    this.root = new THREE.Group();
    // pasos: uno cada ~2.1m caminando (el pool de pasto de Kenney)
    if (this.grounded && this.sfx && this._lastX !== undefined) {
      this._stepDist += Math.hypot(this.pos.x - this._lastX, this.pos.z - this._lastZ);
      if (this._stepDist > 2.1) { this._stepDist = 0; this.sfx.step?.(); }
    }
    this._lastX = this.pos.x; this._lastZ = this.pos.z;
    this.root.position.copy(this.pos);
    scene.add(this.root);
    this.keys = {};
    addEventListener('keydown', e => { this.keys[e.code] = true; });
    addEventListener('keyup', e => { this.keys[e.code] = false; });
    this.dragging = false;
    this.attackT = 0;
    this.comboT = 0;
    this.comboIdx = 0;
    this.comboStep = 0;
    this.dead = false;
    this.hitT = 0;
    this.locked = false;   // true mientras el chat esta abierto: ignora WASD/salto/ataque
    this.speedBuffT = 0;   // haste de party (Instinto de Manada)
    this.speedBuffMult = 1;
    addEventListener('mousedown', e => {
      if (e.button === 2) this.dragging = true;
      else if (e.button === 0) this.attack();   // clic izq = ataque
    });
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
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync('./assets/models/' + this.charFile);
    const ch = gltf.scene;
    // GOTCHA: Box3 sobre SkinnedMesh mide bind-space. El rig KayKit (Rig_Medium)
    // mide ~2.54 unidades: escala fija para ~1.9m (heroe, leve sobre los vecinos).
    const sc = 1.9 / 2.54;
    ch.scale.setScalar(sc);
    ch.position.y = 0;
    ch.traverse(o => { if (o.isMesh) o.castShadow = true; });
    // look del heroe COMPUESTO: cabeza/torso/piernas/accesorios elegidos
    // de cualquier rig KayKit + paleta (mix-and-match real)
    if (this.heroSpec) await composeCharacter(loader, ch, this.heroSpec, this.custom);
    sanitizeImported(ch);
    this.char = ch;
    this.root.add(ch);
    if (this.name) this.root.add(makeNametag(this.name));
    await equipWeapon(loader, ch, this.charFile, this.heroWeapon);
    this.mixer = new THREE.AnimationMixer(ch);
    // las animaciones del rig KayKit viven en archivos aparte (mismo Rig_Medium,
    // se enlazan por nombre de hueso). General trae los Idle; Movement el resto.
    const clips = [];
    for (const af of ['char_anims_general.glb', 'char_anims.glb', 'char_anims_melee.glb', 'char_anims_ranged.glb']) {
      try { clips.push(...(await loader.loadAsync('./assets/models/' + af)).animations); }
      catch { /* opcional */ }
    }
    const findClip = (re) => clips.find(c => re.test(c.name));
    const stateMap = { Idle: /^Idle/i, Walk: /^Walking/i, Run: /^Running/i, Jump: /^Jump_Full_Short/i };
    this.actions = {};
    for (const [state, re] of Object.entries(stateMap)) {
      const clip = findClip(re);
      if (clip) this.actions[state] = this.mixer.clipAction(clip);
    }
    // COMBO ARPG: cadena de clips reales por clase (1-2-3, el ultimo = finisher)
    this.comboActions = [];
    for (const cn of comboClips(this.charFile, this.combatStyle)) {
      const c = clips.find(k => k.name === cn);
      if (c) this.comboActions.push(this.mixer.clipAction(plantClip(c)));
    }
    if (!this.comboActions.length) {
      const th = clips.find(k => k.name === 'Throw');
      if (th) this.comboActions.push(this.mixer.clipAction(plantClip(th)));
    }
    this.comboIdx = 0;
    this.comboT = 0;
    // skill Q: clip dramatico propio (jump chop / spin / summon)
    const sClip = clips.find(c => c.name === specialClipName(this.charFile, this.combatStyle));
    if (sClip) this.actions['Special'] = this.mixer.clipAction(plantClip(sClip));
    // reaccion al daño (Hit) + muerte (Death): clips reales del pack
    const hitClip = clips.find(c => c.name === 'Hit_A' || c.name === 'Hit_B');
    if (hitClip) this.actions['Hit'] = this.mixer.clipAction(plantClip(hitClip));
    const deathClip = clips.find(c => c.name === 'Death_A' || c.name === 'Death_B');
    if (deathClip) this.actions['Death'] = this.mixer.clipAction(deathClip);
    this.play('Idle');
  }

  // golpe del combo: cicla los clips de la clase. El ultimo 35% de cada anim es
  // CANCELABLE (attackT corto) = cadencia ARPG; la ventana comboT encadena 1-2-3.
  attack() {
    if (this.locked || this.attackT > 0 || this.dead || !this.comboActions?.length) return false;
    if (this.comboT <= 0) this.comboIdx = 0;   // ventana vencida: reinicia el combo
    this.comboStep = this.comboIdx % this.comboActions.length;
    const a = this.comboActions[this.comboStep];
    this.comboIdx++;
    this.comboT = 1.5;
    if (this.sfx) this.sfx.swing();
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = ATTACK_SPEED;
    this.attackT = (a.getClip().duration / ATTACK_SPEED) * 0.65;
    if (this.cur && this.actions[this.cur]) a.crossFadeFrom(this.actions[this.cur], 0.08, false);
    a.play();
    this.actions['Attack'] = a;   // para que play()/otros crossfades encuentren la actual
    this.cur = 'Attack';
    return true;
  }

  // skill Q: clip dramatico completo (sin cancel), mas lento y con peso
  attackSpecial() {
    const a = this.actions['Special'];
    if (this.locked || this.dead || !a) return this.attack();
    if (this.sfx) this.sfx.swing();
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = 1.25;
    this.attackT = a.getClip().duration / 1.25;
    if (this.cur && this.actions[this.cur] && this.actions[this.cur] !== a) a.crossFadeFrom(this.actions[this.cur], 0.1, false);
    a.play();
    this.actions['Attack'] = a;
    this.cur = 'Attack';
    return true;
  }

  // tambaleo corto al recibir daño (no interrumpe ataque ni muerte)
  playHit() {
    if (this.dead || this.attackT > 0) return;
    // caminar NO se traba por el flinch: si hay tecla de movimiento, no reacciona
    if (this.keys['KeyW'] || this.keys['KeyS'] || this.keys['KeyA'] || this.keys['KeyD']) return;
    const a = this.actions['Hit'];
    if (!a) return;
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = 1.4;
    this.hitT = a.getClip().duration / 1.4;
    if (this.cur && this.actions[this.cur]) a.crossFadeFrom(this.actions[this.cur], 0.08, false);
    a.play();
    this.cur = 'Hit';
  }

  // entra/sale del estado muerto (mantiene la pose de Death mientras dura)
  setDead(v) {
    this.dead = v;
    if (v) {
      const a = this.actions['Death'];
      if (a) {
        a.reset();
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
        a.timeScale = 1;
        if (this.cur && this.actions[this.cur]) a.crossFadeFrom(this.actions[this.cur], 0.15, false);
        a.play();
        this.cur = 'Death';
      }
    } else {
      this.attackT = 0;
      this.hitT = 0;
      // Death quedo clampeada con weight 1 (clampWhenFinished); si no se apaga,
      // se mezcla 50/50 con Idle para siempre y el char queda inclinado (chueco)
      const d = this.actions['Death'];
      if (d) d.stop();
      this.cur = '';
      this.play('Idle');
    }
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
    if (!this.locked) {
      if (this.keys['KeyW']) fwd += 1;
      if (this.keys['KeyS']) fwd -= 1;
      if (this.keys['KeyA']) strafe -= 1;
      if (this.keys['KeyD']) strafe += 1;
    }
    const moving = fwd !== 0 || strafe !== 0;
    if (this.speedBuffT > 0) this.speedBuffT -= dt;
    this._stepDist = this._stepDist || 0;
    let spd = 9.0 * (this.keys['ShiftLeft'] || this.keys['ShiftRight'] ? 2 : 1)
      * (this.speedBuffT > 0 ? (this.speedBuffMult || 1) : 1);
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
    // un auto EN MOVIMIENTO puede invadir al jugador quieto (el blocked() de
    // arriba solo evita entrar): si hay solape, empujarlo fuera del auto
    if (this.pos.y < 1.25) {
      const p = this.city.carPushOut(this.pos.x, this.pos.z, 0.28);
      if (p && !this.city.inRealBuilding(p[0], p[1], 0)) { this.pos.x = p[0]; this.pos.z = p[1]; }
    }
    if (!this.locked && this.keys['Space'] && this.grounded) { this.velY = 8.4; this.grounded = false; }
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
    // la ventana de combo corre SIEMPRE (encadena entre golpes, no solo durante)
    this.comboT -= dt;
    // prioridad de animacion: muerte > ataque > tambaleo > salto > locomocion
    if (this.dead) {
      // mantener la pose de Death; no pisar con nada
    } else if (this.attackT > 0) {
      this.attackT -= dt;   // ataque manda; no pisar con locomocion
    } else if (!this.grounded) {
      this.play('Jump');
    } else if (moving) {
      this.hitT = 0;        // caminar cancela el flinch: el movimiento siempre responde
      this.play(spd > 9 ? 'Run' : 'Walk');
    } else if (this.hitT > 0) {
      this.hitT -= dt;      // el tambaleo de Hit solo se ve quieto
    } else {
      this.play('Idle');
    }
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
