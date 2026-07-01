import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const require = createRequire(import.meta.url);
const WebSocket = require(path.join(root, 'server/node_modules/ws'));
const WS_URL = process.env.SMOKE_WS_URL || 'ws://127.0.0.1:8456';
const TIMEOUT_MS = Number(process.env.SMOKE_MOB_AI_TIMEOUT_MS || 12000);

let ok = true;
function fail(message) {
  console.error('FAIL:', message);
  ok = false;
}

function send(ws, obj) {
  ws.send(JSON.stringify(obj));
}

const ws = new WebSocket(WS_URL);
let myId = null;
let firstMob = null;
let latestMob = null;
let sawIdleRoam = false;
let sawCombatMove = false;
let sawHit = false;
let settled = false;
let phase = 'idle-roam';

const timer = setTimeout(() => {
  if (!myId) fail('missing id handshake');
  if (!firstMob) fail('missing mobs snapshot');
  if (!sawIdleRoam) fail('server did not emit idle roaming mpos while player was far away');
  if (!sawCombatMove) fail('server did not emit combat mpos after player approached a mob');
  if (!sawHit) fail('server did not emit phit when player stayed in attack range');
  finish();
}, TIMEOUT_MS);

function finish() {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  try { ws.close(); } catch {}
  if (!ok) process.exit(1);
  console.log('PASS: mob AI smoke');
}

ws.on('open', () => {
  console.log('PASS: WS connected for mob AI smoke');
});

ws.on('message', (buf) => {
  let msg;
  try { msg = JSON.parse(String(buf)); } catch { fail('message is not JSON'); finish(); return; }
  if (msg.t === 'id') {
    myId = msg.id;
    send(ws, { t: 'hi', name: 'Smoke', char: 'char_knight.glb' });
    return;
  }
  if (msg.t === 'mobs') {
    firstMob = (msg.list || [])[0];
    latestMob = firstMob;
    if (!firstMob) { fail('empty mob list'); finish(); return; }
    send(ws, { t: 's', x: 999, z: 999, h: 0, a: 'Idle' });
    console.log('PASS: mob snapshot', { count: msg.list.length, first: firstMob });
    return;
  }
  if (msg.t === 'mpos' && firstMob) {
    const mob = (msg.list || []).find((m) => m.id === firstMob.id);
    if (!mob) return;
    latestMob = mob;
    const movedFromSpawn = Math.hypot(mob.x - firstMob.x, mob.z - firstMob.z);
    if (phase === 'idle-roam' && mob.state === 'walk' && movedFromSpawn > 0.08) {
      sawIdleRoam = true;
      phase = 'combat';
      console.log('PASS: idle roam mpos', { state: mob.state, moved: +movedFromSpawn.toFixed(2) });
      send(ws, { t: 's', x: mob.x + 1.2, z: mob.z, h: 0, a: 'Idle' });
      return;
    }
    if (phase === 'combat' && (mob.state === 'walk' || mob.state === 'attack')) {
      sawCombatMove = true;
      console.log('PASS: combat mpos state', mob.state);
      if (mob.state === 'walk') send(ws, { t: 's', x: mob.x + 1.2, z: mob.z, h: 0, a: 'Idle' });
    }
  }
  if (msg.t === 'phit' && latestMob && msg.id === latestMob.id) {
    sawHit = true;
    console.log('PASS: phit damage', msg.dmg);
    if (sawIdleRoam && sawCombatMove) finish();
  }
});

ws.on('error', (err) => {
  fail(`WS error: ${err.message}`);
  finish();
});

ws.on('close', () => {
  if (!settled) {
    fail('WS closed before mob AI smoke finished');
    finish();
  }
});
