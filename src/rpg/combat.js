// Combate tab-target con mobs COMPARTIDOS (el server es dueno). Clic selecciona un
// esqueleto; en rango el jugador auto-ataca y el DANO lo aplica el SERVER (mhit),
// que avisa a TODOS los clientes. Al morir, si lo mataste tu (o tu party) recibes XP
// y loot. Los mobs te pegan desde el server con aggro/chase/leash.
import * as THREE from 'three';
import { projectileSpeed } from './effects.js?v=20260710g44';
import { PROJECTILE_BY_CHAR, skillReleaseDelay } from '../animmap.js?v=20260710g44';
import { attackReleaseDelay } from '../weapons.js?v=20260710g44';
import { matchesAction } from '../keybinds.js?v=20260710g44';
import { BloodCoat } from './bloodcoat.js?v=20260710g44';

const ATTACK_CD = 0.34;      // cadencia ARPG: golpes rapidos encadenados
const RANGE_MELEE = 3.05;    // CUERPO A CUERPO real: la espada toca al zombie
const RANGE_LUNGE = 4.85;    // iman corto de melee para que no se pierda el ritmo
const MELEE_SETTLE_DIST = 2.35;      // ajuste fino para que el swing lea contacto real
const MELEE_SETTLE_MAX_STEP = 0.48;  // corto: no teletransporta ni reemplaza movimiento
const MELEE_SETTLE_MIN_STEP = 0.08;
const AUTO_MELEE_ENGAGE_RANGE = 13.5; // auto-combate busca pelea antes de quedar encima
const AUTO_CHASE_RANGE = 14.0;        // persecucion suave, no teleport, fuera del melee
const AUTO_CHASE_SPEED = 15.5;        // m/s: corre al pack con ritmo ARPG
const AUTO_CHASE_STEP_MAX = 0.62;     // cap por frame contra picos de dt
const RANGE_RANGED = 12;     // mago/arquero castean a distancia (como debe ser)
const ATTACK_RANGE = 3.6;    // rango del PvP (el server valida 5m)
const RESPAWN_T = 3.0;
const SPAWN_GRACE_T = 3.0;
const CRIT_CHANCE = 0.18;    // golpes criticos x2 (numeros dorados grandes)
const CLEAVE_RANGE = 3.0;    // el tajo melee barre en arco a los cercanos
const CLEAVE_ARC = 1.25;     // ± rad respecto al heading (~140 grados)
const IMPACT_FALLBACK_RANGE = RANGE_MELEE + 0.35;
const FINISHER_HIT_STOP = 0.07;
const FINISHER_SHAKE = 0.020;
const STREAK_WINDOW = 7;     // s para encadenar kills en racha
const XP_STREAK_MULT_SCALE = 0.18;
const XP_STREAK_MULT_CAP = 1.35;
const KILL_FRENZY_T = 1.35;  // cada kill acelera el siguiente engagement
const KILL_FRENZY_MAX_T = 2.25;
const KILL_FRENZY_SPEED = 1.2;
const KILL_FRENZY_MAX_SPEED = 1.55;
const KILL_HEAL_BASE_PCT = 0.07;
const KILL_HEAL_STREAK_PCT = 0.012;
const KILL_HEAL_MAX_PCT = 0.16;
const KILL_HEAL_LOW_HP_PCT = 0.035;
const KILL_HEAL_BOSS_PCT = 0.24;
const KILL_CHAIN_ATTACK_CD = 0.04;
const KILL_CHAIN_DASH_CD = 0.08;
const KILL_CHAIN_TARGET_RANGE = 14;
const KILL_CHAIN_RANGED_RANGE = 14;
const KILL_CHAIN_SHOT_T = 0.42;
const KILL_CHAIN_LUNGE_RANGE = 9.75;
const KILL_CHAIN_LUNGE_STEP = 3.1;
const KILL_CHAIN_ATTACK_LOCK_T = 0.05;
const KILL_CHAIN_COMBO_T = 0.82;
const KILL_CHAIN_COMBO_MAX_T = 1.12;
const KILL_CHAIN_WOUNDED_BIAS = 2.4;
const KILL_CHAIN_LUNGE_BIAS = 0.75;
const KILL_FRENZY_TRAIL_DIST = 1.35;
const AUTO_TARGET_WOUNDED_BIAS = 1.35;
const AUTO_TARGET_LUNGE_BIAS = 0.35;
const KILL_RUPTURE_MIN_STREAK = 3;
const KILL_RUPTURE_RANGE = 4.2;
const KILL_RUPTURE_MAX_HITS = 4;
const KILL_RUPTURE_DAMAGE_MULT = 0.34;
const KILL_RUPTURE_HEAVY_DAMAGE_RATIO = 0.92;
const KILL_RUPTURE_OVERKILL_RATIO = 0.28;
const ATTACK_INPUT_BUFFER_T = 0.52;
const ATTACK_INTENT_T = 1.1;
const ATTACK_CHAIN_RETRY_T = 0.18;
const SKILL_PRIORITY_T = 0.28;
const SKILL_BASIC_LOCK_T = 0.16;
const SKILL_HEAVY_PRIORITY_T = 0.42;
const SKILL_HEAVY_BASIC_LOCK_T = 0.24;
const SKILL_LUNGE_RANGE = 8.4;
const SKILL_LUNGE_STEP = 4.8;
const SKILL_LUNGE_KEEP = 1.6;
const SPIN_PULSE_DELAYS = [0.08, 0.15, 0.23];
const SPIN_PULSE_DAMAGE_MULT = 0.38;
const BLEED_TICK_DELAYS = [0.28, 0.52, 0.76];
const BLEED_DAMAGE_MULT = 0.12;
const SKILL_FOLLOW_ATTACK_CD = 0.045;
const SKILL_FOLLOW_ATTACK_LOCK_T = 0.055;
const SKILL_FOLLOW_HASTE_T = 0.48;
const SKILL_FOLLOW_HASTE = 1.12;
const SKILL_FOLLOW_COMBO_T = 0.62;
const COMBO_MOMENTUM_T = 0.36;
const COMBO_MOMENTUM_HASTE = 1.08;
const COMBO_MOMENTUM_COMBO_T = 0.58;
const COMBO_MOMENTUM_ATTACK_CD = 0.16;
const COMBO_FINISHER_ATTACK_CD = 0.13;
const COMBO_PACK_ATTACK_CD = 0.115;
const COMBO_MOMENTUM_ATTACK_LOCK_T = 0.09;
const COMBO_FINISHER_ATTACK_LOCK_T = 0.075;
const COMBO_MOMENTUM_TRAIL_DIST = 0.95;
const ATTACK_ANIM_SPEED_CAP = 1.5;
const DASH_STRIKE_RADIUS = 2.25;
const DASH_STRIKE_MAX = 3;
const DASH_STRIKE_DAMAGE_MULT = 0.55;
const PERFECT_DODGE_DAMAGE_MULT = 0.72;
const PERFECT_DODGE_DASH_CD = 0.10;
const PERFECT_DODGE_HASTE_T = 0.65;
const PERFECT_DODGE_HASTE = 1.22;
const PERFECT_DODGE_COUNTER_ANIM_SPEED = 1.42;
const PERFECT_DODGE_TRAIL_DIST = 2.15;
const COMBAT_DODGE_RANGE = 7.0;
const MOTION_TRAIL_MIN_DIST = 0.32;
const MOTION_TRAIL_DODGE_DIST = 2.75;
const IMPACT_DELAY_MELEE = 0.09;   // sincroniza sangre/dano con el contacto visual
const IMPACT_DELAY_RANGED = 0.12;  // fallback si un ataque a distancia no tiene punto final
const PROJECTILE_RELEASE_DELAY = 0.045;
const PROJECTILE_MIN_DELAY = 0.10;
const PROJECTILE_MAX_DELAY = 0.42;
const SKILL_IMPACT_DELAY = {
  strike: 0.11, stab: 0.11, pierce: 0.17, bolt: 0.17, execute: 0.18,
  spin: 0.12, bladedance: 0.12, nova: 0.13, leap: 0.18, fireball: 0.20,
  rain: 0.26, storm: 0.26, meteor: 0.32, volley: 0.17,
};
const STARTER_GUARD_T = 32;        // prevents the first pack from deleting a level 1
const STARTER_GUARD_MULT = 0.3;    // still hurts, but leaves room to learn
const STARTER_GUARD_HP_FLOOR = 0.18;
const SHAKE_FULL_RADIUS = 0.55;
const SHAKE_FALLOFF_RADIUS = 3.2;

const NEEDS_TARGET = new Set(['strike', 'stab', 'pierce', 'bolt', 'execute', 'fireball', 'rain', 'storm', 'meteor']);
const AREA_TARGET_TYPES = new Set(['fireball', 'rain', 'storm', 'meteor']);
const HEAVY_SKILL_TYPES = new Set(['execute', 'leap', 'meteor', 'storm']);
const AREA_TARGET_HIT_BONUS = 3.1;
const AREA_TARGET_WOUNDED_BONUS = 0.9;
const EXECUTE_TARGET_WOUNDED_BONUS = 3.2;
const EXECUTE_TARGET_THRESHOLD_BONUS = 5.5;

// clases a distancia disparan un proyectil visible al atacar

export class Combat {
  constructor(opts) {
    this.scene = opts.scene;
    this.camera = opts.camera;
    this.player = opts.player;
    this.mobField = opts.mobField;   // render de los esqueletos del server
    this.net = opts.net;             // cliente multiplayer (dueno de net.mobs)
    this.inv = opts.inventory;
    this.prog = opts.progress;
    this.hud = opts.hud;
    this.effects = opts.effects || null;
    this.onRespawn = opts.onRespawn || (() => {});
    this.onKillRewards = opts.onKillRewards || null;   // (info) -> oro/loot (etapa economia)
    this.skills = opts.skills || null;                 // SkillSystem (etapa skills)
    this.sfx = opts.sfx || null;                       // sonidos procedurales
    this.safeCenter = opts.safeCenter || [-62, -7];    // gruta: cura + zona segura
    this._inGruta = false;
    this.targetId = null;
    this.pvpId = null;       // conn-id del jugador targeteado (excluyente con targetId)
    this.attackCd = 0;
    this.streak = 0;         // kills encadenados dentro de la ventana
    this.streakT = 0;
    this.dmgBuffT = 0;       // buff de dano temporal (Grito de Guerra)
    this.dmgBuffMult = 1;
    this.hitStopT = 0;       // congela el mundo unos ms al conectar (game feel)
    this.slowMoT = 0;        // micro camara-lenta en kills con racha alta
    this.targetLocked = false; // true = target FIJADO por TAB/clic (opcional)
    this._targetHudState = null;
    // Modo normal = manual en cada arranque. El autoataque solo existe si X lo
    // activa en la sesion actual; no se restaura para evitar golpes inesperados.
    this.autoAttack = false;
    try { localStorage.setItem('sauces_auto', '0'); } catch {}
    this._punchT = 0;        // ventana de golpe manual tras un clic/tap
    this.attackIntentT = 0;  // manual intent: keeps one click alive while closing distance
    this.attackIntentId = null;
    this._pvpPunchT = 0;
    this._manualAttackHeld = false;
    this._manualAttackPointerId = null;
    this._manualAttackTarget = null;
    this._manualAttackFirstPending = false;
    this.skillPriorityT = 0;  // evita que el autoataque ensucie una skill recien lanzada
    this._hitTimers = new Map(); // timer -> tipo de impacto pendiente
    this._actionSeq = 0;
    this._activeAction = null;
    this._lastDashSeq = Number(this.player?.dashSeq) || 0;
    this.chainShotT = 0;      // breve alcance extra para proyectiles tras una kill
    this._dashStrikeSeq = 0;
    this._dashStrikeHitIds = new Set();
    this._dodgeCounterSeq = 0;
    this._dodgeCounterHitIds = new Set();
    this._bleedSeq = new Map();
    this.shieldHp = 0;       // escudo de party: absorbe dano antes que la vida
    this.godSaveT = 0;       // GRACIA DIVINA de Diosito: a 1 HP + lifesteal 99%
    this._holoOn = false;    // materiales holograficos activos
    this.shieldT = 0;
    this.classSpec = opts.classSpec || null;   // heroe: aura/proyectil/estilo
    this.bloodCoat = opts.bloodCoat || new BloodCoat({
      player: this.player,
      combatStyle: this.classSpec?.combatStyle || this.player?.combatStyle,
    });
    this.inputSurface = opts.inputSurface || (typeof document !== 'undefined' ? document.querySelector?.('canvas') : null);
    this.dead = false;
    this.respawnT = 0;
    this.spawnGraceT = SPAWN_GRACE_T;
    this.starterGuardT = STARTER_GUARD_T;
    this.hpMax = this.prog.hpMax;
    this.hp = this.hpMax;
    this.ray = new THREE.Raycaster();

    addEventListener('pointerdown', (e) => this._onPointerAttack(e));
    addEventListener('pointerup', (e) => this._releaseManualAttack(e));
    addEventListener('pointercancel', (e) => this._cancelManualAttack(e));
    addEventListener('pointermove', (e) => this._onManualAttackPointerMove(e));
    addEventListener('blur', () => this._cancelManualAttack());
    this.inputSurface?.addEventListener?.('pointerleave', (e) => this._cancelManualAttack(e));
    if (typeof document !== 'undefined') {
      document.addEventListener?.('visibilitychange', () => {
        if (document.hidden) this._cancelManualAttack();
      });
    }
    addEventListener('keydown', (e) => {
      if (matchesAction(e, 'targetNext') && !this.player.locked) { e.preventDefault(); this._cycleTarget(); }
    });

    // el server avisa cuando un mob muere; canal aparte del render (onMobDead lo usa MobField)
    this.net.onMobKilled = (id, by, party, meta) => this._onMobDead(id, by, party, meta);
    this.net.onPlayerHit = (hit) => this._onPlayerHit(hit);
    this.net.onPlayerMiss = (miss) => this._onPlayerMiss(miss);
    this.net.onPartySkill = (m) => this.applyPartySkill(m);
    addEventListener('keydown', (e) => {
      if (matchesAction(e, 'toggleAuto') && !e.repeat && !this.player.locked) this.toggleAuto();
      if (matchesAction(e, 'jumpDash') && !e.repeat && !this.player.locked && this.tryCombatDodge()) e.preventDefault?.();
    });

    this.hud.setHP(this.hp, this.hpMax);
    this.hud.setXP(this.prog.xp, this.prog.xpNext, this.prog.level);
  }

