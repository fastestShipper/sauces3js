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

function makePlayer(city = makeCity()) {
  const scene = { add() {} };
  const player = new Player(scene, city, [0, 0], {});
  player.actions = {
    Idle: { reset() {}, setLoop() {}, play() {}, crossFadeFrom() {} },
    Walk: { reset() {}, setLoop() {}, play() {}, crossFadeFrom() {}, timeScale: 1 },
    Run: { reset() {}, setLoop() {}, play() {}, crossFadeFrom() {}, timeScale: 1 },
    Jump: { reset() {}, setLoop() {}, play() {}, crossFadeFrom() {} },
  };
  player.mixer = { update() {} };
  return player;
}

function makeCamera() {
  return {
    position: new THREE.Vector3(),
    lookAt() {},
  };
}

function action(name, duration = 0.45) {
  return {
    name,
    timeScale: 1,
    played: 0,
    reset() { return this; },
    setLoop() { return this; },
    play() { this.played++; return this; },
    stop() { return this; },
    crossFadeFrom() { return this; },
    getClip() { return { duration }; },
  };
}

{
  const player = makePlayer();
  const camera = makeCamera();
  player.keys.KeyW = true;
  player.keys.Space = true;
  player.update(0.05, camera);
  const moved = Math.hypot(player.pos.x, player.pos.z);
  if (moved < 1.0) throw new Error('dash did not move farther than normal walk');
  if (!player.isDashing()) throw new Error('dash timer was not active after moving Space press');
  if (!player.grounded || player.velY !== 0) throw new Error('moving Space should dash, not jump');
  const firstCd = player.dashCd;
  player.keys.Space = false;
  player.update(0.02, camera);
  player.keys.Space = true;
  player.update(0.02, camera);
  if (player.dashCd > firstCd) throw new Error('dash restarted while cooldown was active');
  console.log('PASS: moving Space triggers dash with cooldown');
}

{
  const player = makePlayer();
  const camera = makeCamera();
  player.keys.Space = true;
  player.update(0.02, camera);
  if (player.isDashing()) throw new Error('stationary Space should not dash');
  if (player.grounded || player.velY <= 0) throw new Error('stationary Space did not jump');
  console.log('PASS: stationary Space still jumps');
}

{
  const player = makePlayer();
  const camera = makeCamera();
  const hits = [];
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
      mobs: new Map([[9, { id: 9, x: 1.4, z: 0, hp: 40, hpMax: 40, lvl: 1 }]]),
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
      hideStreak() {},
    },
    effects: { hitFlash() {} },
    sfx: { hurt() {}, death() {} },
  });
  if (!combat.tryCombatDodge()) throw new Error('stationary Space in combat did not start contextual dash');
  if (!player.isDashing()) throw new Error('contextual combat dodge did not enter dash state');
  if (player._spaceWasDown !== true) throw new Error('contextual combat dodge did not consume Space press');
  if (combat.targetId !== 9 || combat.targetLocked) throw new Error('contextual combat dodge did not soft-target nearby mob');
  if (player._dashAnimKey !== 'Backward') throw new Error(`contextual combat dodge did not request backward clip: ${player._dashAnimKey}`);
  if (Math.abs(player.heading - Math.PI / 2) > 0.01) throw new Error('contextual combat dodge did not keep facing the mob');
  player.keys.Space = true;
  player.update(0.02, camera);
  if (!player.grounded || player.velY !== 0) throw new Error('contextual combat dodge also triggered jump');
  if (hits.length !== 0) throw new Error('contextual combat dodge should not deal direct damage');
  console.log('PASS: stationary Space becomes dodge only near combat');
}

{
  const player = makePlayer();
  const camera = makeCamera();
  player.attackT = 0.05;
  player.attackVisualT = 0.2;
  player.keys.KeyW = true;
  player.keys.Space = true;
  player.update(0.02, camera);
  if (!player.isDashing()) throw new Error('dash did not cancel active attack immediately');
  if (player.attackT !== 0) throw new Error('dash did not clear hard attack window');
  if (player.attackVisualT > 0.081) throw new Error('dash did not shorten visual swing tail');
  console.log('PASS: dash cancels active attack window');
}

