const { rollDrops } = await import('../src/rpg/economy.js');

function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const expected = {
  verdugo: 'axe_2handed',
  piromante: 'staff',
  cazadora: 'bow',
  sombra: 'dagger',
  cernunnos: 'staff',
};
const legacyClasses = new Set(['guerrero', 'mago', 'arquero', 'encapuchado']);
const oldRandom = Math.random;

try {
  let seed = 0x51a7d00d;
  for (const [classId, weaponName] of Object.entries(expected)) {
    Math.random = makeRandom(seed++);
    const weapons = [];
    for (let i = 0; i < 8000; i++) {
      for (const drop of rollDrops(5, { classId })) {
        if (legacyClasses.has(drop.classReq)) throw new Error(`legacy class leaked into a drop: ${drop.classReq}`);
        if (drop.kind === 'gear' && drop.slot === 'weapon') weapons.push(drop);
      }
    }
    if (weapons.length < 80) throw new Error(`${classId} sample produced too few weapon drops: ${weapons.length}`);
    if (weapons.some((drop) => drop.weaponName !== weaponName || drop.classReq !== classId)) {
      throw new Error(`${classId} received an irrelevant weapon drop`);
    }
  }
} finally {
  Math.random = oldRandom;
}

console.log('PASS: rare weapon drops are relevant to the active class');
