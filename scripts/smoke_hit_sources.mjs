import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const require = createRequire(import.meta.url);
const WebSocket = require(path.join(root, 'server/node_modules/ws'));
const WS_URL = process.env.SMOKE_WS_URL || 'ws://127.0.0.1:8456';
const TIMEOUT_MS = Number(process.env.SMOKE_HIT_SOURCES_TIMEOUT_MS || 6000);

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
    target = (msg.list || []).find((m) => m.hp > 10);
    if (!target) { fail('no mob with enough hp'); finish(ws); return; }
    baseHp = target.hp;
    phase = 'wait-basic';
    send(ws, { t: 's', x: target.x + 0.8, z: target.z, h: 0, a: 'Idle', hp: 100, hm: 100, lv: 1 });
    send(ws, { t: 'mhit', id: target.id, dmg: 2, k: 'basic' });
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
