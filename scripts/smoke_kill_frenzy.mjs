globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
};
globalThis.addEventListener = () => {};

const { Combat } = await import('../src/rpg/combat.js');
const { SkillSystem } = await import('../src/rpg/skills.js');

function makeCombat(opts = {}) {
  const skillKills = [];
  const rewards = [];
  const streaks = [];
  const effects = [];
  const lunges = [];
  const hits = [];
  const mob = { id: 3, x: 2, z: 0, hp: 0, hpMax: 40, lvl: 2, b: 0 };
  const nextMob = { id: 4, x: 5.7, z: 0, hp: 22, hpMax: 22, lvl: 2, b: 0 };
  const closeMob = { id: 5, x: 5.9, z: 1.0, hp: 5, hpMax: 22, lvl: 2, b: 0 };
  const farMob = { id: 6, x: 8.8, z: 0, hp: 22, hpMax: 22, lvl: 2, b: 0 };
  const player = {
    charFile: opts.charFile || 'char_knight.glb',
    pos: { x: 0, z: 0 },
    speedBuffT: 0,
    speedBuffMult: 1,
    dashCd: 0.58,
    attackT: 0.26,
    comboT: 0.02,
    keys: {},
    locked: false,
    dead: false,
    heading: 0,
    setDead() {},
    combatLunge(tx, tz, step) {
      lunges.push({ tx, tz, step });
      const dx = tx - this.pos.x;
      const dz = tz - this.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      this.pos.x += (dx / d) * step;
      this.pos.z += (dz / d) * step;
      return true;
    },
  };
  const combat = new Combat({
    scene: null,
    camera: null,
    player,
    mobField: {
      setTargeted() {},
      meshes() { return []; },
      pickFromIntersections() { return null; },
    },
    net: {
      myId: 9,
      mobs: new Map([[mob.id, mob], [nextMob.id, nextMob], [closeMob.id, closeMob], [farMob.id, farMob]]),
      remotes: new Map(),
      party: [],
      sendAttack() {},
      attackMob(id, dmg, kind) { hits.push({ id, dmg, kind }); },
      partySkill() {},
      reportStreak(v) { streaks.push(v); },
    },
    inventory: { equippedWeapon: null },
    progress: { hpMax: 100, xp: 0, xpNext: 10, level: 1, gainXp() { return false; } },
    hud: {
      setHP() {},
      setXP() {},
      showTarget() {},
      hideTarget() {},
      toast() {},
      showStreak() {},
      hideStreak() {},
    },
    effects: {
      projectile() { effects.push('projectile'); },
      goreBurst() { effects.push('gore'); },
      dismember() { effects.push('dismember'); },
      bloodHit() { effects.push('blood'); },
      damageNumber() { effects.push('number'); },
      healBurst() { effects.push('heal'); },
      nova() { effects.push('nova'); },
      dashTrail(from, to, color, opts) { effects.push({ type: 'trail', from, to, color, opts }); return true; },
      hitFlash(pos, color) { effects.push({ type: 'flash', pos, color }); return true; },
      shake() { effects.push('shake'); },
    },
    sfx: { kill() {}, streak() {} },
    skills: { onKill(streak, boss) { skillKills.push({ streak, boss }); } },
    onKillRewards(info) { rewards.push(info); },
  });
  return { combat, mob, nextMob, closeMob, farMob, skillKills, rewards, streaks, effects, lunges, hits };
}

