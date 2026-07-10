// Resetea personajes a nivel 1. DESTRUCTIVO: borra progreso, oro e inventario.
//
// Salvaguardas (antes no habia ninguna):
//   * Por defecto hace DRY-RUN. Sin `--confirm` no escribe nada.
//   * Aborta si el relay esta VIVO. El server tiene el store en memoria y hace
//     flush cada 2s: resetear en caliente hace que el server pise el archivo con
//     su copia vieja, deshaciendo el reset en silencio.
//   * `--only a,b` limita el reseteo a esas cuentas.
//
// Uso:
//   node scripts/reset_accounts_level1.mjs                      (dry-run, seguro)
//   node scripts/reset_accounts_level1.mjs --confirm            (resetea TODO)
//   node scripts/reset_accounts_level1.mjs --confirm --only zpw
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));

const CONFIRM = flags.has('--confirm');
const FORCE = flags.has('--force');   // saltea el chequeo de relay vivo, bajo tu riesgo
const onlyArg = args.find((a) => a.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean)) : null;

const storePath = positional[0] || process.env.SAUCES_STORE_PATH || path.join(process.cwd(), 'server', 'accounts.json');
const healthPort = Number(process.env.SAUCES_HEALTH_PORT) || 8457;

if (!existsSync(storePath)) {
  console.error(`RESET_FAIL store not found: ${storePath}`);
  process.exit(1);
}

// GUARD DE RACE: si el relay corre, su flush con debounce pisa lo que escribamos.
async function relayAlive() {
  try {
    const res = await fetch(`http://127.0.0.1:${healthPort}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

if (!FORCE && await relayAlive()) {
  console.error(`RESET_FAIL el relay esta VIVO en 127.0.0.1:${healthPort}.`);
  console.error('  El server tiene el store en memoria y hace flush cada 2s: resetear');
  console.error('  ahora hace que el server pise el archivo y el reset se pierda.');
  console.error('  Detenlo primero:  systemctl stop sauces-mp');
  console.error('  (o pasa --force si sabes exactamente lo que haces)');
  process.exit(1);
}

let store;
try {
  store = JSON.parse(readFileSync(storePath, 'utf8'));
} catch (err) {
  console.error(`RESET_FAIL invalid JSON: ${err.message}`);
  process.exit(1);
}

if (!store || typeof store !== 'object' || !store.accounts || typeof store.accounts !== 'object' || Array.isArray(store.accounts)) {
  console.error('RESET_FAIL accounts store shape is invalid');
  process.exit(1);
}

const targets = [];
for (const [user, acc] of Object.entries(store.accounts)) {
  if (!acc || typeof acc !== 'object' || !acc.char || typeof acc.char !== 'object') continue;
  if (only && !only.has(user)) continue;
  targets.push({ user, level: acc.char.level, gold: acc.char.gold, items: (acc.char.inv || []).length });
}

if (only) {
  for (const user of only) {
    if (!store.accounts[user]) console.warn(`RESET_WARN cuenta inexistente en --only: ${user}`);
  }
}

if (!CONFIRM) {
  console.log(`DRY-RUN. Se resetearian ${targets.length} cuenta(s) en ${storePath}:`);
  for (const t of targets) console.log(`  ${t.user}  lv${t.level}  ${t.gold} oro  ${t.items} items`);
  console.log('\nNo se escribio nada. Agrega --confirm para ejecutar de verdad.');
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = `${storePath}.bak-${stamp}`;
copyFileSync(storePath, backupPath);

let resetCount = 0;
for (const [user, acc] of Object.entries(store.accounts)) {
  if (!acc || typeof acc !== 'object' || !acc.char || typeof acc.char !== 'object') continue;
  if (only && !only.has(user)) continue;
  acc.char.level = 1;
  acc.char.xp = 0;
  acc.char.hpMax = 100;
  acc.char.gold = 0;
  acc.char.inv = [];
  acc.char.equipId = null;
  resetCount++;
}

const tmpPath = `${storePath}.tmp-${process.pid}`;
writeFileSync(tmpPath, JSON.stringify(store, null, 2));
renameSync(tmpPath, storePath);

console.log(`RESET_OK accounts=${resetCount} backup=${backupPath}`);
