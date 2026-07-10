import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkTo } from './lib/walk.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const require = createRequire(import.meta.url);
const WebSocket = require(path.join(root, 'server/node_modules/ws'));
const WS_URL = process.env.SMOKE_WS_URL || 'ws://127.0.0.1:8456';
// caminar hasta el mob toma segundos (antes se teleportaba); 6s no alcanzaba.
const TIMEOUT_MS = Number(process.env.SMOKE_HIT_SOURCES_TIMEOUT_MS || 30000);
const { SAFE_X, SAFE_Z } = require(path.join(root, 'server/mob_balance.js'));

let ok = true;
let settled = false;
let target = null;
let baseHp = 0;
let phase = 'wait-mobs';
let myId = null;

function fail(message) {
  console.error('FAIL:', message);
  ok = false;
}

function send(ws, obj) {
  ws.send(JSON.stringify(obj));
}

function finish(ws) {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  try { ws.close(); } catch {}
  if (!ok) process.exit(1);
  console.log('PASS: hit source smoke');
}

const ws = new WebSocket(WS_URL);
const timer = setTimeout(() => {
  if (!target) fail('missing target mob');
  else fail(`timed out in phase ${phase}`);
  finish(ws);
}, TIMEOUT_MS);

ws.on('open', () => {
  console.log('PASS: WS connected for hit source smoke');
});

ws.on('message', (buf) => {
  let msg;
  try { msg = JSON.parse(String(buf)); } catch { fail('message is not JSON'); finish(ws); return; }
  if (msg.t === 'id') {
    myId = msg.id;
    send(ws, { t: 'hi', name: 'HitSmoke', char: 'char_knight.glb' });
    return;
  }
  if (msg.t === 'mobs' && phase === 'wait-mobs') {
    // el mob VIVO mas cercano al spawn: hay que caminar hasta el, no teleportarse
    const start = { x: SAFE_X, z: SAFE_Z };
    target = (msg.list || [])
      .filter((m) => m.hp > 10)
      .map((m) => ({ m, d: Math.hypot(m.x - start.x, m.z - start.z) }))
      .sort((a, b) => a.d - b.d)
      .map((e) => e.m)[0];
    if (!target) { fail('no mob with enough hp'); finish(ws); return; }
    baseHp = target.hp;
    phase = 'wait-basic';
    // El movement guard clampea los teleports. Caminamos hasta 10m (gate: 20m).
    const dx = target.x - start.x, dz = target.z - start.z;
    const dd = Math.hypot(dx, dz) || 1;
    const stop = { x: target.x - (dx / dd) * 10, z: target.z - (dz / dd) * 10 };
    walkTo({ send: (o) => send(ws, o) }, start, stop)
      .then(() => { send(ws, { t: 'mhit', id: target.id, dmg: 2, k: 'basic' }); })
      .catch((e) => { fail('walk failed: ' + e.message); finish(ws); });
    return;
  }
  if (msg.t !== 'mhp' || !target || msg.id !== target.id) return;
  if (phase === 'wait-basic') {
    if (msg.hp !== baseHp - 2) {
      fail(`basic damage mismatch: expected ${baseHp - 2}, got ${msg.hp}`);
      finish(ws);
      return;
    }
    if (msg.k !== 'basic' || msg.dmg !== 2 || msg.by !== myId || !Number.isFinite(msg.sx) || !Number.isFinite(msg.sz)) {
      fail(`basic hit metadata mismatch: ${JSON.stringify({ k: msg.k, dmg: msg.dmg, by: msg.by, sx: msg.sx, sz: msg.sz })}`);
      finish(ws);
      return;
    }
    phase = 'wait-skill';
    send(ws, { t: 'mhit', id: target.id, dmg: 3, k: 'skill' });
    return;
  }
  if (phase === 'wait-skill') {
    if (msg.hp !== baseHp - 5) {
      fail(`skill damage blocked or mismatched: expected ${baseHp - 5}, got ${msg.hp}`);
      finish(ws);
      return;
    }
    if (msg.k !== 'skill' || msg.dmg !== 3 || msg.by !== myId || !Number.isFinite(msg.sx) || !Number.isFinite(msg.sz)) {
      fail(`skill hit metadata mismatch: ${JSON.stringify({ k: msg.k, dmg: msg.dmg, by: msg.by, sx: msg.sx, sz: msg.sz })}`);
      finish(ws);
      return;
    }
    phase = 'wait-bleed';
    send(ws, { t: 'mhit', id: target.id, dmg: 2, k: 'bleed' });
    return;
  }
  if (phase === 'wait-bleed') {
    if (msg.hp !== baseHp - 7) {
      fail(`bleed damage blocked or mismatched: expected ${baseHp - 7}, got ${msg.hp}`);
      finish(ws);
      return;
    }
    if (msg.k !== 'bleed' || msg.dmg !== 2 || msg.by !== myId || !Number.isFinite(msg.sx) || !Number.isFinite(msg.sz)) {
      fail(`bleed hit metadata mismatch: ${JSON.stringify({ k: msg.k, dmg: msg.dmg, by: msg.by, sx: msg.sx, sz: msg.sz })}`);
      finish(ws);
      return;
    }
    console.log('PASS: basic, skill and bleed damage all preserve hit metadata', { id: target.id, baseHp, hp: msg.hp });
    finish(ws);
  }
});

ws.on('error', (err) => {
  fail(`WS error: ${err.message}`);
  finish(ws);
});

ws.on('close', () => {
  if (!settled) {
    fail('WS closed before hit source smoke finished');
    finish(ws);
  }
});