{
  const { combat, mob, closeMob, skillKills, rewards, effects, lunges, hits } = makeCombat();
  combat.autoAttack = true;
  combat.targetId = mob.id;
  combat.attackCd = 0.31;
  combat.hp = 42;
  combat._onMobDead(mob.id, 9, []);
  if (combat.streak !== 1) throw new Error('kill did not increment streak');
  if (combat.hp !== 49) throw new Error(`kill sustain expected hp 49, got ${combat.hp}`);
  if (combat.attackCd > 0.041) throw new Error(`kill frenzy did not reset attack cd: ${combat.attackCd}`);
  if (combat.player.dashCd > 0.081) throw new Error(`kill frenzy did not refresh dash cd: ${combat.player.dashCd}`);
  if (combat.player.speedBuffT < 1.3) throw new Error('kill frenzy did not add speed time');
  if (combat.player.speedBuffMult < 1.17) throw new Error('kill frenzy did not add speed multiplier');
  if (combat.player.attackT > 0.051) throw new Error(`kill chain did not release hard attack lock: ${combat.player.attackT}`);
  if (combat.player.comboT < 0.81) throw new Error(`kill chain did not carry combo window: ${combat.player.comboT}`);
  if (combat.targetId !== closeMob.id) throw new Error(`kill chain did not prefer wounded nearby target: ${combat.targetId}`);
  if (combat.targetLocked) throw new Error('kill chain should keep auto target unlocked');
  if (!lunges.length || lunges[0].step < 2.0) throw new Error('kill chain did not lunge toward chosen mob');
  if (combat.player.pos.x <= 2) throw new Error('kill chain lunge did not move player forward');
  const chainTrail = effects.find((e) => e && e.type === 'trail' && e.opts?.opacity >= 0.3 && e.opts?.width >= 0.4);
  if (!chainTrail || chainTrail.to.x <= chainTrail.from.x) throw new Error('kill chain lunge did not leave a forward trail');
  if (!effects.some((e) => e && e.type === 'flash')) throw new Error('kill chain lunge did not flash on landing');
  if (combat._attackCooldown() >= 0.34) throw new Error('kill frenzy did not speed up attack cooldown');
  if (combat._attackAnimSpeed() < 1.17) throw new Error('kill frenzy did not speed up attack animation');
  if (skillKills.length !== 1 || skillKills[0].streak !== 1 || skillKills[0].boss !== false) {
    throw new Error('kill frenzy did not notify skills');
  }
  if (!rewards.length || rewards[0].streak !== 1) throw new Error('kill rewards did not receive streak');
  if (!effects.includes('gore') || !effects.includes('dismember')) throw new Error('kill gore effects did not run');
  if (hits.length) throw new Error('kill rupture should not trigger below streak 3');
  console.log('PASS: own kill triggers movement and attack-chain frenzy');
}

{
  const { combat, mob, nextMob, closeMob, effects, lunges } = makeCombat();
  combat.autoAttack = true;
  combat.targetId = nextMob.id;
  combat.targetLocked = false;
  combat._onMobDead(mob.id, 9, []);
  if (combat.targetId !== closeMob.id) {
    throw new Error(`area kill should retarget best pressure mob, got ${combat.targetId}`);
  }
  if (combat.targetLocked) throw new Error('area kill retarget should stay soft');
  if (!lunges.length || lunges[0].step < 3.0) throw new Error(`area kill retarget did not use faster chain lunge: ${JSON.stringify(lunges)}`);
  if (!effects.some((e) => e && e.type === 'trail' && e.opts?.opacity >= 0.3)) throw new Error('area kill retarget did not emit chain lunge trail');
  console.log('PASS: area kill retarget keeps the chain moving');
}

{
  const { combat, mob, nextMob, lunges } = makeCombat();
  combat.autoAttack = true;
  combat.targetId = nextMob.id;
  combat.targetLocked = true;
  combat._onMobDead(mob.id, 9, []);
  if (combat.targetId !== nextMob.id || !combat.targetLocked) {
    throw new Error(`area kill stole manual target lock: target=${combat.targetId}, locked=${combat.targetLocked}`);
  }
  if (lunges.length) throw new Error('manual target lock should not trigger kill-chain lunge');
  console.log('PASS: area kill retarget respects manual target lock');
}

{
  const { combat, mob, effects } = makeCombat();
  mob.b = 1;
  combat.hp = 20;
  combat._onMobDead(mob.id, 9, []);
  if (combat.hp !== 44) throw new Error(`boss kill sustain expected hp 44, got ${combat.hp}`);
  if (!effects.includes('heal')) throw new Error('boss kill sustain did not emit heal feedback');
  console.log('PASS: kill sustain gives a boss-sized survival refill');
}

{
  const { combat, mob, nextMob, closeMob, farMob, hits, effects, streaks } = makeCombat();
  combat.autoAttack = true;
  combat.streak = 2;
  combat._onMobDead(mob.id, 9, []);
  const ids = hits.map((h) => h.id).sort((a, b) => a - b);
  if (ids.length !== 2 || ids[0] !== nextMob.id || ids[1] !== closeMob.id) {
    throw new Error(`kill rupture target mismatch: ${ids.join(',')}`);
  }
  if (hits.some((h) => h.id === mob.id || h.id === farMob.id)) {
    throw new Error('kill rupture hit dead or far mob');
  }
  if (hits.some((h) => h.kind !== 'skill' || h.dmg < 1)) {
    throw new Error('kill rupture sent invalid hit payload');
  }
  if (!effects.includes('blood') || !effects.includes('number') || !effects.includes('nova')) {
    throw new Error('kill rupture feedback did not run');
  }
  if (!streaks.includes(3)) throw new Error('kill rupture streak did not report at 3');
  console.log('PASS: auto streak 3 kill rupture splashes nearby mobs only');
}

