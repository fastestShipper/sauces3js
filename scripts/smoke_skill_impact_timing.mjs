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
  const effects = [];
  const mobMap = new Map(mobs.map((m) => [m.id, { hpMax: m.hpMax || m.hp || 40, lvl: m.lvl || 1, ...m }]));
  const player = {
    charFile: 'char_knight.glb',
    pos: { x: 0, z: 0 },
    keys: {},
    locked: false,
    dead: false,
    attack() { attacks.push('attack'); return true; },
    attackSpecial() { attacks.push('special'); return true; },
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
    sfx: { hit() {} },
    effects: {
      bloodHit() { effects.push('blood'); },
      damageNumber() { effects.push('number'); },
      shake() { effects.push('shake'); },
      slashArc() { effects.push('slash'); },
      projectile() { effects.push('projectile'); },
      meteorRain() { effects.push('rain'); },
      nova() { effects.push('nova'); },
      goreBurst() { effects.push('gore'); },
    },
  });
  return { combat, hits, attacks, effects };
}

{
  const { combat, hits, attacks } = makeCombat([{ id: 7, x: 5, z: 0, hp: 40 }]);
  const ok = combat.castSkill({ type: 'strike', dmgMult: 2.4 });
  if (!ok) throw new Error('strike skill was rejected');
  if (!attacks.length) throw new Error('strike did not start an attack animation');
  if (hits.length) throw new Error('strike damage landed before impact delay');
  await wait(65);
  if (hits.length) throw new Error('strike damage landed too early');
  await wait(95);
  if (hits.length !== 1 || hits[0].id !== 7 || hits[0].kind !== 'skill') {
    throw new Error('strike damage did not land after impact delay');
  }
  if (combat.hitStopT <= 0) throw new Error('strike impact did not trigger hit-stop');
  console.log('PASS: strike skill damage lands on impact timing');
}

{
  const { combat, hits } = makeCombat([{ id: 9, x: 10, z: 0, hp: 40 }, { id: 10, x: 10.8, z: 0, hp: 40 }]);
  const ok = combat.castSkill({ type: 'fireball', dmgMult: 2.1, radius: 3.5 });
  if (!ok) throw new Error('fireball skill was rejected');
  if (hits.length) throw new Error('fireball area damage landed before projectile timing');
  await wait(130);
  if (hits.length) throw new Error('fireball area damage landed too early');
  await wait(140);
  if (hits.length < 2 || hits.some((h) => h.kind !== 'skill')) {
    throw new Error('fireball area damage did not land after projectile timing');
  }
  console.log('PASS: projectile skill damage lands after travel timing');
}

{
  const { combat, hits, effects } = makeCombat([{ id: 12, x: 9, z: 0, hp: 40 }, { id: 13, x: 10.2, z: 0, hp: 40 }]);
  const ok = combat.castSkill({ type: 'meteor', dmgMult: 2.8, radius: 7 });
  if (!ok) throw new Error('meteor skill was rejected');
  if (!effects.includes('rain')) throw new Error('meteor did not start the falling projectile tell');
  if (effects.includes('nova')) throw new Error('meteor explosion nova fired before impact timing');
  if (hits.length) throw new Error('meteor area damage landed before impact timing');
  await wait(180);
  if (effects.includes('nova') || hits.length) throw new Error('meteor impact landed too early');
  await wait(210);
  if (!effects.includes('nova')) throw new Error('meteor explosion nova did not land with impact timing');
  if (hits.length < 2 || hits.some((h) => h.kind !== 'skill')) {
    throw new Error('meteor area damage did not land after impact timing');
  }
  console.log('PASS: meteor explosion VFX lands with delayed impact');
}

{
  const { combat, hits } = makeCombat([{ id: 11, x: 4, z: 0, hp: 40 }]);
  combat.hp = 50;
  const ok = combat.castSkill({ type: 'stab', dmgMult: 2.2, leech: 0.5 });
  if (!ok) throw new Error('stab skill was rejected');
  if (combat.hp !== 50) throw new Error('stab leech healed before impact');
  await wait(150);
  if (hits.length !== 1) throw new Error('stab damage did not land after impact timing');
  if (combat.hp <= 50) throw new Error('stab leech did not heal on impact');
  console.log('PASS: leech skill heals only after impact');
}

{
  const { combat, hits, attacks } = makeCombat([{ id: 21, x: 1.8, z: 0, hp: 80 }]);
  combat.targetId = 21;
  combat.autoAttack = true;
  combat.update(0.016);
  if (attacks.length !== 1) throw new Error('basic attack did not queue before skill test');
  if (hits.length) throw new Error('basic hit landed before its impact window');
  const ok = combat.castSkill({ type: 'strike', dmgMult: 2.4 });
  if (!ok) throw new Error('priority strike was rejected');
  if (attacks.length !== 2) throw new Error('priority strike did not start a skill animation');
  combat.update(0.016);
  if (attacks.length !== 2) throw new Error('auto attack fired during skill priority window');
  await wait(150);
  if (hits.length !== 1 || hits[0].id !== 21 || hits[0].kind !== 'skill') {
    throw new Error('skill priority did not clear the pending basic impact');
  }
  console.log('PASS: accepted skill clears pending basic impact and suppresses auto attack');
}

{
  const { combat, hits, attacks } = makeCombat([{ id: 31, x: 2.1, z: 0, hp: 18, hpMax: 80 }]);
  combat.targetId = 31;
  combat.autoAttack = true;
  const ok = combat.castSkill({ type: 'execute', dmgMult: 2.4, executeMult: 4.8, threshold: 0.4 });
  if (!ok) throw new Error('execute skill was rejected');
  if (attacks[0] !== 'special') throw new Error('execute did not start a heavy skill animation');
  if (combat.skillPriorityT < 0.4 || combat.attackCd < 0.23) {
    throw new Error(`execute did not keep heavy priority windows: priority=${combat.skillPriorityT}, cd=${combat.attackCd}`);
  }
  combat.update(0.20);
  if (attacks.length !== 1) throw new Error('auto attack interrupted execute visual priority');
  await wait(240);
  if (!hits.some((h) => h.id === 31 && h.kind === 'skill')) throw new Error('execute damage did not land');
  console.log('PASS: execute keeps a heavier visual priority window');
}

console.log('PASS: skill impact timing smoke');
