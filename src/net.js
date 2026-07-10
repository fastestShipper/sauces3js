// Multiplayer client: connects to the relay, sends the local player's state
// ~10Hz, and renders every other player (KayKit char + shared walk/idle anim,
// interpolated, with a floating nametag). No prediction — a casual shared world.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { sanitizeImported } from './glbutil.js?v=20260709g41';
import { composeCharacter } from './rpg/charcustom.js?v=20260709g41';
import { CLASS_LIST, CERNUNNOS } from './rpg/classes.js?v=20260709g41';

// spec de heroe a partir del charFile del remoto (para paleta/piezas)
function classByChar(charFile) {
  if (charFile === CERNUNNOS.char) return CERNUNNOS;
  return CLASS_LIST.find((c) => c.char === charFile) || CLASS_LIST[0];
}
import { makeNametag } from './nametag.js?v=20260709g41';
import { cloneSkinned } from './npcs.js?v=20260709g41';
import { equipWeapon, attackClipName, comboClips, ATTACK_SPEED, attackFollowupClipName, attackReleaseDelay } from './weapons.js?v=20260709g41';
import { showBubble } from './chat.js?v=20260709g41';
import { WS_URL } from './rpg/account.js?v=20260709g41';
import { combatActionWindows, SKILL_TYPES, skillAnimSpeed, skillClipCandidates, skillFollowupClipCandidates, skillReleaseDelay, skillUsesHeavyWindow } from './animmap.js?v=20260709g41';
import { plantClip } from './animclip.js?v=20260709g41';

const SCALE = 1.9 / 2.54;
const REMOTE_DODGE_SPEED = 1.65;
const REMOTE_HIT_SPEED_LIGHT = 1.65;
const REMOTE_HIT_SPEED_HEAVY = 1.12;
const REMOTE_HEAVY_HIT_RATIO = 0.16;
const REMOTE_DEATH_SPEED = 1.0;
const REMOTE_HIT_PULSE_TIME = 0.16;
const REMOTE_HIT_PULSE_DIST = 0.16;
const REMOTE_HEAVY_HIT_PULSE_TIME = 0.2;
const REMOTE_HEAVY_HIT_PULSE_DIST = 0.24;
const REMOTE_DODGE_TRAIL_MIN = 0.28;
const REMOTE_DODGE_TRAIL_LEN = 2.35;
const REMOTE_MIXER_DT_CAP = 0.14;
const REMOTE_ATTACK_QUEUE_T = 0.62;
const REMOTE_ATTACK_SPEED_MULT_MIN = 0.75;
const REMOTE_ATTACK_SPEED_MULT_MAX = 1.5;
const REMOTE_METEOR_IMPACT_DELAY = 0.32;
const REMOTE_BODY_LEAN_MAX = 0.14;
const REMOTE_ACTION_BLEND = 0.08;
const REMOTE_LOCOMOTION_BLEND = 0.12;
const REMOTE_ACTION_STOP_PAD = 0.035;
const REMOTE_PROJECTILE_BY_CHAR = {
  'char_mage.glb': 'fireball',
  'char_cernunnos.glb': 'magic',
  'char_ranger.glb': 'arrow',
};
const REMOTE_MELEE_SKILL_TYPES = new Set(['strike', 'stab', 'execute', 'spin', 'bladedance', 'leap']);
const REMOTE_SELF_AREA_SKILLS = new Set(['spin', 'bladedance', 'nova', 'warcry', 'partybuff', 'partyhaste', 'partyshield']);
const REMOTE_HEAL_SKILLS = new Set(['partyheal', 'heal', 'veil']);
const REMOTE_SKILL_PROJECTILE = {
  fireball: 'fireball',
  pierce: 'arrow',
  bolt: 'magic',
  volley: 'arrow',
};
const REMOTE_AREA_RADIUS = {
  spin: 4,
  bladedance: 4,
  nova: 4.5,
  leap: 5,
  fireball: 3.5,
  rain: 5,
  storm: 5,
  meteor: 7,
  warcry: 3,
  partybuff: 3,
  partyhaste: 3,
  partyshield: 3,
};

function normAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function dashDirectionKey(dx, dz, facing) {
  if (!Number.isFinite(dx) || !Number.isFinite(dz) || Math.hypot(dx, dz) < 0.01) return 'Forward';
  const diff = normAngle(Math.atan2(dx, dz) - (Number.isFinite(facing) ? facing : Math.atan2(dx, dz)));
  if (Math.abs(diff) > 2.35) return 'Backward';
  if (diff > 0.78) return 'Right';
  if (diff < -0.78) return 'Left';
  return 'Forward';
}

const DODGE_KEYS = new Set(['Forward', 'Backward', 'Left', 'Right']);
function cleanDodgeKey(value) {
  const key = String(value || '');
  return DODGE_KEYS.has(key) ? key : '';
}

function remoteIsRanged(r) {
  return !!REMOTE_PROJECTILE_BY_CHAR[r?.charFile];
}

function remoteDodgeVector(r, key = 'Forward') {
  const h = Number.isFinite(r?.th) ? r.th : (Number.isFinite(r?.rot) ? r.rot : 0);
  if (key === 'Backward') return [-Math.sin(h), -Math.cos(h)];
  if (key === 'Left') return [-Math.cos(h), Math.sin(h)];
  if (key === 'Right') return [Math.cos(h), -Math.sin(h)];
  return [Math.sin(h), Math.cos(h)];
}

function remoteMixerStepForDistance(d, active, mobile, lowEnd) {
  if (!Number.isFinite(d)) return 0;
  const near = active ? (mobile ? 18 : 34) : (mobile ? 14 : 24);
  const mid = active ? (mobile ? 34 : 64) : (mobile ? 28 : 52);
  if (d < near) return 0;
  if (d < mid) return active ? 0 : (lowEnd ? 1 / 18 : 1 / 24);
  if (active) return 1 / 24;
  return lowEnd ? 1 / 10 : 1 / 12;
}