{
  const { combat, mob, hits, effects, streaks } = makeCombat();
  combat.autoAttack = false;
  combat.streak = 2;
  combat._onMobDead(mob.id, 9, [], { kind: 'basic', dmg: 24, hpBefore: 12, hpMax: 40, lvl: 2 });
  if (hits.length) throw new Error(`manual basic kill ruptured into random hits: ${JSON.stringify(hits)}`);
  if (effects.includes('nova')) throw new Error('manual basic kill should not emit rupture nova');
  if (!streaks.includes(3)) throw new Error('manual basic kill should still report streak');
  console.log('PASS: manual basic streak kill does not rupture into random attacks');
}

{
  const { combat, mob, hits, effects } = makeCombat();
  combat.autoAttack = false;
  combat.streak = 2;
  combat._onMobDead(mob.id, 9, [], { kind: 'heavy', dmg: 54, hpBefore: 12, hpMax: 40, lvl: 2 });
  if (hits.length) throw new Error(`manual heavy basic kill ruptured into random hits: ${JSON.stringify(hits)}`);
  if (effects.includes('nova')) throw new Error('manual heavy basic kill should not emit rupture nova');
  if (!effects.includes('gore') || !effects.includes('dismember')) throw new Error('manual heavy basic kill should keep kill gore feedback');
  console.log('PASS: manual heavy basic kill gives gore without random rupture');
}

{
  const { combat, mob, nextMob, closeMob, hits, effects } = makeCombat();
  combat.autoAttack = true;
  combat.streak = 0;
  combat._onMobDead(mob.id, 9, [], { kind: 'heavy', dmg: 54, hpBefore: 12, hpMax: 40, lvl: 2 });
  const ids = hits.map((h) => h.id).sort((a, b) => a - b);
  if (ids.length !== 2 || ids[0] !== nextMob.id || ids[1] !== closeMob.id) {
    throw new Error(`auto heavy basic kill rupture target mismatch: ${ids.join(',')}`);
  }
  if (hits.some((h) => h.kind !== 'skill' || h.dmg < 1)) {
    throw new Error(`auto heavy basic kill rupture sent invalid hits: ${JSON.stringify(hits)}`);
  }
  if (!effects.includes('gore') || !effects.includes('nova') || !effects.includes('shake')) {
    throw new Error('auto heavy basic kill rupture feedback did not run');
  }
  console.log('PASS: auto heavy basic kill ruptures nearby pack with gore feedback');
}

{
  const { combat, mob, nextMob, closeMob, farMob, hits, effects } = makeCombat();
  combat.streak = 0;
  combat._onMobDead(mob.id, 9, [], { kind: 'skill', dmg: 82, hpBefore: 18, hpMax: 40, lvl: 2 });
  const ids = hits.map((h) => h.id).sort((a, b) => a - b);
  if (ids.length !== 2 || ids[0] !== nextMob.id || ids[1] !== closeMob.id) {
    throw new Error(`heavy overkill rupture target mismatch: ${ids.join(',')}`);
  }
  if (hits.some((h) => h.id === mob.id || h.id === farMob.id || h.kind !== 'skill')) {
    throw new Error(`heavy overkill rupture sent invalid hits: ${JSON.stringify(hits)}`);
  }
  if (!effects.includes('gore') || !effects.includes('nova') || !effects.includes('shake')) {
    throw new Error('heavy overkill rupture feedback did not run');
  }
  console.log('PASS: heavy skill overkill ruptures nearby pack before streak 3');
}

{
  const { combat, mob } = makeCombat();
  mob.b = 1;
  combat.player.dashCd = 0.58;
  combat.player.attackT = 0.4;
  combat._applyKillFrenzy(mob);
  if (combat.player.dashCd !== 0) throw new Error('boss kill frenzy should fully refresh dash');
  if (combat.player.attackT !== 0) throw new Error('boss kill frenzy should fully release attack lock');
  console.log('PASS: boss kill fully refreshes dash');
}

