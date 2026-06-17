// Multiplayer client: connects to the relay, sends the local player's state
// ~10Hz, and renders every other player (KayKit char + shared walk/idle anim,
// interpolated, with a floating nametag). No prediction — a casual shared world.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { sanitizeImported } from './glbutil.js?v=20260616b';
import { makeNametag } from './nametag.js?v=20260616b';
import { cloneSkinned } from './npcs.js?v=20260616b';
import { equipWeapon, attackClipName, ATTACK_SPEED } from './weapons.js?v=20260616b';

const WS_URL = 'wss://sauces.controla.group/ws';   // server unico (sirve tambien en dev local)
const SCALE = 1.9 / 2.54;

export class Net {
  constructor(scene, player) {
    this.scene = scene;
    this.player = player;
    this.remotes = new Map();   // id -> {root, mixer, walkA, idleA, x,z,rot, tx,tz,th, anim, walking, ready}
    this.protos = {};           // charFile -> gltf
    this.loader = new GLTFLoader();
    this.clips = [];
    this.acc = 0;
    addEventListener('mousedown', (e) => {
      if (e.button === 0 && this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'atk' }));
    });
    this._init();
  }

  async _init() {
    for (const af of ['char_anims_general.glb', 'char_anims.glb']) {
      try { this.clips.push(...(await this.loader.loadAsync('./assets/models/' + af)).animations); } catch { /* opcional */ }
    }
    this.walkClip = this.clips.find(c => c.name === 'Walking_A') || this.clips.find(c => /walk/i.test(c.name));
    this.idleClip = this.clips.find(c => c.name === 'Idle_A') || this.walkClip;
    this._connect();
  }

  _connect() {
    let ws;
    try { ws = new WebSocket(WS_URL); } catch { return; }
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hi', name: this.player.name || 'Anon', char: this.player.charFile }));
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } this._onMsg(m); };
    ws.onclose = () => { this.ws = null; setTimeout(() => this._connect(), 3000); };  // reconexion
    ws.onerror = () => {};
  }

  _onMsg(m) {
    if (m.t === 'roster') { for (const p of m.players) this._spawn(p); }
    else if (m.t === 'join') this._spawn(m);
    else if (m.t === 's') { const r = this.remotes.get(m.id); if (r) { r.tx = m.x; r.tz = m.z; r.th = m.h; r.anim = m.a; } }
    else if (m.t === 'atk') { const r = this.remotes.get(m.id); if (r) this._remoteAttack(r); }
    else if (m.t === 'leave') { const r = this.remotes.get(m.id); if (r) { this.scene.remove(r.root); this.remotes.delete(m.id); } }
  }

  // dispara el ataque one-shot de un remoto (clip real, corta walk/idle)
  _remoteAttack(r) {
    if (!r.ready || !r.attackA || r.attackT > 0) return;
    r.attacking = true;
    if (r.walkA) r.walkA.stop();
    if (r.idleA) r.idleA.stop();
    r.walking = false;
    r.attackA.reset();
    r.attackA.setLoop(THREE.LoopOnce, 1);
    r.attackA.clampWhenFinished = true;
    r.attackA.timeScale = ATTACK_SPEED;
    r.attackT = r.attackA.getClip().duration / ATTACK_SPEED;
    r.attackA.play();
  }

  async _proto(charFile) {
    if (!this.protos[charFile]) {
      try { const g = await this.loader.loadAsync('./assets/models/' + charFile); sanitizeImported(g.scene); this.protos[charFile] = g; }
      catch { return null; }
    }
    return this.protos[charFile];
  }

  async _spawn(p) {
    if (this.remotes.has(p.id)) return;
    const r = {
      x: p.x || 0, z: p.z || 0, rot: p.h || 0, tx: p.x || 0, tz: p.z || 0, th: p.h || 0,
      anim: p.a || 'Idle', root: new THREE.Group(), ready: false, walking: false,
    };
    r.root.position.set(r.x, 0, r.z);
    this.scene.add(r.root);
    this.remotes.set(p.id, r);   // reservar el id antes del await (evita doble spawn)
    const proto = await this._proto(p.char || 'char_knight.glb');
    if (!proto || !this.remotes.has(p.id)) return;
    const ch = cloneSkinned(proto.scene);
    ch.scale.setScalar(SCALE);
    ch.traverse(o => { if (o.isMesh) o.castShadow = true; });
    r.root.add(ch);
    if (p.name) r.root.add(makeNametag(p.name));
    await equipWeapon(this.loader, ch, p.char || 'char_knight.glb');   // arma de clase
    r.mixer = new THREE.AnimationMixer(ch);
    if (this.walkClip) r.walkA = r.mixer.clipAction(this.walkClip);
    r.idleA = this.idleClip ? r.mixer.clipAction(this.idleClip) : r.walkA;
    const aClip = this.clips.find(c => c.name === attackClipName(p.char || 'char_knight.glb'));
    if (aClip) r.attackA = r.mixer.clipAction(aClip);
    r.attackT = 0; r.attacking = false;
    if (r.idleA) r.idleA.play();
    r.ready = true;
  }

  update(dt, player) {
    // mandar estado local ~10Hz
    this.acc += dt;
    if (this.ws && this.ws.readyState === 1 && this.acc > 0.1) {
      this.acc = 0;
      this.ws.send(JSON.stringify({
        t: 's', x: +player.pos.x.toFixed(2), z: +player.pos.z.toFixed(2),
        h: +player.heading.toFixed(2), a: player.cur || 'Idle',
      }));
    }
    // interpolar remotos
    for (const r of this.remotes.values()) {
      if (!r.ready) continue;
      const dx = r.tx - r.x, dz = r.tz - r.z;
      const moving = (dx * dx + dz * dz) > 0.0009;
      r.x += dx * Math.min(1, dt * 10);
      r.z += dz * Math.min(1, dt * 10);
      r.root.position.set(r.x, 0, r.z);
      let drot = ((r.th - r.rot + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      r.rot += drot * Math.min(1, dt * 8);
      r.root.rotation.y = r.rot;
      if (r.attacking) {
        r.attackT -= dt;
        if (r.attackT <= 0) {                       // fin del ataque: resync locomocion
          r.attacking = false;
          if (r.attackA) r.attackA.stop();
          if (r.idleA) r.idleA.reset().play();
          r.walking = false;
        }
      } else {
        const wantWalk = moving || r.anim === 'Walk' || r.anim === 'Run';
        if (r.walkA) {
          if (wantWalk && !r.walking) { if (r.idleA) r.idleA.stop(); r.walkA.play(); r.walking = true; }
          else if (!wantWalk && r.walking) { r.walkA.stop(); if (r.idleA) r.idleA.play(); r.walking = false; }
        }
      }
      r.mixer.update(dt);
    }
  }
}
