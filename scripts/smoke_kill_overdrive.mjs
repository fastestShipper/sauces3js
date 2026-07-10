globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
};
globalThis.addEventListener = () => {};

const { Combat } = await import('../src/rpg/combat.js');

function makeCombat() {
  const player = {
    charFile: 'char_knight.glb',
    pos: { x: 0, z: 0 },
    speedBuffT: 0,
    speedBuffMult: 1,
    dashCd: 0.58,
    attackT: 0.26,
    comboT: 0,
    keys: {},
    locked: false,
    dead: false,
    heading: 0,
    setDead() {},
    combatLunge() { return false; },
  };
  const mob = { id: 3, x: 2, z: 0, hp: 0, hpMax: 40, lvl: 2, b: 0 };
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
      mobs: new Map([[mob.id, mob]]),
      remotes: new Map(),
      party: [],
      sendAttack() {},
      attackMob() {},
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
      showStreak() {},
      hideStreak() {},
    },
    effects: {},
    sfx: { kill() {}, streak() {} },
    skills: { onKill() {} },
  });
  return { combat, mob };
}

{
  const { combat, mob } = makeCombat();
  combat.streak = 11;
  combat._applyKillFrenzy(mob);
  if (combat.player.speedBuffMult < 1.51 || combat.player.speedBuffMult > 1.55) {
    throw new Error(`high streak did not reach bounded overdrive: ${combat.player.speedBuffMult}`);
  }
  if (combat._attackCooldown() < 0.19 || combat._attackCooldown() > 0.23) {
    throw new Error(`overdrive attack cooldown outside bounds: ${combat._attackCooldown()}`);
  }
  if (combat._attackAnimSpeed() !== 1.5) {
    throw new Error(`attack animation speed cap mismatch: ${combat._attackAnimSpeed()}`);
  }
  console.log('PASS: high streak overdrive speeds attacks within hard caps');
}

{
  const { combat, mob } = makeCombat();
  mob.b = 1;
  combat.streak = 20;
  combat._applyKillFrenzy(mob);
  if (combat.player.speedBuffMult !== 1.55) throw new Error(`boss overdrive exceeded cap: ${combat.player.speedBuffMult}`);
  if (combat.player.dashCd !== 0 || combat.player.attackT !== 0) throw new Error('boss overdrive did not clear dash and attack locks');
  console.log('PASS: boss overdrive keeps speed cap and clears locks');
}

console.log('PASS: kill overdrive smoke');
