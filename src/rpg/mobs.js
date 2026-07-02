// MobField: renderiza los MOBS que el SERVER posee (vista pura, sin logica).
// El server decide HP, spawn y muerte; este modulo solo dibuja esqueletos KayKit
// (Mage/Minion/Rogue/Warrior), billboardea sus barras de vida y reproduce los
// clips empaquetados (Idle, Hit_A, Death_A, Spawn_Ground) que vienen en el GLB.
//
// El GLB kaykit_skeletons.glb trae 4 rigs (Rig_Mage/Rig_Minion/Rig_Rogue/
// Rig_Warrior) con sus partes skinned y los clips de animacion. Los huesos calzan
// con el Rig_Medium del proyecto (41 joints) por NOMBRE, asi que los clips manejan
// cualquiera de los 4 esqueletos.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { sanitizeImported } from '../glbutil.js?v=20260701e';

const SCALE = 1.9 / 2.54;          // rig KayKit (~2.54u) escalado a ~1.9m como los jugadores
const HP_W = 1.5;                  // ancho de la barra de vida (u)
const HP_H = 0.16;                 // alto de la barra de vida (u)
const HP_Y = 2.5;                  // altura de la barra sobre el piso (u)
const DEATH_HOLD = 1.2;            // s que dura la pose de muerte antes de quitar el visual
const HIT_SPEED = 1.4;             // acelera el clip de impacto para que sea snappy

// kind % 4 -> tipo de esqueleto. El server manda kind; el cliente solo lo mapea a un look.
const KIND_TO_TYPE = ['Minion', 'Rogue', 'Warrior', 'Mage'];

// Tinte por nivel para que la horda no se vea uniforme. Niveles altos viran a rojizo.
function levelTint(lvl) {
  const t = Math.min(1, Math.max(0, (lvl || 1) / 30));
  return new THREE.Color().setHSL(0.58 - 0.58 * t, 0.18 + 0.25 * t, 0.95 - 0.12 * t);
}

// Barra de vida flotante: fondo oscuro + relleno verde. Dos planos apilados dentro
// de un grupo que luego se billboardea hacia la camara en update().
function makeHpBar() {
  const group = new THREE.Group();
  group.position.y = HP_Y;
  const bgGeo = new THREE.PlaneGeometry(HP_W, HP_H);
  const bg = new THREE.Mesh(bgGeo, new THREE.MeshBasicMaterial({ color: 0x14161c, depthTest: false, transparent: true, opacity: 0.85 }));
  bg.renderOrder = 998;
  const fillGeo = new THREE.PlaneGeometry(HP_W, HP_H);
  const fill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: 0x46d35a, depthTest: false, transparent: true }));
  fill.position.z = 0.001;         // delante del fondo para evitar z-fighting
  fill.renderOrder = 999;
  group.add(bg);
  group.add(fill);
  return { group, fill };
}

// Ajusta el relleno de la barra al ratio hp/hpMax. El plano se ancla a la izquierda
// (escala desde el centro + corrimiento) y vira de verde a rojo segun la salud.
function setHpFill(bar, ratio) {
  const r = Math.min(1, Math.max(0, ratio));
  bar.fill.scale.x = r || 0.0001;             // evitar escala 0 (degenera la matriz)
  bar.fill.position.x = -HP_W * 0.5 * (1 - r);
  bar.fill.material.color.setHSL(0.33 * r, 0.7, 0.5);
}

// Anillo plano de seleccion bajo el mob, oculto hasta que se le apunta.
function makeRing() {
  const geo = new THREE.RingGeometry(0.7, 0.92, 28);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = -Math.PI / 2;             // acostado en el piso
  ring.position.y = 0.02;
  ring.visible = false;
  ring.renderOrder = 1;
  return ring;
}

export class MobField {
  constructor(scene, getCamera, net) {
    this.scene = scene;
    this.getCamera = getCamera;
    this.net = net;
    this.loader = new GLTFLoader();
    // el GLB de esqueletos viene comprimido con Draco: hay que darle el decoder
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
    this.loader.setDRACOLoader(draco);
    this.protos = {};        // 'Minion' -> { scene (solo ese rig), clips }
    this.clips = [];         // clips compartidos del GLB
    this.mobs = new Map();   // id -> visual del mob
    this.dying = [];         // [{ id, t }] mobs en su ventana de muerte antes de quitarse
    this.ready = false;
  }

