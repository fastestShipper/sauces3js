globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
};
globalThis.addEventListener = () => {};

const { Combat } = await import('../src/rpg/combat.js');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeCombat(mobs = []) {
  const hits = [];
  const attacks = [];
  const sent = [];
  const toasts = [];
  const lunges = [];
  const mobMap = new Map(mobs.map((m) => [m.id, { hpMax: m.hpMax || m.hp || 40, lvl: m.lvl || 1, ...m }]));
  const player = {
    charFile: 'char_knight.glb',
    pos: { x: 0, z: 0 },
    keys: {},
    locked: false,
    dead: false,
    attack() { attacks.push('attack'); return true; },
    attackSpecial() { attacks.push('special'); return true; },
    combatLunge(tx, tz, step) {
      const dx = tx - this.pos.x, dz = tz - this.pos.z;
      const d = Math.hypot(dx, dz);
      lunges.push({ tx, tz, step, before: { x: this.pos.x, z: this.pos.z } });
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
      toast(message) { toasts.push(message); },
    },
  });
  return { combat, hits, attacks, sent, toasts, lunges, player };
}

{
  const { combat, hits, attacks, toasts } = makeCombat([]);
  const ok = combat.castSkill({ type: 'strike', dmgMult: 2.4 });
  if (ok) throw new Error('single-target skill accepted with no mob');
  if (hits.length || attacks.length) throw new Error('empty single-target skill caused attack or hit');
  if (!toasts.some((m) => /objetivo cerca/.test(m))) throw new Error('missing no-target toast');
  console.log('PASS: no-target single skill is rejected cleanly');
}

{
  const { combat, hits, attacks, sent, lunges, player } = makeCombat([{ id: 7, x: 5, z: 0, hp: 40 }]);
  const ok = combat.castSkill({ type: 'strike', dmgMult: 2.4 });
  if (!ok) throw new Error('single-target skill rejected nearby mob');
  if (!attacks.length) throw new Error('nearby target did not trigger animation');
  if (sent[0]?.kind !== 'strike' || sent[0]?.meta?.type !== 'mob' || sent[0]?.meta?.id !== 7) {
    throw new Error(`single skill did not send remote target cue: ${JSON.stringify(sent[0])}`);
  }
  if (!lunges.length || player.pos.x < 3.0) throw new Error('melee skill did not lunge into contact');
  if (hits.length) throw new Error('single skill hit before impact timing');
  await wait(150);
  if (hits.length !== 1 || hits[0].id !== 7 || hits[0].kind !== 'skill') {
    throw new Error('nearby target was not hit as skill damage');
  }
  console.log('PASS: single skill auto-targets and lunges into nearby mob');
}

{
  const { combat, hits, sent } = makeCombat([{ id: 9, x: 10, z: 0, hp: 40 }, { id: 10, x: 10.8, z: 0, hp: 40 }]);
  const ok = combat.castSkill({ type: 'fireball', dmgMult: 2.1, radius: 3.5 });
  if (!ok) throw new Error('target-area skill rejected nearby mob');
  if (sent[0]?.kind !== 'fireball' || sent[0]?.meta?.type !== 'mob' || sent[0]?.meta?.id !== 9) {
    throw new Error(`fireball did not send remote target cue: ${JSON.stringify(sent[0])}`);
  }
  if (hits.length) throw new Error('target-area skill hit before impact timing');
  await wait(250);
  if (hits.length < 2 || hits.some((h) => h.kind !== 'skill')) {
    throw new Error('target-area skill did not damage nearby cluster');
  }
  console.log('PASS: target-area skill auto-targets nearby cluster');
}

{
  const { combat, sent, player } = makeCombat([{ id: 19, x: 2.2, z: 0, hp: 40 }]);
  combat.targetId = 19;
  const ok = combat.castSkill({ type: 'spin', dmgMult: 1.4, radius: 3.5 });
  if (!ok) throw new Error('self-area skill rejected valid cast');
  if (sent[0]?.kind !== 'spin' || sent[0]?.meta?.type !== 'point') {
    throw new Error(`self-area skill sent a mob cue instead of a local point: ${JSON.stringify(sent[0])}`);
  }
  if (Math.abs(sent[0].meta.x - player.pos.x) > 0.001 || Math.abs(sent[0].meta.z - player.pos.z) > 0.001) {
    throw new Error(`self-area skill point cue is not centered on player: ${JSON.stringify(sent[0].meta)}`);
  }
  await wait(300);
  console.log('PASS: self-area skill keeps remote cue centered on the caster');
}

