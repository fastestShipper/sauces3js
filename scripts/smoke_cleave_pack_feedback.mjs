globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
};
globalThis.addEventListener = () => {};

const { Combat } = await import('../src/rpg/combat.js');

const hits = [];
const attacks = [];
const effects = [];
const skillEvents = [];
const main = { id: 31, x: 0, z: 2.1, hp: 44, hpMax: 44, lvl: 2 };
const left = { id: 32, x: -0.75, z: 2.15, hp: 28, hpMax: 28, lvl: 2 };
const right = { id: 33, x: 0.85, z: 2.2, hp: 28, hpMax: 28, lvl: 2 };
const deep = { id: 34, x: 0.15, z: 2.85, hp: 28, hpMax: 28, lvl: 2 };
const behind = { id: 35, x: 0, z: -1.5, hp: 28, hpMax: 28, lvl: 2 };
const far = { id: 36, x: 4.4, z: 2.1, hp: 28, hpMax: 28, lvl: 2 };

const oldRandom = Math.random;
Math.random = () => 0.99;
try {
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
      attack(force, speed) { attacks.push({ force, speed }); this.comboStep = 0; return true; },
    },
    mobField: {
      setTargeted() {},
      meshes() { return []; },
      pickFromIntersections() { return null; },
    },
    net: {
      myId: 1,
      mobs: new Map([[main.id, main], [left.id, left], [right.id, right], [deep.id, deep], [behind.id, behind], [far.id, far]]),
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

  combat.targetId = main.id;
  combat.targetLocked = true;
  combat.autoAttack = true;
  combat.update(0.016);
  if (attacks.length !== 1) throw new Error('cleave setup did not start melee swing');
  await new Promise((resolve) => setTimeout(resolve, 130));

  const ids = hits.map((h) => h.id).sort((a, b) => a - b);
  // GOW: un tajo alcanza el objetivo + A LO SUMO UN enemigo adyacente, no barre la
  // horda. Peleas a los enemigos de a uno; no borras un pack de un swing.
  const expected = [31, 32];
  if (JSON.stringify(ids) !== JSON.stringify(expected)) {
    throw new Error(`cleave should hit target + one adjacent, got: ${ids.join(',')}`);
  }
  const extras = hits.filter((h) => h.kind === 'cleave');
  if (extras.length !== 1) throw new Error(`cleave should hit exactly one extra, got ${extras.length}`);
  // el extra pega a la mitad del golpe principal
  const mainHit = hits.find((h) => h.id === main.id);
  if (!mainHit) throw new Error('main target was not hit');
  if (!(extras[0].dmg > 0 && extras[0].dmg <= mainHit.dmg * 0.6)) {
    throw new Error(`cleave extra should be ~50% of main dmg: extra ${extras[0].dmg} vs main ${mainHit.dmg}`);
  }
  if (hits.some((h) => h.id === right.id || h.id === deep.id || h.id === behind.id || h.id === far.id)) {
    throw new Error('cleave exceeded the one-target cap or hit a mob behind/out of range');
  }
  if (skillEvents.length !== 2) {
    throw new Error(`cleave should grant one hit pulse per connected body (main + 1), got ${skillEvents.length}`);
  }
  console.log('PASS: melee cleave is capped at one adjacent enemy at half damage (GOW)');
} finally {
  Math.random = oldRandom;
}

console.log('PASS: cleave pack feedback smoke');
