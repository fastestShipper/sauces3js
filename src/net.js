// Multiplayer client: connects to the relay, sends the local player's state
// ~10Hz, and renders every other player (KayKit char + shared walk/idle anim,
// interpolated, with a floating nametag). No prediction — a casual shared world.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { sanitizeImported } from './glbutil.js?v=20260708b';
import { makeNametag } from './nametag.js?v=20260708b';
import { cloneSkinned } from './npcs.js?v=20260708b';
import { equipWeapon, attackClipName, ATTACK_SPEED } from './weapons.js?v=20260708b';
import { showBubble } from './chat.js?v=20260708b';
import { WS_URL } from './rpg/account.js?v=20260708b';

const SCALE = 1.9 / 2.54;

// barra de vida flotante para remotos: sprite canvas actualizable (fill por ratio)
function makeHpBar() {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 20;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(1.35, 0.21, 1);
  sp.position.y = 2.06;      // justo debajo del nametag (2.35)
  sp.renderOrder = 998;
  const draw = (hp, hpMax) => {
    const c = cv.getContext('2d');
    c.clearRect(0, 0, 128, 20);
    c.fillStyle = 'rgba(12,10,24,0.8)';
    c.roundRect(2, 4, 124, 12, 6); c.fill();
    const ratio = Math.max(0, Math.min(1, hp / Math.max(1, hpMax)));
    if (ratio > 0) {
      c.fillStyle = ratio > 0.5 ? '#5fd18a' : ratio > 0.25 ? '#ffcf5c' : '#ff5a48';
      c.roundRect(4, 6, 120 * ratio, 8, 4); c.fill();
    }
    tex.needsUpdate = true;
  };
  draw(1, 1);
  return { sprite: sp, draw };
}

