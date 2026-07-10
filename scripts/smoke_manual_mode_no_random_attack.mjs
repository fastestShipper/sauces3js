globalThis.addEventListener = () => {};

let savedAuto = null;
globalThis.localStorage = {
  getItem(key) { return key === 'sauces_auto' ? savedAuto : null; },
  setItem(key, value) { if (key === 'sauces_auto') savedAuto = value; },
};

const { Combat } = await import('../src/rpg/combat.js');

function makeCombat(autoValue = null) {
  savedAuto = autoValue;
  const attacks = [];
  const sent = [];
  const hits = [];
  const mob = { id: 101, x: 2.0, z: 0, hp: 40, hpMax: 40, lvl: 1 };
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
      mobs: new Map([[mob.id, mob]]),
      remotes: new Map(),
      party: [],
      attackMob(id, dmg, kind) { hits.push({ id, dmg, kind }); },
      sendAttack(kind, meta) { sent.push({ kind, meta }); },
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
    effects: {
      slashArc() {},
      bloodHit() {},
      damageNumber() {},
      shake() {},
    },
    sfx: { swing() {}, hit() {} },
  });
  return { combat, attacks, sent, hits, mob };
}

{
  const { combat, attacks, sent } = makeCombat(null);
  if (combat.autoAttack !== false) throw new Error('default combat mode should be manual');
  combat.update(0.016);
  if (attacks.length || sent.length) throw new Error('manual mode attacked without input');
  if (combat.targetId != null) throw new Error('manual mode auto-selected a mob without input');
  console.log('PASS: default manual mode does not attack by proximity');
}

{
  const { combat, attacks, sent } = makeCombat(null);
  combat.pokeAttack();
  combat.update(0.016);
  if (attacks.length !== 1 || sent.length !== 1) throw new Error('manual click did not fire one basic attack');
  if (combat.attackIntentT !== 0 || combat.attackIntentId !== null) throw new Error('manual attack intent did not clear after the swing started');
  combat._clearImpacts();
  console.log('PASS: manual mode still attacks on deliberate click');
}

{
  const { combat, attacks, sent } = makeCombat('1');
  if (combat.autoAttack !== false) throw new Error('saved auto mode should not be restored on boot');
  combat.update(0.016);
  if (attacks.length || sent.length) throw new Error('saved auto flag caused an attack on boot');
  if (savedAuto !== '0') throw new Error('boot did not clear stale saved auto flag');
  combat.toggleAuto();
  if (combat.autoAttack !== true || savedAuto !== '1') throw new Error('explicit toggle did not enable auto mode');
  combat.update(0.016);
  if (attacks.length !== 1 || sent.length !== 1) throw new Error('auto mode did not attack nearby mob');
  combat.chainShotT = 0.4;
  combat._punchT = 0.2;
  if (!combat._hitTimers.size) throw new Error('auto attack did not queue a basic impact');
  combat.toggleAuto();
  if (combat.autoAttack !== false || combat.chainShotT !== 0 || combat._punchT !== 0 || combat.attackIntentT !== 0 || combat._hitTimers.size !== 0) {
    throw new Error('turning auto mode off did not clear queued basic attack state');
  }
  console.log('PASS: auto mode is explicit and clears queued basics when disabled');
}

console.log('PASS: manual mode random attack smoke');