  async load() {
    let gltf;
    try {
      gltf = await this.loader.loadAsync('./assets/models/kaykit_skeletons.glb');
    } catch {
      return;   // sin GLB no hay vista de mobs, pero el resto del juego sigue
    }
    sanitizeImported(gltf.scene);
    this.clips = gltf.animations || [];
    // prototipo LIMPIO por tipo: clonar la escena entera con SkeletonUtils (rebind
    // correcto de los skinned) y QUITAR los subarboles de los otros 3 tipos. Un
    // child.clone(true) ingenuo comparte/rompe el skeleton (hueso undefined) y
    // revienta el render con "Cannot read matrixWorld of undefined".
    for (const type of KIND_TO_TYPE) {
      const full = cloneSkeleton(gltf.scene);
      const keep = full.children.filter((c) => this._belongsTo(c, type));
      const drop = full.children.filter((c) => !this._belongsTo(c, type));
      for (const c of drop) full.remove(c);
      // los huesos traen sufijo del merge (root_1, hips_2...) pero las pistas de los
      // clips usan el nombre BASE (root, hips). Normalizamos para que el mixer matchee
      // por nombre y los esqueletos animen (sin esto quedan en T-pose).
      full.traverse((o) => { if (o.isBone) o.name = o.name.replace(/_\d+$/, ''); });
      this.protos[type] = keep.length ? full : null;
    }
    this._hook();
    this.ready = true;
    // si el snapshot llego antes de cargar, materializarlo ahora
    if (this.net && this.net.mobs && this.net.mobs.size) {
      for (const mob of this.net.mobs.values()) this._createMob(mob);
    }
  }

  // un nodo pertenece a un tipo si su nombre (o el de un descendiente) lo nombra.
  // Rig_Mage / Skeleton_Mage_Body -> 'Mage', etc.
  _belongsTo(node, type) {
    let hit = false;
    node.traverse(o => { if (o.name && o.name.indexOf(type) !== -1) hit = true; });
    return hit;
  }

  // engancha los callbacks que el cliente de red expone. Defensivo: si el net no
  // los provee (otra version), simplemente no se suscribe.
  _hook() {
    const net = this.net;
    if (!net) return;
    // ASIGNAR los callbacks (net los LLAMA), no llamarlos.
    net.onMobsSnapshot = (list) => this._onSnapshot(list);
    net.onMobHp = (id, hp) => this._onHp(id, hp);
    net.onMobMove = (mob) => this._onMove(mob);
    net.onMobDead = (id, by, party) => this._onDead(id, by, party);
    net.onMobSpawn = (mob) => this._onSpawn(mob);
  }

  // snapshot completo: crea el visual de cada mob que aun no existe.
  _onSnapshot(list) {
    if (!Array.isArray(list)) return;
    for (const mob of list) this._createMob(mob);
  }

  _onSpawn(mob) {
    const v = this._createMob(mob);
    if (v) this._playOnce(v, 'Spawn_Ground');   // animacion de aparicion si existe
  }

