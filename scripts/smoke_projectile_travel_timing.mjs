globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
};
globalThis.addEventListener = () => {};

const { Combat } = await import('../src/rpg/combat.js');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs = 700) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await wait(8);
  }
  return predicate();
}

function makeCombat(mobs = [], opts = {}) {
  const hits = [];
  const projectiles = [];
  const attacks = [];
  const mobMap = new Map(mobs.map((m) => [m.id, { hpMax: m.hpMax || m.hp || 40, lvl: m.lvl || 1, ...m }]));
  const player = {
    charFile: opts.charFile || 'char_mage.glb',
    pos: { x: 0, z: 0 },
    keys: {},
    locked: false,
    dead: false,
    heading: 0,
    comboStep: 0,
    attack() { attacks.push('attack'); return true; },
    attackSpecial() { attacks.push('special'); return true; },
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
      myId: 1,
      mobs: mobMap,
      remotes: new Map(),
      party: [],
      attackMob(id, dmg, kind) { hits.push({ id, dmg, kind, t: Date.now() }); },
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
      toast() {},
      hideStreak() {},
    },
    classSpec: opts.classSpec || { projectile: 'fireball', auraColor: 0xff7a1e },
    sfx: { hit() {}, swing() {}, skill() {} },
    effects: {
      projectile(from, to, type) { projectiles.push({ from, to, type }); },
      slashArc() {},
      bloodHit() {},
      damageNumber() {},
      goreBurst() {},
      shake() {},
      meteorRain() {},
      nova() {},
    },
  });
  return { combat, hits, attacks, projectiles };
}

{
  const { combat, hits, projectiles } = makeCombat([{ id: 21, x: 8, z: 0, hp: 40 }]);
  const start = Date.now();
  combat.targetId = 21;
  combat.autoAttack = true;
  combat.update(0.016);
  if (projectiles.length || hits.length) throw new Error('basic magic attack fired before animation release');
  await wait(60);
  if (projectiles.length || hits.length) throw new Error('basic magic attack released too early');
  await waitFor(() => projectiles.length === 1, 260);
  if (projectiles.length !== 1 || projectiles[0].type !== 'fireball') {
    throw new Error('basic magic attack did not spawn projectile at release');
  }
  if (hits.length) throw new Error('basic magic attack landed at release instead of after travel');
  await waitFor(() => hits.length === 1, 600);
  if (hits.length !== 1 || hits[0].id !== 21 || hits[0].t - start < 330) {
    throw new Error(`basic magic attack did not land after release plus travel: ${JSON.stringify({ hits, delta: hits[0] ? hits[0].t - start : null })}`);
  }
  console.log('PASS: basic magic projectile spawns on animation release before damage');
}

{
  const { combat, hits, projectiles } = makeCombat([{ id: 22, x: 5, z: 0, hp: 40 }], {
    charFile: 'char_ranger.glb',
    classSpec: { projectile: 'arrow', auraColor: 0x59d98c, combatStyle: 'bow' },
  });
  const start = Date.now();
  combat.targetId = 22;
  combat.autoAttack = true;
  combat.update(0.016);
  if (projectiles.length) throw new Error('basic bow attack spawned arrow before draw release');
  if (hits.length) throw new Error('basic bow attack hit before draw release');
  await wait(80);
  if (projectiles.length || hits.length) throw new Error('basic bow attack released too early');
  await waitFor(() => projectiles.length === 1, 260);
  if (projectiles.length !== 1 || projectiles[0].type !== 'arrow') {
    throw new Error('basic bow attack did not spawn arrow at release');
  }
  if (hits.length) throw new Error('basic bow attack landed at release instead of after travel');
  await waitFor(() => hits.length === 1, 500);
  if (hits.length !== 1 || hits[0].id !== 22 || hits[0].t - start < 230) {
    throw new Error('basic bow attack did not land after release plus travel');
  }
  console.log('PASS: basic bow arrow spawns on animation release before damage');
}

{
  const near = makeCombat([{ id: 31, x: 3, z: 0, hp: 40 }]);
  const far = makeCombat([{ id: 32, x: 13.5, z: 0, hp: 40 }]);
  const nearStart = Date.now();
  if (!near.combat.castSkill({ type: 'fireball', dmgMult: 2.1, radius: 3.5 })) {
    throw new Error('near fireball was rejected');
  }
  if (near.projectiles.length || near.hits.length) throw new Error('near fireball fired before magic release');
  await wait(80);
  if (near.projectiles.length || near.hits.length) throw new Error('near fireball released too early');
  await waitFor(() => near.projectiles.length === 1, 260);
  if (near.projectiles.length !== 1 || near.projectiles[0].type !== 'fireball') {
    throw new Error('near fireball did not spawn projectile at release');
  }
  if (near.hits.length) throw new Error('near fireball landed at release instead of after travel');
  await waitFor(() => near.hits.length === 1, 500);
  if (near.hits.length !== 1 || near.hits[0].id !== 31 || near.hits[0].t - nearStart < 220) {
    throw new Error('near fireball did not land after release plus travel');
  }

  const farStart = Date.now();
  if (!far.combat.castSkill({ type: 'fireball', dmgMult: 2.1, radius: 3.5 })) {
    throw new Error('far fireball was rejected');
  }
  await wait(430);
  if (far.hits.length) throw new Error('far fireball landed too early for long travel distance');
  await waitFor(() => far.hits.length === 1, 500);
  if (far.hits.length !== 1 || far.hits[0].id !== 32 || far.hits[0].t - farStart < 500) {
    throw new Error('far fireball did not land after long travel delay');
  }
  console.log('PASS: magic projectile skill timing waits for release and distance');
}

{
  const bow = makeCombat([{ id: 41, x: 5, z: 0, hp: 40 }], {
    charFile: 'char_ranger.glb',
    classSpec: { projectile: 'arrow', auraColor: 0x59d98c, combatStyle: 'bow' },
  });
  const start = Date.now();
  if (!bow.combat.castSkill({ type: 'pierce', dmgMult: 3.0 })) {
    throw new Error('bow pierce was rejected');
  }
  if (bow.projectiles.length) throw new Error('bow pierce spawned arrow before draw release');
  await wait(80);
  if (bow.projectiles.length || bow.hits.length) {
    throw new Error('bow pierce released arrow or damage too early');
  }
  await waitFor(() => bow.projectiles.length === 1, 260);
  if (bow.projectiles.length !== 1 || bow.projectiles[0].type !== 'arrow') {
    throw new Error('bow pierce did not spawn arrow at release');
  }
  if (bow.hits.length) throw new Error('bow pierce damage landed at release instead of after travel');
  await waitFor(() => bow.hits.length === 1, 500);
  if (bow.hits.length !== 1 || bow.hits[0].id !== 41 || bow.hits[0].t - start < 230) {
    throw new Error('bow pierce did not land after release plus travel');
  }
  console.log('PASS: bow skill arrow spawns on animation release before damage');
}

console.log('PASS: projectile travel timing smoke');
