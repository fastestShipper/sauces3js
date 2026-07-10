import assert from 'node:assert/strict';

globalThis.location = { hostname: '127.0.0.1', search: '' };
globalThis.window = { __SAUCES_MOBILE__: false, __SAUCES_LOW_END__: false };

const { shouldShowMobHpBar } = await import('../src/rpg/mobs.js?smoke=hp-bar-lod');

const base = {
  dead: false,
  boss: false,
  hp: 100,
  hpMax: 100,
  state: 'idle',
  attackTellT: 0,
  ring: { visible: false },
};

assert.equal(shouldShowMobHpBar(base, 10, { mobile: true }), true, 'near mobile mobs keep readable bars');
assert.equal(shouldShowMobHpBar(base, 21, { mobile: true }), false, 'distant full-health mobile mobs hide clutter');
assert.equal(shouldShowMobHpBar(base, 19, { mobile: true, currentVisible: true }), true, 'visible bars keep a two-meter hysteresis band');
assert.equal(shouldShowMobHpBar(base, 19, { mobile: true, currentVisible: false }), false, 'hidden bars wait until the entry threshold');
assert.equal(shouldShowMobHpBar({ ...base, hp: 99 }, 40, { mobile: true }), true, 'damaged mobs keep their bars');
assert.equal(shouldShowMobHpBar({ ...base, boss: true }, 40, { lowEnd: true }), true, 'boss bars never use distance LOD');
assert.equal(shouldShowMobHpBar({ ...base, ring: { visible: true } }, 40, { lowEnd: true }), true, 'target bars never use distance LOD');
assert.equal(shouldShowMobHpBar({ ...base, state: 'attack' }, 22, { lowEnd: true }), true, 'near attacking mobs extend the threat range');
assert.equal(shouldShowMobHpBar({ ...base, state: 'attack' }, 24, { lowEnd: true }), false, 'far full-health threats still avoid UI clutter');
assert.equal(shouldShowMobHpBar({ ...base, dead: true }, 2), false, 'dead mobs never show bars');

console.log('PASS: mob HP-bar LOD preserves targets, bosses, damage, and nearby threats');
