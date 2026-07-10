globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
};
globalThis.addEventListener = () => {};

const { Combat } = await import('../src/rpg/combat.js');

function makeCombat({ charFile = 'char_knight.glb' } = {}) {
  const hits = [];
  const attacks = [];
  const sent = [];
  const effects = [];
  const main = { id: 21, x: 1.8, z: 0, hp: 40, hpMax: 40, lvl: 1 };
  const fallback = { id: 22, x: 2.35, z: 0.35, hp: 40, hpMax: 40, lvl: 1 };
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
      attack() { attacks.push('attack'); return true; },
    },
    mobField: {
      setTargeted() {},
      meshes() { return []; },
      pickFromIntersections() { return null; },
    },
    net: {
      myId: 1,
      mobs: new Map([[main.id, main], [fallback.id, fallback]]),
      remotes: new Map(),
      party: [],
      attackMob(id, dmg, kind) { hits.push({ id, dmg, kind }); },
      sendAttack() { sent.push('atk'); },
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
      projectile() { effects.push('projectile'); },
      bloodHit() { effects.push('blood'); },
      damageNumber() { effects.push('number'); },
      goreBurst() { effects.push('gore'); },
      shake() { effects.push('shake'); },
    },
  });
  return { combat, main, fallback, hits, attacks, sent, effects };
}

{
  const { combat, main, fallback, hits, attacks, sent, effects } = makeCombat();
  combat.targetId = main.id;
  combat.targetLocked = true;
  combat.autoAttack = true;
  combat.update(0.016);
  if (attacks.length !== 1 || sent.length !== 1) throw new Error('melee fallback setup did not start attack');
  main.hp = 0;
  await new Promise((resolve) => setTimeout(resolve, 130));
  if (!hits.some((h) => h.id === fallback.id && (h.kind === undefined || h.kind === 'heavy'))) {
    throw new Error(`melee impact did not fall through to nearby mob: ${JSON.stringify(hits)}`);
  }
  if (hits.some((h) => h.id === main.id)) throw new Error('melee fallback should not hit dead original target');
  if (!effects.includes('slash') || !effects.includes('blood')) throw new Error('melee fallback missed attack feedback');
  console.log('PASS: melee basic impact falls through to nearby live mob');
}

{
  const { combat, main, fallback, hits, attacks, sent, effects } = makeCombat({ charFile: 'char_mage.glb' });
  combat.targetId = main.id;
  combat.targetLocked = true;
  combat.autoAttack = true;
  combat.update(0.016);
  if (attacks.length !== 1 || sent.length !== 1) throw new Error('ranged fallback setup did not start attack');
  main.hp = 0;
  await new Promise((resolve) => setTimeout(resolve, 260));
  if (hits.some((h) => h.id === fallback.id)) throw new Error('ranged projectile should not retarget after release');
  if (!effects.includes('projectile')) throw new Error('ranged attack did not emit projectile feedback');
  console.log('PASS: ranged basic impact does not retarget after release');
}

console.log('PASS: basic impact fallback smoke');
