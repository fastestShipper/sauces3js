import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const require = createRequire(import.meta.url);
const WebSocket = require(path.join(root, 'server/node_modules/ws'));

const relayPort = Number(process.env.SMOKE_COMBAT_NOISE_PORT || 8572);
const healthPort = relayPort + 1;
const wsUrl = `ws://127.0.0.1:${relayPort}`;
const SAFE_X = -62, SAFE_Z = -7, SAFE_R = 30;
const AGGRO_RANGE = 28;

let failures = 0;

function check(name, ok, details = '') {
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (details ? ' ' + details : ''));
  if (!ok) failures++;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function inSafe(p) {
  return Math.hypot(p.x - SAFE_X, p.z - SAFE_Z) < SAFE_R + 2;
}

function chooseNoiseCase(mobs) {
  for (const victim of mobs) {
    if (!victim || victim.b || inSafe(victim)) continue;
    for (const witness of mobs) {
      if (!witness || witness.id === victim.id || witness.b || inSafe(witness)) continue;
      const vw = dist(victim, witness);
      if (vw < 14 || vw > 28) continue;
      const ux = (victim.x - witness.x) / vw;
      const uz = (victim.z - witness.z) / vw;
      const player = { x: victim.x + ux * 17.5, z: victim.z + uz * 17.5 };
      const pv = dist(player, victim);
      const pw = dist(player, witness);
      if (pv > 19.6 || pw <= AGGRO_RANGE + 2 || pw > 47) continue;
      if (inSafe(player)) continue;
      return { victim, witness, player, pv, pw, vw };
    }
  }
  return null;
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

function client() {
  const ws = new WebSocket(wsUrl);
  const c = { ws, id: null, msgs: [], mobs: new Map() };
  ws.on('message', (buf) => {
    const m = JSON.parse(buf.toString());
    c.msgs.push(m);
    if (m.t === 'id') c.id = m.id;
    if (m.t === 'mobs') for (const mob of m.list || []) c.mobs.set(mob.id, mob);
    if (m.t === 'mpos') for (const mob of m.list || []) c.mobs.set(mob.id, { ...(c.mobs.get(mob.id) || {}), ...mob });
    if (m.t === 'mhp') {
      const prev = c.mobs.get(m.id) || {};
      c.mobs.set(m.id, { ...prev, hp: m.hp });
    }
  });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.open = new Promise((resolve) => ws.on('open', resolve));
  return c;
}

try {
  const ready = await waitForServer();
  check('temporary relay starts on isolated port', ready);
  if (!ready) throw new Error(serverOut || 'relay did not start');

  const c = client();
  await c.open;
  await wait(200);
  c.send({ t: 'hi', name: 'noise-smoke', char: 'char_knight.glb' });

  const deadline = Date.now() + 6000;
  while (!c.msgs.some((m) => m.t === 'mobs') && Date.now() < deadline) await wait(100);
  const list = [...c.mobs.values()];
  const picked = chooseNoiseCase(list);
  check('found two mobs for noise geometry', !!picked, picked ? JSON.stringify({
    victim: picked.victim.id,
    witness: picked.witness.id,
    pv: +picked.pv.toFixed(1),
    pw: +picked.pw.toFixed(1),
    vw: +picked.vw.toFixed(1),
  }) : '');
  if (!picked) throw new Error('no suitable mob pair for combat noise smoke');

  const { victim, witness, player } = picked;
  const hold = setInterval(() => c.send({ t: 's', x: player.x, z: player.z, h: 0, a: 'Idle', hp: 100, hm: 100, lv: 1 }), 80);
  if (hold.unref) hold.unref();
  c.send({ t: 's', x: player.x, z: player.z, h: 0, a: 'Idle', hp: 100, hm: 100, lv: 1 });
  await wait(450);

  const startWitness = c.mobs.get(witness.id) || witness;
  const startD = dist(player, startWitness);
  const beforeHit = c.msgs.length;
  c.send({ t: 'mhit', id: victim.id, dmg: 1, k: 'skill' });

  let sawHit = false;
  let sawWitnessMove = false;
  let bestD = startD;
  const end = Date.now() + 4200;
  while (Date.now() < end && !(sawHit && sawWitnessMove)) {
    await wait(100);
    sawHit = sawHit || c.msgs.slice(beforeHit).some((m) => m.t === 'mhp' && m.id === victim.id && m.k === 'skill');
    const w = c.mobs.get(witness.id);
    if (w) {
      const d = dist(player, w);
      bestD = Math.min(bestD, d);
      if ((w.state === 'walk' || w.state === 'attack') && d < startD - 0.55) sawWitnessMove = true;
    }
  }
  clearInterval(hold);

  check('skill hit was accepted by relay', sawHit);
  const beforeHeavy = c.msgs.length;
  c.send({ t: 'mhit', id: victim.id, dmg: 1, k: 'heavy' });
  let sawHeavy = false;
  const heavyEnd = Date.now() + 1800;
  while (Date.now() < heavyEnd && !sawHeavy) {
    await wait(80);
    sawHeavy = c.msgs.slice(beforeHeavy).some((m) => m.t === 'mhp' && m.id === victim.id && m.k === 'heavy');
  }
  check('heavy basic hit metadata is preserved by relay', sawHeavy);
  check('combat noise pulls a mob outside normal aggro', sawWitnessMove, JSON.stringify({
    witness: witness.id,
    startD: +startD.toFixed(2),
    bestD: +bestD.toFixed(2),
  }));
  try { c.ws.close(); } catch {}
} catch (err) {
  console.error('FAIL server combat noise smoke:', err.message);
  failures++;
} finally {
  try { child.kill(); } catch {}
}

if (failures) {
  console.error(serverOut);
  process.exit(1);
}
console.log('PASS: server combat noise smoke');