{
  const hpEvents = [];
  const hits = [];
  const fx = { flashes: 0, blood: 0, numbers: 0, arcs: 0, shakes: 0, trails: 0, trail: null };
  const skillEvents = [];
  const player = makePlayer();
  const camera = makeCamera();
  player.isDashing = () => true;
  player.dashSeq = 3;
  player.dashCd = 0.5;
  player.heading = 0.4;
  const counterAction = action('Counter');
  player.comboActions = [counterAction];
  player.comboFollowupActions = [null];
  player.actions.Attack = counterAction;
  const sent = [];
  const combat = new Combat({
    scene: null,
    camera: null,
    player,
    mobField: {
      setTargeted() {},
      meshes() { return []; },
      pickFromIntersections() { return null; },
      playAttack() { hpEvents.push('mobAttackAnim'); },
    },
    net: {
      myId: 1,
      mobs: new Map([[7, { id: 7, x: 0.6, z: 0.3, hp: 40, hpMax: 40, lvl: 1 }]]),
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
      setHP(hp) { hpEvents.push(hp); },
      setXP() {},
      showTarget() {},
      hideTarget() {},
      toast() {},
      hideStreak() {},
    },
    effects: {
      hitFlash() { fx.flashes++; },
      bloodHit() { fx.blood++; },
      damageNumber() { fx.numbers++; },
      slashArc() { fx.arcs++; },
      dashTrail(from, to, color, opts) {
        fx.trails++;
        fx.trail = { from, to, color, opts };
        return true;
      },
      shake() { fx.shakes++; },
    },
    skills: { onHit() { skillEvents.push('hit'); } },
    sfx: { hurt() {}, death() {}, hit() {} },
  });
  combat.spawnGraceT = 0;
  combat._onPlayerHit({ id: 7, dmg: 50 });
  if (combat.hp !== 100) throw new Error('dash did not evade mob hit');
  if (!hpEvents.includes('mobAttackAnim')) throw new Error('evaded mob hit did not keep mob attack animation');
  console.log('PASS: dash evades mob damage');
  combat._onPlayerHit({ id: 7, dmg: 50, told: true });
  if (combat.hp !== 100) throw new Error('perfect dodge counter should still evade damage');
  if (hits.length !== 1 || hits[0].id !== 7 || hits[0].kind !== 'skill' || hits[0].dmg <= 0) {
    throw new Error('perfect dodge did not counter-hit the telegraphed mob');
  }
  if (sent.length !== 1 || sent[0].kind !== 'counter' || sent[0].meta?.id !== 7 || sent[0].meta?.am < 1.4) {
    throw new Error('perfect dodge did not send a remote counter animation cue');
  }
  if (!player._counterAttackQueue) throw new Error('perfect dodge did not queue a local counter animation');
  player.dashT = 0;
  player.update(0.016, camera);
  if (counterAction.played !== 1 || player.cur !== 'Attack') throw new Error('perfect dodge did not play queued counter animation after dash');
  if (player.dashCd > 0.101) throw new Error('perfect dodge did not refund dash cooldown');
  if (player.speedBuffT <= 0 || player.speedBuffMult < 1.2) throw new Error('perfect dodge did not grant brief haste');
  if (fx.flashes !== 1 || fx.blood !== 1 || fx.numbers !== 1 || fx.arcs !== 1 || fx.shakes !== 1 || fx.trails !== 1) {
    throw new Error('perfect dodge did not emit expected feedback');
  }
  if (!fx.trail || Math.hypot(fx.trail.to.x - fx.trail.from.x, fx.trail.to.z - fx.trail.from.z) <= 0.3) {
    throw new Error('perfect dodge counter trail did not move toward the mob');
  }
  if (fx.trail.opts?.width < 0.45 || fx.trail.opts?.opacity < 0.3) {
    throw new Error('perfect dodge counter trail is too weak to read');
  }
  if (skillEvents.length !== 1) throw new Error('perfect dodge did not grant one resource pulse');
  combat._onPlayerHit({ id: 7, dmg: 50, told: true });
  if (hits.length !== 1) throw new Error('perfect dodge repeated counter on same mob during one dash');
  player.dashSeq = 4;
  combat._onPlayerMiss({ id: 7, told: true });
  if (combat.hp !== 100) throw new Error('miss event should not damage the player');
  if (hits.length !== 2 || hits[1].id !== 7 || hits[1].kind !== 'skill') {
    throw new Error('miss event during dash did not trigger a perfect dodge counter');
  }
  console.log('PASS: telegraphed dash dodge counter-hits once');
}

{
  const hits = [];
  const fx = { blood: 0, numbers: 0, arcs: 0, shakes: 0 };
  const skillEvents = [];
  const player = makePlayer();
  player.dashT = 0.1;
  player.dashSeq = 1;
  player.heading = 0;
  player.comboActions = [];
  const mobs = new Map([
    [1, { id: 1, x: 0.7, z: 0.3, hp: 40, hpMax: 40, lvl: 1 }],
    [2, { id: 2, x: -0.9, z: 0.2, hp: 40, hpMax: 40, lvl: 1 }],
    [3, { id: 3, x: 1.1, z: 1.1, hp: 40, hpMax: 40, lvl: 1 }],
    [4, { id: 4, x: 0.0, z: 1.8, hp: 40, hpMax: 40, lvl: 1 }],
    [5, { id: 5, x: 3.2, z: 0.0, hp: 40, hpMax: 40, lvl: 1 }],
  ]);
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
      mobs,
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
      hideStreak() {},
    },
    effects: {
      bloodHit() { fx.blood++; },
      damageNumber() { fx.numbers++; },
      slashArc() { fx.arcs++; },
      shake() { fx.shakes++; },
    },
    skills: { onHit() { skillEvents.push('hit'); } },
    sfx: { hit() {} },
  });
  combat.autoAttack = false;
  combat.update(0.016);
  if (hits.length !== 3) throw new Error('dash strike should hit max three nearby mobs');
  if (hits.some(h => h.kind !== 'skill' || h.dmg <= 0)) throw new Error('dash strike used wrong hit kind or damage');
  if (fx.blood !== 3 || fx.numbers !== 3 || fx.arcs !== 1 || fx.shakes !== 1) throw new Error('dash strike did not emit expected combat feedback');
  if (skillEvents.length !== 3) throw new Error(`dash strike should grant one hit resource pulse per body, got ${skillEvents.length}`);
  combat.update(0.016);
  if (hits.length !== 3) throw new Error('dash strike repeated hits during the same dash');
  player.dashSeq = 2;
  combat.update(0.016);
  if (hits.length !== 6) throw new Error('new dash did not allow a fresh dash strike');
  if (skillEvents.length !== 6) throw new Error(`fresh dash strike should grant fresh body pulses, got ${skillEvents.length}`);
  console.log('PASS: dash strike cuts through nearby mobs once per dash');
}

console.log('PASS: dash response smoke');