export class Net {
  constructor(scene, player, token) {
    this.scene = scene;
    this.player = player;
    this.token = token || null;   // ata la conexion de juego a la cuenta (para guardar)
    this.combat = null;           // lo setea app.js: fuente de hp/hpMax local
    this.remotes = new Map();   // id -> {root, mixer, walkA, idleA, x,z,rot, tx,tz,th, anim, walking, ready}
    this.protos = {};           // charFile -> gltf
    this.loader = new GLTFLoader();
    this.clips = [];
    this.acc = 0;
    this.onChat = null;   // (name, text) -> pintar en el log (lo setea app.js)
    // ===== mobs compartidos (el server es dueno) + party =====
    this.myId = null;        // id de conexion de este jugador (del mensaje {t:'id'})
    this.mobs = new Map();   // mobId -> { id, x, z, h, state, lvl, hp, hpMax, kind }
    this.party = [];         // [{id, name}] miembros de mi party
    this.onMobsSnapshot = null;  // (list) -> el MobField crea los visuales
    this.onMobHp = null;         // (id, hp)
    this.onMobMove = null;       // (mob)
    this.onMobDead = null;       // (id, by, party)
    this.onMobSpawn = null;      // (mob)
    this.onMobKilled = null;     // (id, by, party) -> el combate da XP (canal aparte del render visual)
    this.onPlayerHit = null;     // ({ id, dmg, hp }) -> dano server-side al jugador
    this.onWave = null;          // ({ x, z }) -> banner de oleada zombie
    this.onParty = null;         // (members)
    this.onPartyInvited = null;  // (fromId, name)
    // ===== PvP + friends =====
    this.onPvpHit = null;        // ({ from, name, dmg }) -> me pego otro jugador
    this.onPvpKill = null;       // (killerName, victimName) -> kill feed
    this.onPvpSafe = null;       // () -> intente pegar en zona segura
    this.friends = [];           // [{user, online, id}]
    this.friendsGuest = false;   // true si el server dijo "sin cuenta"
    this.onFriends = null;       // (friends, guest)
    this.onFriendReq = null;     // (fromId, name, user)
    this.onFriendErr = null;     // (error)
    addEventListener('mousedown', (e) => {
      if (e.button === 0 && this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'atk' }));
    });
    this._init();
  }

  async _init() {
    for (const af of ['char_anims_general.glb', 'char_anims.glb', 'char_anims_melee.glb', 'char_anims_ranged.glb']) {
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
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hi', name: this.player.name || 'Anon', char: this.player.charFile, token: this.token }));
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } this._onMsg(m); };
    ws.onclose = () => { this.ws = null; setTimeout(() => this._connect(), 3000); };  // reconexion
    ws.onerror = () => {};
  }

  _onMsg(m) {
    if (m.t === 'roster') { for (const p of m.players) this._spawn(p); }
    else if (m.t === 'join') this._spawn(m);
    else if (m.t === 's') {
      const r = this.remotes.get(m.id);
      if (r) {
        r.tx = m.x; r.tz = m.z; r.th = m.h; r.anim = m.a;
        if (Number.isFinite(m.hp) && (r.hp !== m.hp || r.hpMax !== m.hm)) {
          r.hp = m.hp; r.hpMax = m.hm || 100;
          if (r.hpBar) r.hpBar.draw(r.hp, r.hpMax);
        }
      }
    }
    else if (m.t === 'atk') { const r = this.remotes.get(m.id); if (r) this._remoteAttack(r); }
    else if (m.t === 'leave') { const r = this.remotes.get(m.id); if (r) { this.scene.remove(r.root); this.remotes.delete(m.id); } }
    else if (m.t === 'chat') {
      if (this.onChat) this.onChat(m.name, m.text);
      const r = this.remotes.get(m.id);
      if (r && r.ready) showBubble(r.root, m.text, r);   // burbuja sobre el remoto
    }
    else if (m.t === 'id') { this.myId = m.id; }
    else if (m.t === 'mobs') {
      this.mobs.clear();
      for (const mob of (m.list || [])) this.mobs.set(mob.id, mob);
      if (this.onMobsSnapshot) this.onMobsSnapshot(m.list || []);
    }
    else if (m.t === 'mhp') {
      const mob = this.mobs.get(m.id); if (mob) mob.hp = m.hp;
      if (this.onMobHp) this.onMobHp(m.id, m.hp);
    }
    else if (m.t === 'mpos') {
      for (const patch of (m.list || [])) {
        const mob = this.mobs.get(patch.id);
        if (!mob) continue;
        Object.assign(mob, patch);
        if (this.onMobMove) this.onMobMove(mob);
      }
    }
    else if (m.t === 'phit') {
      if (this.onPlayerHit) this.onPlayerHit({ id: m.id, dmg: m.dmg, hp: m.hp });
    }
    else if (m.t === 'mdead') {
      if (this.onMobDead) this.onMobDead(m.id, m.by, m.party || []);
      if (this.onMobKilled) this.onMobKilled(m.id, m.by, m.party || []);
      this.mobs.delete(m.id);
    }
    else if (m.t === 'mspawn') {
      if (m.mob) { this.mobs.set(m.mob.id, m.mob); if (this.onMobSpawn) this.onMobSpawn(m.mob); }
    }
    else if (m.t === 'pinvited') { if (this.onPartyInvited) this.onPartyInvited(m.from, m.name); }
    else if (m.t === 'party') {
      this.party = m.members || [];
      if (this.onParty) this.onParty(this.party);
    }
    else if (m.t === 'wave') { if (this.onWave) this.onWave({ x: m.x, z: m.z }); }
    else if (m.t === 'pvph') { if (this.onPvpHit) this.onPvpHit({ from: m.from, name: m.name, dmg: m.dmg }); }
    else if (m.t === 'pvpkill') { if (this.onPvpKill) this.onPvpKill(m.killer, m.victim); }
    else if (m.t === 'pvpsafe') { if (this.onPvpSafe) this.onPvpSafe(); }
    else if (m.t === 'flist') {
      this.friends = m.friends || [];
      this.friendsGuest = !!m.guest;
      if (this.onFriends) this.onFriends(this.friends, this.friendsGuest);
    }
    else if (m.t === 'freqin') { if (this.onFriendReq) this.onFriendReq(m.from, m.name, m.user); }
    else if (m.t === 'ferr') { if (this.onFriendErr) this.onFriendErr(m.error); }
  }

  // envia un mensaje de chat al relay (el server lo reenvia con el nombre)
  sendChat(text) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'chat', text }));
  }

  // guarda el progreso del personaje en la cuenta (el server valida y persiste)
  save(char) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'save', char }));
  }

  // ===== acciones de mobs / party / pvp / friends hacia el server =====
  _send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }
  attackMob(id, dmg) { this._send({ t: 'mhit', id, dmg }); }
  invite(to) { this._send({ t: 'pinvite', to }); }
  accept(from) { this._send({ t: 'paccept', from }); }
  leaveParty() { this._send({ t: 'pleave' }); }
  attackPlayer(to, dmg) { this._send({ t: 'pvp', to, dmg }); }
  pvpDead(by) { this._send({ t: 'pvpdead', by }); }
  friendList() { this._send({ t: 'flist' }); }
  friendReq(to) { this._send({ t: 'freq', to }); }
  friendAcc(from) { this._send({ t: 'facc', from }); }

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
    // defensa en profundidad: char remoto se usa como ruta de asset -> solo
    // archivos conocidos aunque el relay este comprometido o sea viejo
    const CHAR_OK = ['char_knight.glb', 'char_mage.glb', 'char_ranger.glb', 'char_rogue_hooded.glb', 'char_cernunnos.glb'];
    const charFile = CHAR_OK.includes(p.char) ? p.char : 'char_knight.glb';
    const r = {
      x: p.x || 0, z: p.z || 0, rot: p.h || 0, tx: p.x || 0, tz: p.z || 0, th: p.h || 0,
      anim: p.a || 'Idle', root: new THREE.Group(), ready: false, walking: false,
      name: p.name || 'Vecino',
    };
    r.root.position.set(r.x, 0, r.z);
    this.scene.add(r.root);
    this.remotes.set(p.id, r);   // reservar el id antes del await (evita doble spawn)
    const proto = await this._proto(charFile);
    if (!proto || !this.remotes.has(p.id)) return;
    const ch = cloneSkinned(proto.scene);
    ch.scale.setScalar(SCALE);
    ch.traverse(o => { if (o.isMesh) o.castShadow = true; });
    r.root.add(ch);
    if (p.name) r.root.add(makeNametag(p.name));
    r.hp = Number.isFinite(p.hp) ? p.hp : 100;
    r.hpMax = Number.isFinite(p.hm) && p.hm > 0 ? p.hm : 100;
    r.hpBar = makeHpBar();
    r.hpBar.draw(r.hp, r.hpMax);
    r.root.add(r.hpBar.sprite);
    await equipWeapon(this.loader, ch, charFile);   // arma de clase
    r.mixer = new THREE.AnimationMixer(ch);
    if (this.walkClip) r.walkA = r.mixer.clipAction(this.walkClip);
    r.idleA = this.idleClip ? r.mixer.clipAction(this.idleClip) : r.walkA;
    const aClip = this.clips.find(c => c.name === attackClipName(charFile));
    if (aClip) {
      // plantar el ataque: quitar root motion (root/hips.position) como en el jugador
      const planted = aClip.clone();
      planted.tracks = planted.tracks.filter(t => t.name !== 'root.position' && t.name !== 'hips.position');
      r.attackA = r.mixer.clipAction(planted);
    }
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
        hp: this.combat ? Math.round(this.combat.hp) : 100,
        hm: this.combat ? Math.round(this.combat.hpMax) : 100,
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
