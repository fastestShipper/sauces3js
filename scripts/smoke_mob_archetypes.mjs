// Smoke: los enemigos son CUATRO arquetipos distintos, no un zombie repintado.
//
// Antes el rig salia del NIVEL (`kind = lvl - 1`), asi que el esqueleto Mago
// parecia hechicero y peleaba igual que un caminante. Aspecto, stats y conducta
// estaban fundidos en el nivel.
//
// Ahora el nivel escala SOLO los stats; el arquetipo decide rig y conducta.
import { WebSocket } from '../server/node_modules/ws/wrapper.mjs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkTo, wait } from './lib/walk.mjs';

const require = createRequire(import.meta.url);
const mb = require('../server/mob_balance.js');
const { SAFE_X, SAFE_Z } = mb;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const relayPort = Number(process.env.SMOKE_ARCH_PORT || 8602);
const healthPort = relayPort + 1;

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' ' + detail : ''));
  if (!ok) failures++;
};

// --- 1. Puro: los 4 arquetipos existen y son distintos de verdad ---
{
  const names = mb.MOB_ARCHETYPE_ORDER;
  check('hay 4 arquetipos', names.length === 4, names.join(','));

  const p = names.map((n) => mb.archetypeProfile(n));
  check('cada arquetipo usa un rig distinto', new Set(p.map((x) => x.rig)).size === 4,
    p.map((x) => x.rig).join(','));

  const caminante = mb.archetypeProfile('caminante');
  const rastrera = mb.archetypeProfile('rastrera');
  const saqueador = mb.archetypeProfile('saqueador');
  const cultista = mb.archetypeProfile('cultista');

  check('la rastrera es MAS rapida y MAS fragil que el caminante',
    rastrera.speed > caminante.speed && rastrera.hp < caminante.hp,
    `spd ${rastrera.speed}>${caminante.speed}, hp ${rastrera.hp}<${caminante.hp}`);
  check('el saqueador aguanta mas y telegrafia MAS largo',
    saqueador.hp > caminante.hp && saqueador.windupMs > caminante.windupMs,
    `hp ${saqueador.hp}, windup ${saqueador.windupMs}ms`);
  check('la rastrera casi no telegrafia (castiga estar quieto)',
    rastrera.windupMs < caminante.windupMs, `${rastrera.windupMs}ms`);
  check('el cultista ataca A DISTANCIA', cultista.attackRange > 6,
    `${cultista.attackRange}m vs ${caminante.attackRange}m del caminante`);
  check('solo el cultista guarda distancia', !!cultista.keepDist && !caminante.keepDist);
}

// --- 2. El arquetipo NO depende del nivel (esa era la confusion) ---
{
  const byId = new Map();
  for (let id = 0; id < 400; id++) byId.set(id, mb.mobArchetype(id, false));
  const counts = {};
  for (const a of byId.values()) counts[a] = (counts[a] || 0) + 1;
  check('los 4 arquetipos aparecen en la poblacion', Object.keys(counts).length === 4,
    JSON.stringify(counts));
  check('la horda es MAYORIA caminantes', counts.caminante > counts.rastrera,
    `${counts.caminante} caminantes vs ${counts.rastrera} rastreras`);
  check('el cultista es raro (uno solo ya cambia la pelea)',
    counts.cultista < counts.caminante / 2, `${counts.cultista} cultistas de 400`);

  // determinista: el respawn no cambia de rig a mitad de pelea
  check('el arquetipo es determinista por id',
    [...byId].every(([id, a]) => mb.mobArchetype(id, false) === a));
  check('los bosses son saqueadores', mb.mobArchetype(123, true) === 'saqueador');
}

