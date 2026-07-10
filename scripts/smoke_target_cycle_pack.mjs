import assert from 'node:assert/strict';

globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.addEventListener = () => {};

const { Combat } = await import('../src/rpg/combat.js');

function makeCombat({ mobs = [], remotes = [], party = [] } = {}) {
  const attacks = [];
  const sent = [];
  const targetMarks = [];
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
    attack() { attacks.push('attack'); return true; },
    combatLunge(tx, tz, step) {
      const dx = tx - this.pos.x;
      const dz = tz - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.001) {
        const move = Math.min(step, d);
        this.pos.x += (dx / d) * move;
        this.pos.z += (dz / d) * move;
      }
      return true;
    },
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
      mobs: new Map(mobs.map((m) => [m.id, m])),
      remotes: new Map(remotes.map((r) => [r.id, r])),
      party,
      attackMob() {},
      sendAttack(kind, meta) { sent.push({ kind, meta }); },
      partySkill() {},
      reportStreak() {},
    },
    inventory: { equippedWeapon: null },
    progress: { hpMax: 100, xp: 0, xpNext: 70, level: 1, gainXp() { return false; } },
    hud: { setHP() {}, setXP() {}, showTarget() {}, hideTarget() {}, toast() {}, hideStreak() {} },
    effects: { slashArc() {}, dashTrail() {}, bloodHit() {}, damageNumber() {} },
  });
  return { combat, player, attacks, sent, targetMarks };
}

{
  const aliveA = { id: 10, x: 2, z: 0, hp: 40, hpMax: 40, lvl: 1 };
  const aliveB = { id: 11, x: 3, z: 0, hp: 40, hpMax: 40, lvl: 1 };
  const aliveC = { id: 12, x: 4, z: 0, hp: 40, hpMax: 40, lvl: 1 };
  const dead = { id: 9, x: 1, z: 0, hp: 0, hpMax: 40, lvl: 1 };
  const rival = { id: 'rival', x: 5, z: 0, ready: true, dead: false, name: 'Rival' };
  const partyMate = { id: 'party', x: 1.5, z: 0, ready: true, dead: false, name: 'Party' };
  const hidden = { id: 'hidden', x: 1.2, z: 0, ready: false, dead: false, name: 'Hidden' };
  const { combat, targetMarks } = makeCombat({
    mobs: [dead, aliveA, aliveB, aliveC],
    remotes: [rival, partyMate, hidden],
    party: [{ id: partyMate.id }],
  });
  assert.equal(combat._cycleTarget(), true);
  assert.equal(combat.targetId, aliveA.id, 'first Tab should select nearest living hostile');
  assert.deepEqual(targetMarks.at(-1), { id: aliveA.id, on: true, locked: true }, 'Tab target should use explicit locked feedback');
  combat._cycleTarget();
  assert.equal(combat.targetId, aliveB.id, 'second Tab should advance through the pack');
  combat._cycleTarget();
  assert.equal(combat.targetId, aliveC.id, 'third Tab should keep cycling mobs');
  combat._cycleTarget();
  assert.equal(combat.pvpId, rival.id, 'cycle should include a ready non-party rival last');
  combat._cycleTarget();
  assert.equal(combat.targetId, aliveA.id, 'cycle should wrap to the nearest living hostile');
  assert.notEqual(combat.targetId, dead.id, 'cycle must skip dead mobs');
  console.log('PASS: Tab cycles living pack targets and skips dead, party and unready entries');
}

{
  const chosen = { id: 20, x: 2.4, z: 0, hp: 40, hpMax: 40, lvl: 1 };
  const wounded = { id: 21, x: 2.7, z: 0, hp: 3, hpMax: 40, lvl: 1 };
  const { combat, targetMarks } = makeCombat({ mobs: [chosen, wounded] });
  combat._setSoftTarget(chosen.id);
  assert.deepEqual(targetMarks.at(-1), { id: chosen.id, on: true, locked: false }, 'assisted target should use soft feedback');
  combat.pokeAttack();
  combat.attackCd = 1;
  combat.update(0.016);
  assert.equal(combat.targetId, chosen.id, 'manual intent target should not be stolen by wounded pressure target');
  assert.equal(combat.attackIntentId, chosen.id, 'manual intent should remain attached to clicked target');
  assert.equal(combat.autoAttack, false, 'target pin must not enable auto mode');
  combat._onMobDead(chosen.id, 999, [], {});
  assert.equal(combat.targetLocked, false, 'target death should clear stale lock state');
  assert.deepEqual(targetMarks.at(-1), { id: chosen.id, on: false, locked: false }, 'target death should hide its ring');
  console.log('PASS: one manual click pins its soft target while the attack is pending');
}

{
  const far = { id: 30, x: 12, z: 0, hp: 40, hpMax: 40, lvl: 1 };
  const { combat, attacks, sent } = makeCombat({ mobs: [far] });
  combat._setSoftTarget(far.id);
  combat.pokeAttack();
  for (let frame = 0; frame < 90 && attacks.length === 0; frame++) combat.update(1 / 60);
  assert.equal(attacks.length, 1, 'manual click should survive the chase and start one attack');
  assert.equal(sent.length, 1, 'manual chase should announce exactly one attack');
  assert.equal(sent[0].meta.id, far.id, 'manual chase should hit the originally selected target');
  assert.equal(combat.autoAttack, false, 'manual chase must remain manual');
  combat.update(1);
  assert.equal(attacks.length, 1, 'manual chase must not continue attacking after the click is consumed');
  console.log('PASS: manual attack buffer survives long chase and is consumed exactly once');
}

console.log('PASS: pack target cycle and manual intent smoke');
