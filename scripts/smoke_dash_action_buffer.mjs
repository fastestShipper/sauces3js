globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
};
globalThis.addEventListener = () => {};

const { Combat } = await import('../src/rpg/combat.js');

function makeCombat({ mobX = 2.8, rivalX = 1.9 } = {}) {
  const attacks = [];
  const sent = [];
  const mobHits = [];
  const pvpHits = [];
  const mob = { id: 7, x: mobX, z: 0, hp: 40, hpMax: 40, lvl: 1 };
  const rival = { id: 'p2', ready: true, x: rivalX, z: 0, hp: 90, hpMax: 100, name: 'Rival' };
  const player = {
    charFile: 'char_knight.glb',
    pos: { x: 0, z: 0 },
    keys: {},
    locked: false,
    dead: false,
    grounded: true,
    heading: 0,
    comboStep: 0,
    attackT: 0,
    dashT: 0,
    dashVisualT: 0,
    isDashing() { return (this.dashT || 0) > 0; },
    attack() { attacks.push('attack'); return true; },
    attackSkill(type) { attacks.push('skill:' + type); return true; },
    combatLunge() { return false; },
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
      mobs: new Map([[mob.id, mob]]),
      remotes: new Map([[rival.id, rival]]),
      party: [],
      attackMob(id, dmg, kind) { mobHits.push({ id, dmg, kind }); },
      attackPlayer(id, dmg) { pvpHits.push({ id, dmg }); },
      sendAttack(kind, cue) { sent.push({ kind, cue }); },
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
    sfx: { hit() {}, swing() {} },
    effects: {
      slashArc() {},
      bloodHit() {},
      damageNumber() {},
      goreBurst() {},
      shake() {},
    },
  });
  combat.spawnGraceT = 0;
  return { combat, player, mob, rival, attacks, sent, mobHits, pvpHits };
}

{
  const { combat, player, mob, attacks, sent } = makeCombat();
  combat.targetId = mob.id;
  combat.autoAttack = false;
  player.dashT = 0.08;
  player.dashVisualT = 0.16;
  combat.pokeAttack();
  combat.update(0.05);
  if (attacks.length !== 0 || sent.length !== 0) throw new Error('mob attack fired during dash');
  if (combat._punchT <= 0) throw new Error('mob attack input was not preserved during dash');
  player.dashT = 0;
  combat.update(0.04);
  if (attacks.length !== 0 || sent.length !== 0) throw new Error('mob attack fired during dash visual tail');
  player.dashVisualT = 0;
  combat.update(0.03);
  if (attacks.length !== 1 || sent.length !== 1) throw new Error('mob attack did not fire after dash ended');
  console.log('PASS: mob attack buffers until dash animation ends');
}

{
  const { combat, player, rival, attacks, sent, pvpHits } = makeCombat();
  combat.pvpId = rival.id;
  player.dashT = 0.06;
  player.dashVisualT = 0.14;
  if (!combat.manualAttack()) throw new Error('pvp attack input was not accepted during dash');
  combat.update(0.05);
  if (attacks.length !== 0 || sent.length !== 0 || pvpHits.length !== 0) throw new Error('pvp attack fired during dash');
  player.dashT = 0;
  combat.update(0.04);
  if (attacks.length !== 0 || pvpHits.length !== 0) throw new Error('pvp attack fired during dash visual tail');
  player.dashVisualT = 0;
  combat.update(0.03);
  if (attacks.length !== 1 || sent.length !== 1 || pvpHits.length !== 1 || pvpHits[0].id !== rival.id) {
    throw new Error('pvp attack did not fire after dash ended');
  }
  console.log('PASS: pvp manual attack buffers until dash animation ends');
}

{
  const { combat, player, mob, attacks, sent } = makeCombat();
  combat.targetId = mob.id;
  player.dashVisualT = 0.12;
  const skill = { type: 'strike', name: 'Strike', dmgMult: 2, cost: 10, cd: 1 };
  const blocked = combat.castSkill(skill, { bufferable: true });
  if (!blocked || blocked.buffer !== true) throw new Error('skill did not request buffer during dash visual tail');
  if (attacks.length !== 0 || sent.length !== 0) throw new Error('skill animation fired during dash');
  player.dashVisualT = 0;
  const casted = combat.castSkill(skill, { bufferable: true, buffered: true });
  if (!casted) throw new Error('buffered skill did not cast after dash ended');
  if (attacks.length !== 1 || attacks[0] !== 'skill:strike' || sent.length !== 1) {
    throw new Error('buffered skill did not play the expected animation/cue after dash');
  }
  console.log('PASS: skill casts after dash instead of interrupting dodge');
}

console.log('PASS: dash action buffer smoke');