function advanceRemoteMixer(r, dt, step) {
  if (!r || !r.mixer) return;
  try {
    if (!step || step <= dt * 1.25) {
      r.mixer.update(dt);
      r.mixAcc = 0;
      return;
    }
    r.mixAcc = (r.mixAcc || 0) + dt;
    if (r.mixAcc < step) return;
    const adv = Math.min(REMOTE_MIXER_DT_CAP, step);
    r.mixAcc = Math.max(0, r.mixAcc - step);
    r.mixer.update(adv);
  } catch { /* mixer remoto defensivo: no romper el loop */ }
}

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
  constructor(scene, player, token, opts = {}) {
    this.scene = scene;
    this.player = player;
    this.token = token || null;   // ata la conexion de juego a la cuenta (para guardar)
    this.assetVersion = opts.assetVersion || '';
    this.combat = null;           // lo setea app.js: fuente de hp/hpMax local
    this.effects = opts.effects || null; // opcional: feedback visual compartido
    this.remotes = new Map();   // id -> {root, mixer, walkA, idleA, x,z,rot, tx,tz,th, anim, walking, ready}
    this.protos = {};           // charFile -> gltf
    this.loader = new GLTFLoader();
    this.clips = [];
    this.acc = 0;
    this.onChat = null;   // (name, text) -> pintar en el log (lo setea app.js)
    // ===== mobs compartidos (el server es dueno) + party =====
    this.myId = null;        // id de conexion de este jugador (del mensaje {t:'id'})
    this.mobs = new Map();   // mobId -> { id, x, z, h, state, lvl, hp, hpMax, kind }
    this._mobsBootstrappedFromMpos = false;
    this.onPositionCorrection = null; // ({x,z,reason}) optional UX hook
    this.mobsVisualReady = false;
    this.mobVisualIds = new Set();
    this.party = [];         // [{id, name}] miembros de mi party
    this.onMobsSnapshot = null;  // (list) -> el MobField crea los visuales
    this.onMobHp = null;         // (id, hp)
    this.onMobMove = null;       // (mob)
    this.onMobAttack = null;     // (id) -> animacion anticipada de mordida
    this.onMobDead = null;       // (id, by, party, meta)
    this.onMobSpawn = null;      // (mob)
    this.onMobKilled = null;     // (id, by, party, meta) -> el combate da XP (canal aparte del render visual)
    this.onPlayerHit = null;     // ({ id, dmg, hp }) -> dano server-side al jugador
    this.onPlayerMiss = null;    // ({ id }) -> mordida telegrafiada esquivada
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
    this.clipsReady = null;
    this._connect();
  }

  _ensureClipsReady() {
    if (!this.clipsReady) this.clipsReady = this._loadClips();
    return this.clipsReady;
  }

  _assetUrl(name) {
    return './assets/models/' + name + (this.assetVersion ? '?v=' + encodeURIComponent(this.assetVersion) : '');
  }

  async _loadClips() {
    for (const af of ['char_anims_general.glb', 'char_anims.glb', 'char_anims_melee.glb', 'char_anims_ranged.glb', 'char_anims_dodge.glb']) {
      try { this.clips.push(...(await this.loader.loadAsync(this._assetUrl(af))).animations); } catch { /* opcional */ }
    }
    this.walkClip = this.clips.find(c => c.name === 'Walking_A') || this.clips.find(c => /walk/i.test(c.name));
    this.idleClip = this.clips.find(c => c.name === 'Idle_A') || this.walkClip;
  }

  _connect() {
    let ws;
    try { ws = new WebSocket(WS_URL); } catch { return; }
    this.ws = ws;
    ws.onopen = () => {
      const finite = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
      ws.send(JSON.stringify({
        t: 'hi',
        name: this.player.name || 'Anon',
        char: this.player.charFile,
        cu: this.player.custom || null,
        token: this.token,
        h: +finite(this.player.heading).toFixed(2),
        a: this.player.cur || 'Idle',
        lv: (this.combat && this.combat.prog && this.combat.prog.level) || 1,
        hp: this.combat ? Math.round(this.combat.hp) : 100,
        hm: this.combat ? Math.round(this.combat.hpMax) : 100,
      }));
    };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } this._onMsg(m); };
    ws.onclose = () => { this.ws = null; setTimeout(() => this._connect(), 3000); };  // reconexion
    ws.onerror = () => {};
  }

  _onMsg(m) {
    if (m.t === 'corr') {
      const x = Number(m.x), z = Number(m.z);
      if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 3000 || Math.abs(z) > 3000) return;
      this.player.pos.x = x;
      this.player.pos.z = z;
      this.player.dashT = 0;
      this.player.hitImpulseT = 0;
      this.player.keys = {};
      this.player.actionKeys = {};
      if (this.player.root?.position) this.player.root.position.copy(this.player.pos);
      this.acc = 0;
      this.onPositionCorrection?.({ x, z, reason: String(m.reason || '') });
    }
    else if (m.t === 'roster') { for (const p of m.players) this._spawn(p); }
    else if (m.t === 'join') this._spawn(m);
    else if (m.t === 's') {
      const r = this.remotes.get(m.id);
      if (r) {
        r.tx = m.x; r.tz = m.z; r.th = m.h; r.anim = m.a;
        r.netDodgeKey = cleanDodgeKey(m.dk);
        if (Number.isFinite(m.hp) && (r.hp !== m.hp || r.hpMax !== m.hm)) {
          const prevHp = Number.isFinite(r.hp) ? r.hp : null;
          r.hp = m.hp; r.hpMax = m.hm || 100;
          if (r.hpBar) r.hpBar.draw(r.hp, r.hpMax);
          if (prevHp != null && prevHp > 0 && r.hp <= 0) this._remoteDeath(r);
          else if (r.dead && r.hp > 0) this._remoteRecover(r);
          else if (prevHp != null && r.hp > 0 && r.hp < prevHp) {
            const dmg = Math.max(0, prevHp - r.hp);
            const heavy = dmg / Math.max(1, Number(r.hpMax) || 100) >= REMOTE_HEAVY_HIT_RATIO;
            this._remoteHit(r, null, { heavy });
          }
        }
      }
      const rr = this.remotes.get(m.id);
      if (rr && rr.ready && Number(m.lv) > 0 && Number(m.lv) !== rr.lv) {
        rr.lv = Number(m.lv);
        if (rr.tag) { rr.root.remove(rr.tag); rr.tag = makeNametag(rr.name, rr.lv); rr.root.add(rr.tag); }
      }
    }
    else if (m.t === 'atk') { const r = this.remotes.get(m.id); if (r) this._remoteAttack(r, m.k, m); }
    else if (m.t === 'leave') { const r = this.remotes.get(m.id); if (r) { this._remoteClearAttackCueTimers(r); this.scene.remove(r.root); this.remotes.delete(m.id); } }
    else if (m.t === 'chat') {
      if (this.onChat) this.onChat(m.name, m.text);
      const r = this.remotes.get(m.id);
      if (r && r.ready) showBubble(r.root, m.text, r);   // burbuja sobre el remoto
    }
    else if (m.t === 'id') { this.myId = m.id; }
    else if (m.t === 'mobs') {
      this._mobsBootstrappedFromMpos = false;
      this.mobs.clear();
      for (const mob of (m.list || [])) this.mobs.set(mob.id, mob);
      if (this.onMobsSnapshot) this.onMobsSnapshot(m.list || []);
    }
    else if (m.t === 'mhp') {
      const mob = this.mobs.get(m.id); if (mob) mob.hp = m.hp;
      if (this.onMobHp) this.onMobHp(m.id, m.hp, {
        dmg: m.dmg,
        kind: m.k,
        by: m.by,
        sx: m.sx,
        sz: m.sz,
        stagger: !!m.stagger,
      });
    }
    else if (m.t === 'mpos') {
      const list = Array.isArray(m.list) ? m.list : [];
      if (!this.mobs.size && !this._mobsBootstrappedFromMpos) {
        const full = list.filter((patch) => patch && patch.id != null && Number.isFinite(Number(patch.hpMax)) && Number.isFinite(Number(patch.lvl)));
        if (full.length) {
          for (const mob of full) this.mobs.set(mob.id, { ...mob });
          this._mobsBootstrappedFromMpos = true;
          if (this.onMobsSnapshot) this.onMobsSnapshot([...this.mobs.values()]);
        }
      }
      for (const patch of list) {
        const mob = this.mobs.get(patch.id);
        if (!mob) continue;
        Object.assign(mob, patch);
        if (this.onMobMove) this.onMobMove(mob);
      }
    }
    else if (m.t === 'matk') {
      if (this.onMobAttack) this.onMobAttack(m.id, {
        target: m.target,
        ms: m.ms,
        x: m.x,
        z: m.z,
        h: m.h,
      });
    }
    else if (m.t === 'phit') {
      if (m.id != null && (!this.mobsVisualReady || !this.mobVisualIds.has(String(m.id)))) return;
      if (this.onPlayerHit) this.onPlayerHit({ id: m.id, dmg: m.dmg, hp: m.hp, told: !!m.told });
    }
    else if (m.t === 'pmiss') {
      if (this.onPlayerMiss) this.onPlayerMiss({ id: m.id, told: !!m.told, stagger: !!m.stagger });
    }
    else if (m.t === 'mdead') {
      const meta = {
        x: m.x,
        z: m.z,
        lvl: m.lvl,
        hpMax: m.hpMax,
        hpBefore: m.hpBefore,
        dmg: m.dmg,
        kind: m.k,
        by: m.by,
        sx: m.sx,
        sz: m.sz,
        boss: !!m.boss,
      };
      if (this.onMobDead) this.onMobDead(m.id, m.by, m.party || [], meta);
      if (this.onMobKilled) this.onMobKilled(m.id, m.by, m.party || [], meta);
      this.mobs.delete(m.id);
    }
    else if (m.t === 'mspawn') {
      if (m.mob) { this.mobs.set(m.mob.id, m.mob); if (this.onMobSpawn) this.onMobSpawn(m.mob); }
    }
    else if (m.t === 'pinvited') { if (this.onPartyInvited) this.onPartyInvited(m.from, m.name); }
    else if (m.t === 'pskill') {
      if (this.onPartySkill) this.onPartySkill(m);
    }
    else if (m.t === 'party') {
      this.party = m.members || [];
      if (this.onParty) this.onParty(this.party);
    }
    else if (m.t === 'wave') { if (this.onWave) this.onWave({ x: m.x, z: m.z, boss: !!m.boss, night: !!m.night }); }
    else if (m.t === 'top') { if (this.onTop) this.onTop(Array.isArray(m.list) ? m.list : []); }
    else if (m.t === 'pvph') { if (this.onPvpHit) this.onPvpHit({ from: m.from, name: m.name, dmg: m.dmg }); }
    else if (m.t === 'pvpi') this._remotePvpImpact(m);
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
  sendAttack(kind = '', meta = null) {
    const k = typeof kind === 'string' ? kind.slice(0, 24) : '';
    const msg = k ? { t: 'atk', k } : { t: 'atk' };
    const m = meta && typeof meta === 'object' ? meta : null;
    if (m) {
      const tt = String(m.tt || m.type || '').slice(0, 12);
      if (tt === 'mob' || tt === 'player' || tt === 'point') msg.tt = tt;
      if (m.id != null || m.tid != null) msg.tid = String(m.id ?? m.tid).slice(0, 24);
      const tx = Number(m.x ?? m.tx), tz = Number(m.z ?? m.tz);
      if (Number.isFinite(tx) && Number.isFinite(tz)) {
        msg.tx = Math.max(-3000, Math.min(3000, +tx.toFixed(2)));
        msg.tz = Math.max(-3000, Math.min(3000, +tz.toFixed(2)));
      }
      const am = Number(m.am ?? m.animSpeed ?? m.attackAnimSpeed);
      if (Number.isFinite(am)) {
        msg.am = Math.max(REMOTE_ATTACK_SPEED_MULT_MIN, Math.min(REMOTE_ATTACK_SPEED_MULT_MAX, +am.toFixed(3)));
      }
    }
    this._send(msg);
  }
  // reporta la racha local al leaderboard del dia (el server clampa y difunde)
  reportStreak(v) {
    this._send({ t: 'rank', v });
  }

  // skill de party: el server la reenvia a los miembros del grupo
  partySkill(kind, v, dur) {
    this._send({ t: 'pskill', kind, v, dur });
  }

  attackMob(id, dmg, kind = 'basic') { this._send({ t: 'mhit', id, dmg, k: kind }); }
  invite(to) { this._send({ t: 'pinvite', to }); }
  accept(from) { this._send({ t: 'paccept', from }); }
  leaveParty() { this._send({ t: 'pleave' }); }
  attackPlayer(to, dmg) { this._send({ t: 'pvp', to, dmg }); }
  pvpDead(by) { this._send({ t: 'pvpdead', by }); }
  friendList() { this._send({ t: 'flist' }); }
  friendReq(to) { this._send({ t: 'freq', to }); }
  friendAcc(from) { this._send({ t: 'facc', from }); }

  _remoteActions(r) {
    const actions = new Set([r?.walkA, r?.idleA, r?.attackA, r?.dodgeA, r?.hitA, r?.deathA]);
    for (const action of r?.attackActions || []) actions.add(action);
    for (const action of r?.attackFollowupActions || []) actions.add(action);
    for (const action of Object.values(r?.dodgeActions || {})) actions.add(action);
    for (const action of Object.values(r?.skillActions || {})) actions.add(action);
    for (const action of Object.values(r?.skillFollowupActions || {})) actions.add(action);
    actions.delete(null);
    actions.delete(undefined);
    return actions;
  }

  _remoteCancelActionStop(r, action) {
    if (!r || !action || !Array.isArray(r.actionStops) || !r.actionStops.length) return;
    r.actionStops = r.actionStops.filter((entry) => entry.action !== action);
  }

  _remoteQueueActionStop(r, action, delay) {
    if (!r || !action) return;
    this._remoteCancelActionStop(r, action);
    if (!Array.isArray(r.actionStops)) r.actionStops = [];
    r.actionStops.push({ action, t: Math.max(0.02, Number(delay) || REMOTE_ACTION_BLEND) });
  }

  _remoteTickActionStops(r, dt) {
    if (!r || !Array.isArray(r.actionStops) || !r.actionStops.length) return;
    for (let i = r.actionStops.length - 1; i >= 0; i--) {
      const entry = r.actionStops[i];
      entry.t -= dt;
      if (entry.t > 0) continue;
      r.actionStops.splice(i, 1);
      if (entry.action && entry.action !== r.activeAction) {
        try { entry.action.stop(); } catch {}
      }
    }
  }

  _remoteTransitionAction(r, next, fade = REMOTE_ACTION_BLEND) {
    if (!r || !next) return false;
    const prev = r.activeAction || (r.walking ? r.walkA : r.idleA) || null;
    this._remoteCancelActionStop(r, next);
    try {
      next.reset();
      if (prev && prev !== next) {
        for (const other of this._remoteActions(r)) {
          if (other === prev || other === next) continue;
          this._remoteCancelActionStop(r, other);
          other.stop();
        }
        if (typeof next.crossFadeFrom === 'function') {
          next.crossFadeFrom(prev, fade, false);
          this._remoteQueueActionStop(r, prev, fade + REMOTE_ACTION_STOP_PAD);
        } else {
          prev.stop();
        }
      }
      next.play();
      r.activeAction = next;
      return true;
    } catch {
      return false;
    }
  }

  _remotePlayLoop(r, moving, fade = REMOTE_LOCOMOTION_BLEND) {
    if (!r || r.dead) return false;
    const next = moving ? r.walkA : r.idleA;
    if (!next) {
      r.walking = false;
      return false;
    }
    if (r.activeAction === next) {
      r.walking = !!moving;
      return true;
    }
    try {
      next.setLoop(THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = false;
    } catch {}
    const started = this._remoteTransitionAction(r, next, fade);
    if (started) r.walking = !!moving;
    return started;
  }

  _remoteScheduleAttackCue(r, fn, delayMs) {
    const delay = Math.max(0, Number(delayMs) || 0);
    if (delay <= 0) {
      fn();
      return null;
    }
    if (!Array.isArray(r.attackCueTimers)) r.attackCueTimers = [];
    let timer = null;
    timer = setTimeout(() => {
      if (Array.isArray(r.attackCueTimers)) {
        r.attackCueTimers = r.attackCueTimers.filter((entry) => entry !== timer);
      }
      fn();
    }, delay);
    r.attackCueTimers.push(timer);
    return timer;
  }

  _remoteClearAttackCueTimers(r) {
    if (!r || !Array.isArray(r.attackCueTimers)) return;
    for (const timer of r.attackCueTimers) clearTimeout(timer);
    r.attackCueTimers = [];
  }

  _remoteInterruptAttack(r) {
    if (!r) return false;
    const interrupted = !!(r.attacking || r.attackFollowup || r.queuedAttack
      || (r.attackT || 0) > 0 || (r.attackVisualT || 0) > 0
      || (Array.isArray(r.attackCueTimers) && r.attackCueTimers.length));
    this._remoteClearAttackCueTimers(r);
    r.attacking = false;
    r.attackFollowup = null;
    r.queuedAttack = null;
    r.attackT = 0;
    r.attackVisualT = 0;
    r.attackRecoverable = false;
    this._resetRemoteBodyLean(r);
    return interrupted;
  }

  // Dispara el ataque one-shot de un remoto y lo funde desde su accion visual actual.
  _remoteAttack(r, kind = '', meta = null) {
    const skillKind = typeof kind === 'string' ? kind : '';
    const skillAction = skillKind && r.skillActions && r.skillActions[skillKind];
    const actions = skillAction ? [skillAction] : (r.attackActions && r.attackActions.length ? r.attackActions : (r.attackA ? [r.attackA] : []));
    if (!r.ready || !actions.length || r.dead) return false;
    const upgradingBasic = !!skillAction && r.attackT > 0 && (!r.attackKind || r.attackKind === 'basic');
    if (r.attackT > 0 && !upgradingBasic) return this._queueRemoteAttack(r, kind, meta);
    r.queuedAttack = null;
    const comboStep = r.comboIdx % actions.length;
    const a = skillAction || actions[comboStep];
    if (!skillAction) r.comboIdx++;
    r.attackFollowup = null;
    r.attackA = a;
    r.attackKind = skillAction ? skillKind : 'basic';
    r.attacking = true;
    r.dodging = false;
    r.hitting = false;
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    const animMultRaw = meta && meta.am != null ? Number(meta.am) : NaN;
    const animMult = Math.max(REMOTE_ATTACK_SPEED_MULT_MIN, Math.min(REMOTE_ATTACK_SPEED_MULT_MAX, Number.isFinite(animMultRaw) ? animMultRaw : 1));
    const heavySkill = !!skillAction && skillUsesHeavyWindow(skillKind);
    const speed = skillAction ? skillAnimSpeed(skillKind, heavySkill) : ATTACK_SPEED * animMult;
    a.timeScale = speed;
    const baseWindows = combatActionWindows(a.getClip().duration, speed, { skill: !!skillAction, heavy: heavySkill });
    const clipT = baseWindows.clipT;
    const followup = skillAction
      ? (r.skillFollowupActions && r.skillFollowupActions[skillKind])
      : (r.attackFollowupActions && r.attackFollowupActions[comboStep]);
    let followupDuration = 0;
    let followupDelay = 0;
    if (followup && followup !== a) {
      const leadT = skillAction
        ? ((r.skillReleaseDelays && r.skillReleaseDelays[skillKind]) || Math.max(0.08, Math.min(0.18, clipT * 0.42)))
        : (r.attackReleaseDelay || Math.max(0.08, Math.min(0.16, clipT * 0.42)));
      r.attackFollowup = { a: followup, t: leadT, speed };
      followupDuration = followup.getClip().duration;
      followupDelay = leadT;
    }
    const windows = combatActionWindows(a.getClip().duration, speed, {
      skill: !!skillAction, heavy: heavySkill, followupDuration, followupDelay,
    });
    r.attackRecoverable = !skillAction && !remoteIsRanged(r);
    r.attackT = windows.lockT;
    r.attackVisualT = windows.visualT;
    if (skillAction ? REMOTE_MELEE_SKILL_TYPES.has(skillKind) : !remoteIsRanged(r)) {
      const finisher = !skillAction && actions.length > 1 && comboStep === actions.length - 1;
      const side = skillAction
        ? (skillKind === 'spin' || skillKind === 'bladedance' ? 0.52 : (skillKind === 'stab' || skillKind === 'execute' ? -0.42 : 0.28))
        : (comboStep % 2 ? -0.38 : 0.38);
      const heavy = skillKind === 'execute' || skillKind === 'leap' || finisher;
      this._remotePulseAttackBodyLean(r, heavy ? 0.13 : 0.105, heavy ? 0.2 : 0.15, side);
    }
    r.walking = false;
    if (!this._remoteTransitionAction(r, a, REMOTE_ACTION_BLEND)) {
      r.attacking = false;
      return false;
    }
    this._remoteAttackCue(r, skillKind, meta || {}, skillAction ? (r.skillReleaseDelays && r.skillReleaseDelays[skillKind]) : r.attackReleaseDelay);
    return true;
  }

  _queueRemoteAttack(r, kind = '', meta = null) {
    if (!r || r.dead) return false;
    r.queuedAttack = {
      kind: typeof kind === 'string' ? kind : '',
      meta: meta && typeof meta === 'object' ? { ...meta } : null,
      t: REMOTE_ATTACK_QUEUE_T,
    };
    return true;
  }

  _consumeRemoteAttackQueue(r) {
    const q = r && r.queuedAttack;
    if (!q || q.t <= 0 || r.dead || r.dodging || r.hitting) {
      if (r) r.queuedAttack = null;
      return false;
    }
    r.queuedAttack = null;
    return this._remoteAttack(r, q.kind, q.meta);
  }

  _remoteAttackCue(r, kind = '', meta = {}, releaseDelay = 0) {
    const fx = this.effects;
    if (!fx || !r || !meta) return false;
    const tx = Number(meta.tx), tz = Number(meta.tz);
    if (!Number.isFinite(tx) || !Number.isFinite(tz)) return false;
    const sx = Number.isFinite(Number(r.x)) ? Number(r.x) : 0;
    const sz = Number.isFinite(Number(r.z)) ? Number(r.z) : 0;
    const dist = Math.hypot(tx - sx, tz - sz);
    const skillKind = typeof kind === 'string' ? kind : '';
    const cuePos = dist < 0.2 ? { x: sx, y: 0, z: sz } : { x: tx, y: 0, z: tz };
    const delayFx = (fn, capMs = 260) => {
      const delayMs = Math.max(0, Math.min(capMs, Number(releaseDelay) * 1000 || 0));
      this._remoteScheduleAttackCue(r, fn, delayMs);
    };
    r.attackCueAt = Date.now();
    r.attackCueX = tx;
    r.attackCueZ = tz;
    if (REMOTE_HEAL_SKILLS.has(skillKind)) {
      delayFx(() => {
        fx.healBurst?.({ x: sx, y: 0.45, z: sz });
        fx.nova?.({ x: sx, y: 0, z: sz }, r.auraColor || 0x7be07b, 2.8);
      });
      return true;
    }
    if (REMOTE_SELF_AREA_SKILLS.has(skillKind)) {
      delayFx(() => {
        fx.nova?.({ x: sx, y: 0, z: sz }, r.auraColor || 0xffd24a, REMOTE_AREA_RADIUS[skillKind] || 4);
        fx.hitFlash?.({ x: sx, y: 1.1, z: sz }, r.auraColor || 0xffd24a);
      });
      return true;
    }
    if (skillKind === 'rain' || skillKind === 'storm' || skillKind === 'meteor') {
      const releaseMs = Math.max(0, Math.min(360, Number(releaseDelay) * 1000 || 0));
      const rain = () => fx.meteorRain?.(cuePos, REMOTE_AREA_RADIUS[skillKind] || 5, skillKind === 'storm' ? 12 : skillKind === 'meteor' ? 14 : 7);
      this._remoteScheduleAttackCue(r, rain, releaseMs);
      if (skillKind === 'meteor') this._remoteScheduleAttackCue(r, () => fx.nova?.(cuePos, 0xff7a1e, REMOTE_AREA_RADIUS.meteor), releaseMs + REMOTE_METEOR_IMPACT_DELAY * 1000);
      return true;
    }
    if (skillKind === 'leap') {
      if (dist > 0.2) {
        fx.dashTrail?.({ x: sx, z: sz }, { x: tx, z: tz }, r.auraColor || 0xfff2d8, { width: 0.46, opacity: 0.32 });
        if (fx.slashArc) {
          const h = Math.atan2(tx - sx, tz - sz);
          fx.slashArc({ x: sx, y: 1.0, z: sz }, h, r.auraColor || 0xfff2d8);
        }
      }
      fx.nova?.(cuePos, r.auraColor || 0xffd24a, REMOTE_AREA_RADIUS.leap);
      return true;
    }
    if (dist < 0.2) return false;
    const ptype = REMOTE_SKILL_PROJECTILE[skillKind] || REMOTE_PROJECTILE_BY_CHAR[r.charFile];
    if (ptype && dist > 3.4 && fx.projectile) {
      const fire = () => fx.projectile({ x: sx, y: 1.35, z: sz }, { x: tx, y: 0.95, z: tz }, ptype);
      const delayMs = Math.max(0, Math.min(220, Number(releaseDelay) * 1000 || 0));
      this._remoteScheduleAttackCue(r, fire, delayMs);
      return true;
    }
    if (fx.slashArc) {
      const h = Math.atan2(tx - sx, tz - sz);
      delayFx(() => fx.slashArc({ x: sx, y: 1.0, z: sz }, h, r.auraColor || 0xfff2d8), 220);
      return true;
    }
    return false;
  }

  _remoteAttackFollowup(r, followup = r.attackFollowup) {
    const action = followup && followup.a;
    if (!r.ready || !action || r.dead) return false;
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.timeScale = followup.speed || 1;
    r.attackA = action;
    return this._remoteTransitionAction(r, action, 0.05);
  }

  _remotePulseBodyLean(r, nx, nz, amount = 0.1, dur = 0.15) {
    if (!r || !Number.isFinite(nx) || !Number.isFinite(nz)) return false;
    const len = Math.hypot(nx, nz);
    if (len < 0.01) return false;
    const x = nx / len, z = nz / len;
    const h = Number.isFinite(r.th) ? r.th : (Number.isFinite(r.rot) ? r.rot : Math.atan2(x, z));
    const forward = x * Math.sin(h) + z * Math.cos(h);
    const side = x * Math.cos(h) - z * Math.sin(h);
    const amp = Math.max(0.02, Math.min(REMOTE_BODY_LEAN_MAX, Number(amount) || 0.1));
    r.bodyLeanForward = Math.max(-1, Math.min(1, forward)) * amp;
    r.bodyLeanSide = Math.max(-1, Math.min(1, side)) * amp * 0.72;
    r.bodyLeanT = Math.max(r.bodyLeanT || 0, Math.max(0.05, Number(dur) || 0.15));
    r.bodyLeanMaxT = Math.max(r.bodyLeanMaxT || 0, r.bodyLeanT);
    return true;
  }

  _remotePulseAttackBodyLean(r, amount = 0.1, dur = 0.15, side = 0) {
    if (!r) return false;
    const amp = Math.max(0.02, Math.min(REMOTE_BODY_LEAN_MAX, Number(amount) || 0.1));
    r.bodyLeanForward = amp;
    r.bodyLeanSide = Math.max(-1, Math.min(1, Number(side) || 0)) * amp * 0.72;
    r.bodyLeanT = Math.max(r.bodyLeanT || 0, Math.max(0.05, Number(dur) || 0.15));
    r.bodyLeanMaxT = Math.max(r.bodyLeanMaxT || 0, r.bodyLeanT);
    return true;
  }

  _resetRemoteBodyLean(r) {
    if (!r) return;
    r.bodyLeanT = 0;
    r.bodyLeanMaxT = 0;
    r.bodyLeanForward = 0;
    r.bodyLeanSide = 0;
    if (r.char) {
      r.char.rotation.x = 0;
      r.char.rotation.z = 0;
    }
  }

  _updateRemoteBodyLean(r, dt) {
    const ch = r && r.char;
    if (!ch) return;
    const d = Math.min(Math.max(dt || 0, 0), 0.1);
    if (r.dead) {
      r.bodyLeanT = 0;
      r.bodyLeanMaxT = 0;
    } else if ((r.bodyLeanT || 0) > 0) {
      r.bodyLeanT = Math.max(0, r.bodyLeanT - d);
    }
    const maxT = Math.max(0.001, r.bodyLeanMaxT || r.bodyLeanT || 0.001);
    const k = r.bodyLeanT > 0 ? Math.sin(Math.min(1, r.bodyLeanT / maxT) * Math.PI * 0.5) : 0;
    const targetX = -(r.bodyLeanForward || 0) * k;
    const targetZ = -(r.bodyLeanSide || 0) * k;
    const ease = Math.min(1, d * 18);
    ch.rotation.x += (targetX - ch.rotation.x) * ease;
    ch.rotation.z += (targetZ - ch.rotation.z) * ease;
    if ((r.bodyLeanT || 0) <= 0) {
      r.bodyLeanMaxT = 0;
      if (Math.abs(ch.rotation.x) < 0.0005) ch.rotation.x = 0;
      if (Math.abs(ch.rotation.z) < 0.0005) ch.rotation.z = 0;
    }
  }

  // estela visual del dash remoto; no cambia posicion ni predice gameplay.
  _remoteMotionTrail(r, from = null) {
    const fx = this.effects;
    if (!fx?.dashTrail || !r) return false;
    const a = from || { x: r.x || 0, z: r.z || 0 };
    let dx = (r.tx || 0) - a.x, dz = (r.tz || 0) - a.z;
    const d = Math.hypot(dx, dz);
    if (d < REMOTE_DODGE_TRAIL_MIN) {
      const h = Number.isFinite(r.th) ? r.th : (Number.isFinite(r.rot) ? r.rot : 0);
      let sx = Math.sin(h), sz = Math.cos(h);
      if (r.dodgeKey === 'Backward') { sx = -sx; sz = -sz; }
      else if (r.dodgeKey === 'Left') { sx = -Math.cos(h); sz = Math.sin(h); }
      else if (r.dodgeKey === 'Right') { sx = Math.cos(h); sz = -Math.sin(h); }
      dx = sx * REMOTE_DODGE_TRAIL_LEN;
      dz = sz * REMOTE_DODGE_TRAIL_LEN;
    }
    const to = { x: a.x + dx, z: a.z + dz };
    return !!fx.dashTrail(a, to, r.auraColor || 0x8fffd8, { width: 0.38, opacity: 0.28 });
  }

  // reproduce el dodge de un remoto cuando su estado de red entra en Dash.
  _remoteDodge(r, opts = {}) {
    if (!r.ready || r.dodging || r.dead) return false;
    const key = cleanDodgeKey(opts.key || r.netDodgeKey)
      || dashDirectionKey(r.tx - r.x, r.tz - r.z, Number.isFinite(r.th) ? r.th : r.rot);
    const a = (r.dodgeActions && (r.dodgeActions[key] || r.dodgeActions.Forward)) || r.dodgeA;
    if (!a) return false;
    this._remoteInterruptAttack(r);
    r.hitting = false;
    r.hitT = 0;
    r.walking = false;
    r.dodgeA = a;
    r.dodgeKey = key;
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = REMOTE_DODGE_SPEED;
    r.dodgeT = Math.max(0.12, Math.min(0.32, (a.getClip().duration / REMOTE_DODGE_SPEED) * 0.82));
    r.dodging = true;
    {
      const [lx, lz] = remoteDodgeVector(r, key);
      this._remotePulseBodyLean(r, lx, lz, 0.12, 0.17);
    }
    if (!this._remoteTransitionAction(r, a, REMOTE_ACTION_BLEND)) {
      r.dodging = false;
      return false;
    }
    this._remoteMotionTrail(r, opts.from || null);
    return true;
  }

  _remotePvpImpact(m) {
    const victim = this.remotes.get(Number(m.to));
    if (!victim?.ready || victim.dead) return false;
    const attacker = this.remotes.get(Number(m.from));
    const dmg = Math.max(0, Number(m.dmg) || 0);
    const heavy = dmg / Math.max(1, Number(victim.hpMax) || 100) >= REMOTE_HEAVY_HIT_RATIO;
    this._remoteHit(victim, attacker, { heavy });
    const fx = this.effects;
    if (fx) {
      fx.bloodHit?.({ x: victim.x, y: 1.05, z: victim.z });
      fx.hitFlash?.({ x: victim.x, y: 1.15, z: victim.z }, 0xff5a48);
      fx.damageNumber?.({ x: victim.x, y: 2.1, z: victim.z }, dmg, { toPlayer: true, crit: heavy });
      if (attacker?.ready && fx.slashArc) {
        const h = Math.atan2(victim.x - attacker.x, victim.z - attacker.z);
        fx.slashArc({ x: attacker.x, y: 1.0, z: attacker.z }, h, attacker.auraColor || 0xfff2d8);
      }
    }
    return true;
  }

  _remoteHitPulse(r, source = null, opts = {}) {
    if (!r?.ready || r.dead) return false;
    const sx = Number(source?.x), sz = Number(source?.z);
    let dx = 0, dz = 0;
    if (Number.isFinite(sx) && Number.isFinite(sz)) {
      dx = (Number(r.x) || 0) - sx;
      dz = (Number(r.z) || 0) - sz;
    }
    let d = Math.hypot(dx, dz);
    if (d < 0.001) {
      const h = Number.isFinite(r.rot) ? r.rot : (Number.isFinite(r.th) ? r.th : 0);
      dx = -Math.sin(h);
      dz = -Math.cos(h);
      d = Math.hypot(dx, dz) || 1;
    }
    const heavy = !!opts.heavy;
    const dist = heavy ? REMOTE_HEAVY_HIT_PULSE_DIST : REMOTE_HIT_PULSE_DIST;
    const time = heavy ? REMOTE_HEAVY_HIT_PULSE_TIME : REMOTE_HIT_PULSE_TIME;
    r.hitPulseX = (dx / d) * dist;
    r.hitPulseZ = (dz / d) * dist;
    r.hitPulseT = time;
    r.hitPulseMaxT = time;
    return true;
  }

  _remoteHit(r, source = null, opts = {}) {
    if (!r.ready || r.dead) return false;
    const heavy = !!opts.heavy;
    this._remoteHitPulse(r, source, { heavy });
    if (!r.hitA || r.dodging) return true;
    if (r.attacking) {
      if (!heavy) return true;
      this._remoteInterruptAttack(r);
    }
    r.queuedAttack = null;
    const speed = heavy ? REMOTE_HIT_SPEED_HEAVY : REMOTE_HIT_SPEED_LIGHT;
    const hitT = heavy
      ? Math.max(0.18, Math.min(0.36, r.hitA.getClip().duration / speed))
      : Math.max(0.09, Math.min(0.18, r.hitA.getClip().duration / speed));
    if (!heavy && r.hitting) {
      r.hitT = Math.max(r.hitT || 0, Math.min(0.12, hitT));
      return true;
    }
    r.walking = false;
    const a = r.hitA;
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = speed;
    r.hitT = hitT;
    r.hitting = true;
    if (!this._remoteTransitionAction(r, a, REMOTE_ACTION_BLEND)) {
      r.hitting = false;
      return false;
    }
    return true;
  }

  _remoteDeath(r) {
    if (!r.ready || r.dead) return false;
    this._remoteInterruptAttack(r);
    r.dead = true;
    r.dodging = false;
    r.hitting = false;
    r.hitPulseT = 0;
    r.hitPulseX = 0;
    r.hitPulseZ = 0;
    this._resetRemoteBodyLean(r);
    r.walking = false;
    const action = r.deathA;
    if (!action) {
      try { r.activeAction?.stop(); } catch {}
      r.activeAction = null;
      return false;
    }
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.timeScale = REMOTE_DEATH_SPEED;
    r.deathT = action.getClip().duration / REMOTE_DEATH_SPEED;
    return this._remoteTransitionAction(r, action, 0.06);
  }

  _remoteRecover(r) {
    this._remoteInterruptAttack(r);
    r.dead = false;
    r.deathT = 0;
    r.hitting = false;
    this._resetRemoteBodyLean(r);
    r.walking = false;
    return this._remotePlayLoop(r, false, 0.14);
  }

  async _proto(charFile) {
    if (!this.protos[charFile]) {
      try { const g = await this.loader.loadAsync(this._assetUrl(charFile)); sanitizeImported(g.scene); this.protos[charFile] = g; }
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
      mixAcc: 0,
      activeAction: null, actionStops: [],
    };
    r.root.position.set(r.x, 0, r.z);
    this.scene.add(r.root);
    this.remotes.set(p.id, r);   // reservar el id antes del await (evita doble spawn)
    const proto = await this._proto(charFile);
    if (!proto || !this.remotes.has(p.id)) return;
    const ch = cloneSkinned(proto.scene);
    ch.scale.setScalar(SCALE);
    ch.traverse(o => { if (o.isMesh) o.castShadow = true; });
    const remoteSpec = classByChar(charFile);
    r.charFile = charFile;
    r.auraColor = remoteSpec.auraColor || 0x8fffd8;
    // el remoto se ve COMO SE VE EL: piezas mix-and-match + paleta
    await composeCharacter(this.loader, ch, remoteSpec, p.cu || {});
    r.root.add(ch);
    r.char = ch;
    r.bodyLeanT = 0;
    r.bodyLeanMaxT = 0;
    r.bodyLeanForward = 0;
    r.bodyLeanSide = 0;
    r.lv = Number(p.lv) || 0;
    if (p.name) { r.tag = makeNametag(p.name, r.lv); r.root.add(r.tag); }
    r.hp = Number.isFinite(p.hp) ? p.hp : 100;
    r.hpMax = Number.isFinite(p.hm) && p.hm > 0 ? p.hm : 100;
    r.hpBar = makeHpBar();
    r.hpBar.draw(r.hp, r.hpMax);
    r.root.add(r.hpBar.sprite);
    await equipWeapon(this.loader, ch, charFile, remoteSpec.weapon);   // arma de clase
    await this._ensureClipsReady();
    if (!this.remotes.has(p.id)) return;
    r.mixer = new THREE.AnimationMixer(ch);
    if (this.walkClip) r.walkA = r.mixer.clipAction(this.walkClip);
    r.idleA = this.idleClip ? r.mixer.clipAction(this.idleClip) : r.walkA;
    r.dodgeActions = {};
    const dodgeMap = { Forward: 'Dodge_Forward', Backward: 'Dodge_Backward', Left: 'Dodge_Left', Right: 'Dodge_Right' };
    for (const [key, clipName] of Object.entries(dodgeMap)) {
      const clip = this.clips.find(c => c.name === clipName);
      if (clip) r.dodgeActions[key] = r.mixer.clipAction(plantClip(clip));
    }
    r.dodgeA = r.dodgeActions.Forward || null;
    const hitClip = this.clips.find(c => c.name === 'Hit_A' || c.name === 'Hit_B');
    r.hitA = hitClip ? r.mixer.clipAction(plantClip(hitClip)) : null;
    const deathClip = this.clips.find(c => c.name === 'Death_A' || c.name === 'Death_B');
    r.deathA = deathClip ? r.mixer.clipAction(plantClip(deathClip)) : null;
    r.dodgeT = 0; r.dodging = false; r.dodgeKey = 'Forward'; r.lastAnim = null;
    r.hitT = 0; r.hitting = false; r.deathT = 0; r.dead = r.hp <= 0;
    r.attackActions = [];
    r.attackFollowupActions = [];
    const attackFollowupName = attackFollowupClipName(charFile, remoteSpec.combatStyle);
    for (const clipName of comboClips(charFile, remoteSpec.combatStyle)) {
      const aClip = this.clips.find(c => c.name === clipName);
      if (!aClip) continue;
      // plantar el ataque: quitar root motion (root/hips.position) como en el jugador
      r.attackActions.push(r.mixer.clipAction(plantClip(aClip)));
      const followupClip = attackFollowupName ? this.clips.find(c => c.name === attackFollowupName) : null;
      r.attackFollowupActions.push(followupClip && followupClip !== aClip ? r.mixer.clipAction(plantClip(followupClip)) : null);
    }
    if (!r.attackActions.length) {
      const aClip = this.clips.find(c => c.name === attackClipName(charFile));
      if (aClip) {
        r.attackActions.push(r.mixer.clipAction(plantClip(aClip)));
        r.attackFollowupActions.push(null);
      }
    }
    r.attackReleaseDelay = attackReleaseDelay(charFile, remoteSpec.combatStyle);
    r.skillActions = {};
    r.skillFollowupActions = {};
    r.skillReleaseDelays = {};
    for (const type of SKILL_TYPES) {
      const primaryClip = skillClipCandidates(type, remoteSpec.combatStyle, charFile)
        .map(name => this.clips.find(c => c.name === name))
        .find(Boolean);
      if (primaryClip) r.skillActions[type] = r.mixer.clipAction(plantClip(primaryClip));
      const followupClip = skillFollowupClipCandidates(type, remoteSpec.combatStyle, charFile)
        .map(name => this.clips.find(c => c.name === name))
        .find(Boolean);
      if (followupClip && followupClip !== primaryClip) r.skillFollowupActions[type] = r.mixer.clipAction(plantClip(followupClip));
      r.skillReleaseDelays[type] = skillReleaseDelay(type, remoteSpec.combatStyle, charFile);
    }
    r.comboIdx = 0;
    r.attackA = r.attackActions[0] || null;
    r.attackKind = 'basic';
    r.attackT = 0; r.attackVisualT = 0; r.attackRecoverable = false; r.attacking = false;
    r.queuedAttack = null;
    r.attackCueTimers = [];
    if (r.idleA) { r.idleA.play(); r.activeAction = r.idleA; }
    r.ready = true;
  }

  update(dt, player) {
    // mandar estado local ~10Hz
    this.acc += dt;
    if (this.ws && this.ws.readyState === 1 && this.acc > 0.1) {
      this.acc = 0;
      const dk = cleanDodgeKey(player.cur === 'Dash' && player._dashAnimKey);
      const msg = {
        t: 's', lv: (this.combat && this.combat.prog && this.combat.prog.level) || 1,
        x: +player.pos.x.toFixed(2), z: +player.pos.z.toFixed(2),
        h: +player.heading.toFixed(2), a: player.cur || 'Idle',
        hp: this.combat ? Math.round(this.combat.hp) : 100,
        hm: this.combat ? Math.round(this.combat.hpMax) : 100,
      };
      if (dk) msg.dk = dk;
      this.ws.send(JSON.stringify(msg));
    }
    // interpolar remotos
    const mobile = !!(globalThis.window && window.__SAUCES_MOBILE__);
    const lowEnd = !!(globalThis.window && window.__SAUCES_LOW_END__);
    const pp = player && player.pos;
    for (const r of this.remotes.values()) {
      if (!r.ready) continue;
      this._remoteTickActionStops(r, dt);
      const prevX = r.x, prevZ = r.z;
      const dx = r.tx - r.x, dz = r.tz - r.z;
      const moving = (dx * dx + dz * dz) > 0.0009;
      const moveK = 1 - Math.exp(-dt * 12);
      r.x += dx * moveK;
      r.z += dz * moveK;
      let hitOx = 0, hitOz = 0;
      if ((r.hitPulseT || 0) > 0) {
        const maxT = Math.max(0.001, r.hitPulseMaxT || REMOTE_HIT_PULSE_TIME);
        r.hitPulseT = Math.max(0, r.hitPulseT - dt);
        const age = Math.max(0, maxT - r.hitPulseT);
        const k = Math.sin(Math.min(1, age / maxT) * Math.PI);
        hitOx = (r.hitPulseX || 0) * k;
        hitOz = (r.hitPulseZ || 0) * k;
        if (r.hitPulseT <= 0) {
          r.hitPulseX = 0;
          r.hitPulseZ = 0;
        }
      }
      r.root.position.set(r.x + hitOx, 0, r.z + hitOz);
      let drot = ((r.th - r.rot + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      const turnK = 1 - Math.exp(-dt * 10);
      r.rot += drot * turnK;
      r.root.rotation.y = r.rot;
      if (r.anim === 'Dash' && r.lastAnim !== 'Dash') this._remoteDodge(r, { from: { x: prevX, z: prevZ }, key: r.netDodgeKey });
      r.lastAnim = r.anim;
      if (r.dead) {
        r.deathT = Math.max(0, (r.deathT || 0) - dt);
      } else if (r.attacking) {
        if (r.queuedAttack) {
          r.queuedAttack.t = Math.max(0, (r.queuedAttack.t || 0) - dt);
          if (r.queuedAttack.t <= 0) r.queuedAttack = null;
        }
        if (r.attackFollowup) {
          r.attackFollowup.t -= dt;
          if (r.attackFollowup.t <= 0) {
            const followup = r.attackFollowup;
            r.attackFollowup = null;
            this._remoteAttackFollowup(r, followup);
          }
        }
        if ((r.attackVisualT || 0) <= 0 && (r.attackT || 0) > 0) r.attackVisualT = r.attackT;
        r.attackT = Math.max(0, (r.attackT || 0) - dt);
        r.attackVisualT = Math.max(0, (r.attackVisualT || 0) - dt);
        if (r.queuedAttack && r.attackT <= 0 && !r.attackFollowup) {
          this._consumeRemoteAttackQueue(r);
          continue;
        }
        const recoverToMove = !!(r.attackRecoverable && moving && r.attackT <= 0);
        if (recoverToMove || r.attackVisualT <= 0) {
          r.attacking = false;
          r.attackFollowup = null;
          r.attackRecoverable = false;
          r.attackT = 0;
          r.attackVisualT = 0;
          this._remotePlayLoop(r, moving);
        }
      } else if (r.dodging) {
        r.dodgeT -= dt;
        if (r.dodgeT <= 0) {
          r.dodging = false;
          this._remotePlayLoop(r, moving);
        }
      } else if (r.hitting) {
        r.hitT -= dt;
        if (r.hitT <= 0) {
          r.hitting = false;
          this._remotePlayLoop(r, moving);
        }
      } else {
        const wantWalk = moving || r.anim === 'Walk' || r.anim === 'Run';
        if (r.walkA || r.idleA) this._remotePlayLoop(r, wantWalk);
      }
      const active = !!(moving || r.attacking || r.dodging || r.hitting || r.dead);
      const dLod = pp ? Math.hypot(r.x - pp.x, r.z - pp.z) : 0;
      advanceRemoteMixer(r, dt, remoteMixerStepForDistance(dLod, active, mobile, lowEnd));
      this._updateRemoteBodyLean(r, dt);
    }
  }
}
