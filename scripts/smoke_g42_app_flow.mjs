import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Player } from '../src/player.js';

globalThis.addEventListener ||= () => {};

function fail(message) {
  console.error('FAIL:', message);
  process.exit(1);
}

const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const playerSource = readFileSync(new URL('../src/player.js', import.meta.url), 'utf8');

if (!/SocialPanel, showSocialInvite/.test(app)) fail('party invite helper is not imported');
if (!/kind: 'party'[\s\S]*timeout: 15000[\s\S]*onAccept:[\s\S]*onClose:/.test(app)) {
  fail('party invites must expose accept, close and timeout behavior');
}
if (/decorPreload|preloadGLB/.test(app)) fail('heavy decor must not preload during boot');

const treeLoad = app.indexOf("loadDecorGLB('trees_real.glb?v=' + APP_VERSION)");
const bushLoad = app.indexOf("loadDecorGLB('bushes_real.glb?v=' + APP_VERSION)");
const carLoad = app.indexOf('loadDecorGLB(CAR_FILES[ci])');
if (!(treeLoad >= 0 && treeLoad < bushLoad && bushLoad < carLoad)) {
  fail('decor must load trees, then bushes, then cars');
}
if (!/now - decorCalmSince < 9000/.test(app)) fail('heavy decor needs nine calm seconds');
if (!/loadHeavyDecor\(\)[\s\S]*finally\(\(\) => setTimeout\(startStreetLifeWhenCalm/.test(app)) {
  fail('StreetLife must start after heavy decor settles');
}
if (!/if \(!document\.hidden \|\| !combat\.autoAttack\)/.test(app)) {
  fail('hidden heartbeat must be gated by auto mode');
}
if (!/heartbeatBudget = Math\.min\(1/.test(app)) fail('hidden heartbeat must discard delays beyond one second');
if (!/for \(let i = 0; i < 4 && heartbeatBudget > 0; i\+\+\)/.test(app)) {
  fail('hidden heartbeat must use at most four substeps');
}
if (!/heartbeatStep = Math\.min\(0\.25, heartbeatBudget\)/.test(app)) {
  fail('hidden heartbeat substeps must stay capped at 0.25 seconds');
}
if (!/combat\.update\(heartbeatStep\);\s*skills\.update\(heartbeatStep\)/.test(app)) {
  fail('hidden auto combat must advance SkillSystem cooldowns');
}
if (!/const wallDt = clock\.getDelta\(\);\s*if \(document\.hidden\) return;/.test(app)) {
  fail('hidden rAF must not duplicate heartbeat simulation');
}
if (!/advanceActionTimers\(dt\)/.test(playerSource)) fail('Player action timer helper is missing');

const player = new Player(new THREE.Scene(), {
  inRealBuilding: () => false,
  hitsCar: () => false,
  carPushOut: () => null,
  carRoofAt: () => 0,
}, [3, 4]);
player.attackT = 1;
player.attackVisualT = 1;
player.dashT = 1;
const before = player.pos.clone();
const advanced = player.advanceActionTimers(5);
if (advanced !== 0.25) fail('Player action timer helper must cap large dt values');
if (player.attackT !== 0.75 || player.attackVisualT !== 0.75 || player.dashT !== 0.75) {
  fail('Player action timers did not advance by the capped dt');
}
if (!player.pos.equals(before)) fail('Player action timer helper moved the player');

console.log('PASS: g42 hidden auto heartbeat, lazy decor and social invite integration');