  _isGameplayPointer(e) {
    if (!e || e.button !== 0 || e.isPrimary === false || !this.inputSurface) return false;
    return this._isInsideInputSurface(e);
  }

  _isInsideInputSurface(e) {
    const target = e.target;
    return target === this.inputSurface || !!this.inputSurface.contains?.(target);
  }

  _onPointerAttack(e) {
    if (!this._isGameplayPointer(e) || this.player.locked || this.dead) return false;
    this._manualAttackHeld = true;
    this._manualAttackPointerId = e.pointerId ?? null;
    this._manualAttackFirstPending = true;
    this._onClick(e);
    this._manualAttackTarget = this.pvpId != null
      ? { type: 'player', id: this.pvpId }
      : (this.targetId != null ? { type: 'mob', id: this.targetId } : null);
    // PvP requires an explicit click. A world click without a rival buffers one mob strike.
    if (!this.manualAttack() && this.pvpId == null) this.pokeAttack();
    return true;
  }

  _matchesManualAttackPointer(e) {
    if (!e || this._manualAttackPointerId == null || e.pointerId == null) return true;
    return e.pointerId === this._manualAttackPointerId;
  }

  _stopManualAttack({ preserveFirst = false } = {}) {
    if (!this._manualAttackHeld) return false;
    const keepClick = preserveFirst && this._manualAttackFirstPending;
    this._manualAttackHeld = false;
    this._manualAttackPointerId = null;
    this._manualAttackTarget = null;
    this._manualAttackFirstPending = false;
    if (!keepClick) {
      this._punchT = 0;
      this._pvpPunchT = 0;
      this._clearAttackIntent();
    }
    return true;
  }

  _releaseManualAttack(e) {
    if (!this._matchesManualAttackPointer(e)) return false;
    if (!this._isInsideInputSurface(e)) return this._cancelManualAttack(e);
    return this._stopManualAttack({ preserveFirst: true });
  }

  _cancelManualAttack(e = null) {
    if (!this._matchesManualAttackPointer(e)) return false;
    return this._stopManualAttack();
  }

  _onManualAttackPointerMove(e) {
    if (!this._manualAttackHeld || !this._matchesManualAttackPointer(e)) return false;
    if (!this._isInsideInputSurface(e)) return this._cancelManualAttack(e);
    return false;
  }

  _markManualAttackStarted(type, id) {
    if (!this._manualAttackHeld) return;
    const held = this._manualAttackTarget;
    if (held && (held.type !== type || !Object.is(held.id, id))) return;
    if (!held) this._manualAttackTarget = { type, id };
    this._manualAttackFirstPending = false;
  }

  _refreshManualAttackHold() {
    if (!this._manualAttackHeld) return false;
    if (this.dead || this.player.locked) return this._cancelManualAttack();
    const held = this._manualAttackTarget;
    if (held?.type === 'player') {
      const rival = this.net.remotes.get(held.id);
      if (this.pvpId !== held.id || !rival || !rival.ready || rival.dead) return this._cancelManualAttack();
      return this.manualAttack();
    }
    if (held?.type === 'mob') {
      const mob = this.net.mobs.get(held.id);
      if (this.targetId !== held.id || !mob || (mob.hp ?? 0) <= 0) return this._cancelManualAttack();
    }
    return this.pokeAttack();
  }

  _onClick(e) {
    if (e.button !== 0 || this.player.locked || this.dead) return;
    const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hits = this.ray.intersectObjects(this.mobField.meshes(), true);
    const mob = this.mobField.pickFromIntersections(hits);
    if (mob) { this._setTarget(mob.id); return; }
    // sin mob bajo el mouse: probar contra los JUGADORES remotos (PvP)
    const roots = [];
    const byRoot = new Map();
    for (const [pid, r] of this.net.remotes) {
      if (!r.ready || this._inParty(pid)) continue;
      roots.push(r.root);
      byRoot.set(r.root, pid);
    }
    if (!roots.length) return;
    for (const h of this.ray.intersectObjects(roots, true)) {
      let o = h.object;
      while (o && !byRoot.has(o)) o = o.parent;
      if (o) { this._setPvpTarget(byRoot.get(o)); return; }
    }
  }

  _inParty(pid) {
    return this.net.party.some((mem) => mem.id === pid);
  }

  _cycleTarget() {
    // TAB recorre hostiles vivos por distancia. Repetirlo ya no selecciona
    // eternamente al mismo mob cuando un pack rodea al jugador.
    const p = this.player.pos;
    const candidates = [];
    for (const m of this.net.mobs.values()) {
      if (!m || (m.hp ?? 0) <= 0) continue;
      const d = Math.hypot(m.x - p.x, m.z - p.z);
      if (d < 35) candidates.push({ kind: 'mob', id: m.id, d, key: 'mob:' + String(m.id) });
    }
    for (const [pid, r] of this.net.remotes) {
      if (!r.ready || r.dead || this._inParty(pid)) continue;
      const d = Math.hypot(r.x - p.x, r.z - p.z);
      if (d < 35) candidates.push({ kind: 'player', id: pid, d, key: 'player:' + String(pid) });
    }
    if (!candidates.length) return false;
    candidates.sort((a, b) => a.d - b.d || a.key.localeCompare(b.key));
    const currentKey = this.pvpId != null
      ? 'player:' + String(this.pvpId)
      : (this.targetId != null ? 'mob:' + String(this.targetId) : '');
    const currentIdx = candidates.findIndex((entry) => entry.key === currentKey);
    const next = candidates[currentIdx >= 0 ? (currentIdx + 1) % candidates.length : 0];
    if (next.kind === 'mob') this._setTarget(next.id);
    else this._setPvpTarget(next.id);
    return true;
  }

  _clearMobTarget() {
    if (this.targetId != null) {
      this.mobField.setTargeted(this.targetId, false);
      this._targetHudState = null;
    }
    this.targetId = null;
    this.targetLocked = false;
  }

  _syncTargetHud(kind, id, name, hp, hpMax, locked = false) {
    const next = { kind, id, name: name || '', hp, hpMax, locked: !!locked };
    const prev = this._targetHudState;
    if (prev
      && prev.kind === next.kind
      && Object.is(prev.id, next.id)
      && prev.name === next.name
      && Object.is(prev.hp, next.hp)
      && Object.is(prev.hpMax, next.hpMax)
      && prev.locked === next.locked) return false;
    this.hud.showTarget(next.name, next.hp, next.hpMax, next.locked);
    this._targetHudState = next;
    return true;
  }

  _syncMobTargetHud(m, locked = this.targetLocked) {
    if (!m) return false;
    const name = (m.b ? '\ud83d\udc80 ABOMINACI\u00d3N Nv.' : 'Zombi Nv.') + m.lvl;
    return this._syncTargetHud('mob', m.id, name, m.hp, m.hpMax, locked);
  }

  _hideTarget() {
    this._targetHudState = null;
    this.hud.hideTarget();
  }

  _setTarget(id) {
    const sameState = this.pvpId == null && this.targetId === id && this.targetLocked;
    this.pvpId = null;
    if (this.targetId != null && this.targetId !== id) this.mobField.setTargeted(this.targetId, false);
    this.targetId = id;
    this.targetLocked = true;
    if (!sameState) this.mobField.setTargeted(id, true, true);
    const m = this.net.mobs.get(id);
    if (m) this._syncMobTargetHud(m, true);
  }

  _setSoftTarget(id) {
    if (id == null || !this.net.mobs.has(id)) return;
    const sameState = this.pvpId == null && this.targetId === id && !this.targetLocked;
    this.pvpId = null;
    if (this.targetId != null && this.targetId !== id) this.mobField.setTargeted(this.targetId, false);
    this.targetId = id;
    this.targetLocked = false;
    if (!sameState) this.mobField.setTargeted(id, true, false);
    const m = this.net.mobs.get(id);
    if (m) this._syncMobTargetHud(m, false);
  }

  _setPvpTarget(pid) {
    this._clearMobTarget();
    this.pvpId = pid;
    const r = this.net.remotes.get(pid);
    // vida del rival es de SU cliente: mostramos frame con barra llena
    this._syncTargetHud('player', pid, '⚔ ' + ((r && r.name) || 'Jugador'), 1, 1, true);
  }

  // golpe manual: abre una ventana corta para que el loop conecte UN ataque
  pokeAttack() {
    if (this.dead || this.player.locked) return false;
    this._breakSpawnGrace();
    this._punchT = Math.max(this._punchT || 0, ATTACK_INPUT_BUFFER_T);
    this.attackIntentT = Math.max(this.attackIntentT || 0, ATTACK_INTENT_T);
    this.attackIntentId = this.targetId ?? null;
    return true;
  }

  _clearAttackIntent() {
    this.attackIntentT = 0;
    this.attackIntentId = null;
  }

  _breakSpawnGrace() {
    this.spawnGraceT = 0;
  }

  // X: alterna entre combate manual (clic) y auto-farmeo
  toggleAuto() {
    this.autoAttack = !this.autoAttack;
    localStorage.setItem('sauces_auto', this.autoAttack ? '1' : '0');
    if (!this.autoAttack) {
      this._punchT = 0;
      this._clearAttackIntent();
      this.chainShotT = 0;
      this._clearImpacts('basic');
    }
    this.hud.toast(this.autoAttack ? '\u2694\ufe0f Auto-pelea ACTIVADA (X apaga)' : '\ud83d\udd90\ufe0f Combate MANUAL: cada clic es un golpe (X reactiva)');
  }

  // factor de tiempo del mundo: hit-stop (freeze corto) > slow-mo (racha) > 1.
  // Se llama con el dt REAL del frame; decae los timers aqui mismo.
  timeFactor(rawDt) {
    if (this.hitStopT > 0) { this.hitStopT -= rawDt; return 0.12; }
    if (this.slowMoT > 0) { this.slowMoT -= rawDt; return 0.3; }
    return 1;
  }

  _playerAtk() {
    const w = this.inv.equippedWeapon;
    const buff = this.dmgBuffT > 0 ? (this.dmgBuffMult || 1) : 1;
    return (9 + this.prog.level * 2 + (w ? w.atk * 0.5 : 0)) * buff;
  }

