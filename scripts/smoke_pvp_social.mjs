// Smoke: PvP + friends con verificacion de estado server-side.
// Corre contra un server LOCAL (node server/server.js). Casos:
//  1. facc sin freq previa -> NO crea amistad (amistad forzada bloqueada)
//  2. pvpdead sin haber sido golpeado -> NO hay pvpkill (kill feed falso bloqueado)
//  3. freq -> facc legitimo -> flist mutuo
//  4. pvp legitimo -> pvph llega -> pvpdead broadcastea pvpkill
import { WebSocket } from '../server/node_modules/ws/wrapper.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const relayPort = Number(process.env.SMOKE_PVP_PORT || 8576);
const healthPort = relayPort + 1;
const URL = `ws://127.0.0.1:${relayPort}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

function check(name, ok) {
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name);
  if (!ok) failures++;
}

function client(name) {
  const ws = new WebSocket(URL);
  const c = { ws, name, id: null, msgs: [], user: null };
  ws.on('message', (buf) => {
    const m = JSON.parse(buf.toString());
    c.msgs.push(m);
    if (m.t === 'id') c.id = m.id;
  });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.got = (t) => c.msgs.filter((m) => m.t === t);
  c.open = new Promise((r) => ws.on('open', r));
  return c;
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

if (!await waitForServer()) {
  console.error(serverOut || 'FAIL relay temporal no inicio');
  process.exit(1);
}

const suffix = Date.now().toString(36).slice(-6) + String(process.pid % 10000);
const A = client('ka' + suffix);
const B = client('kb' + suffix);
await Promise.all([A.open, B.open]);

// registrar cuentas + hi (fuera de la zona segura de la gruta)
A.send({ t: 'register', user: 'ka' + suffix, pass: 'clave123' });
B.send({ t: 'register', user: 'kb' + suffix, pass: 'clave123' });
await wait(400);
A.send({ t: 'hi', name: A.name, char: 'char_knight.glb' });
B.send({ t: 'hi', name: B.name, char: 'char_mage.glb' });
await wait(300);
A.send({ t: 's', x: -4, z: 47, h: 0, a: 'Idle', hp: 100, hm: 100 });
B.send({ t: 's', x: -5, z: 47, h: 0, a: 'Idle', hp: 80, hm: 120 });
await wait(300);

// --- caso 0: HP visible entre jugadores (el estado 's' lleva hp/hm) ---
const sFromB = A.got('s').find((m) => Number.isFinite(m.hp));
check('el estado del otro jugador incluye hp/hm', !!sFromB && sFromB.hp === 80 && sFromB.hm === 120);

// --- caso 1: amistad forzada (facc sin freq) ---
B.send({ t: 'facc', from: A.id });
await wait(400);
B.send({ t: 'flist' });
await wait(300);
const flist1 = B.got('flist').at(-1);
check('facc sin solicitud NO crea amistad', flist1 && flist1.friends.length === 0);

// --- caso 2: kill feed falso (pvpdead sin haber sido golpeado) ---
const kills0 = A.got('pvpkill').length + B.got('pvpkill').length;
B.send({ t: 'pvpdead', by: A.id });
await wait(400);
check('pvpdead sin golpe previo NO broadcastea', A.got('pvpkill').length + B.got('pvpkill').length === kills0);

// --- caso 3: freq -> facc legitimo ---
A.send({ t: 'freq', to: B.id });
await wait(300);
check('freqin llega a la victima', B.got('freqin').some((m) => m.from === A.id));
B.send({ t: 'facc', from: A.id });
await wait(400);
const fA = A.got('flist').at(-1), fB = B.got('flist').at(-1);
check('amistad mutua tras solicitud real',
  !!fA && !!fB && fA.friends.some((f) => f.user === B.name) && fB.friends.some((f) => f.user === A.name));

// --- caso 4: pvp legitimo + kill feed real ---
A.send({ t: 'pvp', to: B.id, dmg: 25 });
await wait(300);
check('pvph llega a la victima', B.got('pvph').some((m) => m.from === A.id && m.dmg === 25));
check('pvpi se comparte para animacion inmediata',
  A.got('pvpi').some((m) => m.from === A.id && m.to === B.id && m.dmg === 25)
  && B.got('pvpi').some((m) => m.from === A.id && m.to === B.id && m.dmg === 25));
B.send({ t: 'pvpdead', by: A.id });
await wait(400);
check('pvpkill broadcastea tras golpe real', A.got('pvpkill').some((m) => m.victim === B.name));

A.ws.close(); B.ws.close();
try { child.kill(); } catch {}
console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
