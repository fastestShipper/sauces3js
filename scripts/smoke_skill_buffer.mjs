globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.localStorage = { getItem() { return null; }, setItem() {} };

const { SkillSystem } = await import('../src/rpg/skills.js');
const { Combat } = await import('../src/rpg/combat.js');

const METHODS = ['canCast', 'tryCast', 'update', '_castNow', '_bufferCast'];

function makeFake({ res = 10, regen = 0, cd = 0, accepted = true } = {}) {
  const casts = [];
  const fake = {
    skills: [{ key: 'Q', name: 'Test', cost: 10, cd: 1 }],
    res,
    resMax: 100,
    regen,
    cds: [cd],
    _buffered: null,
    refreshes: 0,
    _onCast(s) {
      casts.push(s.name);
      return accepted;
    },
    _refreshUI() {
      this.refreshes++;
    },
  };
  for (const m of METHODS) fake[m] = SkillSystem.prototype[m];
  return { fake, casts };
}

{
  const { fake, casts } = makeFake({ cd: 0.18 });
  const out = fake.tryCast(0);
  if (out !== false || !fake._buffered) throw new Error('cooldown cast should buffer');
  fake.update(0.1);
  if (casts.length !== 0 || !fake._buffered) throw new Error('buffer fired before cooldown finished');
  fake.update(0.1);
  if (casts.length !== 1) throw new Error('buffer did not cast after cooldown finished');
  if (fake.res !== 0 || fake.cds[0] < 0.99) throw new Error('buffered cast did not spend resource and set cooldown');
  if (fake._buffered) throw new Error('buffer should clear after successful cast');
  console.log('PASS: skill buffer fires after cooldown');
}

{
  const { fake, casts } = makeFake({ res: 8, regen: 12 });
  fake.tryCast(0);
  fake.update(0.2);
  if (casts.length !== 1) throw new Error('buffer did not cast after resource regenerated');
  if (fake.res > 0.5) throw new Error('buffered resource cast spent unexpected amount');
  console.log('PASS: skill buffer fires after resource regen');
}

{
  const { fake, casts } = makeFake({ cd: 1.0 });
  fake.tryCast(0);
  fake.update(0.4);
  if (casts.length !== 0) throw new Error('expired buffer should not cast');
  if (fake._buffered) throw new Error('expired buffer should clear');
  console.log('PASS: skill buffer expires cleanly');
}

{
  const { fake, casts } = makeFake({ accepted: false });
  const out = fake.tryCast(0);
  if (out !== false || casts.length !== 1) throw new Error('ready rejected cast should call onCast once');
  if (fake.res !== 10 || fake.cds[0] !== 0) throw new Error('rejected cast should not spend or start cooldown');
  if (fake._buffered) throw new Error('rejected ready cast should not leave a buffer');
  console.log('PASS: rejected ready cast does not become a phantom buffer');
}

{
  const casts = [];
  let hasTarget = false;
  const fake = {
    skills: [{ key: 'Q', name: 'Strike', cost: 10, cd: 1 }],
    res: 20,
    resMax: 100,
    regen: 0,
    cds: [0],
    _buffered: null,
    refreshes: 0,
    _onCast(s, opts) {
      casts.push({ name: s.name, buffered: !!opts?.buffered });
      return hasTarget ? true : { buffer: true };
    },
    _refreshUI() {
      this.refreshes++;
    },
  };
  for (const m of METHODS) fake[m] = SkillSystem.prototype[m];
  const out = fake.tryCast(0);
  if (out !== false || !fake._buffered) throw new Error('ready no-target skill should enter buffer');
  if (fake.res !== 20 || fake.cds[0] !== 0) throw new Error('buffered no-target skill should not spend resource or cooldown');
  fake.update(0.12);
  if (casts.length < 2 || !fake._buffered) throw new Error('buffered no-target skill should keep retrying while target is missing');
  hasTarget = true;
  fake.update(0.08);
  if (fake._buffered) throw new Error('target-ready buffered skill should clear buffer');
  if (fake.res !== 10 || fake.cds[0] < 0.99) throw new Error('target-ready buffered skill did not spend resource and start cooldown');
  if (!casts.some((c) => c.buffered)) throw new Error('buffer retry did not mark cast context as buffered');
  console.log('PASS: ready target skill buffers until a target appears');
}

{
  const mob = { id: 41, x: 2, z: 0, hp: 40, hpMax: 40, lvl: 1 };
  const animations = [];
  const player = {
    charFile: 'char_knight.glb',
    pos: { x: 0, z: 0 },
    keys: {},
    locked: false,
    dead: false,
    attackT: 0.2,
    attackSkill(type) { animations.push(type); return true; },
  };
  const combat = new Combat({
    scene: null,
    camera: null,
    player,
    mobField: { setTargeted() {}, meshes() { return []; }, pickFromIntersections() { return null; } },
    net: {
      myId: 1,
      mobs: new Map([[mob.id, mob]]),
      remotes: new Map(),
      party: [],
      attackMob() {},
      sendAttack() {},
      partySkill() {},
      reportStreak() {},
    },
    inventory: { equippedWeapon: null },
    progress: { hpMax: 100, xp: 0, xpNext: 10, level: 1, gainXp() { return false; } },
    hud: { setHP() {}, setXP() {}, showTarget() {}, hideTarget() {}, toast() {} },
  });
  const skill = { key: 'Q', name: 'Locked Strike', type: 'strike', cost: 10, cd: 1, dmgMult: 2 };
  const fake = {
    skills: [skill],
    res: 20,
    resMax: 100,
    regen: 0,
    cds: [0],
    _buffered: null,
    _onCast(s, opts) { return combat.castSkill(s, opts); },
    _refreshUI() {},
  };
  for (const m of METHODS) fake[m] = SkillSystem.prototype[m];
  const out = fake.tryCast(0);
  if (out !== false || !fake._buffered) throw new Error('attack cancel lock should buffer a ready skill');
  if (fake.res !== 20 || fake.cds[0] !== 0 || animations.length !== 0) {
    throw new Error('attack cancel lock spent resource, started cooldown, or animated prematurely');
  }
  player.attackT = 0;
  fake.update(0.02);
  if (animations.length !== 1 || fake.res !== 10 || fake.cds[0] < 0.99 || fake._buffered) {
    throw new Error('buffered skill did not cast exactly once after the cancel lock opened');
  }
  combat._clearImpacts();
  console.log('PASS: attack cancel lock buffers skill without premature cost or cooldown');
}

console.log('PASS: skill buffer smoke');
