// Combate tab-target con mobs COMPARTIDOS (el server es dueno). Clic selecciona un
// esqueleto; en rango el jugador auto-ataca y el DANO lo aplica el SERVER (mhit),
// que avisa a TODOS los clientes. Al morir, si lo mataste tu (o tu party) recibes XP
// y loot. Los mobs te pegan desde el server con aggro/chase/leash.
import * as THREE from 'three';

const ATTACK_CD = 0.9;       // segundos entre auto-ataques
const ATTACK_RANGE = 3.6;    // rango para pegar
const RESPAWN_T = 3.0;

// clases a distancia disparan un proyectil visible al atacar
const PROJECTILE_BY_CHAR = {
  'char_mage.glb': 'fireball',
  'char_cernunnos.glb': 'magic',
  'char_ranger.glb': 'arrow',
};

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
    this.targetId = null;
    this.pvpId = null;       // conn-id del jugador targeteado (excluyente con targetId)
    this.attackCd = 0;
    this.dead = false;
    this.respawnT = 0;
    this.hpMax = this.prog.hpMax;
    this.hp = this.hpMax;
    this.ray = new THREE.Raycaster();

    addEventListener('mousedown', (e) => this._onClick(e));
    addEventListener('keydown', (e) => {
      if (e.code === 'Tab' && !this.player.locked) { e.preventDefault(); this._cycleTarget(); }
    });

    // el server avisa cuando un mob muere; canal aparte del render (onMobDead lo usa MobField)
    this.net.onMobKilled = (id, by, party) => this._onMobDead(id, by, party);
    this.net.onPlayerHit = (hit) => this._onPlayerHit(hit);

    this.hud.setHP(this.hp, this.hpMax);
    this.hud.setXP(this.prog.xp, this.prog.xpNext, this.prog.level);
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
    // TAB: el hostil mas cercano, sea esqueleto o jugador (fuera de mi party)
    const p = this.player.pos;
    let best = null, bd = 1e9, kind = null;
    for (const m of this.net.mobs.values()) {
      const d = Math.hypot(m.x - p.x, m.z - p.z);
      if (d < bd) { bd = d; best = m.id; kind = 'mob'; }
    }
    for (const [pid, r] of this.net.remotes) {
      if (!r.ready || this._inParty(pid)) continue;
      const d = Math.hypot(r.x - p.x, r.z - p.z);
      if (d < bd) { bd = d; best = pid; kind = 'player'; }
    }
    if (best == null || bd >= 35) return;
    if (kind === 'mob') this._setTarget(best);
    else this._setPvpTarget(best);
  }

  _clearMobTarget() {
    if (this.targetId != null) this.mobField.setTargeted(this.targetId, false);
    this.targetId = null;
  }

  _setTarget(id) {
    this.pvpId = null;
    if (this.targetId && this.targetId !== id) this.mobField.setTargeted(this.targetId, false);
    this.targetId = id;
    this.mobField.setTargeted(id, true);
    const m = this.net.mobs.get(id);
    if (m) this.hud.showTarget('Esqueleto Nv.' + m.lvl, m.hp, m.hpMax);
  }

  _setPvpTarget(pid) {
    this._clearMobTarget();
    this.pvpId = pid;
    const r = this.net.remotes.get(pid);
    // vida del rival es de SU cliente: mostramos frame con barra llena
    this.hud.showTarget('⚔ ' + ((r && r.name) || 'Jugador'), 1, 1);
  }

  _playerAtk() {
    const w = this.inv.equippedWeapon;
    return 9 + this.prog.level * 2 + (w ? w.atk * 0.5 : 0);
  }

  _isMoving() {
    const k = this.player.keys || {};
    return !!(k['KeyW'] || k['KeyS'] || k['KeyA'] || k['KeyD']);
  }

  update(dt) {
    if (this.dead) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) this._respawn();
      return;
    }
    if (this.targetId && !this.net.mobs.has(this.targetId)) { this.targetId = null; this.hud.hideTarget(); }
    if (this.pvpId != null && !this.net.remotes.has(this.pvpId)) { this.pvpId = null; this.hud.hideTarget(); }

    this.attackCd -= dt;
    const target = this.targetId ? this.net.mobs.get(this.targetId) : null;
    if (target) {
      const d = Math.hypot(target.x - this.player.pos.x, target.z - this.player.pos.z);
      if (d < ATTACK_RANGE && this.attackCd <= 0 && !this.player.locked && !this._isMoving()) {
        this.attackCd = ATTACK_CD;
        this.player.heading = Math.atan2(target.x - this.player.pos.x, target.z - this.player.pos.z);
        this.player.attack();
        const atk = this._playerAtk();
        if (this.effects) {
          const ptype = PROJECTILE_BY_CHAR[this.player.charFile];
          if (ptype) this.effects.projectile({ x: this.player.pos.x, y: 1.35, z: this.player.pos.z }, { x: target.x, y: 0.9, z: target.z }, ptype);
        }
        if (this.skills) this.skills.onHit();      // el guerrero sube rage al pegar
        this.net.attackMob(this.targetId, atk);    // el SERVER aplica el dano (compartido)
        this.hud.showTarget('Esqueleto Nv.' + target.lvl, target.hp, target.hpMax);
      }
      return;
    }
    // PvP: auto-ataque contra el jugador targeteado (el server valida rango/zona)
    const rival = this.pvpId != null ? this.net.remotes.get(this.pvpId) : null;
    if (rival && rival.ready) {
      const d = Math.hypot(rival.x - this.player.pos.x, rival.z - this.player.pos.z);
      if (d < ATTACK_RANGE && this.attackCd <= 0 && !this.player.locked && !this._isMoving()) {
        this.attackCd = ATTACK_CD;
        this.player.heading = Math.atan2(rival.x - this.player.pos.x, rival.z - this.player.pos.z);
        this.player.attack();
        const atk = this._playerAtk();
        if (this.effects) {
          const ptype = PROJECTILE_BY_CHAR[this.player.charFile];
          if (ptype) this.effects.projectile({ x: this.player.pos.x, y: 1.35, z: this.player.pos.z }, { x: rival.x, y: 0.9, z: rival.z }, ptype);
          this.effects.bloodHit({ x: rival.x, y: 1.0, z: rival.z });
        }
        if (this.skills) this.skills.onHit();
        this.net.attackPlayer(this.pvpId, atk);   // el SERVER valida y se lo manda a la victima
      }
    }
  }

  // dano PvP entrante (de otro jugador, ya validado por el server)
  takePvpHit(hit) {
    if (this.dead || !hit) return;
    const dmg = Math.max(0, Number(hit.dmg) || 0);
    if (!dmg) return;
    this.hp = Math.max(0, this.hp - dmg);
    this.hud.setHP(this.hp, this.hpMax);
    this.player.playHit();
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

  // skill activa (tecla Q): aplica el efecto al objetivo / a ti. effect viene del SkillSystem.
  castSkill(effect) {
    if (this.dead || !effect) return;
    if (effect.type === 'heal') {
      const heal = Math.round(this.hpMax * (effect.heal || 0.4));
      this.hp = Math.min(this.hpMax, this.hp + heal);
      this.hud.setHP(this.hp, this.hpMax);
      this.player.attack();
      if (this.effects) this.effects.damageNumber({ x: this.player.pos.x, y: 2.2, z: this.player.pos.z }, heal, { heal: true });
      return;
    }
    const base = this._playerAtk() * (effect.dmgMult || 1.5);
    this.player.attack();
    const c = this.targetId ? this.net.mobs.get(this.targetId) : null;
    const cx = c ? c.x : this.player.pos.x;
    const cz = c ? c.z : this.player.pos.z;
    if (this.effects) {
      const ptype = PROJECTILE_BY_CHAR[this.player.charFile];
      if (ptype) this.effects.projectile({ x: this.player.pos.x, y: 1.4, z: this.player.pos.z }, { x: cx, y: 0.9, z: cz }, ptype);
    }
    if (effect.aoe) {
      for (const m of this.net.mobs.values()) {
        if (Math.hypot(m.x - cx, m.z - cz) < effect.aoe) {
          this.net.attackMob(m.id, base);
          if (this.effects) { this.effects.bloodHit({ x: m.x, y: 0.8, z: m.z }); this.effects.damageNumber({ x: m.x, y: 1.5, z: m.z }, base, { crit: true }); }
        }
      }
    } else if (this.targetId) {
      this.net.attackMob(this.targetId, base);
      if (c && this.effects) this.effects.damageNumber({ x: c.x, y: 1.5, z: c.z }, base, { crit: true });
    }
  }

  _onPlayerHit(hit) {
    if (this.dead || !hit) return;
    const dmg = Math.max(0, Number(hit.dmg) || 0);
    if (!dmg) return;
    this.hp = Math.max(0, this.hp - dmg);
    this.hud.setHP(this.hp, this.hpMax);
    this.player.playHit();
    if (this.skills) this.skills.gainRageFromDamage(8);
    if (this.effects) {
      this.effects.bloodHit({ x: this.player.pos.x, y: 1.1, z: this.player.pos.z });
      this.effects.damageNumber({ x: this.player.pos.x, y: 2.2, z: this.player.pos.z }, dmg, { toPlayer: true });
    }
    if (this.hp <= 0) this._die();
  }

  _onMobDead(id, by, party) {
    if (this.targetId === id) { this.targetId = null; this.hud.hideTarget(); }
    const mine = (by === this.net.myId) || (Array.isArray(party) && party.includes(this.net.myId));
    if (!mine) return;
    const m = this.net.mobs.get(id);   // aun existe: net lo borra DESPUES de avisar
    const lvl = m ? m.lvl : 1;
    const leveled = this.prog.gainXp(4 + lvl);   // XP lento, escala con nivel del mob
    this.hpMax = this.prog.hpMax;
    if (leveled) { this.hp = this.hpMax; this.hud.toast('Subiste a nivel ' + this.prog.level); }
    this.hud.setXP(this.prog.xp, this.prog.xpNext, this.prog.level);
    this.hud.setHP(this.hp, this.hpMax);
    if (this.onKillRewards) this.onKillRewards({ lvl, x: m ? m.x : 0, z: m ? m.z : 0 });
  }

  _die() {
    this.dead = true;
    this.respawnT = RESPAWN_T;
    this.targetId = null;
    this.pvpId = null;
    this.hud.hideTarget();
    this.player.locked = true;
    this.player.setDead(true);
    if (this.effects) this.effects.bloodDeath({ x: this.player.pos.x, y: 0.6, z: this.player.pos.z });
    this.hud.toast('Has caido. Respawn en la gruta...');
  }

  _respawn() {
    this.dead = false;
    this.hp = this.hpMax;
    this.hud.setHP(this.hp, this.hpMax);
    this.player.locked = false;
    this.player.setDead(false);
    this.onRespawn();
  }
}