  // construye el Object3D + mixer + barra de vida de un mob. Idempotente por id.
  _createMob(mob) {
    if (!this.ready || !mob || mob.id == null) return null;
    if (this.mobs.has(mob.id)) return this.mobs.get(mob.id);
    const type = KIND_TO_TYPE[((mob.kind | 0) % 4 + 4) % 4];
    const proto = this.protos[type] || this.protos.Minion;
    if (!proto) return null;
    const root = new THREE.Group();
    root.position.set(mob.x || 0, 0, mob.z || 0);
    // clonar el esqueleto skinned correctamente: un .clone() ingenuo comparte el
    // skeleton y rompe la deformacion. SkeletonUtils.clone hace deep-clone real.
    let ch;
    try { ch = cloneSkeleton(proto); }
    catch { return null; }
    ch.scale.setScalar(SCALE);
    const tint = levelTint(mob.lvl);
    ch.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true;
      // tinte por nivel: clonar el material para no pintar el prototipo compartido
      if (o.material && o.material.color) {
        o.material = o.material.clone();
        o.material.color.multiply(tint);
      }
    });
    root.add(ch);
    const bar = makeHpBar();
    setHpFill(bar, (mob.hp != null && mob.hpMax) ? mob.hp / mob.hpMax : 1);
    root.add(bar.group);
    const ring = makeRing();
    root.add(ring);
    this.scene.add(root);
    // mixer con Idle en loop por defecto
    const mixer = new THREE.AnimationMixer(ch);
    const actions = {};
    const bind = (name) => {
      const clip = this.clips.find(c => c.name === name);
      return clip ? mixer.clipAction(clip) : null;
    };
    actions.Idle = bind('Idle') || bind('Idle_B');
    actions.Walk = bind('Walking_A') || bind('Walk') || bind('Run');
    actions.Hit = bind('Hit_A') || bind('Hit_B');
    actions.Death = bind('Death_A') || bind('Death_B');
    actions.Spawn_Ground = bind('Spawn_Ground');
    if (actions.Idle) actions.Idle.play();
    const v = {
      id: mob.id, root, ch, mixer, actions, bar, ring,
      hp: mob.hp != null ? mob.hp : (mob.hpMax || 1),
      hpMax: mob.hpMax || mob.hp || 1,
      tx: mob.x || 0, tz: mob.z || 0, th: mob.h || 0, state: mob.state || 'idle',
      busyT: 0, dead: false,
    };
    this.mobs.set(mob.id, v);
    return v;
  }

  // recibo de daño: actualiza la barra y dispara Hit_A (one-shot, vuelve a Idle).
  _onHp(id, hp) {
    const v = this.mobs.get(id);
    if (!v) return;
    v.hp = hp;
    setHpFill(v.bar, v.hpMax ? hp / v.hpMax : 0);
    if (!v.dead) this._playOnce(v, 'Hit', HIT_SPEED);
  }

  // movimiento/state server-side: el render interpola hacia tx/tz y rota al heading.
  _onMove(mob) {
    const v = this.mobs.get(mob && mob.id);
    if (!v || v.dead) return;
    v.tx = Number.isFinite(mob.x) ? mob.x : v.tx;
    v.tz = Number.isFinite(mob.z) ? mob.z : v.tz;
    v.th = Number.isFinite(mob.h) ? mob.h : v.th;
    v.state = mob.state || 'idle';
  }

  // muerte: Death_A clampeado y agenda el retiro del visual tras DEATH_HOLD.
  _onDead(id /*, by, party */) {
    const v = this.mobs.get(id);
    if (!v || v.dead) return;
    v.dead = true;
    v.busyT = 0;
    if (v.ring) v.ring.visible = false;
    if (v.bar && v.bar.group) v.bar.group.visible = false;
    const a = v.actions.Death;
    if (a) {
      try {
        for (const k in v.actions) { if (v.actions[k] && v.actions[k] !== a) v.actions[k].stop(); }
        a.reset();
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
        a.timeScale = 1;
        a.play();
      } catch { /* clip corrupto: igual se retira */ }
    }
    this.mobs.delete(id);              // ya no es "vivo" para meshes()/picking
    this.dying.push({ v, t: DEATH_HOLD });
  }

  // reproduce un clip one-shot y deja que update() lo deje volver a Idle.
  _playOnce(v, name, speed) {
    const a = v.actions[name];
    if (!a || v.dead) return;
    try {
      if (v.actions.Idle) v.actions.Idle.stop();
      a.reset();
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = false;
      a.timeScale = speed || 1;
      a.play();
      v.busyT = a.getClip().duration / (speed || 1);
    } catch { /* nunca tirar desde un callback de red */ }
  }

  update(dt) {
    const cam = this.getCamera ? this.getCamera() : null;
    // mobs vivos: avanzar mixer, billboardear barra, volver a Idle al terminar one-shots
    for (const v of this.mobs.values()) {
      v.root.position.x += (v.tx - v.root.position.x) * Math.min(1, dt * 9);
      v.root.position.z += (v.tz - v.root.position.z) * Math.min(1, dt * 9);
      if (Number.isFinite(v.th)) v.root.rotation.y = v.th;
      if (v.busyT > 0) {
        v.busyT -= dt;
        if (v.busyT <= 0 && v.actions.Idle) { try { v.actions.Idle.reset().play(); v.walking = false; } catch {} }
      } else if (v.actions.Walk && v.actions.Idle) {
        const moving = v.state === 'walk';
        if (moving && !v.walking) {
          try { v.actions.Idle.stop(); v.actions.Walk.reset().play(); } catch {}
          v.walking = true;
        } else if (!moving && v.walking) {
          try { v.actions.Walk.stop(); v.actions.Idle.reset().play(); } catch {}
          v.walking = false;
        }
      }
      if (v.mixer) { try { v.mixer.update(dt); } catch {} }
      if (cam && v.bar && v.bar.group) v.bar.group.quaternion.copy(cam.quaternion);
    }
    // mobs muriendo: terminar la pose y retirarlos al expirar el temporizador
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      if (d.v.mixer) { try { d.v.mixer.update(dt); } catch {} }
      d.t -= dt;
      if (d.t <= 0) {
        this.scene.remove(d.v.root);
        this.dying.splice(i, 1);
      }
    }
  }

  // roots de los mobs vivos (para raycaster.intersectObjects(..., true) del click)
  meshes() {
    const out = [];
    for (const v of this.mobs.values()) out.push(v.root);
    return out;
  }

  // dado el array de intersecciones del raycaster, sube por el padre hasta el root
  // del mob y devuelve su estado de red {id,x,z,...} (o null).
  pickFromIntersections(intersects) {
    if (!intersects || !intersects.length) return null;
    const roots = new Map();
    for (const v of this.mobs.values()) roots.set(v.root, v.id);
    for (const hit of intersects) {
      let o = hit.object;
      while (o) {
        if (roots.has(o)) {
          const id = roots.get(o);
          if (this.net && this.net.mobs && this.net.mobs.get) {
            const m = this.net.mobs.get(id);
            if (m) return m;
          }
          return { id };
        }
        o = o.parent;
      }
    }
    return null;
  }

  // objeto visual de un mob por id (o null)
  get(id) {
    return this.mobs.get(id) || null;
  }

  // muestra/oculta el anillo de seleccion bajo un mob
  setTargeted(id, on) {
    for (const v of this.mobs.values()) {
      if (v.ring) v.ring.visible = !!on && v.id === id;
    }
  }
}
