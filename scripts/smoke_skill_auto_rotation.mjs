globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
};
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};

const { SkillSystem } = await import('../src/rpg/skills.js');
const { Combat } = await import('../src/rpg/combat.js');

const SKILL_METHODS = ['canCast', 'tryAutoCast', 'update', '_castNow', '_bufferCast'];

function makeSkillFake(skills, opts = {}) {
  const casts = [];
  const fake = {
    skills,
    res: opts.res ?? 100,
    resMax: opts.resMax ?? 100,
    regen: opts.regen ?? 0,
    cds: opts.cds || skills.map(() => 0),
    _buffered: null,
    _autoCastT: 0,
    _onCast(s, ctx) {
      casts.push({ name: s.name, type: s.type, auto: !!ctx?.auto });
      return true;
    },
    _refreshUI() {},
  };
  for (const m of SKILL_METHODS) fake[m] = SkillSystem.prototype[m];
  return { fake, casts };
}

function autoCtx(extra = {}) {
  return {
    auto: true,
    hasTarget: true,
    dead: false,
    playerLocked: false,
    hpRatio: 0.8,
    targetHpRatio: 0.55,
    targetDist: 2.2,
    nearCount: 1,
    boss: false,
    ...extra,
  };
}

{
  const { fake, casts } = makeSkillFake([
    { key: 'R', name: 'Party Banner', type: 'partybuff', cost: 0, cd: 1, dmgMult: 99 },
    { key: 'Q', name: 'Strike', type: 'strike', cost: 10, cd: 1, dmgMult: 1.6 },
  ]);
  const ok = fake.tryAutoCast(autoCtx());
  if (!ok) throw new Error('auto rotation did not cast an offensive skill');
  if (casts.length !== 1 || casts[0].name !== 'Strike' || !casts[0].auto) {
    throw new Error(`auto rotation did not skip support skill: ${JSON.stringify(casts)}`);
  }
  if (fake.res !== 90 || fake.cds[1] <= 0) throw new Error('auto offensive cast did not spend resource and start cooldown');
  console.log('PASS: auto rotation skips support skills');
}

{
  const { fake, casts } = makeSkillFake([
    { key: 'Q', name: 'Strike', type: 'strike', cost: 5, cd: 1, dmgMult: 2.0 },
    { key: 'E', name: 'Spin', type: 'spin', cost: 5, cd: 1, dmgMult: 1.0 },
  ]);
  const ok = fake.tryAutoCast(autoCtx({ nearCount: 4 }));
  if (!ok || casts[0]?.name !== 'Spin') throw new Error(`dense pack did not choose area skill: ${JSON.stringify(casts)}`);
  console.log('PASS: auto rotation prefers area skill in a pack');
}

{
  const { fake, casts } = makeSkillFake([
    { key: 'E', name: 'Spin', type: 'spin', cost: 5, cd: 1, dmgMult: 1.0 },
    { key: 'F', name: 'Leap', type: 'leap', cost: 5, cd: 1, dmgMult: 4.0 },
  ]);
  const ok = fake.tryAutoCast(autoCtx({ nearCount: 4, nearPlayer: 4, nearTarget: 4, targetDist: 1.4 }));
  if (!ok || casts[0]?.name !== 'Spin') throw new Error(`melee pack auto rotation used leap instead of close-range area: ${JSON.stringify(casts)}`);
  console.log('PASS: auto rotation reserves leap for real entries');
}

{
  const { fake, casts } = makeSkillFake([
    { key: 'Q', name: 'Nova', type: 'nova', cost: 5, cd: 1, dmgMult: 4.0 },
    { key: 'E', name: 'Fireball', type: 'fireball', cost: 5, cd: 1, dmgMult: 1.0 },
  ]);
  const ok = fake.tryAutoCast(autoCtx({ nearCount: 4, nearPlayer: 1, nearTarget: 4, targetDist: 8 }));
  if (!ok || casts[0]?.name !== 'Fireball') throw new Error(`target pack used self-centered area skill: ${JSON.stringify(casts)}`);
  console.log('PASS: auto rotation separates self-area from target-area density');
}

