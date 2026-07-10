// Smoke E2E del endurecimiento de auth, contra un relay de verdad.
//
//  1. Rate limit: la fuerza bruta se corta.
//  2. scrypt fuera del bucle de eventos: los logins no congelan el mundo.
//  3. Tokens con expiracion y revocacion.
//  4. Login con Google (Privy) verificado de punta a punta.
//  5. Claim de migracion: cuenta vieja -> Google, y la contrasena deja de servir.
import { WebSocket } from '../server/node_modules/ws/wrapper.mjs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as jose from '../server/node_modules/jose/dist/webapi/index.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const relayPort = Number(process.env.SMOKE_AUTH_PORT || 8598);
const healthPort = relayPort + 1;
const APP_ID = 'cmsmoketestapp0000000000';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' ' + detail : ''));
  if (!ok) failures++;
};

// clave ES256 de mentira que hace de "Privy" para este test
const { publicKey, privateKey } = await jose.generateKeyPair('ES256', { extractable: true });
const spki = await jose.exportSPKI(publicKey);
const mintToken = (did) => new jose.SignJWT({ sub: did })
  .setProtectedHeader({ alg: 'ES256' })
  .setIssuer('privy.io')
  .setAudience(APP_ID)
  .setIssuedAt()
  .setExpirationTime('1h')
  .sign(privateKey);

const storePath = path.join(os.tmpdir(), `sauces-auth-${process.pid}.json`);
const child = spawn(process.execPath, ['server.js'], {
  cwd: path.join(root, 'server'),
  env: {
    ...process.env,
    SAUCES_PORT: String(relayPort),
    SAUCES_HEALTH_PORT: String(healthPort),
    SAUCES_STORE_PATH: storePath,
    WAVE_EVERY_MS: '600000',
    PRIVY_APP_ID: APP_ID,
    PRIVY_VERIFICATION_KEY: spki,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (b) => { out += b; });
child.stderr.on('data', (b) => { out += b; });
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
if (!await up()) { console.error(out); cleanup(); process.exit(1); }

function client() {
  const ws = new WebSocket(`ws://127.0.0.1:${relayPort}`);
  const c = { ws, msgs: [] };
  ws.on('message', (b) => c.msgs.push(JSON.parse(b.toString())));
  c.send = (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
  c.got = (t) => c.msgs.filter((m) => m.t === t);
  c.open = new Promise((r) => ws.on('open', r));
  return c;
}

const sfx = Date.now().toString(36).slice(-5);

// --- 4. login con Google, cuenta nueva ---
{
  const c = client(); await c.open;
  const tok = await mintToken('did:privy:newguy');
  c.send({ t: 'privy', token: tok });          // sin nombre -> pide uno
  await wait(500);
  const a1 = c.got('auth').at(-1);
  check('DID nuevo sin nombre pide un nombre', a1?.ok === false && a1?.needsUsername === true);

  c.send({ t: 'privy', token: tok, user: 'goog' + sfx });
  await wait(600);
  const a2 = c.got('auth').at(-1);
  check('login con Google crea la cuenta', a2?.ok === true, a2?.error || '');
  check('devuelve token de sesion', typeof a2?.token === 'string' && a2.token.length > 20);

  // el mismo DID vuelve a entrar sin nombre
  const c2 = client(); await c2.open;
  c2.send({ t: 'privy', token: await mintToken('did:privy:newguy') });
  await wait(600);
  const a3 = c2.got('auth').at(-1);
  check('el mismo Google vuelve a su cuenta', a3?.ok === true && a3?.user === 'goog' + sfx, a3?.user || '');
  c.ws.close(); c2.ws.close();
}

// --- token falso rechazado por el relay ---
{
  const evil = await jose.generateKeyPair('ES256', { extractable: true });
  const bad = await new jose.SignJWT({ sub: 'did:privy:evil' })
    .setProtectedHeader({ alg: 'ES256' }).setIssuer('privy.io').setAudience(APP_ID)
    .setIssuedAt().setExpirationTime('1h').sign(evil.privateKey);
  const c = client(); await c.open;
  c.send({ t: 'privy', token: bad, user: 'evil' + sfx });
  await wait(500);
  const a = c.got('auth').at(-1);
  check('token firmado por un impostor RECHAZADO', a?.ok === false, a?.error || '');
  c.ws.close();
}

// --- 5. claim de migracion ---
{
  const user = 'old' + sfx;
  const c = client(); await c.open;
  c.send({ t: 'register', user, pass: 'clave123' });
  await wait(700);
  check('cuenta vieja de contrasena creada', c.got('auth').at(-1)?.ok === true);

  c.send({ t: 'privylink', token: await mintToken('did:privy:oldguy') });
  await wait(700);
  check('claim ata el Google a la cuenta vieja', c.got('link').at(-1)?.ok === true,
    c.got('link').at(-1)?.error || '');
  c.ws.close();

  // la contrasena ya NO sirve
  const c2 = client(); await c2.open;
  c2.send({ t: 'login', user, pass: 'clave123' });
  await wait(700);
  check('tras el claim la contrasena deja de servir', c2.got('auth').at(-1)?.ok === false);
  c2.ws.close();

  // pero el Google entra a la MISMA cuenta, con su personaje
  const c3 = client(); await c3.open;
  c3.send({ t: 'privy', token: await mintToken('did:privy:oldguy') });
  await wait(700);
  const a = c3.got('auth').at(-1);
  check('el Google entra a la cuenta vieja (no pierde el personaje)',
    a?.ok === true && a?.user === user, a?.user || a?.error || '');
  c3.ws.close();
}

// --- 1. rate limit de fuerza bruta ---
{
  const c = client(); await c.open;
  for (let i = 0; i < 12; i++) c.send({ t: 'login', user: 'nadie', pass: 'x' + i });
  await wait(1500);
  const denied = c.got('auth').filter((a) => /Demasiados/i.test(a.error || ''));
  check('la fuerza bruta se corta con rate limit', denied.length > 0,
    `${denied.length} intentos bloqueados de 12`);
  c.ws.close();
}

// --- 2. el relay sigue vivo y respondiendo tras el chaparron de scrypt ---
{
  const t0 = Date.now();
  const res = await fetch(`http://127.0.0.1:${healthPort}/health`);
  const dt = Date.now() - t0;
  check('el relay sigue respondiendo tras los logins', res.ok && dt < 1500, `${dt}ms`);
}

// --- 3. un token de sesion inventado no autentica en `hi` ---
{
  const c = client(); await c.open;
  c.send({ t: 'hi', name: 'ghost', char: 'char_knight.glb', token: 'f'.repeat(48) });
  await wait(500);
  c.send({ t: 'save', char: { charFile: 'char_knight.glb', level: 9, xp: 0, gold: 0, hpMax: 100, inv: [], equipId: '' } });
  await wait(2600);
  const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  const leaked = Object.values(raw.accounts || {}).some((a) => a.char && a.char.level === 9);
  check('un token inventado no puede guardar en ninguna cuenta', !leaked);
  c.ws.close();
}

cleanup();
console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
