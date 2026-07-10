globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
};
globalThis.addEventListener = () => {};

const { Combat } = await import('../src/rpg/combat.js');

function makeCombat() {
  const hits = [];
  const attacks = [];
  const sent = [];
  const healthy = { id: 10, x: 2.2, z: 0, hp: 40, hpMax: 40, lvl: 1 };
  const wounded = { id: 11, x: 2.7, z: 0, hp: 4, hpMax: 40, lvl: 1 };
  const dead = { id: 12, x: 1.0, z: 0, hp: 0, hpMax: 40, lvl: 1 };
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
      mobs: new Map([[healthy.id, healthy], [wounded.id, wounded], [dead.id, dead]]),
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
      slashArc() {},
      bloodHit() {},
      damageNumber() {},
      goreBurst() {},
      shake() {},
    },
  });
  return { combat, healthy, wounded, dead, hits, attacks, sent };
}

{
  const { combat, wounded, dead, hits, attacks, sent } = makeCombat();
  combat.autoAttack = true;
  combat.update(0.016);
  if (combat.targetId === dead.id) throw new Error('auto target selected a dead mob');
  if (combat.targetId !== wounded.id) throw new Error(`auto target did not prefer wounded pressure target: ${combat.targetId}`);
  if (attacks.length !== 1 || sent.length !== 1) throw new Error('auto target did not immediately start an attack');
  await new Promise((resolve) => setTimeout(resolve, 130));
  if (!hits.some((h) => h.id === wounded.id)) throw new Error('auto target attack did not land on wounded mob');
  console.log('PASS: auto target prefers wounded nearby mob pressure');
}

{
  const { combat, healthy, wounded } = makeCombat();
  combat.targetId = healthy.id;
  combat.targetLocked = true;
  combat.attackCd = 1;
  combat.update(0.016);
  if (combat.targetId !== healthy.id || !combat.targetLocked) {
    throw new Error(`locked target was overwritten by pressure target: ${combat.targetId}, locked=${combat.targetLocked}`);
  }
  if (combat.targetId === wounded.id) throw new Error('manual target lock should not be stolen by wounded mob');
  console.log('PASS: auto target pressure respects manual target lock');
}

{
  const { combat, wounded, dead, attacks, sent } = makeCombat();
  combat.autoAttack = true;
  combat.targetId = dead.id;
  combat.targetLocked = true;
  combat.attackCd = 1;
  combat.update(0.016);
  if (combat.targetId !== wounded.id || combat.targetLocked) {
    throw new Error(`stale dead target did not retarget softly in auto mode: target=${combat.targetId}, locked=${combat.targetLocked}`);
  }
  if (attacks.length || sent.length) throw new Error('stale target retarget should not bypass attack cooldown');
  console.log('PASS: auto mode drops stale dead target and retargets without firing early');
}

{
  const { combat, dead, attacks, sent } = makeCombat();
  combat.autoAttack = false;
  combat.targetId = dead.id;
  combat.targetLocked = true;
  combat.update(0.016);
  if (combat.targetId != null || combat.targetLocked) {
    throw new Error(`manual stale dead target should clear without retarget: target=${combat.targetId}, locked=${combat.targetLocked}`);
  }
  if (attacks.length || sent.length) throw new Error('manual stale target clear should not attack');
  console.log('PASS: manual mode clears stale dead target without chaining');
}

console.log('PASS: auto target pressure smoke');
