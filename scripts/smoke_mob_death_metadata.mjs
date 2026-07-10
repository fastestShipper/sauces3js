import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkTo } from './lib/walk.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const require = createRequire(import.meta.url);
const WebSocket = require(path.join(root, 'server/node_modules/ws'));
let WS_URL = process.env.SMOKE_WS_URL || '';
// caminar hasta el mob toma segundos (antes se teleportaba); 7s no alcanzaba.
const TIMEOUT_MS = Number(process.env.SMOKE_MOB_DEATH_TIMEOUT_MS || 30000);
const { SAFE_X, SAFE_Z } = require(path.join(root, 'server/mob_balance.js'));
let serverChild = null;

function fail(message) {
  console.error('FAIL:', message);
  throw new Error(message);
}

function send(ws, obj) {
  ws.send(JSON.stringify(obj));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}

function waitForPort(port, timeoutMs = 7000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error(`server did not listen on ${port}`));
        else setTimeout(tick, 120);
      });
    };
    tick();
  });
}

async function ensureServer() {
  if (WS_URL) return;
  const port = await freePort();
  const healthPort = await freePort();
  WS_URL = `ws://127.0.0.1:${port}`;
  serverChild = spawn(process.execPath, ['server.js'], {
    cwd: path.join(root, 'server'),
    env: {
      ...process.env,
      SAUCES_PORT: String(port),
      SAUCES_HEALTH_PORT: String(healthPort),
      WAVE_EVERY_MS: '3600000',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  serverChild.stderr.on('data', (chunk) => { stderr += String(chunk); });
  serverChild.once('exit', (code) => {
    if (code && !settlingDown) console.error('local smoke server exited', code, stderr.slice(-600));
  });
  await waitForPort(port);
}

let settlingDown = false;

function runDeathCase(kind) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let myId = null;
    let target = null;
    let phase = 'wait-mobs';
    const ws = new WebSocket(WS_URL);
    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      if (err) reject(err);
      else resolve();
    };
    const timer = setTimeout(() => {
      finish(new Error(`timed out in phase ${phase} for ${kind}`));
    }, TIMEOUT_MS);

    ws.on('open', () => {
      console.log(`PASS: WS connected for ${kind} mob death metadata smoke`);
    });

    ws.on('message', (buf) => {
      let msg;
      try { msg = JSON.parse(String(buf)); } catch { finish(new Error('message is not JSON')); return; }
      try {
        if (msg.t === 'id') {
          myId = msg.id;
          send(ws, { t: 'hi', name: `DeathSmoke-${kind}`, char: 'char_knight.glb' });
          return;
        }
        if (msg.t === 'mobs' && phase === 'wait-mobs') {
          // mob matable mas cercano al spawn: hay que CAMINAR hasta el
          const start = { x: SAFE_X, z: SAFE_Z };
          target = (msg.list || [])
            .filter((m) => m.hp > 5 && !m.b)
            .map((m) => ({ m, d: Math.hypot(m.x - start.x, m.z - start.z) }))
            .sort((a, b) => a.d - b.d)
            .map((e) => e.m)[0];
          if (!target) fail('no killable mob found');
          phase = 'wait-death';
          const dx = target.x - start.x, dz = target.z - start.z;
          const dd = Math.hypot(dx, dz) || 1;
          const stop = { x: target.x - (dx / dd) * 10, z: target.z - (dz / dd) * 10 };
          walkTo({ send: (o) => send(ws, o) }, start, stop)
            .then(() => { send(ws, { t: 'mhit', id: target.id, dmg: target.hp + 9, k: kind }); })
            .catch((e) => finish(e));
          return;
        }
        if (msg.t !== 'mdead' || !target || msg.id !== target.id) return;
        if (msg.by !== myId) fail(`wrong killer id: ${msg.by}`);
        if (msg.k !== kind) fail(`wrong death kind for ${kind}: ${msg.k}`);
        if (msg.dmg !== target.hp + 9) fail(`wrong death dmg: ${msg.dmg}`);
        if (!Number.isFinite(msg.sx) || !Number.isFinite(msg.sz)) fail('missing death source position');
        if (!Number.isFinite(msg.x) || !Number.isFinite(msg.z)) fail('missing mob death position');
        if (msg.hpMax !== target.hpMax) fail(`wrong death hpMax: ${msg.hpMax}`);
        if (msg.hpBefore !== target.hp) fail(`wrong death hpBefore: ${msg.hpBefore}`);
        if (msg.lvl !== target.lvl) fail(`wrong death level: ${msg.lvl}`);
        if (!Array.isArray(msg.party)) fail('death party is not an array');
        console.log('PASS: death metadata received', {
          id: msg.id,
          dmg: msg.dmg,
          kind: msg.k,
          x: +msg.x.toFixed(2),
          z: +msg.z.toFixed(2),
        });
        finish();
      } catch (err) {
        finish(err);
      }
    });

    ws.on('error', (err) => {
      finish(new Error(`WS error: ${err.message}`));
    });

    ws.on('close', () => {
      if (!settled) finish(new Error(`WS closed before ${kind} mob death metadata smoke finished`));
    });
  });
}

try {
  await ensureServer();
  for (const kind of ['skill', 'heavy']) {
    await runDeathCase(kind);
  }
} finally {
  if (serverChild) {
    settlingDown = true;
    serverChild.kill();
  }
}

console.log('PASS: mob death metadata smoke');
