globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
};
globalThis.addEventListener = () => {};

import * as THREE from 'three';

const { Player } = await import('../src/player.js');
const { Combat } = await import('../src/rpg/combat.js');

function makeCity(blocked = () => false) {
  return {
    inRealBuilding(x, z) { return blocked(x, z); },
    hitsCar() { return false; },
    carPushOut() { return null; },
    carRoofAt() { return 0; },
  };
}

function makeCamera() {
  return {
    position: new THREE.Vector3(),
    lookAt() {},
  };
}

function stubAction() {
  return {
    timeScale: 1,
    reset() { return this; },
    setLoop() { return this; },
    play() { return this; },
    stop() { return this; },
    crossFadeFrom() { return this; },
    getClip() { return { duration: 0.4 }; },
  };
}

function makePlayer(city = makeCity()) {
  const player = new Player(new THREE.Scene(), city, [0, 0], {});
  player.actions = {
    Idle: stubAction(),
    Walk: stubAction(),
    Run: stubAction(),
    Jump: stubAction(),
    Hit: stubAction(),
  };
  player.mixer = { update() {} };
  return player;
}

{
  const player = makePlayer();
  const camera = makeCamera();
  if (!player.applyHitImpulse({ x: 1, z: 0 })) throw new Error('hit impulse was not accepted');
  if (player.hitImpulseMaxT !== player.hitImpulseT) throw new Error('hit impulse max duration should track custom decay');
  player.update(0.05, camera);
  if (!(player.pos.x < -0.05)) throw new Error(`hit impulse did not push away from attacker: ${player.pos.x}`);
  if (player.hitImpulseT <= 0) throw new Error('hit impulse should decay over multiple frames');
  player.update(0.3, camera);
  if (player.hitImpulseT !== 0 || player.hitImpulseX !== 0 || player.hitImpulseZ !== 0) {
    throw new Error('hit impulse did not clear after its short lifetime');
  }
  console.log('PASS: player hit impulse moves and clears');
}

{
  const player = makePlayer(makeCity((x) => x < -0.02));
  const camera = makeCamera();
  player.applyHitImpulse({ x: 1, z: 0 });
  player.update(0.05, camera);
  if (player.pos.x < -0.02) throw new Error('hit impulse ignored collision blocking');
  console.log('PASS: player hit impulse respects collision');
}

{
  const impulses = [];
  const playHits = [];
  const combat = new Combat({
    scene: null,
    camera: null,
    player: {
      pos: { x: 0, z: 0 },
      heading: 0,
      locked: false,
      dead: false,
      playHit(opts) { playHits.push(opts || {}); },
      setDead() {},
      isDashing() { return false; },
      applyHitImpulse(source, opts) { impulses.push({ source, opts }); return true; },
    },
    mobField: {
      playAttack() {},
      setTargeted() {},
      meshes() { return []; },
      pickFromIntersections() { return null; },
    },
    net: {
      myId: 1,
      mobs: new Map([[7, { id: 7, x: 1.2, z: -0.4, hp: 30, hpMax: 30 }]]),
      remotes: new Map([[3, { id: 3, x: -2, z: 0.5, ready: true }]]),
      party: [],
      sendAttack() {},
      attackMob() {},
      partySkill() {},
      reportStreak() {},
      pvpDead() {},
    },
    inventory: { equippedWeapon: null },
    progress: { hpMax: 100, xp: 0, xpNext: 10, level: 1, gainXp() { return false; } },
    hud: {
      setHP() {},
      setXP() {},
      showTarget() {},
      hideTarget() {},
      hurtFlash() {},
      showDeath() {},
      setDeathCount() {},
      toast() {},
    },
    effects: {
      bloodHit() {},
      damageNumber() {},
      shake() {},
    },
    sfx: { hurt() {}, death() {} },
  });
  combat.spawnGraceT = 0;
  combat._onPlayerHit({ id: 7, dmg: 12, heavy: true });
  if (impulses.length !== 1 || impulses[0].source.x !== 1.2 || impulses[0].source.z !== -0.4) {
    throw new Error('mob hit did not pass the attacker position into the impulse');
  }
  if (playHits[0]?.heavy !== true) throw new Error('heavy mob hit was not forwarded into player hit reaction');
  combat.takePvpHit({ from: 3, dmg: 9 });
  if (impulses.length !== 2 || impulses[1].source.x !== -2 || impulses[1].source.z !== 0.5) {
    throw new Error('PvP hit did not pass the rival position into the impulse');
  }
  if (playHits[1]?.heavy !== false) throw new Error('light PvP hit should stay a light player hit reaction');
  console.log('PASS: combat routes hit sources into player impulse');
}

{
  const calls = { attacks: 0, hits: 0 };
  const player = {
    pos: { x: 0, z: 0 },
    heading: 0,
    locked: false,
    dead: false,
    dashSeq: 9,
    dashVisualT: 0.18,
    dashCd: 0.4,
    speedBuffT: 0,
    speedBuffMult: 1,
    isDashing() { return false; },
    playHit() { calls.hits++; },
    setDead() {},
    applyHitImpulse() { return true; },
  };
  const combat = new Combat({
    scene: null,
    camera: null,
    player,
    mobField: {
      playAttack() {},
      setTargeted() {},
      meshes() { return []; },
      pickFromIntersections() { return null; },
    },
    net: {
      myId: 1,
      mobs: new Map([[11, { id: 11, x: 1.4, z: 0, hp: 30, hpMax: 30 }]]),
      remotes: new Map(),
      party: [],
      sendAttack() {},
      attackMob(id, dmg, kind) { calls.attacks++; calls.lastAttack = { id, dmg, kind }; },
      partySkill() {},
      reportStreak() {},
      pvpDead() {},
    },
    inventory: { equippedWeapon: null },
    progress: { hpMax: 100, xp: 0, xpNext: 10, level: 1, gainXp() { return false; } },
    hud: {
      setHP() {},
      setXP() {},
      showTarget() {},
      hideTarget() {},
      hurtFlash() {},
      showDeath() {},
      setDeathCount() {},
      toast() {},
    },
    effects: {
      slashArc() {},
      bloodHit() {},
      damageNumber() {},
      hitFlash() {},
      shake() {},
    },
    sfx: { hit() {}, hurt() {}, death() {} },
  });
  combat.spawnGraceT = 0;
  const hp0 = combat.hp;
  combat._onPlayerHit({ id: 11, dmg: 18, told: true });
  if (combat.hp !== hp0) throw new Error('visual dodge tail should evade incoming mob damage');
  if (calls.hits !== 0) throw new Error('visual dodge tail should not play hit reaction');
  if (calls.attacks !== 1 || calls.lastAttack.id !== 11 || calls.lastAttack.kind !== 'skill') {
    throw new Error('visual dodge tail did not trigger perfect dodge counter');
  }
  console.log('PASS: visual dodge tail evades and counters telegraphed bites');
}

console.log('PASS: player hit impulse smoke');
