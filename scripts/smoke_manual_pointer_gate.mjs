globalThis.addEventListener = () => {};
globalThis.localStorage = { getItem() { return null; }, setItem() {} };

const { Combat } = await import('../src/rpg/combat.js');

const attacks = [];
const sent = [];
const surface = {
  contains(target) { return target?.surface === this; },
};
const mob = { id: 17, x: 2, z: 0, hp: 30, hpMax: 30, lvl: 1 };
const player = {
  charFile: 'char_knight.glb',
  pos: { x: 0, z: 0 },
  keys: {},
  locked: false,
  dead: false,
  heading: 0,
  comboStep: 0,
  attack() { attacks.push('attack'); return true; },
};

const combat = new Combat({
  scene: null,
  camera: null,
  player,
  inputSurface: surface,
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
    attackMob() {},
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

let picks = 0;
combat._onClick = () => { picks++; };

const uiTarget = { closest() { return this; } };
if (combat._onPointerAttack({ button: 0, target: uiTarget })) throw new Error('UI pointer was accepted as gameplay input');
combat.update(0.016);
if (attacks.length || sent.length || combat._punchT > 0 || picks) throw new Error('UI pointer queued a random manual attack');

if (combat._onPointerAttack({ button: 2, target: surface })) throw new Error('right click was accepted as an attack');
if (attacks.length || picks) throw new Error('right click changed combat state');

player.locked = true;
if (combat._onPointerAttack({ button: 0, target: surface })) throw new Error('locked player accepted an attack');
player.locked = false;

const canvasChild = { surface };
if (!combat._onPointerAttack({ button: 0, target: canvasChild })) throw new Error('game surface click was rejected');
if (picks !== 1 || combat._punchT <= 0) throw new Error('game surface click did not buffer one deliberate attack');
combat.update(0.016);
if (attacks.length !== 1 || sent.length !== 1) throw new Error('deliberate game surface click did not fire exactly once');
combat._clearImpacts();

console.log('PASS: only the game render surface can queue a manual pointer attack');
