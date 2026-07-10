import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const require = createRequire(import.meta.url);
const WebSocket = require(path.join(root, 'server/node_modules/ws'));

const relayPort = Number(process.env.SMOKE_MOB_EVADE_PORT || 8584);
const healthPort = relayPort + 1;
const wsUrl = `ws://127.0.0.1:${relayPort}`;
const SAFE_X = -62, SAFE_Z = -7, SAFE_R = 30;

let failures = 0;

function check(name, ok, details = '') {
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (details ? ' ' + details : ''));
  if (!ok) failures++;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function inSafe(p) {
  return Math.hypot(p.x - SAFE_X, p.z - SAFE_Z) < SAFE_R + 2;
}

const child = spawn(process.execPath, ['server.js'], {
  cwd: path.join(root, 'server'),
  env: {
    ...process.env,
    SAUCES_PORT: String(relayPort),
    SAUCES_HEALTH_PORT: String(healthPort),
    WAVE_EVERY_MS: '600000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverOut = '';
child.stdout.on('data', (buf) => { serverOut += buf.toString(); });
child.stderr.on('data', (buf) => { serverOut += buf.toString(); });

async function waitForServer() {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${healthPort}/health`);
      if (res.ok) return true;
    } catch {}
    await wait(200);
  }
  return false;
}

function makeClient() {
  const ws = new WebSocket(wsUrl);
  const c = { ws, id: null, msgs: [], mobs: new Map() };
  ws.on('message', (buf) => {
    const m = JSON.parse(buf.toString());
    c.msgs.push(m);
    if (m.t === 'id') c.id = m.id;
    if (m.t === 'mobs') for (const mob of m.list || []) c.mobs.set(mob.id, mob);
    if (m.t === 'mpos') for (const mob of m.list || []) c.mobs.set(mob.id, { ...(c.mobs.get(mob.id) || {}), ...mob });
  });
  c.open = new Promise((resolve) => ws.on('open', resolve));
  return c;
}

try {
  const ready = await waitForServer();
  check('temporary relay starts on isolated port', ready);
  if (!ready) throw new Error(serverOut || 'relay did not start');

  const c = makeClient();
  await c.open;
  await wait(200);
  send(c.ws, { t: 'hi', name: 'evade-smoke', char: 'char_knight.glb', hp: 100, hm: 100, lv: 1 });

  const deadline = Date.now() + 6000;
  while (!c.msgs.some((m) => m.t === 'mobs') && Date.now() < deadline) await wait(100);
  const mob = [...c.mobs.values()].find((m) => m && !m.b && !inSafe(m));
  check('found a non-safe mob for evasion', !!mob, mob ? JSON.stringify({ id: mob.id, x: mob.x, z: mob.z }) : '');
  if (!mob) throw new Error('no mob available for evasion smoke');

  const near = { x: mob.x + 1.15, z: mob.z };
  let far = { x: mob.x + 7.2, z: mob.z };
  if (inSafe(far)) far = { x: mob.x - 7.2, z: mob.z };

  let holdingNear = true;
  const hold = setInterval(() => {
    const p = holdingNear ? near : far;
    send(c.ws, { t: 's', x: p.x, z: p.z, h: 0, a: holdingNear ? 'Idle' : 'Dash', hp: 100, hm: 100, lv: 1 });
  }, 60);
  if (hold.unref) hold.unref();

  let sawTell = false;
  let tookHitAfterEvade = false;
  const end = Date.now() + 9000;
  while (Date.now() < end && !sawTell) {
    await wait(50);
    const tell = c.msgs.find((m) => m.t === 'matk' && m.id === mob.id);
    if (!tell) continue;
    sawTell = true;
    holdingNear = false;
    send(c.ws, { t: 's', x: far.x, z: far.z, h: 0, a: 'Dash', hp: 100, hm: 100, lv: 1 });
  }
  check('server emitted attack tell before evasion', sawTell);
  if (!sawTell) throw new Error('mob never started a telegraphed attack');

  const hitStart = c.msgs.length;
  await wait(760);
  const afterEvade = c.msgs.slice(hitStart);
  tookHitAfterEvade = afterEvade.some((m) => m.t === 'phit' && m.id === mob.id);
  const sawMiss = afterEvade.some((m) => m.t === 'pmiss' && m.id === mob.id && m.told);
  clearInterval(hold);

  check('server emits a miss event for the dodged bite', sawMiss);
  check('dash-range evasion cancels the pending bite damage', !tookHitAfterEvade, JSON.stringify({
    mob: mob.id,
    near: { x: +near.x.toFixed(2), z: +near.z.toFixed(2) },
    far: { x: +far.x.toFixed(2), z: +far.z.toFixed(2) },
  }));
  try { c.ws.close(); } catch {}
} catch (err) {
  console.error('FAIL mob attack evasion smoke:', err.message);
  failures++;
} finally {
  try { child.kill(); } catch {}
}

if (failures) {
  console.error(serverOut);
  process.exit(1);
}

console.log('PASS: mob attack evasion smoke');
