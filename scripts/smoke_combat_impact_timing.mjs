globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
};
globalThis.addEventListener = () => {};

const { Combat } = await import('../src/rpg/combat.js');

async function waitFor(predicate, timeoutMs = 260) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
  return predicate();
}

function makeCombat({ comboStep = 0 } = {}) {
  const hits = [];
  const attacks = [];
  const sentAttacks = [];
  const effects = [];
  const mobMap = new Map([[7, { id: 7, x: 1.8, z: 0, hp: 40, hpMax: 40, lvl: 1 }]]);
  const player = {
    charFile: 'char_knight.glb',
    pos: { x: 0, z: 0 },
    keys: {},
    locked: false,
    dead: false,
    heading: 0,
    comboStep: 0,
    comboT: 0,
    attackT: 0,
    speedBuffT: 0,
    speedBuffMult: 1,
    attack() { this.comboStep = comboStep; attacks.push('attack'); return true; },
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
      sendAttack() { sentAttacks.push('atk'); },
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
  });
  return { combat, hits, attacks, sentAttacks, effects };
}

const { combat, hits, attacks, sentAttacks } = makeCombat();

combat.targetId = 7;
combat.autoAttack = true;

combat.update(0.016);
if (attacks.length !== 1) throw new Error('attack animation did not start');
if (sentAttacks.length !== 1) throw new Error('attack broadcast was not sent');
if (hits.length !== 0) throw new Error('damage was applied before impact timing');

await new Promise((resolve) => setTimeout(resolve, 50));
if (hits.length !== 0) throw new Error('damage landed too early');

await waitFor(() => hits.length === 1);
const basicKind = hits[0]?.kind;
const basicKindOk = basicKind === undefined || basicKind === 'heavy';
if (hits.length !== 1 || hits[0].id !== 7 || !basicKindOk) {
  throw new Error('basic impact did not apply one delayed mob hit');
}
if (combat.hitStopT <= 0) throw new Error('impact did not trigger hit-stop');
if (combat.attackCd > 0.161) throw new Error(`basic combo momentum did not open next swing soon enough: ${combat.attackCd}`);
if (combat.player.attackT > 0.091) throw new Error(`basic combo momentum left attack lock too high: ${combat.player.attackT}`);
if (combat.player.comboT < 0.58) throw new Error(`basic combo momentum did not carry combo window: ${combat.player.comboT}`);
if (combat.player.speedBuffT <= 0 || combat.player.speedBuffMult < 1.08) {
  throw new Error(`basic combo momentum did not add haste: ${combat.player.speedBuffT}, ${combat.player.speedBuffMult}`);
}

console.log('PASS: combat applies basic damage on impact timing');

{
  const oldRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const finisher = makeCombat({ comboStep: 2 });
    finisher.combat.targetId = 7;
    finisher.combat.autoAttack = true;
    finisher.combat.update(0.016);
    await waitFor(() => finisher.hits.length === 1);
    if (finisher.hits.length !== 1) throw new Error('finisher impact did not apply delayed hit');
    if (finisher.hits[0].kind !== 'heavy') throw new Error(`finisher basic impact did not send heavy metadata: ${finisher.hits[0].kind}`);
    if (finisher.combat.hitStopT < 0.069) throw new Error(`finisher hit-stop too weak: ${finisher.combat.hitStopT}`);
    if (finisher.combat.attackCd > 0.131) throw new Error(`finisher combo momentum cooldown too high: ${finisher.combat.attackCd}`);
    if (finisher.combat.player.attackT > 0.076) throw new Error(`finisher combo momentum lock too high: ${finisher.combat.player.attackT}`);
    if (finisher.combat.player.speedBuffMult < 1.115) throw new Error(`finisher combo momentum haste too weak: ${finisher.combat.player.speedBuffMult}`);
    if (!finisher.effects.includes('shake') || !finisher.effects.includes('gore')) {
      throw new Error('finisher impact did not trigger heavy feedback');
    }
    console.log('PASS: combo finisher has heavy non-crit impact feedback');
  } finally {
    Math.random = oldRandom;
  }
}
