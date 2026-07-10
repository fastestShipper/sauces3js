import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const storePath = process.argv[2] || path.join(process.cwd(), 'server', 'accounts.json');
if (!existsSync(storePath)) {
  console.error(`RESET_FAIL store not found: ${storePath}`);
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

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = `${storePath}.bak-${stamp}`;
copyFileSync(storePath, backupPath);

let resetCount = 0;
for (const acc of Object.values(store.accounts)) {
  if (!acc || typeof acc !== 'object' || !acc.char || typeof acc.char !== 'object') continue;
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
