globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
};
globalThis.addEventListener = () => {};

const { Combat } = await import('../src/rpg/combat.js');

function makeCombat(playerPatch = {}, mobPatch = {}) {
  const lunges = [];
  const attacks = [];
  const sent = [];
  const mob = { id: 71, x: 10, z: 0, hp: 60, hpMax: 60, lvl: 1, ...mobPatch };
  const player = {
    charFile: 'char_knight.glb',
    pos: { x: 0, z: 0 },
    keys: {},
    locked: false,
    dead: false,
    heading: 0,
    attackVisualT: 0,
    dashVisualT: 0,
    attack() { attacks.push('attack'); return true; },
    combatLunge(tx, tz, step, opts) {
      lunges.push({ tx, tz, step, opts });
      const dx = tx - this.pos.x, dz = tz - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.001) {
        const move = Math.min(step, d);
        this.pos.x += (dx / d) * move;
        this.pos.z += (dz / d) * move;
      }
      return true;
    },
    isDashing() { return false; },
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
      toast() {},
      hideStreak() {},
    },
    sfx: {},
    effects: { slashArc() {}, bloodHit() {}, damageNumber() {} },
    skills: null,
  });
  combat.attackCd = 0.7;
  combat.autoAttack = true;
  return { combat, player, mob, lunges, attacks, sent };
}

{
  const { combat, player, lunges, attacks } = makeCombat();
  combat.update(0.1);
  if (combat.targetId !== 71) throw new Error(`auto chase did not acquire target: ${combat.targetId}`);
  if (!lunges.length || !lunges[0].opts?.chase) throw new Error('auto chase did not lunge with chase flag');
  if (player.pos.x <= 0.2) throw new Error(`auto chase did not move player enough: ${player.pos.x}`);
  if (attacks.length) throw new Error('auto chase should not attack before reaching range');
  console.log('PASS: melee auto combat chases a mob outside lunge range');
}

{
  const { combat, player, lunges } = makeCombat({
    actionDown(action) { return action === 'moveForward'; },
  });
  combat.update(0.1);
  if (lunges.length || player.pos.x !== 0) throw new Error('auto chase ignored manual movement input');
  console.log('PASS: auto chase respects manual movement input');
}

{
  const { combat, player, lunges, attacks, sent } = makeCombat();
  combat.autoAttack = false;
  combat.pokeAttack();
  for (let frame = 0; frame < 90 && !attacks.length; frame++) combat.update(1 / 60);
  if (lunges.length < 2 || player.pos.x <= 0.6) throw new Error('manual attack intent did not keep closing distance');
  if (attacks.length !== 1 || sent.length !== 1) throw new Error('manual click did not produce exactly one attack after chase');
  if (sent[0].meta?.id !== 71) throw new Error(`manual chase attacked wrong target: ${sent[0].meta?.id}`);
  combat.update(1);
  if (attacks.length !== 1) throw new Error('manual chase continued attacking after the click was consumed');
  console.log('PASS: manual attack intent survives chase and is consumed exactly once');
}

{
  const { combat, player, lunges } = makeCombat({
    actionDown(action) { return action === 'moveForward'; },
  });
  combat.autoAttack = false;
  combat.pokeAttack();
  combat.update(0.1);
  if (combat.attackIntentT !== 0 || lunges.length || player.pos.x !== 0) throw new Error('manual movement did not cancel attack intent');
  console.log('PASS: manual movement cancels pending attack intent');
}

{
  const { combat, player, lunges } = makeCombat({ charFile: 'char_mage.glb' });
  combat.update(0.1);
  if (lunges.length || player.pos.x !== 0) throw new Error('ranged hero should not melee chase');
  console.log('PASS: auto chase skips ranged heroes');
}

{
  const { combat, player, lunges } = makeCombat({ attackVisualT: 0.2 });
  combat.update(0.1);
  if (lunges.length || player.pos.x !== 0) throw new Error('auto chase moved during visible attack');
  console.log('PASS: auto chase does not cut visible attacks');
}

console.log('PASS: auto chase smoke');
