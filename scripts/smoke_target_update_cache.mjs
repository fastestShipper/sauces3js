import assert from 'node:assert/strict';

globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.addEventListener = () => {};

const [{ Combat }, { HUD }] = await Promise.all([
  import('../src/rpg/combat.js'),
  import('../src/rpg/hud.js'),
]);

function trackedElement(label, writes) {
  let text = '';
  const classes = new Set();
  return {
    get textContent() { return text; },
    set textContent(value) { text = String(value); writes.push(`${label}.text`); },
    style: new Proxy({}, {
      set(target, key, value) {
        target[key] = value;
        writes.push(`${label}.style.${String(key)}`);
        return true;
      },
    }),
    classList: {
      add(...names) { names.forEach((name) => classes.add(name)); writes.push(`${label}.class.add`); },
      remove(...names) { names.forEach((name) => classes.delete(name)); writes.push(`${label}.class.remove`); },
      toggle(name, force) {
        const on = force === undefined ? !classes.has(name) : !!force;
        if (on) classes.add(name); else classes.delete(name);
        writes.push(`${label}.class.toggle`);
        return on;
      },
      contains(name) { return classes.has(name); },
    },
    get offsetWidth() { return 240; },
  };
}

{
  const writes = [];
  const hud = Object.create(HUD.prototype);
  hud.elTarget = trackedElement('target', writes);
  hud.elTargetName = trackedElement('name', writes);
  hud.elTargetHp = trackedElement('hp', writes);
  hud.elTargetFill = trackedElement('fill', writes);
  hud.elTargetGhost = trackedElement('ghost', writes);
  hud._targetRatio = null;
  hud._targetName = '';
  hud._targetHp = null;
  hud._targetHpMax = null;
  hud._targetLocked = null;

  const nativeSetTimeout = globalThis.setTimeout;
  const nativeClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = () => 1;
  globalThis.clearTimeout = () => {};
  try {
    assert.equal(hud.showTarget('Zombi Nv.1', 100, 100, false), true);
    const stableWrites = writes.length;
    for (let frame = 1; frame < 600; frame++) {
      assert.equal(hud.showTarget('Zombi Nv.1', 100, 100, false), false);
    }
    assert.equal(writes.length, stableWrites, 'stable HUD state must perform zero DOM writes');

    assert.equal(hud.showTarget('Zombi Nv.1', 24, 100, false), true);
    assert.equal(hud.elTargetFill.style.width, '24.0%');
    assert.equal(hud.elTargetGhost.style.width, '100.0%', 'damage ghost should preserve previous HP');
    assert.equal(hud.elTarget.classList.contains('is-low'), true, 'low HP state should activate');
    assert.equal(hud.elTarget.classList.contains('is-hit'), true, 'damage hit state should activate');
    const hpWrites = writes.length;
    assert.equal(hud.showTarget('Zombi Nv.1', 24, 100, false), false);
    assert.equal(writes.length, hpWrites, 'stable damaged HUD state must remain cached');

    assert.equal(hud.showTarget('Zombi Nv.1', 24, 100, true), true);
    assert.equal(hud.elTarget.classList.contains('is-locked'), true, 'soft target must update to locked');
    const lockedWrites = writes.length;
    assert.equal(hud.showTarget('Zombi Nv.1', 24, 100, true), false);
    assert.equal(writes.length, lockedWrites, 'stable locked HUD state must remain cached');
  } finally {
    globalThis.setTimeout = nativeSetTimeout;
    globalThis.clearTimeout = nativeClearTimeout;
  }
}