{
  const { fake, casts } = makeSkillFake([
    { key: 'F', name: 'Execute', type: 'execute', cost: 0, cd: 1, dmgMult: 2.0, threshold: 0.4 },
  ]);
  const healthy = fake.tryAutoCast(autoCtx({ targetHpRatio: 0.8 }));
  if (healthy || casts.length) throw new Error('execute auto-cast fired on a healthy target');
  const weak = fake.tryAutoCast(autoCtx({ targetHpRatio: 0.32 }));
  if (!weak || casts[0]?.name !== 'Execute') throw new Error('execute auto-cast did not fire on a weak target');
  console.log('PASS: auto rotation gates execute by target health');
}

{
  const { fake, casts } = makeSkillFake([
    { key: 'F', name: 'Execute', type: 'execute', cost: 0, cd: 1, dmgMult: 2.0, threshold: 0.4 },
  ]);
  const ok = fake.tryAutoCast(autoCtx({ targetHpRatio: 0.82, weakestHpRatio: 0.24 }));
  if (!ok || casts[0]?.name !== 'Execute') throw new Error('execute auto-cast ignored weak nearby target');
  console.log('PASS: auto rotation lets execute target a weak nearby mob');
}

{
  const { fake, casts } = makeSkillFake([
    { key: 'Q', name: 'Quick Strike', type: 'strike', cost: 0, cd: 0.01, dmgMult: 1.0 },
  ]);
  if (!fake.tryAutoCast(autoCtx())) throw new Error('first auto cast failed');
  if (fake.tryAutoCast(autoCtx())) throw new Error('auto cast ignored throttle');
  fake.update(0.17);
  if (fake.tryAutoCast(autoCtx())) throw new Error('auto cast throttle expired too early');
  fake.update(0.20);
  if (!fake.tryAutoCast(autoCtx())) throw new Error('auto cast did not recover after throttle');
  if (casts.length !== 2) throw new Error(`unexpected throttled cast count: ${casts.length}`);
  console.log('PASS: auto rotation has a short throttle');
}

function makeCombat(autoReturn = true) {
  const attacks = [];
  const calls = [];
  const mobs = new Map([
    [1, { id: 1, x: 2.0, z: 0, hp: 40, hpMax: 40, lvl: 1 }],
    [2, { id: 2, x: 2.7, z: 0.2, hp: 40, hpMax: 40, lvl: 1 }],
    [3, { id: 3, x: 2.4, z: -0.3, hp: 8, hpMax: 40, lvl: 1 }],
  ]);
  const combat = new Combat({
    scene: null,
    camera: null,
    player: {
      charFile: 'char_knight.glb',
      pos: { x: 0, z: 0 },
      keys: {},
      locked: false,
      dead: false,
      heading: 0,
      comboStep: 0,
      attack() { attacks.push('attack'); return true; },
    },
    mobField: {
      setTargeted() {},
      meshes() { return []; },
      pickFromIntersections() { return null; },
    },
    net: {
      myId: 1,
      mobs,
      remotes: new Map(),
      party: [],
      attackMob() {},
      sendAttack() {},
      partySkill() {},
      reportStreak() {},
    },
    inventory: { equippedWeapon: null },
    progress: { hpMax: 100, xp: 0, xpNext: 10, level: 1, gainXp() { return false; } },
    hud: {
      setHP() {},
      setXP() {},
      showTarget() {},
      hideTarget() {},
      hideStreak() {},
      toast() {},
    },
    skills: {
      tryAutoCast(ctx) {
        calls.push(ctx);
        return autoReturn;
      },
    },
  });
  return { combat, attacks, calls };
}

{
  const { combat, attacks, calls } = makeCombat(true);
  combat.autoAttack = true;
  combat.update(0.016);
  if (calls.length !== 1) throw new Error('combat did not ask SkillSystem for an auto cast');
  if (!calls[0].auto || !calls[0].hasTarget || calls[0].nearCount < 2 || calls[0].nearPlayer < 2 || calls[0].nearTarget < 2 || calls[0].weakestHpRatio > 0.21) {
    throw new Error(`combat sent incomplete auto cast context: ${JSON.stringify(calls[0])}`);
  }
  if (attacks.length) throw new Error('basic attack fired on the same frame as an accepted auto skill');
  console.log('PASS: combat auto skill suppresses same-frame basic attack');
}

{
  const { combat, attacks, calls } = makeCombat(true);
  combat.autoAttack = false;
  combat.update(0.016);
  if (calls.length) throw new Error('combat tried auto skill while auto attack was disabled');
  if (attacks.length) throw new Error('combat basic attack fired with auto attack disabled and no manual punch');
  console.log('PASS: combat auto rotation respects manual mode');
}

console.log('PASS: skill auto rotation smoke');