{
  const { combat, hits } = makeCombat([
    { id: 21, x: 4.8, z: 0, hp: 40 },
    { id: 22, x: 8.2, z: 0, hp: 40 },
    { id: 23, x: 8.8, z: 0.4, hp: 18, hpMax: 40 },
    { id: 24, x: 8.5, z: -0.6, hp: 40 },
  ]);
  const ok = combat.castSkill({ type: 'fireball', dmgMult: 2.1, radius: 1.4 });
  if (!ok) throw new Error('cluster fireball rejected valid dense pack');
  if (combat.targetId !== 22) throw new Error(`cluster fireball did not target dense pack anchor: ${combat.targetId}`);
  await wait(250);
  const ids = hits.map((h) => h.id).sort((a, b) => a - b);
  if (ids.includes(21)) throw new Error('cluster fireball wasted damage on the nearby solo mob');
  if (ids.length !== 3 || ids[0] !== 22 || ids[1] !== 23 || ids[2] !== 24) {
    throw new Error(`cluster fireball hit wrong ids: ${ids.join(',')}`);
  }
  console.log('PASS: target-area skill prefers dense cluster over nearby solo');
}

{
  const { combat, hits, attacks, sent, lunges, player } = makeCombat([{ id: 11, x: 7.2, z: 0, hp: 40 }, { id: 12, x: 8.1, z: 0, hp: 40 }]);
  const ok = combat.castSkill({ type: 'leap', dmgMult: 2.8, radius: 3.5, range: 9 });
  if (!ok) throw new Error('leap rejected nearby landing target');
  if (attacks[0] !== 'special') throw new Error('leap did not trigger special animation');
  if (sent[0]?.kind !== 'leap' || sent[0]?.meta?.type !== 'mob' || sent[0]?.meta?.id !== 11) {
    throw new Error(`leap did not send landing target cue: ${JSON.stringify(sent[0])}`);
  }
  if (!lunges.length || player.pos.x < 5.0) throw new Error('leap did not move toward the pack before impact');
  if (hits.length) throw new Error('leap hit before impact timing');
  await wait(220);
  if (hits.length < 2 || hits.some((h) => h.kind !== 'skill')) {
    throw new Error('leap did not damage the landing pack');
  }
  console.log('PASS: leap lands into the pack before area damage');
}

{
  const { combat, hits, lunges, player } = makeCombat([
    { id: 31, x: 2.2, z: 0, hp: 80, hpMax: 80 },
    { id: 32, x: 5.8, z: 0, hp: 22, hpMax: 80 },
  ]);
  player.charFile = 'char_rogue_hooded.glb';
  const ok = combat.castSkill({ type: 'execute', dmgMult: 2.4, executeMult: 4.8, threshold: 0.4 });
  if (!ok) throw new Error('execute rejected valid weak target');
  if (combat.targetId !== 32) throw new Error(`execute did not prioritize weak target: ${combat.targetId}`);
  if (!lunges.length || player.pos.x < 3.0) throw new Error('execute did not lunge toward weak target');
  await wait(220);
  if (hits.length !== 1 || hits[0].id !== 32 || hits[0].kind !== 'skill') {
    throw new Error(`execute hit wrong target: ${JSON.stringify(hits)}`);
  }
  console.log('PASS: execute prioritizes weak target for a real finisher');
}

{
  const { combat, hits } = makeCombat([
    { id: 41, x: 2.2, z: 0, hp: 80, hpMax: 80 },
    { id: 42, x: 5.8, z: 0, hp: 22, hpMax: 80 },
  ]);
  combat.player.charFile = 'char_rogue_hooded.glb';
  combat.targetId = 41;
  combat.targetLocked = true;
  const ok = combat.castSkill({ type: 'execute', dmgMult: 2.4, executeMult: 4.8, threshold: 0.4 });
  if (!ok) throw new Error('execute rejected locked target');
  if (combat.targetId !== 41) throw new Error(`execute ignored manual target lock: ${combat.targetId}`);
  await wait(220);
  if (hits.length !== 1 || hits[0].id !== 41 || hits[0].kind !== 'skill') {
    throw new Error(`execute did not honor locked target: ${JSON.stringify(hits)}`);
  }
  console.log('PASS: execute respects manual target lock');
}

console.log('PASS: skill targeting smoke');