function makeCombat() {
  const mobs = Array.from({ length: 90 }, (_, index) => ({
    id: index + 1,
    x: index === 0 ? 2 : 40 + index,
    z: 0,
    hp: 100,
    hpMax: 100,
    lvl: 1,
  }));
  const targetMarks = [];
  const targetShows = [];
  let targetHides = 0;
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
    attackVisualT: 0,
    dashVisualT: 0,
    dashCd: 0,
    isDashing() { return false; },
    attack() { return true; },
  };
  const combat = new Combat({
    scene: null,
    camera: null,
    player,
    mobField: {
      setTargeted(id, on, locked = false) { targetMarks.push({ id, on, locked }); },
      meshes() { return []; },
      pickFromIntersections() { return null; },
    },
    net: {
      myId: 1,
      mobs: new Map(mobs.map((mob) => [mob.id, mob])),
      remotes: new Map(),
      party: [],
      attackMob() {},
      sendAttack() {},
      partySkill() {},
      reportStreak() {},
    },
    inventory: { equippedWeapon: null },
    progress: { hpMax: 100, xp: 0, xpNext: 70, level: 1, gainXp() { return false; } },
    hud: {
      setHP() {},
      setXP() {},
      showTarget(name, hp, hpMax, locked) { targetShows.push({ name, hp, hpMax, locked }); },
      hideTarget() { targetHides++; },
      toast() {},
      hideStreak() {},
    },
    effects: { slashArc() {}, dashTrail() {}, bloodHit() {}, damageNumber() {} },
  });
  combat.attackCd = 1000;
  return { combat, mobs, targetMarks, targetShows, get targetHides() { return targetHides; } };
}

{
  const state = makeCombat();
  const { combat, mobs, targetMarks, targetShows } = state;
  let softTargetCalls = 0;
  const setSoftTarget = combat._setSoftTarget.bind(combat);
  combat._setSoftTarget = (id) => { softTargetCalls++; return setSoftTarget(id); };
  combat.autoAttack = true;

  combat.update(1 / 60);
  const firstStable = { softTargetCalls, marks: targetMarks.length, shows: targetShows.length };
  for (let frame = 1; frame < 600; frame++) combat.update(1 / 60);
  assert.deepEqual(
    { softTargetCalls, marks: targetMarks.length, shows: targetShows.length },
    firstStable,
    '600 stable frames over 90 mobs must perform zero target updates after frame one',
  );
  assert.deepEqual(firstStable, { softTargetCalls: 1, marks: 1, shows: 1 });

  const primary = mobs[0];
  primary.hp = 24;
  combat.update(1 / 60);
  assert.equal(softTargetCalls, 1, 'HP changes must not reselect the same soft target');
  assert.equal(targetMarks.length, 1, 'HP changes must not rewrite the target ring');
  assert.equal(targetShows.length, 2, 'HP changes must refresh the HUD exactly once');
  assert.equal(targetShows.at(-1).hp, 24);

  combat._setTarget(primary.id);
  assert.equal(targetMarks.length, 2, 'soft-to-locked must update the ring exactly once');
  assert.equal(targetShows.length, 3, 'soft-to-locked must update the HUD exactly once');
  for (let frame = 0; frame < 120; frame++) combat.update(1 / 60);
  assert.deepEqual({ marks: targetMarks.length, shows: targetShows.length }, { marks: 2, shows: 3 });

  combat._setSoftTarget(primary.id);
  assert.equal(targetMarks.length, 3, 'locked-to-soft must update the ring exactly once');
  assert.equal(targetShows.length, 4, 'locked-to-soft must update the HUD exactly once');

  const pressured = mobs[1];
  primary.hp = 100;
  pressured.x = 2.1;
  pressured.hp = 1;
  combat.update(1 / 60);
  assert.equal(combat.targetId, pressured.id, 'pressure change must retarget in the same frame');
  assert.equal(softTargetCalls, 3);
  assert.equal(targetMarks.length, 5, 'id change must hide old ring and show new ring exactly once');
  assert.equal(targetShows.length, 5, 'id change must refresh the HUD exactly once');

  const pressureStable = { softTargetCalls, marks: targetMarks.length, shows: targetShows.length };
  for (let frame = 0; frame < 120; frame++) combat.update(1 / 60);
  assert.deepEqual({ softTargetCalls, marks: targetMarks.length, shows: targetShows.length }, pressureStable);

  pressured.hp = 0;
  combat.update(1 / 60);
  assert.equal(combat.targetId, primary.id, 'dead target must retarget in the same frame');
  assert.equal(softTargetCalls, 4);
  assert.equal(targetMarks.length, 7, 'death retarget must clear and set rings exactly once');
  assert.equal(targetShows.length, 6, 'death retarget must show the replacement exactly once');
  assert.equal(state.targetHides, 1, 'death retarget must hide stale HUD exactly once');
}

console.log('PASS: target update cache is stable for 600 frames/90 mobs and exact on HP, lock, pressure, id, and death changes');
