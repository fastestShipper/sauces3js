globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
};
globalThis.addEventListener = () => {};

const { Combat } = await import('../src/rpg/combat.js');

const calls = [];
const player = {
  pos: { x: 0, z: 0 },
  locked: false,
  dead: false,
  charFile: 'char_knight.glb',
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
    mobs: new Map(),
    remotes: new Map(),
    party: [],
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
  effects: {
    shake(amp, dur) { calls.push({ amp, dur }); },
  },
});

if (!combat._localShake({ x: 0.22, z: 0.14 }, 0.1, 0.12)) {
  throw new Error('near combat shake should be accepted');
}
if (calls.length !== 1 || calls[0].amp < 0.099) {
  throw new Error(`near combat shake should keep full amplitude: ${JSON.stringify(calls)}`);
}

if (!combat._localShake({ x: 2.1, z: 0 }, 0.1, 0.12)) {
  throw new Error('falloff combat shake should still be accepted');
}
if (calls.length !== 2 || calls[1].amp >= calls[0].amp || calls[1].amp <= 0.01) {
  throw new Error(`falloff combat shake should scale down: ${JSON.stringify(calls)}`);
}

if (combat._localShake({ x: 3.35, z: 0 }, 0.1, 0.12)) {
  throw new Error('far combat shake should be rejected');
}
if (calls.length !== 2) {
  throw new Error(`far combat shake should not call effects: ${JSON.stringify(calls)}`);
}

console.log('PASS: camera shake is local to nearby combat');