  // tajo en arco: pega a hasta 3 zombies extra frente al jugador (70% del daño)
  _cleave(mainId, dmg) {
    const px = this.player.pos.x, pz = this.player.pos.z, hd = this.player.heading;
    let extra = 0;
    for (const m of this.net.mobs.values()) {
      if (extra >= 3 || !m || m.id === mainId || (m.hp ?? 0) <= 0) continue;
      const dx = m.x - px, dz = m.z - pz;
      if (Math.hypot(dx, dz) > CLEAVE_RANGE) continue;
      let diff = Math.atan2(dx, dz) - hd;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > CLEAVE_ARC) continue;
      extra++;
      const sdmg = Math.round(dmg * 0.7);
      this.net.attackMob(m.id, sdmg, 'cleave');
      if (this.skills) this.skills.onHit?.();
      if (this.effects) {
        this.effects.bloodHit({ x: m.x, y: 1.0, z: m.z });
        this.effects.damageNumber({ x: m.x, y: 1.6, z: m.z }, sdmg, {});
      }
    }
    return extra;
  }

  _meleeImpactFallback(skipId, heading = this.player.heading) {
    const px = this.player.pos.x, pz = this.player.pos.z;
    let best = null, bestId = null, bestScore = IMPACT_FALLBACK_RANGE;
    for (const [mid, m] of this.net.mobs) {
      const id = m?.id ?? mid;
      if (!m || id === skipId || (m.hp ?? 0) <= 0) continue;
      const dx = m.x - px, dz = m.z - pz;
      const d = Math.hypot(dx, dz);
      if (d > IMPACT_FALLBACK_RANGE) continue;
      let diff = Math.atan2(dx, dz) - heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > CLEAVE_ARC) continue;
      const score = this._targetPressureScore(m, d, AUTO_TARGET_WOUNDED_BIAS, 0, 0);
      if (score < bestScore) { bestScore = score; best = m; bestId = id; }
    }
    return best ? { id: bestId, mob: best } : null;
  }

  _dashStrike() {
    if (!this.player.isDashing?.()) return 0;
    const seq = this.player.dashSeq || 0;
    if (seq !== this._dashStrikeSeq) {
      this._dashStrikeSeq = seq;
      this._dashStrikeHitIds.clear();
    }
    if (this._dashStrikeHitIds.size >= DASH_STRIKE_MAX) return 0;
    const px = this.player.pos.x, pz = this.player.pos.z;
    const near = [];
    for (const m of this.net.mobs.values()) {
      if (!m || (m.hp ?? 0) <= 0 || this._dashStrikeHitIds.has(m.id)) continue;
      const d = Math.hypot(m.x - px, m.z - pz);
      if (d <= DASH_STRIKE_RADIUS) near.push({ m, d });
    }
    near.sort((a, b) => a.d - b.d);
    const dmg = Math.max(1, Math.round(this._playerAtk() * DASH_STRIKE_DAMAGE_MULT));
    let hits = 0;
    for (const { m } of near.slice(0, DASH_STRIKE_MAX - this._dashStrikeHitIds.size)) {
      this._dashStrikeHitIds.add(m.id);
      hits++;
      this.net.attackMob(m.id, dmg, 'skill');
      if (this.skills) this.skills.onHit?.();
      if (this.effects) {
        this.effects.bloodHit({ x: m.x, y: 1.0, z: m.z });
        this.effects.damageNumber({ x: m.x, y: 1.45, z: m.z }, dmg, {});
      }
      if (!this.targetId) this._setSoftTarget(m.id);
    }
    if (hits) {
      this._breakSpawnGrace();
      this.hitStopT = Math.max(this.hitStopT, 0.035);
      if (this.sfx) this.sfx.hit?.(false);
      if (this.effects) {
        this.effects.slashArc(this.player.pos, this.player.heading, (this.classSpec && this.classSpec.auraColor) || 0xfff2d8);
        this._localShake(this.player.pos, 0.045, 0.08);
      }
    }
    return hits;
  }

  _perfectDodgeCounter(hit) {
    if (!hit || !hit.told || hit.id == null) return false;
    const seq = this.player.dashSeq || 0;
    if (seq !== this._dodgeCounterSeq) {
      this._dodgeCounterSeq = seq;
      this._dodgeCounterHitIds.clear();
    }
    if (this._dodgeCounterHitIds.has(hit.id)) return false;
    const mob = this.net.mobs.get(hit.id);
    if (!mob || mob.hp <= 0) return false;
    this._dodgeCounterHitIds.add(hit.id);
    const dmg = Math.max(1, Math.round(this._playerAtk() * PERFECT_DODGE_DAMAGE_MULT));
    this.player.heading = Math.atan2(mob.x - this.player.pos.x, mob.z - this.player.pos.z);
    this.player.queueCounterAttack?.(PERFECT_DODGE_COUNTER_ANIM_SPEED);
    this.net.sendAttack?.('counter', { tt: 'mob', id: mob.id, x: mob.x, z: mob.z, am: PERFECT_DODGE_COUNTER_ANIM_SPEED });
    this.net.attackMob(mob.id, dmg, 'skill');
    this.player.dashCd = Math.min(Math.max(0, this.player.dashCd || 0), PERFECT_DODGE_DASH_CD);
    this.player.speedBuffT = Math.max(this.player.speedBuffT || 0, PERFECT_DODGE_HASTE_T);
    this.player.speedBuffMult = Math.max(this.player.speedBuffMult || 1, PERFECT_DODGE_HASTE);
    this.hitStopT = Math.max(this.hitStopT, 0.055);
    if (!this.targetId) this._setSoftTarget(mob.id);
    if (this.sfx) this.sfx.hit?.(false);
    if (this.effects) {
      const aura = (this.classSpec && this.classSpec.auraColor) || 0xfff2d8;
      const dx = mob.x - this.player.pos.x, dz = mob.z - this.player.pos.z;
      const dd = Math.hypot(dx, dz);
      if (dd > MOTION_TRAIL_MIN_DIST && this.effects.dashTrail) {
        const k = Math.min(PERFECT_DODGE_TRAIL_DIST, dd) / dd;
        this.effects.dashTrail(
          { x: this.player.pos.x, y: 0, z: this.player.pos.z },
          { x: this.player.pos.x + dx * k, y: 0, z: this.player.pos.z + dz * k },
          aura,
          { width: 0.46, opacity: 0.34 },
        );
      }
      this.effects.slashArc?.(this.player.pos, this.player.heading, aura);
      this.effects.bloodHit?.({ x: mob.x, y: 1.0, z: mob.z });
      this.effects.damageNumber?.({ x: mob.x, y: 1.55, z: mob.z }, dmg, { crit: true });
      this.effects.hitFlash?.({ x: this.player.pos.x, y: 1.2, z: this.player.pos.z }, 0x8fffd8);
      this._localShake(this.player.pos, 0.032, 0.07, 2.8);
    }
    if (this.skills) this.skills.onHit?.();
    return true;
  }

  _isMoving() {
    if (this.player?.actionDown) {
      return !!(this.player.actionDown('moveForward') || this.player.actionDown('moveBack') || this.player.actionDown('moveLeft') || this.player.actionDown('moveRight'));
    }
    const k = this.player.keys || {};
    return !!(k['KeyW'] || k['KeyS'] || k['KeyA'] || k['KeyD']);
  }

  _skillTargetRange(s) {
    if (Number.isFinite(Number(s?.range))) return Number(s.range);
    if (['fireball', 'rain', 'storm', 'meteor', 'pierce', 'bolt'].includes(s?.type)) return 16;
    if (PROJECTILE_BY_CHAR[this.player.charFile]) return 15;
    return 7;
  }

  _skillAreaRadius(s) {
    if (Number.isFinite(Number(s?.radius))) return Number(s.radius);
    if (s?.type === 'meteor') return 7;
    if (s?.type === 'rain' || s?.type === 'storm') return 5;
    if (s?.type === 'fireball') return 3.5;
    return 4;
  }

  _areaTargetMob(s, maxRange) {
    const p = this.player.pos;
    const current = this.targetId ? this.net.mobs.get(this.targetId) : null;
    if (this.targetLocked && current && current.hp > 0 && Math.hypot(current.x - p.x, current.z - p.z) <= maxRange) return current;
    const radius = this._skillAreaRadius(s);
    let best = null, bestScore = -Infinity;
    for (const m of this.net.mobs.values()) {
      if (!m || (m.hp ?? 0) <= 0) continue;
      const d = Math.hypot(m.x - p.x, m.z - p.z);
      if (d > maxRange) continue;
      let hits = 0, weak = 0;
      for (const other of this.net.mobs.values()) {
        if (!other || (other.hp ?? 0) <= 0) continue;
        if (Math.hypot(other.x - m.x, other.z - m.z) > radius) continue;
        hits++;
        weak += 1 - this._mobHpRatio(other);
      }
      const score = hits * AREA_TARGET_HIT_BONUS + weak * AREA_TARGET_WOUNDED_BONUS - d * 0.28;
      if (score > bestScore) { bestScore = score; best = m; }
    }
    return best;
  }

  _executeTargetMob(s, maxRange) {
    const p = this.player.pos;
    const current = this.targetId ? this.net.mobs.get(this.targetId) : null;
    if (this.targetLocked && current && current.hp > 0 && Math.hypot(current.x - p.x, current.z - p.z) <= maxRange) return current;
    const threshold = Math.max(0.05, Math.min(0.95, Number(s?.threshold) || 0.4));
    let best = null, bestScore = maxRange;
    for (const m of this.net.mobs.values()) {
      if (!m || (m.hp ?? 0) <= 0) continue;
      const d = Math.hypot(m.x - p.x, m.z - p.z);
      if (d > maxRange) continue;
      const ratio = this._mobHpRatio(m);
      const wounded = 1 - ratio;
      const executable = ratio <= threshold ? EXECUTE_TARGET_THRESHOLD_BONUS : 0;
      const score = d - wounded * EXECUTE_TARGET_WOUNDED_BONUS - executable;
      if (score < bestScore) { bestScore = score; best = m; }
    }
    return best;
  }

  _skillTargetMob(s) {
    const range = this._skillTargetRange(s);
    if (s?.type === 'execute') return this._executeTargetMob(s, range);
    return AREA_TARGET_TYPES.has(s?.type) ? this._areaTargetMob(s, range) : this._nearestMob(range);
  }

  _skillImpactDelay(type) {
    return SKILL_IMPACT_DELAY[type] ?? 0.12;
  }

  _projectileImpactDelay(from, to, type, minDelay = PROJECTILE_MIN_DELAY, maxDelay = PROJECTILE_MAX_DELAY, releaseDelay = 0) {
    const ax = Number.isFinite(Number(from?.x)) ? Number(from.x) : 0;
    const az = Number.isFinite(Number(from?.z)) ? Number(from.z) : 0;
    const bx = Number.isFinite(Number(to?.x)) ? Number(to.x) : ax;
    const bz = Number.isFinite(Number(to?.z)) ? Number(to.z) : az;
    const dist = Math.hypot(bx - ax, bz - az);
    const flightDelay = PROJECTILE_RELEASE_DELAY + dist / projectileSpeed(type);
    const release = Math.max(0, Number(releaseDelay) || 0);
    return release + Math.max(minDelay, Math.min(maxDelay, flightDelay));
  }

  _skillReleaseDelay(s) {
    return skillReleaseDelay(s?.type, this.classSpec?.combatStyle, this.player.charFile);
  }

  _localShake(origin, amp = 0.07, dur = 0.12, maxRange = SHAKE_FALLOFF_RADIUS) {
    if (!this.effects?.shake || !this.player?.pos || !origin) return false;
    const ox = Number(origin.x);
    const oz = Number(origin.z);
    if (!Number.isFinite(ox) || !Number.isFinite(oz)) return false;
    const d = Math.hypot(ox - this.player.pos.x, oz - this.player.pos.z);
    if (d > maxRange) return false;
    const denom = Math.max(0.001, maxRange - SHAKE_FULL_RADIUS);
    const k = d <= SHAKE_FULL_RADIUS ? 1 : Math.max(0, 1 - (d - SHAKE_FULL_RADIUS) / denom);
    const scaledAmp = Math.max(0.0005, amp * k);
    const scaledDur = Math.max(0.010, dur * (0.45 + 0.55 * k));
    this.effects.shake(scaledAmp, scaledDur);
    return true;
  }

  _skillImpactFeedback(hitCount, heavy = false, origin = null) {
    const hits = Math.max(0, Number(hitCount) || 0);
    if (!hits) return;
    this.hitStopT = Math.max(this.hitStopT, heavy || hits >= 3 ? 0.075 : 0.05);
    if (this.sfx) this.sfx.hit?.(heavy || hits >= 3);
    this._localShake(origin, heavy || hits >= 3 ? 0.058 : 0.034, heavy || hits >= 3 ? 0.095 : 0.07);
  }

  _skillFollowThrough(m, hitCount = 1, opts = {}) {
    if (!m || m.id == null || this.dead || this.player.locked || PROJECTILE_BY_CHAR[this.player.charFile]) return false;
    if ((m.hp ?? 1) <= 0) return false;
    if (this.targetLocked && this.targetId !== m.id) return false;
    if (!this.targetLocked) this._setSoftTarget(m.id);
    const hits = Math.max(1, Number(hitCount) || 1);
    this.attackCd = Math.min(Math.max(0, this.attackCd || 0), opts.attackCd ?? SKILL_FOLLOW_ATTACK_CD);
    const lockT = opts.attackLock ?? Math.max(0.025, SKILL_FOLLOW_ATTACK_LOCK_T - Math.min(0.025, (hits - 1) * 0.008));
    this.player.attackT = Math.min(Math.max(0, this.player.attackT || 0), lockT);
    this.player.comboT = Math.max(this.player.comboT || 0, SKILL_FOLLOW_COMBO_T + Math.min(0.18, (hits - 1) * 0.04));
    this.player.speedBuffT = Math.max(this.player.speedBuffT || 0, SKILL_FOLLOW_HASTE_T + Math.min(0.18, (hits - 1) * 0.03));
    this.player.speedBuffMult = Math.max(this.player.speedBuffMult || 1, SKILL_FOLLOW_HASTE);
    if (hits >= 2) this._momentumPulse({ dist: COMBO_MOMENTUM_TRAIL_DIST, width: 0.34, opacity: 0.22, minGap: 90 });
    return true;
  }

  _comboMomentum(opts = {}) {
    if (!this.player || PROJECTILE_BY_CHAR[this.player.charFile]) return false;
    const cleaveHits = Math.max(0, Number(opts.cleaveHits) || 0);
    const hitCount = 1 + cleaveHits;
    const heavy = !!(opts.finisher || opts.crit || cleaveHits >= 2);
    const hasteT = Math.min(0.62, COMBO_MOMENTUM_T + Math.min(0.16, hitCount * 0.035) + (heavy ? 0.08 : 0));
    const haste = Math.min(1.18, COMBO_MOMENTUM_HASTE + Math.min(0.045, cleaveHits * 0.012) + (opts.finisher ? 0.035 : 0) + (opts.crit ? 0.02 : 0));
    const comboCarry = COMBO_MOMENTUM_COMBO_T + Math.min(0.14, cleaveHits * 0.03) + (heavy ? 0.08 : 0);
    const cd = cleaveHits >= 2
      ? COMBO_PACK_ATTACK_CD
      : (heavy ? COMBO_FINISHER_ATTACK_CD : COMBO_MOMENTUM_ATTACK_CD);
    const lockT = heavy ? COMBO_FINISHER_ATTACK_LOCK_T : COMBO_MOMENTUM_ATTACK_LOCK_T;
    this.player.speedBuffT = Math.max(this.player.speedBuffT || 0, hasteT);
    this.player.speedBuffMult = Math.max(this.player.speedBuffMult || 1, haste);
    this.player.comboT = Math.max(this.player.comboT || 0, comboCarry);
    this.player.attackT = Math.min(Math.max(0, this.player.attackT || 0), lockT);
    this.attackCd = Math.min(Math.max(0, this.attackCd || 0), cd);
    if (heavy || cleaveHits > 0) this._momentumPulse({
      dist: heavy ? 1.15 : COMBO_MOMENTUM_TRAIL_DIST,
      width: heavy ? 0.42 : 0.34,
      opacity: heavy ? 0.32 : 0.24,
      minGap: 75,
    });
    return true;
  }

  _bleedMob(id, sourceDmg, opts = {}) {
    const mobId = Number(id);
    if (!Number.isInteger(mobId) || PROJECTILE_BY_CHAR[this.player.charFile]) return 0;
    const m = this.net.mobs.get(mobId);
    if (!m || (m.hp ?? 0) <= 0) return 0;
    const delays = opts.delays || BLEED_TICK_DELAYS;
    const mult = Number.isFinite(Number(opts.mult)) ? Number(opts.mult) : BLEED_DAMAGE_MULT;
    const dmg = Math.max(1, Math.round(Math.max(1, Number(sourceDmg) || 1) * mult));
    const seq = (this._bleedSeq.get(mobId) || 0) + 1;
    this._bleedSeq.set(mobId, seq);
    for (let i = 0; i < delays.length; i++) {
      const delay = delays[i];
      const last = i === delays.length - 1;
      this._queueImpact(delay, () => {
        if (this._bleedSeq.get(mobId) !== seq) return;
        const live = this.net.mobs.get(mobId);
        if (!live || (live.hp ?? 0) <= 0) { this._bleedSeq.delete(mobId); return; }
        this.net.attackMob(mobId, dmg, 'bleed');
        if (this.effects) {
          this.effects.bloodHit?.({ x: live.x, y: 0.85, z: live.z });
          this.effects.damageNumber?.({ x: live.x, y: 1.35, z: live.z }, dmg, { crit: !!opts.crit });
          if (last) this.effects.goreBurst?.({ x: live.x, y: 0.78, z: live.z }, opts.crit ? 0.45 : 0.28);
        }
        if (last && this._bleedSeq.get(mobId) === seq) this._bleedSeq.delete(mobId);
      }, 'bleed');
    }
    return delays.length;
  }

  _applyKillFrenzy(m) {
    if (!this.player) return;
    const streak = Math.max(1, this.streak || 1);
    const boss = !!(m && m.b);
    const t = Math.min(KILL_FRENZY_MAX_T, KILL_FRENZY_T + Math.min(8, streak - 1) * 0.1 + (boss ? 0.35 : 0));
    const mult = Math.min(KILL_FRENZY_MAX_SPEED, KILL_FRENZY_SPEED + Math.min(9, streak - 1) * 0.035 + (boss ? 0.1 : 0));
    this.player.speedBuffT = Math.max(this.player.speedBuffT || 0, t);
    this.player.speedBuffMult = Math.max(this.player.speedBuffMult || 1, mult);
    const comboCarry = Math.min(KILL_CHAIN_COMBO_MAX_T, KILL_CHAIN_COMBO_T + Math.min(8, streak - 1) * 0.035 + (boss ? 0.16 : 0));
    this.player.comboT = Math.max(this.player.comboT || 0, comboCarry);
    this.player.attackT = Math.min(Math.max(0, this.player.attackT || 0), boss ? 0 : KILL_CHAIN_ATTACK_LOCK_T);
    this.attackCd = Math.min(Math.max(0, this.attackCd || 0), KILL_CHAIN_ATTACK_CD);
    this.player.dashCd = Math.min(Math.max(0, this.player.dashCd || 0), boss ? 0 : KILL_CHAIN_DASH_CD);
    if (PROJECTILE_BY_CHAR[this.player.charFile]) {
      this.chainShotT = Math.max(this.chainShotT || 0, KILL_CHAIN_SHOT_T + Math.min(0.18, Math.max(0, streak - 1) * 0.02) + (boss ? 0.18 : 0));
    }
    this._momentumPulse({
      dist: KILL_FRENZY_TRAIL_DIST + Math.min(0.55, Math.max(0, streak - 1) * 0.06) + (boss ? 0.32 : 0),
      width: boss ? 0.52 : 0.42,
      opacity: boss ? 0.36 : 0.28,
      minGap: 60,
    });
    this.skills?.onKill?.(streak, boss);
  }

  _killSustain(m) {
    if (this.dead || this.hp >= this.hpMax) return 0;
    const streak = Math.max(1, this.streak || 1);
    const hpRatio = this.hp / Math.max(1, this.hpMax);
    const boss = !!(m && m.b);
    const lowHpBonus = hpRatio <= 0.35 ? KILL_HEAL_LOW_HP_PCT : 0;
    const pct = boss
      ? KILL_HEAL_BOSS_PCT
      : Math.min(KILL_HEAL_MAX_PCT, KILL_HEAL_BASE_PCT + Math.max(0, streak - 1) * KILL_HEAL_STREAK_PCT + lowHpBonus);
    const before = this.hp;
    const heal = Math.max(1, Math.round(this.hpMax * pct));
    this.hp = Math.min(this.hpMax, this.hp + heal);
    const gained = Math.max(0, Math.round(this.hp - before));
    if (!gained) return 0;
    if (this.effects) {
      this.effects.damageNumber?.({ x: this.player.pos.x, y: 2.25, z: this.player.pos.z }, gained, { heal: true });
      if (boss || streak >= 2 || hpRatio <= 0.35) this.effects.healBurst?.({ x: this.player.pos.x, y: 0.65, z: this.player.pos.z });
    }
    return gained;
  }

  _killRupture(deadMob, meta = {}) {
    if (!deadMob || !this.net || !this.net.mobs) return 0;
    const kind = String(meta.kind || meta.k || '');
    const boss = !!(meta.boss || deadMob.b);
    const hpMax = Math.max(1, Number(meta.hpMax) || Number(deadMob.hpMax) || 1);
    const hpBeforeRaw = Number(meta.hpBefore);
    const hpBefore = Math.max(0, Number.isFinite(hpBeforeRaw) ? hpBeforeRaw : (Number(deadMob.hp) || 0));
    const dmg = Math.max(0, Number(meta.dmg) || 0);
    const heavyKill = boss || kind === 'skill' || kind === 'cleave' || (this.autoAttack && kind === 'heavy');
    const deliberateSplash = this.autoAttack || heavyKill;
    if (!deliberateSplash) return 0;
    const overkillRatio = dmg > 0 ? Math.max(0, dmg - hpBefore) / hpMax : 0;
    const damageRatio = dmg > 0 ? dmg / hpMax : 0;
    const streakRupture = this.streak >= KILL_RUPTURE_MIN_STREAK;
    const overkillRupture = heavyKill && (damageRatio >= KILL_RUPTURE_HEAVY_DAMAGE_RATIO || overkillRatio >= KILL_RUPTURE_OVERKILL_RATIO);
    if (!streakRupture && !overkillRupture) return 0;
    const targets = [];
    for (const [mid, m] of this.net.mobs) {
      const id = m?.id ?? mid;
      if (!m || id === deadMob.id || (m.hp ?? 0) <= 0) continue;
      const d = Math.hypot((m.x || 0) - deadMob.x, (m.z || 0) - deadMob.z);
      if (d <= KILL_RUPTURE_RANGE) targets.push({ id, m, d });
    }
    if (!targets.length) return 0;
    targets.sort((a, b) => a.d - b.d);
    const pressure = streakRupture ? Math.max(0, this.streak - KILL_RUPTURE_MIN_STREAK) : Math.min(4, Math.floor(overkillRatio * 5));
    const mult = KILL_RUPTURE_DAMAGE_MULT
      + Math.min(0.16, pressure * 0.025)
      + (overkillRupture ? Math.min(0.08, Math.max(overkillRatio, damageRatio - 1) * 0.04) : 0);
    const ruptureDmg = Math.max(1, Math.round(this._playerAtk() * mult * (boss ? 1.25 : 1)));
    let hits = 0;
    for (const t of targets.slice(0, KILL_RUPTURE_MAX_HITS)) {
      this.net.attackMob?.(t.id, ruptureDmg, 'skill');
      hits++;
      if (this.effects) {
        this.effects.bloodHit?.({ x: t.m.x, y: 0.9, z: t.m.z });
        this.effects.damageNumber?.({ x: t.m.x, y: 1.2, z: t.m.z }, ruptureDmg, { crit: this.streak >= 5 || overkillRupture });
      }
    }
    if (hits && this.effects) {
      this.effects.nova?.({ x: deadMob.x, y: 0.12, z: deadMob.z }, 0xff3020, KILL_RUPTURE_RANGE);
      this._localShake(deadMob, 0.042 + Math.min(0.025, hits * 0.006), 0.08);
    }
    if (hits) this._skillImpactFeedback(hits, this.streak >= 5 || overkillRupture, deadMob);
    return hits;
  }

  _combatHaste() {
    if (!this.player || (this.player.speedBuffT || 0) <= 0) return 1;
    return Math.max(1, Math.min(KILL_FRENZY_MAX_SPEED, this.player.speedBuffMult || 1));
  }

  _attackCooldown() {
    return Math.max(0.19, ATTACK_CD / this._combatHaste());
  }

  _attackAnimSpeed() {
    return Math.min(ATTACK_ANIM_SPEED_CAP, this._combatHaste());
  }

  _killXp(lvl, mult = 1, boss = false) {
    const mobLevel = Math.max(1, Math.floor(Number(lvl) || 1));
    const base = 1.7 + mobLevel * 1.15;
    const bossMult = boss ? 2.4 : 1;
    const rewardMult = Math.max(1, Number(mult) || 1);
    const xpMult = Math.min(XP_STREAK_MULT_CAP, 1 + (rewardMult - 1) * XP_STREAK_MULT_SCALE);
    return Math.max(2, Math.round(base * xpMult * bossMult));
  }

  _bufferPvpAttack(seconds = ATTACK_INPUT_BUFFER_T) {
    this._pvpPunchT = Math.max(this._pvpPunchT || 0, seconds);
    return true;
  }

  _isDodgeActionActive() {
    return !!(this.player?.isDashing?.() || (this.player?.dashVisualT || 0) > 0);
  }

  _tryPvpAttack(rival, { buffer = false, keepQueued = false } = {}) {
    if (this.dead || this.player.locked || !rival || !rival.ready) return false;
    const d = Math.hypot(rival.x - this.player.pos.x, rival.z - this.player.pos.z);
    if (d >= ATTACK_RANGE) return false;
    const busy = this.attackCd > 0 || (this.player.attackT || 0) > 0 || this._isDodgeActionActive();
    if (busy) {
      if (buffer || keepQueued) return this._bufferPvpAttack(keepQueued ? ATTACK_CHAIN_RETRY_T : ATTACK_INPUT_BUFFER_T);
      return false;
    }
    const attackHeading = Math.atan2(rival.x - this.player.pos.x, rival.z - this.player.pos.z);
    this._applyActionHeading(attackHeading);
    if (!this.player.attack(false, this._attackAnimSpeed())) {
      if ((buffer || keepQueued) && (this.player.attackT || 0) > 0) return this._bufferPvpAttack(ATTACK_CHAIN_RETRY_T);
      return false;
    }
    const animSpeed = this._attackAnimSpeed();
    this._breakSpawnGrace();
    this.net.sendAttack?.('', { type: 'player', id: this.pvpId, x: rival.x, z: rival.z, animSpeed });
    this._pvpPunchT = 0;
    this._markManualAttackStarted('player', this.pvpId);
    this.attackCd = this._attackCooldown();
    if (this.sfx) { this.sfx.swing?.(); this.sfx.hit?.(false); }
    this.hitStopT = 0.045;
    const atk = this._playerAtk();
    if (this.effects) {
      const ptype = PROJECTILE_BY_CHAR[this.player.charFile];
      if (ptype) this.effects.projectile({ x: this.player.pos.x, y: 1.35, z: this.player.pos.z }, { x: rival.x, y: 0.9, z: rival.z }, ptype);
      this.effects.bloodHit({ x: rival.x, y: 1.0, z: rival.z });
    }
    if (this.skills) this.skills.onHit();
    this.net.attackPlayer(this.pvpId, atk);   // el SERVER valida y se lo manda a la victima
    return true;
  }

  _mobHpRatio(m) {
    const hpMax = Math.max(1, Number(m && m.hpMax) || Number(m && m.hp) || 1);
    return Math.max(0, Math.min(1, (Number(m && m.hp) || 0) / hpMax));
  }

  _nearMobCount(x, z, radius) {
    const ax = Number.isFinite(Number(x)) ? Number(x) : 0;
    const az = Number.isFinite(Number(z)) ? Number(z) : 0;
    const r = Math.max(0, Number(radius) || 0);
    let count = 0;
    for (const m of this.net.mobs.values()) {
      if (!m || (m.hp ?? 0) <= 0) continue;
      if (Math.hypot((m.x || 0) - ax, (m.z || 0) - az) <= r) count++;
    }
    return count;
  }

  _weakestMobHpRatio(maxRange = 7) {
    const p = this.player.pos;
    const r = Math.max(0, Number(maxRange) || 0);
    let best = 1;
    for (const m of this.net.mobs.values()) {
      if (!m || (m.hp ?? 0) <= 0) continue;
      if (Math.hypot((m.x || 0) - p.x, (m.z || 0) - p.z) > r) continue;
      best = Math.min(best, this._mobHpRatio(m));
    }
    return best;
  }

  _targetPressureScore(m, d, woundedBias, lungeBias, lungeRange) {
    const weak = 1 - this._mobHpRatio(m);
    const reachable = d <= lungeRange ? lungeBias : 0;
    return d - weak * woundedBias - reachable;
  }

  _nearestMob(maxRange) {
    const p = this.player.pos;
    const current = this.targetId ? this.net.mobs.get(this.targetId) : null;
    if (current && current.hp > 0 && Math.hypot(current.x - p.x, current.z - p.z) <= maxRange) return current;
    let best = null, bestD = maxRange;
    for (const m of this.net.mobs.values()) {
      if (m.hp <= 0) continue;
      const d = Math.hypot(m.x - p.x, m.z - p.z);
      if (d < bestD) { best = m; bestD = d; }
    }
    return best;
  }

  _canAutoChase(target, d, range) {
    if (!target || PROJECTILE_BY_CHAR[this.player.charFile]) return false;
    if (this.dead || this.player.locked || this.pvpId != null) return false;
    if (!(this.autoAttack || this._punchT > 0 || (this.attackIntentT || 0) > 0)) return false;
    if (this._isMoving() || this.player.isDashing?.()) return false;
    if ((this.player.attackVisualT || 0) > 0 || (this.player.dashVisualT || 0) > 0) return false;
    return d > range && d <= AUTO_CHASE_RANGE;
  }

  _autoChaseTo(target, d, range, dt) {
    if (!this._canAutoChase(target, d, range)) return false;
    this.player.heading = Math.atan2(target.x - this.player.pos.x, target.z - this.player.pos.z);
    const haste = this._combatHaste();
    const step = Math.min(AUTO_CHASE_STEP_MAX, Math.max(0.12, AUTO_CHASE_SPEED * Math.max(0, dt) * haste), Math.max(0, d - range + 0.18));
    if (step <= 0) return false;
    return !!this.player.combatLunge?.(target.x, target.z, step, { chase: true });
  }

  _settleMeleeAttack(target, d) {
    if (!target || PROJECTILE_BY_CHAR[this.player.charFile]) return d;
    if (this.dead || this.player.locked || this.player.isDashing?.()) return d;
    if (!Number.isFinite(d) || d <= MELEE_SETTLE_DIST || d > RANGE_MELEE + 0.12) return d;
    const step = Math.min(MELEE_SETTLE_MAX_STEP, d - MELEE_SETTLE_DIST);
    if (step < MELEE_SETTLE_MIN_STEP) return d;
    const start = { x: this.player.pos.x, z: this.player.pos.z };
    if (!this.player.combatLunge?.(target.x, target.z, step, { settle: true })) return d;
    if (Math.hypot(this.player.pos.x - start.x, this.player.pos.z - start.z) >= 0.32) {
      this._motionTrail(start, this.player.pos, null, { width: 0.28, opacity: 0.18 });
    }
    return Math.hypot(target.x - this.player.pos.x, target.z - this.player.pos.z);
  }

  tryCombatDodge() {
    if (this.dead || this.player.locked || this._isMoving() || this.player.isDashing?.()) return false;
    if (!this.player.grounded || (this.player.dashCd || 0) > 0) return false;
    const mob = this._nearestMob(COMBAT_DODGE_RANGE);
    if (!mob) return false;
    const p = this.player.pos;
    let dx = p.x - mob.x, dz = p.z - mob.z;
    const d = Math.hypot(dx, dz);
    let faceHeading = Math.atan2(mob.x - p.x, mob.z - p.z);
    if (d < 0.01) {
      faceHeading = this.player.heading || 0;
      dx = -Math.sin(faceHeading);
      dz = -Math.cos(faceHeading);
    }
    const start = { x: p.x, z: p.z };
    const ok = this.player.tryDash?.(dx, dz, { faceHeading });
    if (!ok) return false;
    this._lastDashSeq = Number(this.player?.dashSeq) || this._lastDashSeq;
    this._cancelUncommittedAction();
    const td = Math.hypot(dx, dz) || 1;
    this._motionTrail(start, {
      x: start.x + (dx / td) * MOTION_TRAIL_DODGE_DIST,
      z: start.z + (dz / td) * MOTION_TRAIL_DODGE_DIST,
    }, 0x8fffd8, { width: 0.42, opacity: 0.32 });
    this.player._spaceWasDown = true;   // evita que el mismo Space se convierta en salto
    this._breakSpawnGrace();
    this._setSoftTarget(mob.id);
    if (this.effects) this.effects.hitFlash?.({ x: p.x, y: 1.1, z: p.z }, 0x8fffd8);
    return true;
  }

  _motionTrail(from, to, colorHex = null, opts = {}) {
    const fx = this.effects;
    if (!fx?.dashTrail) return false;
    const a = from || this.player.pos, b = to || this.player.pos;
    const dx = (b.x || 0) - (a.x || 0), dz = (b.z || 0) - (a.z || 0);
    if (Math.hypot(dx, dz) < MOTION_TRAIL_MIN_DIST) return false;
    const aura = colorHex ?? ((this.classSpec && this.classSpec.auraColor) || 0x8fffd8);
    return !!fx.dashTrail(a, b, aura, opts);
  }

  _momentumPulse(opts = {}) {
    const fx = this.effects;
    const p = this.player && this.player.pos;
    if (!fx || !p) return false;
    const now = Date.now();
    const minGap = Math.max(0, Number(opts.minGap) || 0);
    if (minGap && this._lastMomentumPulseMs && now - this._lastMomentumPulseMs < minGap) return false;
    const h = Number.isFinite(this.player.heading) ? this.player.heading : 0;
    const dist = Math.max(0.35, Number(opts.dist) || COMBO_MOMENTUM_TRAIL_DIST);
    const color = opts.color ?? ((this.classSpec && this.classSpec.auraColor) || 0x8fffd8);
    let ok = false;
    if (!PROJECTILE_BY_CHAR[this.player.charFile] && fx.dashTrail) {
      const sx = Math.sin(h);
      const sz = Math.cos(h);
      ok = !!fx.dashTrail(
        { x: p.x - sx * dist, y: 0, z: p.z - sz * dist },
        { x: p.x + sx * 0.18, y: 0, z: p.z + sz * 0.18 },
        color,
        {
          width: opts.width || 0.38,
          opacity: opts.opacity || 0.26,
        },
      ) || ok;
    }
    if (fx.hitFlash) ok = !!fx.hitFlash({ x: p.x, y: opts.y || 1.1, z: p.z }, color) || ok;
    if (ok) this._lastMomentumPulseMs = now;
    return ok;
  }

  _applyActionHeading(heading) {
    if (!Number.isFinite(heading)) return false;
    this.player.heading = heading;
    if (this.player.root?.rotation) this.player.root.rotation.y = heading;
    return true;
  }

  _beginAction(kind, heading = null, target = null) {
    const action = {
      seq: ++this._actionSeq,
      kind,
      heading: Number.isFinite(heading) ? heading : null,
      targetType: target?.type || null,
      targetId: target?.id ?? null,
      committed: false,
      invalidated: false,
    };
    this._activeAction = action;
    if (action.heading != null) this._applyActionHeading(action.heading);
    return action;
  }

  _commitAction(action) {
    if (!action || action.invalidated) return false;
    action.committed = true;
    return true;
  }

  _trackedActionHeading(action) {
    if (!action || action.targetId == null) return action?.heading ?? null;
    const target = action.targetType === 'player'
      ? this.net.remotes?.get?.(action.targetId)
      : this.net.mobs?.get?.(action.targetId);
    if (!target || target.hp === 0 || target.dead) return action.heading;
    const heading = Math.atan2(target.x - this.player.pos.x, target.z - this.player.pos.z);
    action.heading = heading;
    return heading;
  }

  _holdActionHeading() {
    const action = this._activeAction;
    if (!action || action.invalidated || action.committed || action.heading == null) return false;
    return this._applyActionHeading(this._trackedActionHeading(action));
  }

  _cancelUncommittedAction() {
    const action = this._activeAction;
    if (!action || action.invalidated || action.committed) return false;
    action.invalidated = true;
    this._clearImpacts(null, action);
    return true;
  }

  _syncDashAction() {
    const dashSeq = Number(this.player?.dashSeq) || 0;
    if (dashSeq === this._lastDashSeq) return false;
    this._lastDashSeq = dashSeq;
    return this._cancelUncommittedAction();
  }

  _queueImpact(delay, fn, kind = 'any', opts = {}) {
    if (typeof fn !== 'function') return;
    const action = opts.action || null;
    const timer = setTimeout(() => {
      this._hitTimers.delete(timer);
      if (this.dead || action?.invalidated) return;
      if (opts.commit && action && !this._commitAction(action)) return;
      try { fn(); } catch { /* no tumbar el loop por un impacto tardio */ }
    }, Math.round(Math.max(0, Number(delay) || 0) * 1000));
    this._hitTimers.set(timer, { kind, action });
  }

  _clearImpacts(kind = null, action = null) {
    for (const [timer, entry] of [...this._hitTimers]) {
      const k = typeof entry === 'string' ? entry : entry?.kind;
      const queuedAction = typeof entry === 'object' ? entry?.action : null;
      if (kind != null && k !== kind) continue;
      if (action != null && queuedAction !== action) continue;
      clearTimeout(timer);
      this._hitTimers.delete(timer);
    }
  }

  update(dt) {
    this.bloodCoat.update(dt);
    if (this.player.locked) this._cancelManualAttack();
    if (this.dead) {
      this._cancelManualAttack();
      this._clearImpacts();
      this.respawnT -= dt;
      this.hud.setDeathCount(this.respawnT);
      if (this.respawnT <= 0) this._respawn();
      return;
    }
    this._syncDashAction();
    this._holdActionHeading();
    // la gruta te CURA: regeneracion fuerte dentro de la zona segura
    const dg = Math.hypot(this.player.pos.x - this.safeCenter[0], this.player.pos.z - this.safeCenter[1]);
    if (dg < 26) {
      if (this.hp < this.hpMax) {
        this.hp = Math.min(this.hpMax, this.hp + 9 * dt);
        this.hud.setHP(this.hp, this.hpMax);
      }
      if (!this._inGruta) {
        this._inGruta = true;
        this.hud.toast('✚ La gruta te cura');
        if (this.sfx) this.sfx.heal();
      }
    } else if (dg > 30) {
      this._inGruta = false;
    }
    if (this.targetId && !this.net.mobs.has(this.targetId)) { this._clearMobTarget(); this._hideTarget(); }
    if (this.targetId && this.net.mobs.has(this.targetId)) {
      const staleTarget = this.net.mobs.get(this.targetId);
      if (staleTarget && (staleTarget.hp ?? 0) <= 0) {
        const staleId = this.targetId;
        this._clearMobTarget();
        this._hideTarget();
        if (this.attackIntentId === staleId) this._clearAttackIntent();
        if (this.autoAttack) this._autoRetarget(staleId);
      }
    }

    if ((this.attackIntentT || 0) > 0) {
      this.attackIntentT = Math.max(0, this.attackIntentT - dt);
      if (this.player.locked || this.dead || this.pvpId != null || this._isMoving()) this._clearAttackIntent();
    }
    if (this.attackIntentId != null) {
      const intentMob = this.net.mobs.get(this.attackIntentId);
      if (!intentMob || (intentMob.hp ?? 0) <= 0) this._clearAttackIntent();
    }

    const hasAttackIntent = (this.attackIntentT || 0) > 0;
    const wantsMobAssist = this.autoAttack || this._punchT > 0 || hasAttackIntent;
    // ACTION COMBAT: el auto-target agresivo solo vive en auto mode o tras un clic manual.
    if (wantsMobAssist && this.pvpId == null && !(this.targetLocked && this.net.mobs.has(this.targetId))) {
      const engage = PROJECTILE_BY_CHAR[this.player.charFile] ? RANGE_RANGED + 2 : AUTO_MELEE_ENGAGE_RANGE;
      let best = null, bestScore = engage;
      const intentTarget = hasAttackIntent && this.attackIntentId != null
        ? this.net.mobs.get(this.attackIntentId)
        : null;
      const intentDistance = intentTarget
        ? Math.hypot(intentTarget.x - this.player.pos.x, intentTarget.z - this.player.pos.z)
        : Infinity;
      if (intentTarget && (intentTarget.hp ?? 0) > 0 && intentDistance <= engage) {
        best = intentTarget;
      } else {
        for (const m of this.net.mobs.values()) {
          if (!m || (m.hp ?? 0) <= 0) continue;
          const d = Math.hypot(m.x - this.player.pos.x, m.z - this.player.pos.z);
          if (d > engage) continue;
          const score = this._targetPressureScore(m, d, AUTO_TARGET_WOUNDED_BIAS, AUTO_TARGET_LUNGE_BIAS, RANGE_LUNGE);
          if (score < bestScore) { best = m; bestScore = score; }
        }
      }
      if (best) {
        if (this.targetId !== best.id || this.targetLocked || this.pvpId != null) this._setSoftTarget(best.id);
        if (hasAttackIntent && this.attackIntentId == null) this.attackIntentId = best.id;
        if (this._manualAttackHeld && !this._manualAttackTarget) this._manualAttackTarget = { type: 'mob', id: best.id };
      }
      else if (this.targetId && !this.targetLocked) { this._clearMobTarget(); this._hideTarget(); }
    }
    if (this.pvpId != null && !this.net.remotes.has(this.pvpId)) { this.pvpId = null; this._pvpPunchT = 0; this._hideTarget(); }

    // racha: la ventana decae; al vencer se corta y desaparece el contador
    if (this.streakT > 0) {
      this.streakT -= dt;
      if (this.streakT <= 0) { this.streak = 0; this.hud.hideStreak?.(); }
    }
    // buff de dano (Grito de Guerra) expira solo
    if (this.dmgBuffT > 0) this.dmgBuffT -= dt;
    // gracia divina: holografico mientras dura, vuelve a normal al expirar
    if (this.godSaveT > 0) {
      this.godSaveT -= dt;
      if (this.godSaveT <= 0 || this.hp >= this.hpMax) { this.godSaveT = 0; this._setHolo(false); }
    }
    // escudo de party expira solo
    if (this.shieldT > 0) { this.shieldT -= dt; if (this.shieldT <= 0) this.shieldHp = 0; }
    if (this.spawnGraceT > 0) this.spawnGraceT = Math.max(0, this.spawnGraceT - dt);
    if (this.starterGuardT > 0) this.starterGuardT = Math.max(0, this.starterGuardT - dt);

    this.attackCd -= dt;
    if (this.chainShotT > 0) this.chainShotT = Math.max(0, this.chainShotT - dt);
    if (this.skillPriorityT > 0) this.skillPriorityT = Math.max(0, this.skillPriorityT - dt);
    this._refreshManualAttackHold();
    if (this._punchT > 0) this._punchT = Math.max(0, this._punchT - dt);
    if (this._pvpPunchT > 0) this._pvpPunchT = Math.max(0, this._pvpPunchT - dt);
    this._dashStrike();
    const target = this.targetId ? this.net.mobs.get(this.targetId) : null;
    if (target) {
      this._syncMobTargetHud(target);
      let d = Math.hypot(target.x - this.player.pos.x, target.z - this.player.pos.z);
      const ptype = PROJECTILE_BY_CHAR[this.player.charFile];
      const chainShot = ptype && (this.chainShotT || 0) > 0;
      const range = ptype ? (chainShot ? Math.max(RANGE_RANGED, KILL_CHAIN_RANGED_RANGE) : RANGE_RANGED) : RANGE_MELEE;
      const skillPriority = (this.skillPriorityT || 0) > 0;
      if (!this.autoAttack && (this.attackIntentT || 0) > 0 && this.attackIntentId === target.id) {
        this._punchT = Math.max(this._punchT || 0, ATTACK_CHAIN_RETRY_T);
      }
      const wantsAttack = this.autoAttack || this._punchT > 0;
      if (wantsAttack && this._isDodgeActionActive()) {
        if (this._punchT > 0) this._punchT = Math.max(this._punchT, ATTACK_CHAIN_RETRY_T);
        return;
      }
      if (wantsAttack && !skillPriority && !ptype && d > range && d < RANGE_LUNGE && this.attackCd <= 0 && !this.player.locked) {
        const step = Math.min(1.35, Math.max(0.25, d - RANGE_MELEE + 0.35));
        const start = { x: this.player.pos.x, z: this.player.pos.z };
        if (this.player.combatLunge?.(target.x, target.z, step)) {
          this._motionTrail(start, this.player.pos);
          d = Math.hypot(target.x - this.player.pos.x, target.z - this.player.pos.z);
        }
      }
      if (!skillPriority && !ptype && this._autoChaseTo(target, d, range, dt)) {
        d = Math.hypot(target.x - this.player.pos.x, target.z - this.player.pos.z);
      }
      if (!skillPriority && this.pvpId == null && this.autoAttack && this.attackCd <= 0 && !this.player.locked) {
        const nearTarget = this._nearMobCount(target.x, target.z, 4.8);
        const nearPlayer = this._nearMobCount(this.player.pos.x, this.player.pos.z, 4.4);
        const autoCasted = this.skills?.tryAutoCast?.({
          auto: true,
          hasTarget: true,
          dead: this.dead,
          playerLocked: this.player.locked,
          hpRatio: this.hp / Math.max(1, this.hpMax),
          targetHpRatio: this._mobHpRatio(target),
          targetDist: d,
          nearCount: Math.max(nearTarget, nearPlayer),
          nearTarget,
          nearPlayer,
          weakestHpRatio: this._weakestMobHpRatio(7),
          boss: !!target.b,
        });
        if (autoCasted) return;
      }
      // ARPG: se pega EN MOVIMIENTO (kitear y tajear es el core loop)
      if (!skillPriority && d < range && this.attackCd <= 0 && !this.player.locked && wantsAttack) {
        const attackHeading = Math.atan2(target.x - this.player.pos.x, target.z - this.player.pos.z);
        this._applyActionHeading(attackHeading);
        if (!ptype) d = this._settleMeleeAttack(target, d);
        const animSpeed = this._attackAnimSpeed();
        if (!this.player.attack(false, animSpeed)) {
          if (this._punchT > 0 && (this.player.attackT || 0) > 0) this._punchT = Math.max(this._punchT, ATTACK_CHAIN_RETRY_T);
          return;
        }
        const action = this._beginAction('basic', attackHeading, { type: 'mob', id: target.id });
        this._breakSpawnGrace();
        this.net.sendAttack?.('', { type: 'mob', id: target.id, x: target.x, z: target.z, animSpeed });
        this._punchT = 0;
        this._markManualAttackStarted('mob', target.id);
        this._clearAttackIntent();
        this.attackCd = this._attackCooldown();
        // crit + finisher: el 3er golpe del combo pega mas fuerte
        const crit = Math.random() < CRIT_CHANCE;
        if (this.sfx && !this.player.sfx) this.sfx.swing?.();
        const finisher = this.player.comboStep === 2;
        const atk = Math.round(this._playerAtk() * (crit ? 2 : 1) * (finisher ? 1.35 : 1));
        const shotFrom = { x: this.player.pos.x, y: 1.35, z: this.player.pos.z };
        const shotTo = { x: target.x, y: 0.9, z: target.z };
        const releaseDelay = ptype ? attackReleaseDelay(this.player.charFile, this.classSpec?.combatStyle) : 0;
        if (this.effects) {
          // ARCO del tajo: cada golpe melee dibuja su swing luminoso
          if (!ptype) this.effects.slashArc(this.player.pos, this.player.heading, (this.classSpec && this.classSpec.auraColor) || 0xfff2d8);
          if (ptype) {
            const fireProjectile = () => this.effects.projectile(shotFrom, shotTo, ptype);
            if (releaseDelay > 0) this._queueImpact(releaseDelay, fireProjectile, 'basic', { action, commit: true });
            else { this._commitAction(action); fireProjectile(); }
          }
        }
        const targetId = target.id;
        const swingHeading = attackHeading;
        const delay = ptype ? this._projectileImpactDelay(shotFrom, shotTo, ptype, PROJECTILE_MIN_DELAY, PROJECTILE_MAX_DELAY, releaseDelay) : IMPACT_DELAY_MELEE;
        this._queueImpact(delay, () => {
          let impactId = targetId;
          let live = this.net.mobs.get(targetId);
          if (this.dead) return;
          if ((!live || live.hp <= 0) && !ptype) {
            const fallback = this._meleeImpactFallback(targetId, swingHeading);
            if (fallback) { impactId = fallback.id; live = fallback.mob; }
          }
          if (!live || live.hp <= 0) return;
          const hx = Number.isFinite(live.x) ? live.x : target.x;
          const hz = Number.isFinite(live.z) ? live.z : target.z;
          if (this.sfx) this.sfx.hit?.(crit);
          // GAME FEEL: micro-freeze al conectar; el finisher del combo pesa mas
          // aunque no sea critico, para que el 1-2-3 se lea en pantalla.
          this.hitStopT = crit ? 0.09 : (finisher ? FINISHER_HIT_STOP : 0.045);
          if (crit || finisher) this._localShake({ x: hx, z: hz }, crit ? 0.085 : FINISHER_SHAKE, crit ? 0.12 : 0.085);
          if (this.effects) {
            this.effects.bloodHit({ x: hx, y: 1.0, z: hz });
            // los CRITS y finishers revientan carne y hueso (mini gore burst)
            if (crit || finisher) this.effects.goreBurst({ x: hx, y: 0.9, z: hz }, crit ? 0.8 : 0.65);
            this.effects.damageNumber({ x: hx, y: 1.6, z: hz }, atk, { crit });
          }
          if (this.skills) this.skills.onHit();      // el guerrero sube rage al pegar
          // GRACIA DIVINA activa: cada golpe devuelve el 99% como vida
          if (this.godSaveT > 0) {
            const gheal = Math.round(atk * 0.99);
            this.hp = Math.min(this.hpMax, this.hp + gheal);
            this.hud.setHP(this.hp, this.hpMax);
            if (this.effects) this.effects.damageNumber({ x: this.player.pos.x, y: 2.2, z: this.player.pos.z }, gheal, { heal: true });
          }
          const basicKind = (crit || finisher) ? 'heavy' : undefined;
          this.net.attackMob(impactId, atk, basicKind);    // el SERVER aplica el dano (compartido)
          if (!ptype && (finisher || crit)) this._bleedMob(impactId, atk, { crit, mult: crit ? 0.14 : 0.12 });
          // CLEAVE melee: el tajo barre en arco y alcanza hasta 3 zombies extra.
          // Si el swing corta un pack, el golpe debe sentirse mas pesado.
          const cleaveHits = !ptype ? this._cleave(impactId, atk) : 0;
          if (!ptype) this._comboMomentum({ finisher, crit, cleaveHits });
          if (cleaveHits > 0) {
            this.hitStopT = Math.max(this.hitStopT, Math.min(0.095, 0.055 + cleaveHits * 0.012));
            if (this.effects) {
              this._localShake({ x: hx, z: hz }, 0.038 + cleaveHits * 0.011, 0.08 + cleaveHits * 0.016);
              if (cleaveHits >= 2) this.effects.goreBurst({ x: hx, y: 0.85, z: hz }, 0.45 + cleaveHits * 0.1);
            }
          }
        }, 'basic', { action, commit: true });
      }
      return;
    }
    // PvP: auto-ataque contra el jugador targeteado (el server valida rango/zona)
    // PvP: a HUMANOS no se les auto-ataca. El frame muestra su vida; el golpe
    // solo sale con CLIC deliberado (manualAttack), a diferencia de los zombies.
    const rival = this.pvpId != null ? this.net.remotes.get(this.pvpId) : null;
    if (rival && rival.ready) {
      this._syncTargetHud('player', this.pvpId, '⚔ ' + (rival.name || 'Jugador'), rival.hp ?? 1, rival.hpMax ?? 1, true);
      if (this._pvpPunchT > 0) this._tryPvpAttack(rival, { keepQueued: true });
    }
  }

  // golpe PvP MANUAL: clic izquierdo / boton ATK con un jugador targeteado en
  // rango. La agresion a humanos es siempre una decision, nunca un automatismo.
  manualAttack() {
    if (this.dead || this.player.locked) return false;
    const rival = this.pvpId != null ? this.net.remotes.get(this.pvpId) : null;
    return this._tryPvpAttack(rival, { buffer: true });
  }

  // aplica un efecto de party a ESTE jugador (local o recibido por red)
  _applyBuff(kind, v, dur) {
    const fx = this.effects;
    const p = this.player.pos;
    if (kind === 'heal') {
      const heal = Math.round(this.hpMax * v);
      this.hp = Math.min(this.hpMax, this.hp + heal);
      this.hud.setHP(this.hp, this.hpMax);
      if (fx) { fx.healBurst({ x: p.x, y: 0.6, z: p.z }); fx.damageNumber({ x: p.x, y: 2.2, z: p.z }, heal, { heal: true }); }
    } else if (kind === 'dmgbuff') {
      this.dmgBuffMult = 1 + v;
      this.dmgBuffT = dur;
      if (fx) fx.hitFlash({ x: p.x, y: 1.3, z: p.z }, 0xff5a3c);
    } else if (kind === 'haste') {
      this.player.speedBuffMult = 1 + v;
      this.player.speedBuffT = dur;
      if (fx) fx.hitFlash({ x: p.x, y: 0.5, z: p.z }, 0x59d98c);
    } else if (kind === 'shield') {
      this.shieldHp = Math.max(this.shieldHp, v);
      this.shieldT = dur;
      if (fx) fx.hitFlash({ x: p.x, y: 1.2, z: p.z }, 0xffa040);
    }
    if (this.sfx) this.sfx.heal();
  }

  _hasStarterGuard() {
    return this.starterGuardT > 0 && this.prog.level <= 2;
  }

  _applyStarterGuard(dmg, protectFloor = false) {
    if (!this._hasStarterGuard()) return dmg;
    let next = Math.max(1, Math.ceil(dmg * STARTER_GUARD_MULT));
    if (protectFloor) {
      const floor = Math.ceil(this.hpMax * STARTER_GUARD_HP_FLOOR);
      next = Math.min(next, Math.max(0, this.hp - floor));
    }
    return next;
  }

  // skill de party entrante (de un aliado, via server)
  applyPartySkill(m) {
    if (this.dead || !m) return;
    this._applyBuff(m.kind, Number(m.v) || 0, Number(m.dur) || 0);
    this.hud.toast('🤝 ' + (m.from || 'Aliado') + ' apoya al party');
  }

  // HOLOGRAFICO divino: emissive verde + translucido; guarda y restaura los originales
  _setHolo(on) {
    if (this._holoOn === on || !this.player.char) return;
    this._holoOn = on;
    this.player.char.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      if (on) {
        o.userData.__preHolo = o.material;
        const m = o.material.clone();
        m.transparent = true;
        m.opacity = 0.55;
        if (m.emissive) { m.emissive.setHex(0x66ffaa); m.emissiveIntensity = 1.4; }
        m.depthWrite = false;
        o.material = m;
      } else if (o.userData.__preHolo) {
        try { o.material.dispose(); } catch { /* clon propio */ }
        o.material = o.userData.__preHolo;
        delete o.userData.__preHolo;
      }
    });
  }

  // Diosito NO muere: al borde queda a 1 HP, se vuelve holografico y roba vida 99%
  _godGrace() {
    if (!(this.classSpec && this.classSpec.god) || this.hp > 0) return false;
    this.hp = 1;
    this.godSaveT = 8;
    this._setHolo(true);
    this.hud.setHP(this.hp, this.hpMax);
    this.hud.banner?.('GRACIA DIVINA');
    if (this.effects) {
      this.effects.nova(this.player.pos, 0x9be8b0, 6);
      this.effects.healBurst({ x: this.player.pos.x, y: 0.8, z: this.player.pos.z });
    }
    if (this.sfx) this.sfx.heal();
    return true;
  }

  _hitImpulseFrom(source, opts = {}) {
    if (!this.player?.applyHitImpulse) return false;
    if (source && Number.isFinite(Number(source.x)) && Number.isFinite(Number(source.z))) {
      return this.player.applyHitImpulse(source, opts);
    }
    const h = Number.isFinite(this.player.heading) ? this.player.heading : 0;
    return this.player.applyHitImpulse({
      x: this.player.pos.x - Math.sin(h),
      z: this.player.pos.z - Math.cos(h),
    }, opts);
  }

  // dano PvP entrante (de otro jugador, ya validado por el server)
  takePvpHit(hit) {
    if (this.dead || !hit) return;
    let dmg = Math.max(0, Number(hit.dmg) || 0);
    if (!dmg) return;
    // el ESCUDO de party absorbe antes que la vida
    if (this.shieldHp > 0) {
      const absorbed = Math.min(this.shieldHp, dmg);
      this.shieldHp -= absorbed;
      dmg -= absorbed;
      if (this.effects) this.effects.hitFlash({ x: this.player.pos.x, y: 1.2, z: this.player.pos.z }, 0xffa040);
      if (dmg <= 0) return;
    }
    dmg = this._applyStarterGuard(dmg);
    const heavyHit = dmg / Math.max(1, this.hpMax) >= 0.16 || !!hit.heavy || !!hit.boss;
    this.hp = Math.max(0, this.hp - dmg);
    if (this._godGrace()) dmg = 0;
    this.hud.setHP(this.hp, this.hpMax);
    this._hitImpulseFrom(this.net?.remotes?.get?.(hit.from), { speed: 4.8, time: 0.11 });
    this.player.playHit({ heavy: heavyHit });
    if (this.skills) this.skills.gainRageFromDamage(8);
    if (this.effects) {
      this.effects.bloodHit({ x: this.player.pos.x, y: 1.1, z: this.player.pos.z });
      this.effects.damageNumber({ x: this.player.pos.x, y: 2.2, z: this.player.pos.z }, dmg, { toPlayer: true });
    }
    if (this.hp <= 0) {
      this.net.pvpDead(hit.from);   // kill feed: el server anuncia quien me mato
      this._die();
    }
  }

  // ====== SKILLS estilo Dota (Q/W/E/R): el SkillSystem entrega el spec y aqui
  // se ejecuta el efecto. Cada tipo tiene su feel propio (anim + fx + dano). ======
  castSkill(s, opts = {}) {
    if (this.dead || !s || this.player.locked) return false;
    if ((this.player.attackT || 0) > 0 || this._isDodgeActionActive()) {
      return opts.bufferable ? { buffer: true } : false;
    }
    const fx = this.effects;
    const p = this.player.pos;
    const aura = (this.classSpec && this.classSpec.auraColor) || 0xffd24a;
    const needsTarget = NEEDS_TARGET.has(s.type);
    const target = needsTarget ? this._skillTargetMob(s) : (this.targetId ? this.net.mobs.get(this.targetId) : null);
    if (needsTarget && !target) {
      if (!opts.buffered) this.hud.toast?.('No hay objetivo cerca');
      return opts.bufferable ? { buffer: true } : false;
    }
    if (target && !(this.targetLocked && this.targetId === target.id)) this._setSoftTarget(target.id);
    if (target && ['strike', 'stab', 'execute'].includes(s.type)) this._skillLungeTo(target);
    const targetHeading = target
      ? Math.atan2(target.x - this.player.pos.x, target.z - this.player.pos.z)
      : null;
    if (targetHeading != null) this._applyActionHeading(targetHeading);
    const cx = target ? target.x : p.x;
    const cz = target ? target.z : p.z;
    const base = (mult) => Math.round(this._playerAtk() * (mult || 1.5));
    const ptype = (this.classSpec && this.classSpec.projectile) || PROJECTILE_BY_CHAR[this.player.charFile];
    const releaseDelay = this._skillReleaseDelay(s);
    let action = null;
    const skillCue = (m = target, ax = cx, az = cz) => {
      if (m && m.id != null) return { type: 'mob', id: m.id, x: m.x, z: m.z };
      if (Number.isFinite(Number(ax)) && Number.isFinite(Number(az))) return { type: 'point', x: ax, z: az };
      return null;
    };
    const selfCue = () => skillCue(null, this.player.pos.x, this.player.pos.z);

    // dano en area alrededor de (ax, az), con numero y sangre por victima
    const hitAreaNow = (ax, az, radius, dmg, opts = {}) => {
      let hits = 0;
      let follow = null, followScore = Infinity;
      for (const m of this.net.mobs.values()) {
        if (m.hp <= 0 || Math.hypot(m.x - ax, m.z - az) > radius) continue;
        hits++;
        this.net.attackMob(m.id, dmg, 'skill');
        if (this.skills) this.skills.onHit?.();
        if (fx) { fx.bloodHit({ x: m.x, y: 0.9, z: m.z }); fx.damageNumber({ x: m.x, y: 1.6, z: m.z }, dmg, { crit: true }); }
        const hpMax = Math.max(1, Number(m.hpMax) || Number(m.hp) || 1);
        const projectedRatio = Math.max(0, (Number(m.hp) || 0) - dmg) / hpMax;
        const dp = Math.hypot(m.x - this.player.pos.x, m.z - this.player.pos.z);
        const lockedBonus = m.id === this.targetId ? -0.25 : 0;
        const score = projectedRatio * 3.2 + dp * 0.08 + lockedBonus;
        if (score < followScore) { followScore = score; follow = m; }
      }
      this._skillImpactFeedback(hits, !!opts.heavy, { x: ax, z: az });
      if (opts.follow !== false) this._skillFollowThrough(follow, hits, opts.follow || {});
      return hits;
    };
    const hitOneNow = (id, dmg, opts = {}) => {
      const m = this.net.mobs.get(id);
      if (!m || m.hp <= 0) return 0;
      this.net.attackMob(id, dmg, 'skill');
      if (this.skills) this.skills.onHit?.();
      if (fx) { fx.bloodHit({ x: m.x, y: 0.9, z: m.z }); fx.damageNumber({ x: m.x, y: 1.7, z: m.z }, dmg, { crit: true }); }
      if (opts.bleed) this._bleedMob(id, dmg, opts.bleed);
      if (opts.follow !== false) this._skillFollowThrough(m, 1, opts.follow || {});
      this._skillImpactFeedback(1, !!opts.heavy, m);
      return 1;
    };
    const impact = (fn, delay = this._skillImpactDelay(s.type)) => {
      this._queueImpact(delay, fn, 'skill', { action, commit: true });
    };
    const atRelease = (fn) => {
      if (releaseDelay > 0) this._queueImpact(releaseDelay, fn, 'skill', { action, commit: true });
      else { this._commitAction(action); fn(); }
    };
    const hitArea = (ax, az, radius, dmg, opts = {}) => {
      impact(() => hitAreaNow(ax, az, radius, dmg, opts), opts.delay);
    };
    const hitAreaPulses = (centerFn, radius, dmg, opts = {}) => {
      const delays = opts.delays || SPIN_PULSE_DELAYS;
      const pulseDmg = Math.max(1, Math.round(dmg * (opts.pulseMult || SPIN_PULSE_DAMAGE_MULT)));
      for (let i = 0; i < delays.length; i++) {
        impact(() => {
          const c = centerFn();
          if (fx) fx.slashArc?.({ x: c.x, y: 0.9, z: c.z }, (this.player.heading || 0) + i * 0.9, aura);
          return hitAreaNow(c.x, c.z, radius, pulseDmg, opts);
        }, delays[i]);
      }
    };
    const hitOne = (m, dmg, opts = {}) => {
      if (!m || m.id == null) return;
      const id = m.id;
      impact(() => {
        const hits = hitOneNow(id, dmg, opts);
        if (hits && typeof opts.after === 'function') opts.after(dmg);
      }, opts.delay);
    };
    const anim = (special, cue = skillCue()) => {
      if (targetHeading != null) this._applyActionHeading(targetHeading);
      const ok = this.player.attackSkill
        ? this.player.attackSkill(s.type, { special })
        : (special ? (this.player.attackSpecial ? this.player.attackSpecial() : this.player.attack(true)) : this.player.attack(true));
      if (ok) {
        this._breakSpawnGrace();
        this._clearImpacts('basic');
        action = this._beginAction(
          'skill',
          targetHeading,
          target ? { type: 'mob', id: target.id } : null,
        );
        this._punchT = 0;
        const heavy = HEAVY_SKILL_TYPES.has(s.type);
        this.skillPriorityT = Math.max(this.skillPriorityT || 0, heavy ? SKILL_HEAVY_PRIORITY_T : SKILL_PRIORITY_T);
        this.attackCd = Math.max(this.attackCd || 0, heavy ? SKILL_HEAVY_BASIC_LOCK_T : SKILL_BASIC_LOCK_T);
        this.net.sendAttack?.(s.type, cue);
      }
      return ok;
    };

    switch (s.type) {
      case 'strike': {              // golpe brutal single
        if (!anim(false)) return false;
        hitOne(target, base(s.dmgMult), { bleed: { mult: 0.12 } });
        break;
      }
      case 'stab': {                // single + roba vida
        if (!anim(false)) return false;
        const dmg = base(s.dmgMult);
        hitOne(target, dmg, {
          bleed: { mult: 0.14 },
          after: () => {
            if (!s.leech) return;
            const heal = Math.round(dmg * s.leech);
            this.hp = Math.min(this.hpMax, this.hp + heal);
            this.hud.setHP(this.hp, this.hpMax);
            if (fx) { fx.healBurst({ x: p.x, y: 0.6, z: p.z }); fx.damageNumber({ x: p.x, y: 2.2, z: p.z }, heal, { heal: true }); }
          },
        });
        break;
      }
      case 'pierce': case 'bolt': { // single ultra con proyectil
        if (!anim(false)) return false;
        const from = { x: p.x, y: 1.4, z: p.z };
        const to = { x: target.x, y: 0.9, z: target.z };
        if (fx && target && ptype) atRelease(() => fx.projectile(from, to, ptype));
        hitOne(target, base(s.dmgMult), { delay: ptype ? this._projectileImpactDelay(from, to, ptype, PROJECTILE_MIN_DELAY, PROJECTILE_MAX_DELAY, releaseDelay) : undefined });
        break;
      }
      case 'execute': {             // remate: dano x2 extra si esta debil
        if (!anim(true)) return false;
        if (target) {
          const weak = target.hpMax && (target.hp / target.hpMax) <= (s.threshold || 0.4);
          const ex = { x: target.x, z: target.z };
          hitOne(target, base(weak ? s.executeMult : s.dmgMult), {
            heavy: true,
            bleed: { mult: weak ? 0.18 : 0.12, crit: weak },
            after: () => { if (weak && fx) fx.goreBurst({ x: ex.x, y: 0.9, z: ex.z }, 1.6); },
          });
        }
        break;
      }
      case 'spin': case 'bladedance': {   // AoE alrededor del heroe
        if (!anim(true, selfCue())) return false;
        if (fx) fx.nova(p, aura, s.radius || 4);
        hitAreaPulses(() => this.player.pos, s.radius || 4, base(s.dmgMult));
        break;
      }
      case 'nova': {                // anillo alrededor del heroe
        if (!anim(true, selfCue())) return false;
        if (fx) fx.nova(p, aura, s.radius || 4.5);
        hitArea(p.x, p.z, s.radius || 4.5, base(s.dmgMult));
        break;
      }
      case 'leap': {                // salto colerico: AoE grande donde estas
        const landing = this._nearestMob(s.range || SKILL_LUNGE_RANGE);
        if (landing) {
          this._setSoftTarget(landing.id);
          this._skillLungeTo(landing, 1.2, s.leapStep || 5.6, s.range || 9.2);
        }
        if (!anim(true, landing ? skillCue(landing) : selfCue())) return false;
        if (fx) { fx.nova(p, aura, s.radius || 6); fx.goreBurst({ x: p.x, y: 0.5, z: p.z }, 1.4); }
        hitArea(p.x, p.z, s.radius || 6, base(s.dmgMult), { heavy: true });
        break;
      }
      case 'fireball': {            // proyectil con explosion de area en el target
        if (!anim(false)) return false;
        const from = { x: p.x, y: 1.4, z: p.z };
        const to = { x: cx, y: 0.9, z: cz };
        if (fx && ptype) atRelease(() => fx.projectile(from, to, ptype));
        hitArea(cx, cz, s.radius || 3.5, base(s.dmgMult), { delay: ptype ? this._projectileImpactDelay(from, to, ptype, PROJECTILE_MIN_DELAY, PROJECTILE_MAX_DELAY, releaseDelay) : undefined });
        break;
      }
      case 'rain': case 'storm': {  // lluvia de proyectiles sobre el area del target
        if (!anim(true)) return false;
        if (fx) atRelease(() => fx.meteorRain({ x: cx, y: 0, z: cz }, s.radius || 5, s.type === 'storm' ? 12 : 7));
        hitArea(cx, cz, s.radius || 5, base(s.dmgMult), { delay: this._skillImpactDelay(s.type) + releaseDelay });
        break;
      }
      case 'meteor': {              // el cielo se cae sobre el area
        if (!anim(true)) return false;
        const impactDelay = this._skillImpactDelay(s.type) + releaseDelay;
        if (fx) {
          atRelease(() => fx.meteorRain({ x: cx, y: 0, z: cz }, s.radius || 7, 14));
          impact(() => fx.nova({ x: cx, y: 0, z: cz }, 0xff7a1e, s.radius || 7), impactDelay);
        }
        hitArea(cx, cz, s.radius || 7, base(s.dmgMult), { heavy: true, delay: impactDelay });
        break;
      }
      case 'volley': {              // dispara a los N zombies mas cercanos
        const near = [...this.net.mobs.values()]
          .map((m) => ({ m, d: Math.hypot(m.x - p.x, m.z - p.z) }))
          .filter((e) => e.d < (s.range || 12))
          .sort((a, b) => a.d - b.d)
          .slice(0, s.count || 3);
        if (!near.length) {
          this.hud.toast?.('No hay objetivo cerca');
          return false;
        }
        if (!anim(false, skillCue(near[0].m))) return false;
        const from = { x: p.x, y: 1.4, z: p.z };
        for (const { m } of near) {
          const to = { x: m.x, y: 0.9, z: m.z };
          if (fx && ptype) atRelease(() => fx.projectile(from, to, ptype));
          hitOne(m, base(s.dmgMult), { delay: ptype ? this._projectileImpactDelay(from, to, ptype, PROJECTILE_MIN_DELAY, PROJECTILE_MAX_DELAY, releaseDelay) : undefined });
        }
        break;
      }
      case 'warcry': {              // buff de dano temporal + onda visual
        if (!anim(true, selfCue())) return false;
        this.dmgBuffMult = s.buffMult || 1.4;
        this.dmgBuffT = s.buffDur || 6;
        if (fx) fx.nova(p, aura, 3);
        this.hud.toast('📢 ¡' + s.name + '! +' + Math.round(((s.buffMult || 1.4) - 1) * 100) + '% daño');
        break;
      }
      // ===== SKILLS DE PARTY (slot R): benefician a TODO el grupo. La sinergia
      // perfecta es tener a los 4 heroes juntos: dano+cura+velocidad+escudo =====
      case 'partyheal': {           // Sombra: cura 35% a TODO el party
        if (!anim(true, selfCue())) return false;
        this._applyBuff('heal', s.v || 0.35, 0);
        this.net.partySkill('heal', s.v || 0.35, 0);
        this.hud.toast('🌑 ' + s.name + ': el party se cura');
        break;
      }
      case 'partybuff': {           // Verdugo: +45% dano a TODO el party
        if (!anim(true, selfCue())) return false;
        this._applyBuff('dmgbuff', s.v || 0.45, s.dur || 6);
        this.net.partySkill('dmgbuff', s.v || 0.45, s.dur || 6);
        if (fx) fx.nova(p, aura, 3);
        this.hud.toast('📢 ' + s.name + ': +' + Math.round((s.v || 0.45) * 100) + '% dano al party');
        break;
      }
      case 'partyhaste': {          // Cazadora: +30% velocidad a TODO el party
        if (!anim(true, selfCue())) return false;
        this._applyBuff('haste', s.v || 0.3, s.dur || 6);
        this.net.partySkill('haste', s.v || 0.3, s.dur || 6);
        if (fx) fx.nova(p, aura, 3);
        this.hud.toast('🐺 ' + s.name + ': el party corre +' + Math.round((s.v || 0.3) * 100) + '%');
        break;
      }
      case 'partyshield': {         // Piromante: escudo de 30 pts a TODO el party
        if (!anim(true, selfCue())) return false;
        this._applyBuff('shield', s.v || 30, s.dur || 8);
        this.net.partySkill('shield', s.v || 30, s.dur || 8);
        this.hud.toast('🛡️ ' + s.name + ': escudo para el party');
        break;
      }
      case 'veil': case 'heal': {   // autocuracion
        if (!anim(true, selfCue())) return false;
        const heal = Math.round(this.hpMax * (s.healPct || s.heal || 0.35));
        this.hp = Math.min(this.hpMax, this.hp + heal);
        this.hud.setHP(this.hp, this.hpMax);
        if (fx) { fx.healBurst({ x: p.x, y: 0.6, z: p.z }); fx.damageNumber({ x: p.x, y: 2.2, z: p.z }, heal, { heal: true }); }
        break;
      }
      default: {                    // fallback: golpe fuerte
        if (!anim(false)) return false;
        hitOne(target, base(s.dmgMult));
      }
    }
    if (this.sfx) this.sfx.skill?.(s.type);
    return true;
  }

  _onPlayerHit(hit) {
    if (this.dead || !hit) return;
    // el zombie ya puede venir telegrafiado por matk; phit queda como fallback.
    if (this.mobField && hit.id != null) this.mobField.playAttack?.(hit.id, { impact: true, told: !!hit.told });
    // dodge activo: cubre el desplazamiento y el cierre visual para que no entre
    // una mordida mientras el personaje aun se ve esquivando.
    if (this._isDodgeActionActive()) { this._perfectDodgeCounter(hit); return; }
    let dmg = Math.max(0, Number(hit.dmg) || 0);
    if (!dmg) return;
    if (this.spawnGraceT > 0) return;
    // el ESCUDO de party absorbe la mordida antes que la vida
    if (this.shieldHp > 0) {
      const absorbed = Math.min(this.shieldHp, dmg);
      this.shieldHp -= absorbed;
      dmg -= absorbed;
      if (this.effects) this.effects.hitFlash({ x: this.player.pos.x, y: 1.2, z: this.player.pos.z }, 0xffa040);
      if (dmg <= 0) return;
    }
    dmg = this._applyStarterGuard(dmg, true);
    const heavyHit = dmg / Math.max(1, this.hpMax) >= 0.16 || !!hit.heavy || !!hit.boss;
    this.hp = Math.max(0, this.hp - dmg);
    // GRACIA DIVINA: Diosito no muere por mordida — queda a 1 HP holografico
    this._godGrace();
    this.hud.setHP(this.hp, this.hpMax);
    this._hitImpulseFrom(this.net?.mobs?.get?.(hit.id), { speed: 5.6, time: 0.13 });
    this.player.playHit({ heavy: heavyHit });
    if (this.sfx) this.sfx.hurt();
    if (this.skills) this.skills.gainRageFromDamage(8);
    if (this.effects) {
      this.effects.bloodHit({ x: this.player.pos.x, y: 1.1, z: this.player.pos.z });
      this.effects.damageNumber({ x: this.player.pos.x, y: 2.2, z: this.player.pos.z }, dmg, { toPlayer: true });
      this._localShake(this.player.pos, 0.048, 0.09);
    }
    // vignette roja: la pantalla ACUSA la mordida
    this.hud.hurtFlash?.();
    if (this.hp <= 0) this._die();
  }

  _onPlayerMiss(miss) {
    if (this.dead || !miss || miss.id == null) return false;
    if (!this._isDodgeActionActive()) return false;
    return this._perfectDodgeCounter({ id: miss.id, told: true });
  }

  _onMobDead(id, by, party, meta = {}) {
    const wasMyTarget = this.targetId === id;
    if (wasMyTarget) { this._clearMobTarget(); this._hideTarget(); }
    const mine = (by === this.net.myId) || (Array.isArray(party) && party.includes(this.net.myId));
    if (!mine) return;
    const source = this.net.mobs.get(id);   // aun existe: net lo borra DESPUES de avisar
    const m = source || (Number.isFinite(Number(meta.x)) && Number.isFinite(Number(meta.z))
      ? { id, x: Number(meta.x), z: Number(meta.z), hp: 0, hpMax: Number(meta.hpMax) || 1, lvl: Number(meta.lvl) || 1, b: meta.boss ? 1 : 0 }
      : null);
    const lvl = Math.max(1, Number(meta.lvl) || (m ? m.lvl : 1));
    const boss = !!(meta.boss || (m && m.b));
    const killKind = String(meta.kind || meta.k || '');
    const dmgRatio = Math.max(0, Number(meta.dmg) || 0) / Math.max(1, Number(meta.hpMax) || Number(m && m.hpMax) || 1);
    const heavyKill = boss || killKind === 'skill' || killKind === 'cleave' || killKind === 'heavy';
    // RACHA: kills encadenados = multiplicador de oro/XP + contador en pantalla
    this.streak++;
    this.streakT = STREAK_WINDOW;
    this.bloodCoat.recordKill(this.streak);
    const mult = 1 + Math.min(2, (this.streak - 1) * 0.15);
    if (this.streak >= 2) this.hud.showStreak?.(this.streak, mult);
    if (this.sfx) { this.sfx.kill(); this.sfx.streak?.(this.streak); }
    this._applyKillFrenzy(m);
    this._killSustain(m);
    // GORE de kill (escala con la racha)
    if (this.effects && m) {
      this.effects.goreBurst({ x: m.x, y: 0.7, z: m.z }, 1 + Math.min(1.25, this.streak * 0.1 + (heavyKill ? 0.25 : 0) + Math.min(0.25, dmgRatio * 0.12)));
      // VIOLENCIA: el zombie se parte en pedazos que vuelan y rebotan
      this.effects.dismember({ x: m.x, y: 0.8, z: m.z }, { intensity: heavyKill ? 1.35 : 1 });
      this._localShake(m, 0.05 + Math.min(0.045, this.streak * 0.007), 0.12);
    }
    this._killRupture(m, meta);
    // kill cuerpo a cuerpo: la sangre SALPICA LA PANTALLA
    if (m && Math.hypot(m.x - this.player.pos.x, m.z - this.player.pos.z) < 6) this.hud.goreSplat?.();
    // racha alta: micro camara-lenta de 0.15s (el kill se SABOREA)
    if (this.streak >= 5) this.slowMoT = 0.15;
    const leveled = this.prog.gainXp(this._killXp(lvl, mult, boss));
    this.hpMax = this.prog.hpMax;
    if (leveled) {
      // LEVEL-UP estilo MU: columna de luz dorada + fanfarria + banner
      if (this.effects) this.effects.levelUpBurst(this.player.pos);
      this.hud.banner?.('\u2b50 \u00a1NIVEL ' + this.prog.level + '!');
      this.slowMoT = 0.25;
      this.hp = this.hpMax;
      this.hud.toast('Subiste a nivel ' + this.prog.level);
      if (this.sfx) this.sfx.levelup();
    }
    this.hud.setXP(this.prog.xp, this.prog.xpNext, this.prog.level);
    this.hud.setHP(this.hp, this.hpMax);
    // racha >=3 compite en el leaderboard del dia
    if (this.streak >= 3) this.net.reportStreak?.(this.streak);
    if (this.onKillRewards) this.onKillRewards({ lvl, x: m ? m.x : 0, z: m ? m.z : 0, streak: this.streak, mult, boss, kind: killKind, dmg: Number(meta.dmg) || 0 });
    // CADENA: solo en auto mode. En manual, una kill no debe disparar ni mover sola.
    if (this.autoAttack && (wasMyTarget || !this.targetLocked)) this._autoRetarget(id);
  }

  // busca el mob vivo mas rentable (cerca + herido + alcanzable) para sostener racha.
  _autoRetarget(excludeId = null) {
    const p = this.player.pos;
    let best = null, bestId = null, bd = 0, bestScore = KILL_CHAIN_TARGET_RANGE;
    for (const [mid, m] of this.net.mobs) {
      const id = m?.id ?? mid;
      if (!m || id === excludeId || (m.hp ?? 0) <= 0) continue;
      const d = Math.hypot(m.x - p.x, m.z - p.z);
      if (d > KILL_CHAIN_TARGET_RANGE) continue;
      const score = this._targetPressureScore(m, d, KILL_CHAIN_WOUNDED_BIAS, KILL_CHAIN_LUNGE_BIAS, KILL_CHAIN_LUNGE_RANGE);
      if (score < bestScore) { bestScore = score; bd = d; best = m; bestId = id; }
    }
    if (best != null) {
      this._setSoftTarget(bestId);
      this._chainLungeTo(best, bd);
    }
    return best;
  }

  _chainLungeTo(m, d) {
    if (!m || PROJECTILE_BY_CHAR[this.player.charFile] || this.player.locked || this.dead) return false;
    if (d <= RANGE_MELEE + 0.25 || d > KILL_CHAIN_LUNGE_RANGE) return false;
    this.player.heading = Math.atan2(m.x - this.player.pos.x, m.z - this.player.pos.z);
    const step = Math.min(KILL_CHAIN_LUNGE_STEP, Math.max(0.45, d - RANGE_MELEE + 0.45));
    const start = { x: this.player.pos.x, z: this.player.pos.z };
    const moved = !!this.player.combatLunge?.(m.x, m.z, step);
    if (moved) {
      const aura = (this.classSpec && this.classSpec.auraColor) || 0x8fffd8;
      this._motionTrail(start, this.player.pos, aura, { width: 0.46, opacity: 0.34 });
      this.effects?.hitFlash?.({ x: this.player.pos.x, y: 1.05, z: this.player.pos.z }, aura);
    }
    return moved;
  }

  _skillLungeTo(m, keep = SKILL_LUNGE_KEEP, maxStep = SKILL_LUNGE_STEP, maxRange = SKILL_LUNGE_RANGE) {
    if (!m || PROJECTILE_BY_CHAR[this.player.charFile] || this.player.locked || this.dead) return false;
    const dx = m.x - this.player.pos.x, dz = m.z - this.player.pos.z;
    const d = Math.hypot(dx, dz);
    if (d <= keep || d > maxRange) return false;
    this.player.heading = Math.atan2(dx, dz);
    const step = Math.min(maxStep, Math.max(0.4, d - keep));
    const start = { x: this.player.pos.x, z: this.player.pos.z };
    const moved = !!this.player.combatLunge?.(m.x, m.z, step);
    if (moved) this._motionTrail(start, this.player.pos);
    return moved;
  }

  _die() {
    this._cancelManualAttack();
    this._clearImpacts();
    this.bloodCoat.clear();
    this.dead = true;
    this.respawnT = RESPAWN_T;
    this._clearMobTarget();
    this.pvpId = null;
    this._hideTarget();
    this.player.locked = true;
    this.player.setDead(true);
    if (this.sfx) this.sfx.death();
    if (this.effects) this.effects.bloodDeath({ x: this.player.pos.x, y: 0.6, z: this.player.pos.z });
    this.hud.showDeath();
    this.hud.setDeathCount(RESPAWN_T);
  }

  _respawn() {
    this.bloodCoat.clear();
    this.dead = false;
    this.hp = this.hpMax;
    this.spawnGraceT = SPAWN_GRACE_T;
    this.hud.setHP(this.hp, this.hpMax);
    this.hud.hideDeath();
    this.player.locked = false;
    this.player.setDead(false);
    this.onRespawn();
  }
}
