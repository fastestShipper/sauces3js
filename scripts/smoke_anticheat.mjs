// Smoke ANTI-CHEAT: los agujeros que encontro la revision, cerrados y probados.
//
//  1. `mhit` con dmg absurdo se acota al techo del nivel (antes: one-shot a bosses).
//  2. `save` con nivel 200 / oro 1e9 / arma atk 100000 se acota (antes: god mode).
//  3. `hi` repetido se ignora (antes: amplificacion O(N) + teleport gratis).
//  4. Aparecer en la gruta sin permiso del server se clampea (antes: recall libre).
import { WebSocket } from '../server/node_modules/ws/wrapper.mjs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkTo, wait } from './lib/walk.mjs';

const require = createRequire(import.meta.url);
const { maxPlayerHit, MAX_WEAPON_ATK, MAX_PLAYER_LEVEL } = require('../server/combat_limits.js');
const { SAFE_X, SAFE_Z } = require('../server/mob_balance.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const relayPort = Number(process.env.SMOKE_AC_PORT || 8590);
const healthPort = relayPort + 1;
const URL = `ws://127.0.0.1:${relayPort}`;

let failures = 0;
function check(name, ok, detail = '') {
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' ' + detail : ''));
  if (!ok) failures++;
}

function client(name) {
  const ws = new WebSocket(URL);
  const c = { ws, name, id: null, msgs: [] };
  ws.on('message', (buf) => {
    const m = JSON.parse(buf.toString());
    c.msgs.push(m);
    if (m.t === 'id') c.id = m.id;
  });
  c.send = (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
  c.got = (t) => c.msgs.filter((m) => m.t === t);
  c.open = new Promise((r) => ws.on('open', r));
  return c;
}

// store DESECHABLE: este smoke escribe cuentas, jamas debe tocar accounts.json
const storePath = path.join(os.tmpdir(), `sauces-ac-${process.pid}-${Date.now()}.json`);

const child = spawn(process.execPath, ['server.js'], {
  cwd: path.join(root, 'server'),
  env: {
    ...process.env,
    SAUCES_PORT: String(relayPort),
    SAUCES_HEALTH_PORT: String(healthPort),
    SAUCES_STORE_PATH: storePath,
    WAVE_EVERY_MS: '600000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOut = '';
child.stdout.on('data', (b) => { serverOut += b.toString(); });
child.stderr.on('data', (b) => { serverOut += b.toString(); });

function cleanup() {
  try { child.kill(); } catch {}
  try { fs.rmSync(storePath, { force: true }); } catch {}
  try { fs.rmSync(storePath + '.tmp', { force: true }); } catch {}
}

async function waitForServer() {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${healthPort}/health`)).ok) return true; } catch {}
    await wait(200);
  }
  return false;
}
if (!await waitForServer()) {
  console.error(serverOut || 'relay temporal no inicio');
  cleanup();
  process.exit(1);
}

const suffix = Date.now().toString(36).slice(-6) + String(process.pid % 10000);
const user = 'ac' + suffix;
const A = client(user);
await A.open;
A.send({ t: 'register', user, pass: 'clave123' });
await wait(400);
A.send({ t: 'hi', name: user, char: 'char_knight.glb' });
await wait(500);

// --- 3. `hi` repetido se ignora ---
{
  const before = A.got('roster').length;
  A.send({ t: 'hi', name: user, char: 'char_knight.glb' });
  await wait(400);
  check('hi repetido no reenvia roster (sin amplificacion)',
    A.got('roster').length === before, `rosters=${A.got('roster').length}`);
}

// --- 1. mhit con dmg absurdo se acota al techo del nivel ---
{
  const mobsMsg = A.got('mobs').at(-1);
  if (!mobsMsg || !Array.isArray(mobsMsg.list) || !mobsMsg.list.length) {
    check('hay mobs para probar mhit', false);
  } else {
    const start = { x: SAFE_X, z: SAFE_Z };
    const target = mobsMsg.list
      .map((m) => ({ m, d: Math.hypot(m.x - start.x, m.z - start.z) }))
      .sort((a, b) => a.d - b.d)[0].m;

    // caminar LEGITIMAMENTE hasta ~12m del mob (el gate de mhit es 20m)
    const dx = target.x - start.x, dz = target.z - start.z;
    const dd = Math.hypot(dx, dz) || 1;
    await walkTo(A, start, { x: target.x - (dx / dd) * 12, z: target.z - (dz / dd) * 12 });

    A.send({ t: 'mhit', id: target.id, dmg: 3000, k: 'basic' });
    await wait(400);
    const hit = A.got('mhp').concat(A.got('mdead')).find((m) => m.id === target.id);
    if (!hit) {
      check('el mhit llego al mob (camine de verdad)', false, '(sin mhp/mdead)');
    } else {
      // cuenta nueva => nivel persistido 1 => techo de nivel 1
      const cap = maxPlayerHit(1 + 2, 'basic');   // +2 tolerancia del guard de save
      check('mhit dmg=3000 se acota al techo del nivel',
        hit.dmg <= cap, `aplicado=${hit.dmg} techo=${cap} (antes 3000)`);
      check('el dano acotado NO one-shotea un boss', hit.dmg < 440,
        `aplicado=${hit.dmg} hp_boss=440`);
    }
  }
}

// --- 2. save con god-mode se acota ---
{
  A.send({
    t: 'save',
    char: {
      charFile: 'char_knight.glb', className: 'Verdugo',
      level: 200, xp: 1e9, gold: 1e9, hpMax: 100000,
      inv: [{ id: 'w1', name: 'Excalibur', kind: 'gear', tier: 'legendary', atk: 100000 }],
      equipId: 'w1',
    },
  });
  await wait(2800);   // el store hace flush con debounce de 2s
  const accounts = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  const saved = accounts.accounts?.[user]?.char;
  if (!saved) {
    check('el save se persistio', false);
  } else {
    check('nivel 200 acotado por el guard de progresion',
      saved.level <= 1 + 2, `level=${saved.level} (pidio 200)`);
    check('oro 1e9 acotado por el guard de progresion',
      saved.gold <= 50000, `gold=${saved.gold} (pidio 1e9)`);
    check('arma atk=100000 acotada',
      saved.inv[0].atk <= MAX_WEAPON_ATK, `atk=${saved.inv[0].atk} (pidio 100000)`);
    check('nivel nunca supera el maximo del juego', saved.level <= MAX_PLAYER_LEVEL);

    // 2b. spam de saves: el cap por save no sirve si puedes guardar 100 veces/s
    const goldBefore = saved.gold;
    for (let i = 0; i < 12; i++) {
      A.send({
        t: 'save',
        char: { charFile: 'char_knight.glb', level: 3, xp: 0, gold: 1e9, hpMax: 100, inv: [], equipId: '' },
      });
    }
    await wait(2800);
    const after = JSON.parse(fs.readFileSync(storePath, 'utf8')).accounts?.[user]?.char;
    check('spam de saves no acumula oro (rate limit)',
      after.gold <= goldBefore, `antes=${goldBefore} despues=${after.gold}`);
  }
}

// --- 4. aparecer en la gruta sin permiso se clampea ---
{
  const B = client('tp' + suffix);
  await B.open;
  B.send({ t: 'hi', name: 'tp' + suffix, char: 'char_knight.glb' });
  await wait(400);
  // alejarse caminando de la gruta
  const away = { x: SAFE_X + 120, z: SAFE_Z + 40 };
  await walkTo(B, { x: SAFE_X, z: SAFE_Z }, away);
  const corrsBefore = B.got('corr').length;
  // recall instantaneo SIN mandar `recall`: el cliente tramposo salta a la gruta
  B.send({ t: 's', x: SAFE_X, z: SAFE_Z, h: 0, a: 'Idle', hp: 100, hm: 100, lv: 1 });
  await wait(400);
  const corrected = B.got('corr').length > corrsBefore;
  check('teleport a la gruta sin permiso del server se corrige', corrected,
    corrected ? '' : '(el server lo acepto!)');
  B.ws.close();
}

A.ws.close();
cleanup();
console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