// --- 3. El nivel escala stats, el arquetipo escala conducta ---
{
  const hp1 = mb.mobHpMax({ id: 1, lvl: 1, zone: '' }, 'caminante');
  const hp5 = mb.mobHpMax({ id: 1, lvl: 5, zone: '' }, 'caminante');
  check('subir de nivel sube la vida', hp5 > hp1, `${hp1} -> ${hp5}`);

  const tank = mb.mobHpMax({ id: 1, lvl: 3, zone: '' }, 'saqueador');
  const fast = mb.mobHpMax({ id: 1, lvl: 3, zone: '' }, 'rastrera');
  check('al MISMO nivel, el saqueador aguanta mas que la rastrera', tank > fast, `${tank} vs ${fast}`);
}

// --- 4. E2E: el arquetipo viaja al cliente y el cultista KITEA ---
const storePath = path.join(os.tmpdir(), `sauces-arch-${process.pid}.json`);
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
const cleanup = () => {
  try { child.kill(); } catch {}
  try { fs.rmSync(storePath, { force: true }); } catch {}
};
async function up() {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${healthPort}/health`)).ok) return true; } catch {}
    await wait(200);
  }
  return false;
}
if (!await up()) { console.error('relay no inicio'); cleanup(); process.exit(1); }

const ws = new WebSocket(`ws://127.0.0.1:${relayPort}`);
const msgs = [];
ws.on('message', (b) => msgs.push(JSON.parse(b.toString())));
const send = (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
await new Promise((r) => ws.on('open', r));
send({ t: 'hi', name: 'ArchSmoke', char: 'char_knight.glb' });
await wait(700);

const list = msgs.filter((m) => m.t === 'mobs').at(-1)?.list || [];
check('el snapshot trae mobs', list.length > 0, `${list.length}`);
check('cada mob trae su arquetipo `a`', list.every((m) => Number.isInteger(m.a)));
const seen = new Set(list.map((m) => m.a));
check('en el mundo conviven varios arquetipos', seen.size >= 3, `indices vistos: ${[...seen].sort()}`);

// el arquetipo NO se correlaciona con el nivel
const byLevel = new Map();
for (const m of list) {
  if (!byLevel.has(m.lvl)) byLevel.set(m.lvl, new Set());
  byLevel.get(m.lvl).add(m.a);
}
const mixed = [...byLevel.values()].some((s) => s.size > 1);
check('un mismo nivel tiene arquetipos distintos (antes: 1 nivel = 1 rig)', mixed);

// --- el cultista retrocede cuando le cierras la distancia ---
{
  const cultIdx = mb.MOB_ARCHETYPE_ORDER.indexOf('cultista');
  const start = { x: SAFE_X, z: SAFE_Z };
  const cults = list.filter((m) => m.a === cultIdx && m.hp > 0)
    .map((m) => ({ m, d: Math.hypot(m.x - start.x, m.z - start.z) }))
    .sort((a, b) => a.d - b.d);
  if (!cults.length) {
    check('hay un cultista para probar el kiting', false);
  } else {
    const cult = cults[0].m;
    const dx = cult.x - start.x, dz = cult.z - start.z;
    const dd = Math.hypot(dx, dz) || 1;
    // caminamos hasta 3m: bien dentro de su keepDist (6m)
    await walkTo(ws && { send }, start, { x: cult.x - (dx / dd) * 3, z: cult.z - (dz / dd) * 3 });

    const posOf = (id) => {
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m.t !== 'mpos') continue;
        const hit = (m.list || []).find((x) => x.id === id);
        if (hit) return hit;
      }
      return null;
    };
    const before = posOf(cult.id) || cult;
    const dBefore = Math.hypot(before.x - (cult.x - (dx / dd) * 3), before.z - (cult.z - (dz / dd) * 3));
    await wait(1800);
    const after = posOf(cult.id);
    if (!after) {
      check('el cultista sigue vivo y reportando posicion', false);
    } else {
      const moved = Math.hypot(after.x - before.x, after.z - before.z);
      check('el cultista SE MUEVE al acercarte (no se queda a que le pegues)', moved > 0.4,
        `se desplazo ${moved.toFixed(2)}m`);
      check('el server broadcastea su retroceso (no kitea invisible)', moved > 0.4);
    }
  }
}

ws.close();
cleanup();
console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
