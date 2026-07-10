import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const require = createRequire(import.meta.url);
const WebSocket = require(path.join(root, 'server/node_modules/ws'));

const relayPort = Number(process.env.SMOKE_ATTACK_KIND_PORT || 8566);
const healthPort = relayPort + 1;
const wsUrl = `ws://127.0.0.1:${relayPort}`;
let failures = 0;

function check(name, ok) {
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name);
  if (!ok) failures++;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function client(name) {
  const ws = new WebSocket(wsUrl);
  const c = { ws, name, id: null, msgs: [] };
  ws.on('message', (buf) => {
    const m = JSON.parse(buf.toString());
    c.msgs.push(m);
    if (m.t === 'id') c.id = m.id;
  });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.got = (t) => c.msgs.filter((m) => m.t === t);
  c.open = new Promise((resolve) => ws.on('open', resolve));
  return c;
}

try {
  const ready = await waitForServer();
  check('temporary relay starts on isolated port', ready);
  if (!ready) throw new Error(serverOut || 'relay did not start');

  const A = client('skill-a');
  const B = client('skill-b');
  await Promise.all([A.open, B.open]);
  await wait(200);
  A.send({ t: 'hi', name: 'skill-a', char: 'char_knight.glb' });
  B.send({ t: 'hi', name: 'skill-b', char: 'char_mage.glb' });
  await wait(350);
  const before = B.got('atk').length;
  A.send({ t: 'atk', k: 'meteor', tt: 'mob', tid: 88, tx: 4.5, tz: -2.25, am: 1.9 });
  await wait(250);
  const skillAtk = B.got('atk').slice(before).find((m) => m.id === A.id);
  check('server rebroadcasts atk animation kind and target cue',
    !!skillAtk && skillAtk.k === 'meteor' && skillAtk.tt === 'mob' && skillAtk.tid === '88' && skillAtk.tx === 4.5 && skillAtk.tz === -2.25);
  check('server clamps and rebroadcasts attack animation speed',
    !!skillAtk && skillAtk.am === 1.5);

  const beforeBasic = B.got('atk').length;
  A.send({ t: 'atk' });
  await wait(250);
  const basicAtk = B.got('atk').slice(beforeBasic).find((m) => m.id === A.id);
  check('server preserves basic atk fallback without kind', !!basicAtk && !('k' in basicAtk));

  const beforeDash = B.got('s').length;
  A.send({ t: 's', x: 1, z: 2, h: 0, a: 'Dash', hp: 100, hm: 100, lv: 1, dk: 'Left' });
  await wait(250);
  const dashState = B.got('s').slice(beforeDash).find((m) => m.id === A.id);
  check('server rebroadcasts valid dodge direction on Dash',
    !!dashState && dashState.a === 'Dash' && dashState.dk === 'Left');

  const beforeInvalidDash = B.got('s').length;
  A.send({ t: 's', x: 2, z: 3, h: 0, a: 'Dash', hp: 100, hm: 100, lv: 1, dk: '../Left' });
  await wait(250);
  const invalidDashState = B.got('s').slice(beforeInvalidDash).find((m) => m.id === A.id);
  check('server strips invalid dodge direction',
    !!invalidDashState && invalidDashState.a === 'Dash' && !('dk' in invalidDashState));

  A.ws.close();
  B.ws.close();
} catch (err) {
  console.error('FAIL server attack kind smoke:', err.message);
  failures++;
} finally {
  try { child.kill(); } catch {}
}

if (failures) {
  console.error(serverOut);
  process.exit(1);
}
console.log('PASS: server attack animation kind smoke');
