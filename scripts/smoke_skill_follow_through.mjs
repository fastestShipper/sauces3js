globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
};
globalThis.addEventListener = () => {};

const { Combat } = await import('../src/rpg/combat.js');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeCombat(mobs = [], playerPatch = {}) {
  const hits = [];
  const attacks = [];
  const mobMap = new Map(mobs.map((m) => [m.id, { hpMax: m.hpMax || m.hp || 40, lvl: m.lvl || 1, ...m }]));
  const player = {
    charFile: 'char_knight.glb',
    pos: { x: 0, z: 0 },
    keys: {},
    locked: false,
    dead: false,
    heading: 0,
    comboT: 0,
    attackT: 0,
    speedBuffT: 0,
    speedBuffMult: 1,
    attack() { attacks.push('attack'); return true; },
    attackSpecial() { attacks.push('special'); return true; },
    ...playerPatch,
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
    },
    sfx: { hit() {}, skill() {} },
    effects: {
      bloodHit() {},
      damageNumber() {},
      shake() {},
      slashArc() {},
      nova() {},
      goreBurst() {},
    },
    skills: { onHit() {} },
  });
  return { combat, hits, attacks, player };
}

{
  const { combat, hits, attacks, player } = makeCombat([
    { id: 81, x: 1.1, z: 0.2, hp: 80, hpMax: 80 },
    { id: 82, x: -1.2, z: 0.3, hp: 18, hpMax: 80 },
    { id: 83, x: 0.2, z: 1.7, hp: 60, hpMax: 80 },
  ]);
  combat.attackCd = 0.4;
  const ok = combat.castSkill({ type: 'spin', dmgMult: 1.7, radius: 2.2 });
  if (!ok) throw new Error('spin skill was rejected');
  player.attackT = 0.72;
  if (attacks[0] !== 'special') throw new Error('spin did not start a special animation');
  await wait(285);
  if (hits.length !== 9) throw new Error(`spin follow-through setup should still hit all pulse bodies, got ${hits.length}`);
  if (combat.targetId !== 82 || combat.targetLocked) {
    throw new Error(`spin follow-through did not soft-target weakest hit mob: target=${combat.targetId} locked=${combat.targetLocked}`);
  }
  if (combat.attackCd > 0.05) throw new Error(`spin follow-through did not open next attack cooldown: ${combat.attackCd}`);
  if (player.attackT > 0.056) throw new Error(`spin follow-through did not open hard attack lock: ${player.attackT}`);
  if (player.comboT < 0.6) throw new Error(`spin follow-through did not carry combo window: ${player.comboT}`);
  if (player.speedBuffT <= 0 || player.speedBuffMult < 1.12) {
    throw new Error(`spin follow-through did not add brief haste: ${player.speedBuffT}, ${player.speedBuffMult}`);
  }
  console.log('PASS: melee area skill primes follow-through on weakest hit mob');
}

{
  const { combat } = makeCombat([
    { id: 91, x: 1.1, z: 0.2, hp: 80, hpMax: 80 },
    { id: 92, x: -1.2, z: 0.3, hp: 18, hpMax: 80 },
  ]);
  combat.targetId = 91;
  combat.targetLocked = true;
  const ok = combat.castSkill({ type: 'spin', dmgMult: 1.7, radius: 2.2 });
  if (!ok) throw new Error('locked spin skill was rejected');
  await wait(285);
  if (combat.targetId !== 91 || !combat.targetLocked) {
    throw new Error(`spin follow-through overwrote manual target lock: target=${combat.targetId} locked=${combat.targetLocked}`);
  }
  console.log('PASS: melee follow-through respects manual target lock');
}

{
  const { combat, player } = makeCombat([
    { id: 101, x: 8, z: 0, hp: 80, hpMax: 80 },
    { id: 102, x: 8.5, z: 0.2, hp: 30, hpMax: 80 },
  ], { charFile: 'char_mage.glb' });
  const ok = combat.castSkill({ type: 'fireball', dmgMult: 2.1, radius: 2.2 });
  if (!ok) throw new Error('fireball skill was rejected');
  player.attackT = 0.72;
  await wait(300);
  if (player.attackT < 0.71) throw new Error('ranged area skill should not chain-cancel melee attack lock');
  if (player.speedBuffT > 0 || player.speedBuffMult > 1) {
    throw new Error('ranged area skill should not prime melee follow-through');
  }
  console.log('PASS: ranged skills do not prime melee follow-through');
}

console.log('PASS: skill follow-through smoke');
