import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const require = createRequire(import.meta.url);
const WebSocket = require(path.join(root, 'server/node_modules/ws'));
const WS_URL = process.env.SMOKE_WS_URL || 'ws://127.0.0.1:8456';
const TIMEOUT_MS = Number(process.env.SMOKE_MOB_WINDUP_TIMEOUT_MS || 7000);
const MIN_WINDUP_MS = Number(process.env.SMOKE_MOB_WINDUP_MIN_MS || 160);
const MAX_WINDUP_MS = Number(process.env.SMOKE_MOB_WINDUP_MAX_MS || 1400);

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
let attackAt = 0;
let settled = false;
let holdTimer = null;

const timer = setTimeout(() => {
  if (!myId) fail('missing id handshake');
  if (!firstMob) fail('missing mobs snapshot');
  if (!attackAt) fail('server did not emit matk before phit');
  finish();
}, TIMEOUT_MS);

function finish() {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  if (holdTimer) clearInterval(holdTimer);
  try { ws.close(); } catch {}
  if (!ok) process.exit(1);
  console.log('PASS: mob attack windup smoke');
}

function holdNearMob() {
  if (!firstMob || ws.readyState !== WebSocket.OPEN) return;
  send(ws, { t: 's', x: firstMob.x + 1.15, z: firstMob.z, h: 0, a: 'Idle', hp: 100, hm: 100, lv: 1 });
}

ws.on('open', () => {
  console.log('PASS: WS connected for mob windup smoke');
});

ws.on('message', (buf) => {
  let msg;
  try { msg = JSON.parse(String(buf)); } catch { fail('message is not JSON'); finish(); return; }
  if (msg.t === 'id') {
    myId = msg.id;
    send(ws, { t: 'hi', name: 'SmokeWindup', char: 'char_knight.glb', hp: 100, hm: 100, lv: 1 });
    return;
  }
  if (msg.t === 'mobs') {
    firstMob = (msg.list || [])[0];
    if (!firstMob) { fail('empty mob list'); finish(); return; }
    console.log('PASS: mob snapshot for windup', { id: firstMob.id, x: firstMob.x, z: firstMob.z });
    holdNearMob();
    holdTimer = setInterval(holdNearMob, 90);
    if (holdTimer.unref) holdTimer.unref();
    return;
  }
  if (msg.t === 'matk' && firstMob && msg.id === firstMob.id) {
    if (!attackAt) {
      attackAt = Date.now();
      console.log('PASS: matk before impact', { id: msg.id, ms: msg.ms });
    }
    return;
  }
  if (msg.t === 'phit' && firstMob && msg.id === firstMob.id) {
    if (!attackAt) fail('phit arrived before matk');
    const dt = Date.now() - attackAt;
    if (dt < MIN_WINDUP_MS) fail(`phit landed too early after matk: ${dt}ms`);
    if (dt > MAX_WINDUP_MS) fail(`phit landed too late after matk: ${dt}ms`);
    if (!msg.told) fail('phit missing told marker');
    if (ok) console.log('PASS: phit delayed after matk', { id: msg.id, dt, dmg: msg.dmg });
    finish();
  }
});

ws.on('error', (err) => {
  fail(`WS error: ${err.message}`);
  finish();
});

ws.on('close', () => {
  if (!settled) {
    fail('WS closed before mob windup smoke finished');
    finish();
  }
});
