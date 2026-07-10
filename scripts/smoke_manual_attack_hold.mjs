const listeners = new Map();
const documentListeners = new Map();
globalThis.addEventListener = (type, listener) => {
  if (!listeners.has(type)) listeners.set(type, []);
  listeners.get(type).push(listener);
};
globalThis.document = {
  hidden: false,
  addEventListener(type, listener) {
    if (!documentListeners.has(type)) documentListeners.set(type, []);
    documentListeners.get(type).push(listener);
  },
};
globalThis.localStorage = { getItem() { return null; }, setItem() {} };

const { Combat } = await import('../src/rpg/combat.js');

function makeCombat({ autoAttack = false, mobX = 2 } = {}) {
  const attacks = [];
  const sent = [];
  const lunges = [];
  const surfaceListeners = new Map();
  const surface = {
    addEventListener(type, listener) { surfaceListeners.set(type, listener); },
    contains(target) { return target?.surface === this; },
  };
  const mob = { id: 41, x: mobX, z: 0, hp: 100, hpMax: 100, lvl: 1 };
  const player = {
    charFile: 'char_knight.glb',
    pos: { x: 0, z: 0 },
    keys: {},
    locked: false,
    dead: false,
    heading: 0,
    comboStep: 0,
    attackT: 0,
    attack() { attacks.push('attack'); return true; },
    combatLunge(tx, tz, step) {
      lunges.push({ tx, tz, step });
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
    isDashing() { return false; },
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
      setDeathCount() {},
    },
    effects: { slashArc() {}, bloodHit() {}, damageNumber() {}, shake() {} },
    sfx: { swing() {}, hit() {} },
  });
  combat._onClick = () => combat._setTarget(mob.id);
  combat.autoAttack = autoAttack;
  return { combat, player, mob, surface, surfaceListeners, attacks, sent, lunges };
}

function pointer(surface, patch = {}) {
  return { button: 0, isPrimary: true, pointerId: 7, target: surface, ...patch };
}

{
  const { combat, surface, mob, attacks, sent, lunges } = makeCombat({ mobX: 10 });
  if (!combat._onPointerAttack(pointer(surface))) throw new Error('gameplay pointerdown did not start manual hold');
  for (let frame = 0; frame < 120 && attacks.length < 3; frame++) combat.update(1 / 60);
  if (attacks.length < 3) throw new Error(`manual hold did not repeat through cooldown: ${attacks.length}`);
  if (!lunges.length) throw new Error('manual hold did not reuse existing chase behavior');
  if (sent.some(({ meta }) => meta?.id !== mob.id)) throw new Error('manual hold changed targets while repeating');
  if (combat.autoAttack) throw new Error('manual hold enabled auto attack');
  combat._clearImpacts();
  console.log('PASS: manual pointer hold chases and repeats on target through the existing cooldown loop');
}

{
  const { combat, surface, attacks } = makeCombat();
  combat._onPointerAttack(pointer(surface));
  combat.update(0.016);
  if (!combat._releaseManualAttack(pointer(surface))) throw new Error('pointerup did not release manual hold');
  combat.update(1);
  if (attacks.length !== 1) throw new Error(`release allowed another manual attack: ${attacks.length}`);
  console.log('PASS: pointer release stops held attack repetition');
}

{
  const cancelCases = [
    ['pointercancel', ({ combat, surface }) => combat._cancelManualAttack(pointer(surface))],
    ['pointer outside', ({ combat, surface }) => combat._onManualAttackPointerMove(pointer(surface, { target: {} }))],
    ['window blur', ({ combat }) => combat._cancelManualAttack()],
    ['visibility hidden', () => {
      document.hidden = true;
      for (const listener of documentListeners.get('visibilitychange') || []) listener();
      document.hidden = false;
    }],
    ['player lock', ({ combat, player }) => { player.locked = true; combat.update(0.016); }],
    ['death', ({ combat }) => { combat.dead = true; combat.respawnT = 10; combat.update(0.016); }],
  ];
  for (const [label, cancel] of cancelCases) {
    const state = makeCombat();
    state.combat._onPointerAttack(pointer(state.surface));
    cancel(state);
    state.player.locked = false;
    state.combat.dead = false;
    state.combat.update(1);
    if (state.attacks.length || state.combat._manualAttackHeld) throw new Error(`${label} did not cancel held attack state`);
  }
  const outsideRelease = makeCombat();
  outsideRelease.combat._onPointerAttack(pointer(outsideRelease.surface));
  outsideRelease.combat._releaseManualAttack(pointer(outsideRelease.surface, { target: {} }));
  outsideRelease.combat.update(1);
  if (outsideRelease.attacks.length) throw new Error('pointerup outside preserved a click attack');
  console.log('PASS: cancellation, exit, blur, death, and player lock stop held attacks');
}

{
  const { combat, surface, attacks, sent } = makeCombat();
  const ui = { closest() { return this; } };
  if (combat._onPointerAttack(pointer(surface, { target: ui }))) throw new Error('HUD pointer started a manual hold');
  combat.update(1);
  if (attacks.length || sent.length || combat._manualAttackHeld) throw new Error('HUD pointer changed manual combat state');
  console.log('PASS: HUD and UI pointers cannot start held attacks');
}

{
  const { combat, surface, attacks } = makeCombat();
  combat._onPointerAttack(pointer(surface));
  combat._releaseManualAttack(pointer(surface));
  combat.update(0.016);
  combat.update(1);
  if (attacks.length !== 1) throw new Error(`normal click did not produce exactly one attack: ${attacks.length}`);
  const idle = makeCombat();
  idle.combat.update(1);
  if (idle.attacks.length || idle.combat.targetId != null) throw new Error('normal manual mode attacked or selected a random target without input');
  console.log('PASS: normal click stays single-shot and manual idle does not attack randomly');
}

{
  const { combat, surface, attacks } = makeCombat({ autoAttack: true });
  combat.update(0.016);
  combat._onPointerAttack(pointer(surface));
  combat._releaseManualAttack(pointer(surface));
  combat.update(0.35);
  if (!combat.autoAttack) throw new Error('manual pointer lifecycle disabled auto mode');
  if (attacks.length < 2) throw new Error(`auto mode stopped repeating after pointer release: ${attacks.length}`);
  console.log('PASS: auto mode continues unchanged across manual pointer input');
}

console.log('PASS: manual attack hold smoke');
