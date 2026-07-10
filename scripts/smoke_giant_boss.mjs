// Smoke: El Gigante del Parque llega al cliente COMO gigante.
//
// Precedente: `loadMobSpawns` descartaba `s.boss` y el guardian nacia como zombie
// normal (hp 110 en vez de 440) durante semanas, en silencio. El flag `giant`
// recorre el mismo camino fragil: spawns.json -> loadMobSpawns -> makeMob ->
// mobView -> cliente. Este test lo recorre entero contra un relay real.
import { WebSocket } from '../server/node_modules/ws/wrapper.mjs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const relayPort = Number(process.env.SMOKE_GIANT_PORT || 8594);
const healthPort = relayPort + 1;

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' ' + detail : ''));
  if (!ok) failures++;
};

// 1. el spawn existe y esta marcado
const spawns = require('../server/mob_spawns.json');
const giantSpawns = spawns.spawns.filter((s) => s.giant);
check('hay exactamente un spawn de gigante', giantSpawns.length === 1, JSON.stringify(giantSpawns[0] || null));
check('el gigante tambien es boss', !!giantSpawns[0]?.boss);

// 2. el asset existe y es un GLB valido con el rig esperado
{
  const p = path.join(root, 'assets', 'models', 'boss_giant.glb');
  const b = fs.readFileSync(p);
  check('boss_giant.glb existe y es glTF', b.slice(0, 4).toString() === 'glTF', `${(b.length / 1024).toFixed(0)}KB`);
  const jlen = b.readUInt32LE(12);
  const j = JSON.parse(b.slice(20, 20 + jlen).toString('utf8'));
  check('el gigante tiene un skin con 23 huesos', j.skins?.[0]?.joints?.length === 23);

  // los nombres de hueso deben coincidir con los del rig de esqueletos, o el
  // mixer no liga nada y el gigante se queda en T-pose.
  const gb = new Set(j.skins[0].joints.map((i) => j.nodes[i].name));
  const sb = fs.readFileSync(path.join(root, 'assets', 'models', 'kaykit_skeletons.glb'));
  const sj = JSON.parse(sb.slice(20, 20 + sb.readUInt32LE(12)).toString('utf8'));
  const chop = sj.animations.find((a) => a.name === '2H_Melee_Attack_Chop');
  check('el pack trae el clip 2H_Melee_Attack_Chop', !!chop);
  const animated = new Set(chop.channels.map((c) => sj.nodes[c.target.node].name));
  const unmatched = [...gb].filter((b2) => !animated.has(b2));
  check('todos los huesos del gigante los anima el clip', unmatched.length === 0, unmatched.join(',') || '');
}

// 3. el flag sobrevive el viaje hasta el cliente
const storePath = path.join(os.tmpdir(), `sauces-giant-${process.pid}.json`);
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

async function waitForServer() {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${healthPort}/health`)).ok) return true; } catch {}
    await wait(200);
  }
  return false;
}
if (!await waitForServer()) { console.error('relay no inicio'); cleanup(); process.exit(1); }

const ws = new WebSocket(`ws://127.0.0.1:${relayPort}`);
const msgs = [];
ws.on('message', (b) => msgs.push(JSON.parse(b.toString())));
await new Promise((r) => ws.on('open', r));
ws.send(JSON.stringify({ t: 'hi', name: 'GiantSmoke', char: 'char_knight.glb' }));
await wait(700);

const list = msgs.filter((m) => m.t === 'mobs').at(-1)?.list || [];
const giants = list.filter((m) => m.g === 1);
check('el cliente recibe exactamente un gigante', giants.length === 1);
if (giants[0]) {
  check('el gigante llega marcado tambien como boss', giants[0].b === 1, `b=${giants[0].b}`);
  check('el gigante tiene hp de boss (no de zombie normal)', giants[0].hpMax >= 400,
    `hpMax=${giants[0].hpMax} (un zombie lvl5 normal tiene 110)`);
  check('el gigante esta en su spawn del parque', Math.hypot(giants[0].x - 8, giants[0].z + 59) < 2,
    `pos=(${giants[0].x},${giants[0].z})`);
}
// ningun mob comun debe venir marcado como gigante
check('ningun mob comun se marca como gigante', list.filter((m) => m.g === 1 && m.b !== 1).length === 0);

ws.close();
cleanup();
console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