{
  const { combat, mob, nextMob, closeMob, farMob, lunges, hits } = makeCombat({ charFile: 'char_ranger.glb' });
  const attacks = [];
  combat.autoAttack = true;
  nextMob.x = 13.4; nextMob.z = 0; nextMob.hp = 22; nextMob.hpMax = 22;
  closeMob.hp = 0;
  farMob.hp = 0;
  combat.player.attack = () => { attacks.push('attack'); return true; };
  combat.targetId = nextMob.id;
  combat.attackCd = 0;
  combat.chainShotT = 0;
  combat.update(0.016);
  if (attacks.length) throw new Error('ranged basic attack should not fire beyond normal range');
  combat.targetId = mob.id;
  combat.attackCd = 0.31;
  combat._onMobDead(mob.id, 9, []);
  if (combat.targetId !== nextMob.id) throw new Error(`ranged kill chain did not retarget distant mob: ${combat.targetId}`);
  if (lunges.length) throw new Error('ranged kill chain should not lunge');
  if (combat.chainShotT <= 0) throw new Error('ranged kill chain did not arm chain shot');
  combat.attackCd = 0;
  combat.update(0.016);
  if (attacks.length !== 1) throw new Error('ranged chain shot did not fire inside kill-chain range');
  if (hits.length) throw new Error('ranged chain shot should still wait for projectile timing');
  combat._clearImpacts();
  console.log('PASS: ranged kill chain fires a follow-up shot without melee lunge');
}

{
  const { combat, mob, nextMob, lunges } = makeCombat();
  combat.autoAttack = false;
  combat.targetId = mob.id;
  combat._onMobDead(mob.id, 9, []);
  if (combat.targetId != null) throw new Error(`manual kill should not auto-retarget, got ${combat.targetId}`);
  if (lunges.length) throw new Error('manual kill should not trigger kill-chain lunge');
  combat.targetId = nextMob.id;
  combat.attackCd = 0;
  combat.update(0.016);
  if (lunges.length) throw new Error('manual mode should not lunge toward a target without input');
  console.log('PASS: manual mode does not chain into random attacks after a kill');
}

{
  const fake = {
    res: 10,
    resMax: 100,
    cds: [2.0, 0.1, 0, 5.0],
    _autoCastT: 0.22,
    refreshed: 0,
    _refreshUI() { this.refreshed++; },
  };
  const out = SkillSystem.prototype.onKill.call(fake, 4, false);
  if (fake.res <= 10 || fake.res > fake.resMax) throw new Error('skill onKill did not grant resource');
  if (fake.cds[0] >= 2.0 || fake.cds[1] !== 0 || fake.cds[3] >= 5.0) {
    throw new Error('skill onKill did not refund cooldowns');
  }
  if (Math.abs(out.refund - 0.275) > 0.0001 || fake.refreshed !== 1) throw new Error('skill onKill returned unexpected refund or missed refresh');
  if (Math.abs(fake._autoCastT - 0.12) > 0.0001 || out.autoRefund !== 0.10) {
    throw new Error(`skill onKill did not speed up next auto cast: ${fake._autoCastT}`);
  }
  console.log('PASS: skill system refunds resource and cooldowns on kill');
}

{
  const fake = {
    res: 0,
    resMax: 100,
    cds: [4.0],
    _autoCastT: 0,
    _refreshUI() {},
  };
  const out = SkillSystem.prototype.onKill.call(fake, 20, false);
  if (Math.abs(out.refund - 0.42) > 0.0001) throw new Error(`streak refund cap mismatch: ${out.refund}`);
  if (Math.abs(fake.cds[0] - 3.58) > 0.0001) throw new Error(`streak refund cap did not apply to cooldown: ${fake.cds[0]}`);
  console.log('PASS: skill cooldown overdrive scales and caps with streak');
}

{
  const fake = {
    res: 90,
    resMax: 100,
    cds: [1.1],
    _autoCastT: 0.22,
    refreshed: 0,
    _refreshUI() { this.refreshed++; },
  };
  const out = SkillSystem.prototype.onKill.call(fake, 7, true);
  if (fake.res !== 100) throw new Error('boss kill resource should clamp at max');
  if (Math.abs(fake.cds[0] - 0.45) > 0.0001) throw new Error(`boss kill cooldown refund mismatch: ${fake.cds[0]}`);
  if (out.refund !== 0.65) throw new Error('boss kill refund should be stronger');
  if (fake._autoCastT !== 0 || out.autoRefund !== 0.24) throw new Error('boss kill should fully clear auto cast throttle');
  console.log('PASS: boss kill grants stronger frenzy refund');
}

console.log('PASS: kill frenzy smoke');
