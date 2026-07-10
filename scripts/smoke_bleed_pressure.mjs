globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
};
globalThis.addEventListener = () => {};

const { Combat } = await import('../src/rpg/combat.js');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeCombat({ comboStep = 2, charFile = 'char_knight.glb' } = {}) {
  const hits = [];
  const attacks = [];
  const skillEvents = [];
  const effects = [];
  const mob = { id: 77, x: 1.8, z: 0, hp: 100, hpMax: 100, lvl: 1 };
  const combat = new Combat({
    scene: null,
    camera: null,
    player: {
      charFile,
      pos: { x: 0, z: 0 },
      keys: {},
      locked: false,
      dead: false,
      heading: 0,
      comboStep: 0,
      attack() { this.comboStep = comboStep; attacks.push('attack'); return true; },
    },
    mobField: {
      setTargeted() {},
      meshes() { return []; },
      pickFromIntersections() { return null; },
    },
    net: {
      myId: 1,
      mobs: new Map([[mob.id, mob]]),
      remotes: new Map(),
      party: [],
      attackMob(id, dmg, kind) { hits.push({ id, dmg, kind }); },
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
    sfx: { hit() {} },
    effects: {
      slashArc() { effects.push('slash'); },
      bloodHit() { effects.push('blood'); },
      damageNumber() { effects.push('number'); },
      goreBurst() { effects.push('gore'); },
      shake() { effects.push('shake'); },
    },
    skills: { onHit() { skillEvents.push('hit'); } },
  });
  return { combat, mob, hits, attacks, skillEvents, effects };
}

{
  const oldRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const { combat, hits, attacks, skillEvents, effects } = makeCombat();
    combat.targetId = 77;
    combat.autoAttack = true;
    combat.update(0.016);
    if (attacks.length !== 1) throw new Error('finisher setup did not start attack');
    await wait(130);
    const direct = hits.filter((h) => h.kind !== 'bleed');
    if (direct.length !== 1 || direct[0].kind !== 'heavy') {
      throw new Error(`finisher should land one heavy direct hit before bleed, got ${JSON.stringify(direct)}`);
    }
    if (hits.some((h) => h.kind === 'bleed')) throw new Error('bleed ticked before its delay window');
    await wait(740);
    const bleeds = hits.filter((h) => h.kind === 'bleed');
    if (bleeds.length !== 3) throw new Error(`finisher bleed should tick three times, got ${bleeds.length}`);
    if (skillEvents.length !== 1) throw new Error(`bleed should not grant extra resource pulses, got ${skillEvents.length}`);
    if (!effects.includes('blood') || !effects.includes('number')) throw new Error('bleed did not emit blood and damage feedback');
    if (effects.filter((x) => x === 'gore').length < 2) throw new Error('bleed finisher should add a final gore pulse');
    console.log('PASS: melee finisher applies short bleed pressure');
  } finally {
    Math.random = oldRandom;
  }
}

{
  const { combat, hits } = makeCombat();
  combat._bleedMob(77, 20, { delays: [0.05, 0.12, 0.19], mult: 0.25 });
  await wait(70);
  combat._bleedMob(77, 40, { delays: [0.05, 0.12, 0.19], mult: 0.25 });
  await wait(260);
  const bleeds = hits.filter((h) => h.kind === 'bleed');
  if (bleeds.length !== 4) throw new Error(`refreshed bleed should replace remaining old ticks, got ${bleeds.length}`);
  if (bleeds.slice(1).some((h) => h.dmg !== 10)) {
    throw new Error(`refreshed bleed did not use stronger new damage: ${JSON.stringify(bleeds)}`);
  }
  console.log('PASS: refreshed bleed replaces old pending ticks');
}

{
  const { combat, hits } = makeCombat({ charFile: 'char_mage.glb' });
  const count = combat._bleedMob(77, 100);
  await wait(850);
  if (count !== 0 || hits.length) throw new Error('ranged classes should not apply melee bleed pressure');
  console.log('PASS: ranged classes do not apply melee bleed');
}

console.log('PASS: bleed pressure smoke');
