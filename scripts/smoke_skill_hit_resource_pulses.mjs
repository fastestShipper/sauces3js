globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
};
globalThis.addEventListener = () => {};

const { Combat } = await import('../src/rpg/combat.js');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeCombat(mobs = [], playerPatch = {}) {
  const hits = [];
  const attacks = [];
  const skillEvents = [];
  const mobMap = new Map(mobs.map((m) => [m.id, { hpMax: m.hpMax || m.hp || 40, lvl: m.lvl || 1, ...m }]));
  const player = {
    charFile: 'char_knight.glb',
    pos: { x: 0, z: 0 },
    keys: {},
    locked: false,
    dead: false,
    heading: 0,
    attack() { attacks.push('attack'); return true; },
    attackSpecial() { attacks.push('special'); return true; },
    ...playerPatch,
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
    },
    sfx: { hit() {}, skill() {} },
    effects: {
      bloodHit() {},
      damageNumber() {},
      shake() {},
      slashArc() {},
      nova() {},
      goreBurst() {},
    },
    skills: { onHit() { skillEvents.push('hit'); } },
  });
  return { combat, hits, attacks, skillEvents, player };
}

{
  const { combat, hits, attacks, skillEvents } = makeCombat([
    { id: 41, x: 1.2, z: 0.2, hp: 44 },
    { id: 42, x: -1.3, z: 0.4, hp: 44 },
    { id: 43, x: 0.4, z: 1.8, hp: 44 },
    { id: 44, x: 5.2, z: 0, hp: 44 },
  ]);
  const ok = combat.castSkill({ type: 'spin', dmgMult: 1.7, radius: 2.2 });
  if (!ok) throw new Error('spin skill was rejected');
  if (attacks[0] !== 'special') throw new Error('spin did not start a special animation');
  await wait(285);
  const ids = hits.map((h) => h.id).sort((a, b) => a - b);
  const expected = [41, 42, 43];
  const uniqueIds = [...new Set(ids)];
  if (JSON.stringify(uniqueIds) !== JSON.stringify(expected)) {
    throw new Error(`spin hit wrong ids: ${ids.join(',')}`);
  }
  if (hits.length !== 9 || skillEvents.length !== 9) {
    throw new Error(`spin should grant three short hit pulses per connected body, got hits=${hits.length} events=${skillEvents.length}`);
  }
  for (const id of expected) {
    const total = hits.filter((h) => h.id === id).reduce((sum, h) => sum + h.dmg, 0);
    if (total > 22) throw new Error(`spin pulse damage stacked too high for ${id}: ${total}`);
  }
  console.log('PASS: spin grants fast resource pulses without runaway damage');
}

{
  const { combat, hits, skillEvents } = makeCombat([
    { id: 51, x: 0.8, z: 0.1, hp: 44 },
    { id: 52, x: -0.7, z: 0.2, hp: 44 },
    { id: 53, x: 0.2, z: 1.4, hp: 44 },
    { id: 54, x: 3.1, z: 0, hp: 44 },
  ], {
    dashSeq: 12,
    isDashing() { return true; },
  });
  const count = combat._dashStrike();
  if (count !== 3) throw new Error(`dash strike should hit three nearby mobs, got ${count}`);
  const ids = hits.map((h) => h.id).sort((a, b) => a - b);
  const expected = [51, 52, 53];
  if (JSON.stringify(ids) !== JSON.stringify(expected)) {
    throw new Error(`dash strike hit wrong ids: ${ids.join(',')}`);
  }
  if (skillEvents.length !== 3) {
    throw new Error(`dash strike should grant one hit pulse per connected body, got ${skillEvents.length}`);
  }
  console.log('PASS: dash strike grants one resource pulse per hit body');
}

console.log('PASS: skill hit resource pulse smoke');
