// Combate tab-target con mobs COMPARTIDOS (el server es dueno). Clic selecciona un
// esqueleto; en rango el jugador auto-ataca y el DANO lo aplica el SERVER (mhit),
// que avisa a TODOS los clientes. Al morir, si lo mataste tu (o tu party) recibes XP
// y loot. Los mobs te pegan desde el server con aggro/chase/leash.
import * as THREE from 'three';

const ATTACK_CD = 0.42;      // cadencia ARPG: golpes rapidos encadenados
const RANGE_MELEE = 2.7;     // CUERPO A CUERPO real: la espada toca al zombie
const RANGE_RANGED = 11;     // mago/arquero castean a distancia (como debe ser)
const ATTACK_RANGE = 3.6;    // rango del PvP (el server valida 5m)
const RESPAWN_T = 3.0;
const CRIT_CHANCE = 0.18;    // golpes criticos x2 (numeros dorados grandes)
const CLEAVE_RANGE = 3.0;    // el tajo melee barre en arco a los cercanos
const CLEAVE_ARC = 1.25;     // ± rad respecto al heading (~140 grados)
const STREAK_WINDOW = 6;     // s para encadenar kills en racha

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
    this.shieldHp = 0;       // escudo de party: absorbe dano antes que la vida
    this.shieldT = 0;
    this.classSpec = opts.classSpec || null;   // heroe: aura/proyectil/estilo
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
    this.net.onPartySkill = (m) => this.applyPartySkill(m);
    // clic izq = golpe PvP deliberado si hay rival targeteado (a humanos no se
    // les auto-ataca); contra zombies el auto-loop de update() ya cubre
    addEventListener('mousedown', (e) => { if (e.button === 0) this.manualAttack(); });

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
    this.targetLocked = true;
    this.mobField.setTargeted(id, true);
    const m = this.net.mobs.get(id);
    if (m) this.hud.showTarget('Zombi Nv.' + m.lvl, m.hp, m.hpMax);
  }

  _setPvpTarget(pid) {
    this._clearMobTarget();
    this.pvpId = pid;
    const r = this.net.remotes.get(pid);
    // vida del rival es de SU cliente: mostramos frame con barra llena
    this.hud.showTarget('⚔ ' + ((r && r.name) || 'Jugador'), 1, 1);
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

  // tajo en arco: pega a hasta 2 zombies extra frente al jugador (70% del daño)
  _cleave(mainId, dmg) {
    const px = this.player.pos.x, pz = this.player.pos.z, hd = this.player.heading;
    let extra = 0;
    for (const m of this.net.mobs.values()) {
      if (extra >= 2 || m.id === mainId) continue;
      const dx = m.x - px, dz = m.z - pz;
      if (Math.hypot(dx, dz) > CLEAVE_RANGE) continue;
      let diff = Math.atan2(dx, dz) - hd;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > CLEAVE_ARC) continue;
      extra++;
      const sdmg = Math.round(dmg * 0.7);
      this.net.attackMob(m.id, sdmg);
      if (this.effects) {
        this.effects.bloodHit({ x: m.x, y: 1.0, z: m.z });
        this.effects.damageNumber({ x: m.x, y: 1.6, z: m.z }, sdmg, {});
      }
    }
  }

  _isMoving() {
    const k = this.player.keys || {};
    return !!(k['KeyW'] || k['KeyS'] || k['KeyA'] || k['KeyD']);
  }

  update(dt) {
    if (this.dead) {
      this.respawnT -= dt;
      this.hud.setDeathCount(this.respawnT);
      if (this.respawnT <= 0) this._respawn();
      return;
    }
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
    if (this.targetId && !this.net.mobs.has(this.targetId)) { this.targetId = null; this.targetLocked = false; this.hud.hideTarget(); }

    // ACTION COMBAT: nadie clickea zombies. Sin target FIJADO (TAB/clic siguen
    // siendo opcionales), el heroe engancha SOLO al zombie mas cercano y pelea.
    if (this.pvpId == null && !(this.targetLocked && this.net.mobs.has(this.targetId))) {
      const engage = PROJECTILE_BY_CHAR[this.player.charFile] ? RANGE_RANGED + 2 : 8;
      let best = null, bestD = engage;
      for (const m of this.net.mobs.values()) {
        const d = Math.hypot(m.x - this.player.pos.x, m.z - this.player.pos.z);
        if (d < bestD) { best = m; bestD = d; }
      }
      if (best) { this.targetId = best.id; this.targetLocked = false; }
      else if (this.targetId && !this.targetLocked) { this.targetId = null; this.hud.hideTarget(); }
    }
    if (this.pvpId != null && !this.net.remotes.has(this.pvpId)) { this.pvpId = null; this.hud.hideTarget(); }

    // racha: la ventana decae; al vencer se corta y desaparece el contador
    if (this.streakT > 0) {
      this.streakT -= dt;
      if (this.streakT <= 0) { this.streak = 0; this.hud.hideStreak?.(); }
    }
    // buff de dano (Grito de Guerra) expira solo
    if (this.dmgBuffT > 0) this.dmgBuffT -= dt;
    // escudo de party expira solo
    if (this.shieldT > 0) { this.shieldT -= dt; if (this.shieldT <= 0) this.shieldHp = 0; }

    this.attackCd -= dt;
    const target = this.targetId ? this.net.mobs.get(this.targetId) : null;
    if (target) {
      const d = Math.hypot(target.x - this.player.pos.x, target.z - this.player.pos.z);
      const range = PROJECTILE_BY_CHAR[this.player.charFile] ? RANGE_RANGED : RANGE_MELEE;
      // ARPG: se pega EN MOVIMIENTO (kitear y tajear es el core loop)
      if (d < range && this.attackCd <= 0 && !this.player.locked) {
        this.attackCd = ATTACK_CD;
        this.player.heading = Math.atan2(target.x - this.player.pos.x, target.z - this.player.pos.z);
        this.player.attack();
        // crit + finisher: el 3er golpe del combo pega mas fuerte
        const crit = Math.random() < CRIT_CHANCE;
        if (this.sfx) { this.sfx.swing(); this.sfx.hit(crit); }
        // GAME FEEL: micro-freeze al conectar; crit ademas sacude la camara
        this.hitStopT = crit ? 0.09 : 0.045;
        if (crit && this.effects) this.effects.shake(0.12, 0.16);
        const finisher = this.player.comboStep === 2;
        const atk = Math.round(this._playerAtk() * (crit ? 2 : 1) * (finisher ? 1.35 : 1));
        const ptype = PROJECTILE_BY_CHAR[this.player.charFile];
        if (this.effects) {
          if (ptype) this.effects.projectile({ x: this.player.pos.x, y: 1.35, z: this.player.pos.z }, { x: target.x, y: 0.9, z: target.z }, ptype);
          this.effects.bloodHit({ x: target.x, y: 1.0, z: target.z });
          // los CRITS revientan carne y hueso (mini gore burst)
          if (crit) this.effects.goreBurst({ x: target.x, y: 0.9, z: target.z }, 0.8);
          this.effects.damageNumber({ x: target.x, y: 1.6, z: target.z }, atk, { crit });
        }
        if (this.skills) this.skills.onHit();      // el guerrero sube rage al pegar
        this.net.attackMob(this.targetId, atk);    // el SERVER aplica el dano (compartido)
        // CLEAVE melee: el tajo barre en arco y alcanza hasta 2 zombies extra
        if (!ptype) this._cleave(target.id, atk);
        this.hud.showTarget('Zombi Nv.' + target.lvl, target.hp, target.hpMax);
      }
      return;
    }
    // PvP: auto-ataque contra el jugador targeteado (el server valida rango/zona)
    // PvP: a HUMANOS no se les auto-ataca. El frame muestra su vida; el golpe
    // solo sale con CLIC deliberado (manualAttack), a diferencia de los zombies.
    const rival = this.pvpId != null ? this.net.remotes.get(this.pvpId) : null;
    if (rival && rival.ready) {
      this.hud.showTarget('⚔ ' + (rival.name || 'Jugador'), rival.hp ?? 1, rival.hpMax ?? 1);
    }
  }

  // golpe PvP MANUAL: clic izquierdo / boton ATK con un jugador targeteado en
  // rango. La agresion a humanos es siempre una decision, nunca un automatismo.
  manualAttack() {
    if (this.dead || this.player.locked) return false;
    const rival = this.pvpId != null ? this.net.remotes.get(this.pvpId) : null;
    if (!rival || !rival.ready) return false;
    const d = Math.hypot(rival.x - this.player.pos.x, rival.z - this.player.pos.z);
    if (d >= ATTACK_RANGE || this.attackCd > 0) return false;
    this.attackCd = ATTACK_CD;
    this.player.heading = Math.atan2(rival.x - this.player.pos.x, rival.z - this.player.pos.z);
    this.player.attack();
    if (this.sfx) { this.sfx.swing(); this.sfx.hit(false); }
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

  // skill de party entrante (de un aliado, via server)
  applyPartySkill(m) {
    if (this.dead || !m) return;
    this._applyBuff(m.kind, Number(m.v) || 0, Number(m.dur) || 0);
    this.hud.toast('🤝 ' + (m.from || 'Aliado') + ' apoya al party');
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

  // ====== SKILLS estilo Dota (Q/W/E/R): el SkillSystem entrega el spec y aqui
  // se ejecuta el efecto. Cada tipo tiene su feel propio (anim + fx + dano). ======
  castSkill(s) {
    if (this.dead || !s || this.player.locked) return;
    const fx = this.effects;
    const p = this.player.pos;
    const aura = (this.classSpec && this.classSpec.auraColor) || 0xffd24a;
    const target = this.targetId ? this.net.mobs.get(this.targetId) : null;
    const cx = target ? target.x : p.x;
    const cz = target ? target.z : p.z;
    const base = (mult) => Math.round(this._playerAtk() * (mult || 1.5));
    const ptype = (this.classSpec && this.classSpec.projectile) || PROJECTILE_BY_CHAR[this.player.charFile];

    // dano en area alrededor de (ax, az), con numero y sangre por victima
    const hitArea = (ax, az, radius, dmg) => {
      let hits = 0;
      for (const m of this.net.mobs.values()) {
        if (Math.hypot(m.x - ax, m.z - az) > radius) continue;
        hits++;
        this.net.attackMob(m.id, dmg);
        if (fx) { fx.bloodHit({ x: m.x, y: 0.9, z: m.z }); fx.damageNumber({ x: m.x, y: 1.6, z: m.z }, dmg, { crit: true }); }
      }
      return hits;
    };
    const hitOne = (m, dmg) => {
      if (!m) return;
      this.net.attackMob(m.id, dmg);
      if (fx) { fx.bloodHit({ x: m.x, y: 0.9, z: m.z }); fx.damageNumber({ x: m.x, y: 1.7, z: m.z }, dmg, { crit: true }); }
    };
    const anim = (special) => special ? (this.player.attackSpecial ? this.player.attackSpecial() : this.player.attack()) : this.player.attack();

    switch (s.type) {
      case 'strike': {              // golpe brutal single
        anim(false);
        hitOne(target, base(s.dmgMult));
        break;
      }
      case 'stab': {                // single + roba vida
        anim(false);
        const dmg = base(s.dmgMult);
        hitOne(target, dmg);
        if (target && s.leech) {
          const heal = Math.round(dmg * s.leech);
          this.hp = Math.min(this.hpMax, this.hp + heal);
          this.hud.setHP(this.hp, this.hpMax);
          if (fx) { fx.healBurst({ x: p.x, y: 0.6, z: p.z }); fx.damageNumber({ x: p.x, y: 2.2, z: p.z }, heal, { heal: true }); }
        }
        break;
      }
      case 'pierce': case 'bolt': { // single ultra con proyectil
        anim(false);
        if (fx && target && ptype) fx.projectile({ x: p.x, y: 1.4, z: p.z }, { x: target.x, y: 0.9, z: target.z }, ptype);
        hitOne(target, base(s.dmgMult));
        break;
      }
      case 'execute': {             // remate: dano x2 extra si esta debil
        anim(true);
        if (target) {
          const weak = target.hpMax && (target.hp / target.hpMax) <= (s.threshold || 0.4);
          hitOne(target, base(weak ? s.executeMult : s.dmgMult));
          if (weak && fx) fx.goreBurst({ x: target.x, y: 0.9, z: target.z }, 1.6);
        }
        break;
      }
      case 'spin': case 'bladedance': {   // AoE alrededor del heroe
        anim(true);
        if (fx) fx.nova(p, aura, s.radius || 4);
        hitArea(p.x, p.z, s.radius || 4, base(s.dmgMult));
        break;
      }
      case 'nova': {                // anillo alrededor del heroe
        anim(true);
        if (fx) fx.nova(p, aura, s.radius || 4.5);
        hitArea(p.x, p.z, s.radius || 4.5, base(s.dmgMult));
        break;
      }
      case 'leap': {                // salto colerico: AoE grande donde estas
        anim(true);
        if (fx) { fx.nova(p, aura, s.radius || 6); fx.goreBurst({ x: p.x, y: 0.5, z: p.z }, 1.4); }
        hitArea(p.x, p.z, s.radius || 6, base(s.dmgMult));
        break;
      }
      case 'fireball': {            // proyectil con explosion de area en el target
        anim(false);
        if (fx && ptype) fx.projectile({ x: p.x, y: 1.4, z: p.z }, { x: cx, y: 0.9, z: cz }, ptype);
        hitArea(cx, cz, s.radius || 3.5, base(s.dmgMult));
        break;
      }
      case 'rain': case 'storm': {  // lluvia de proyectiles sobre el area del target
        anim(true);
        if (fx) fx.meteorRain({ x: cx, y: 0, z: cz }, s.radius || 5, s.type === 'storm' ? 12 : 7);
        hitArea(cx, cz, s.radius || 5, base(s.dmgMult));
        break;
      }
      case 'meteor': {              // el cielo se cae sobre el area
        anim(true);
        if (fx) { fx.meteorRain({ x: cx, y: 0, z: cz }, s.radius || 7, 14); fx.nova({ x: cx, y: 0, z: cz }, 0xff7a1e, s.radius || 7); }
        hitArea(cx, cz, s.radius || 7, base(s.dmgMult));
        break;
      }
      case 'volley': {              // dispara a los N zombies mas cercanos
        anim(false);
        const near = [...this.net.mobs.values()]
          .map((m) => ({ m, d: Math.hypot(m.x - p.x, m.z - p.z) }))
          .filter((e) => e.d < (s.range || 12))
          .sort((a, b) => a.d - b.d)
          .slice(0, s.count || 3);
        for (const { m } of near) {
          if (fx && ptype) fx.projectile({ x: p.x, y: 1.4, z: p.z }, { x: m.x, y: 0.9, z: m.z }, ptype);
          hitOne(m, base(s.dmgMult));
        }
        break;
      }
      case 'warcry': {              // buff de dano temporal + onda visual
        anim(true);
        this.dmgBuffMult = s.buffMult || 1.4;
        this.dmgBuffT = s.buffDur || 6;
        if (fx) fx.nova(p, aura, 3);
        this.hud.toast('📢 ¡' + s.name + '! +' + Math.round(((s.buffMult || 1.4) - 1) * 100) + '% daño');
        break;
      }
      // ===== SKILLS DE PARTY (slot R): benefician a TODO el grupo. La sinergia
      // perfecta es tener a los 4 heroes juntos: dano+cura+velocidad+escudo =====
      case 'partyheal': {           // Sombra: cura 35% a TODO el party
        anim(true);
        this._applyBuff('heal', s.v || 0.35, 0);
        this.net.partySkill('heal', s.v || 0.35, 0);
        this.hud.toast('🌑 ' + s.name + ': el party se cura');
        break;
      }
      case 'partybuff': {           // Verdugo: +45% dano a TODO el party
        anim(true);
        this._applyBuff('dmgbuff', s.v || 0.45, s.dur || 6);
        this.net.partySkill('dmgbuff', s.v || 0.45, s.dur || 6);
        if (fx) fx.nova(p, aura, 3);
        this.hud.toast('📢 ' + s.name + ': +' + Math.round((s.v || 0.45) * 100) + '% dano al party');
        break;
      }
      case 'partyhaste': {          // Cazadora: +30% velocidad a TODO el party
        anim(true);
        this._applyBuff('haste', s.v || 0.3, s.dur || 6);
        this.net.partySkill('haste', s.v || 0.3, s.dur || 6);
        if (fx) fx.nova(p, aura, 3);
        this.hud.toast('🐺 ' + s.name + ': el party corre +' + Math.round((s.v || 0.3) * 100) + '%');
        break;
      }
      case 'partyshield': {         // Piromante: escudo de 30 pts a TODO el party
        anim(true);
        this._applyBuff('shield', s.v || 30, s.dur || 8);
        this.net.partySkill('shield', s.v || 30, s.dur || 8);
        this.hud.toast('🛡️ ' + s.name + ': escudo para el party');
        break;
      }
      case 'veil': case 'heal': {   // autocuracion
        anim(true);
        const heal = Math.round(this.hpMax * (s.healPct || s.heal || 0.35));
        this.hp = Math.min(this.hpMax, this.hp + heal);
        this.hud.setHP(this.hp, this.hpMax);
        if (fx) { fx.healBurst({ x: p.x, y: 0.6, z: p.z }); fx.damageNumber({ x: p.x, y: 2.2, z: p.z }, heal, { heal: true }); }
        break;
      }
      default: {                    // fallback: golpe fuerte
        anim(false);
        hitOne(target, base(s.dmgMult));
      }
    }
    if (this.sfx) this.sfx.hit();
  }

  _onPlayerHit(hit) {
    if (this.dead || !hit) return;
    // el zombie que te pego se anima (el server manda su id en phit)
    if (this.mobField && hit.id != null) this.mobField.playAttack?.(hit.id);
    const dmg = Math.max(0, Number(hit.dmg) || 0);
    if (!dmg) return;
    this.hp = Math.max(0, this.hp - dmg);
    this.hud.setHP(this.hp, this.hpMax);
    this.player.playHit();
    if (this.sfx) this.sfx.hurt();
    if (this.skills) this.skills.gainRageFromDamage(8);
    if (this.effects) {
      this.effects.bloodHit({ x: this.player.pos.x, y: 1.1, z: this.player.pos.z });
      this.effects.damageNumber({ x: this.player.pos.x, y: 2.2, z: this.player.pos.z }, dmg, { toPlayer: true });
      this.effects.shake(0.07, 0.12);
    }
    // vignette roja: la pantalla ACUSA la mordida
    this.hud.hurtFlash?.();
    if (this.hp <= 0) this._die();
  }

  _onMobDead(id, by, party) {
    const wasMyTarget = this.targetId === id;
    if (wasMyTarget) { this.targetId = null; this.hud.hideTarget(); }
    const mine = (by === this.net.myId) || (Array.isArray(party) && party.includes(this.net.myId));
    if (!mine) return;
    const m = this.net.mobs.get(id);   // aun existe: net lo borra DESPUES de avisar
    const lvl = m ? m.lvl : 1;
    // RACHA: kills encadenados = multiplicador de oro/XP + contador en pantalla
    this.streak++;
    this.streakT = STREAK_WINDOW;
    const mult = 1 + Math.min(2, (this.streak - 1) * 0.15);
    if (this.streak >= 2) this.hud.showStreak?.(this.streak, mult);
    if (this.sfx) { this.sfx.kill(); this.sfx.streak?.(this.streak); }
    // GORE de kill (escala con la racha)
    if (this.effects && m) {
      this.effects.goreBurst({ x: m.x, y: 0.7, z: m.z }, 1 + Math.min(1, this.streak * 0.1));
      // VIOLENCIA: el zombie se parte en pedazos que vuelan y rebotan
      this.effects.dismember({ x: m.x, y: 0.8, z: m.z }, 0x7da364);
      this.effects.shake(0.1 + Math.min(0.12, this.streak * 0.02), 0.18);
    }
    // racha alta: micro camara-lenta de 0.15s (el kill se SABOREA)
    if (this.streak >= 5) this.slowMoT = 0.15;
    const leveled = this.prog.gainXp(Math.round((4 + lvl) * mult));
    this.hpMax = this.prog.hpMax;
    if (leveled) {
      this.hp = this.hpMax;
      this.hud.toast('Subiste a nivel ' + this.prog.level);
      if (this.sfx) this.sfx.levelup();
    }
    this.hud.setXP(this.prog.xp, this.prog.xpNext, this.prog.level);
    this.hud.setHP(this.hp, this.hpMax);
    if (this.onKillRewards) this.onKillRewards({ lvl, x: m ? m.x : 0, z: m ? m.z : 0, streak: this.streak, mult });
    // CADENA: retarget automatico al zombie mas cercano — el farmeo no se corta
    if (wasMyTarget) this._autoRetarget();
  }

  // busca el mob vivo mas cercano (<=14m) y lo targetea solo: cadena adictiva
  _autoRetarget() {
    const p = this.player.pos;
    let best = null, bd = 14;
    for (const m of this.net.mobs.values()) {
      const d = Math.hypot(m.x - p.x, m.z - p.z);
      if (d < bd) { bd = d; best = m.id; }
    }
    if (best != null) this._setTarget(best);
  }

  _die() {
    this.dead = true;
    this.respawnT = RESPAWN_T;
    this.targetId = null;
    this.pvpId = null;
    this.hud.hideTarget();
    this.player.locked = true;
    this.player.setDead(true);
    if (this.sfx) this.sfx.death();
    if (this.effects) this.effects.bloodDeath({ x: this.player.pos.x, y: 0.6, z: this.player.pos.z });
    this.hud.showDeath();
    this.hud.setDeathCount(RESPAWN_T);
  }

  _respawn() {
    this.dead = false;
    this.hp = this.hpMax;
    this.hud.setHP(this.hp, this.hpMax);
    this.hud.hideDeath();
    this.player.locked = false;
    this.player.setDead(false);
    this.onRespawn();
  }
}
