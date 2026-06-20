// Validate server/accounts.json shape without printing secrets (salt/hash).
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.join(__dirname, '../server/accounts.json');

let ok = true;
function fail(msg) {
  console.error('FAIL:', msg);
  ok = false;
}

if (!existsSync(STORE_PATH)) {
  console.log('SKIP: no server/accounts.json (empty store is valid in dev)');
  process.exit(0);
}

let parsed;
try {
  parsed = JSON.parse(readFileSync(STORE_PATH, 'utf8'));
} catch (e) {
  fail(`accounts.json is not valid JSON: ${e.message}`);
  process.exit(1);
}

if (!parsed || typeof parsed !== 'object') fail('root must be an object');

const schemaVersion = parsed.schemaVersion;
if (schemaVersion !== undefined && (!Number.isInteger(schemaVersion) || schemaVersion < 1)) {
  fail(`invalid schemaVersion: ${schemaVersion}`);
}

if (parsed.accounts !== undefined && (typeof parsed.accounts !== 'object' || Array.isArray(parsed.accounts))) {
  fail('accounts must be a plain object');
}

const accounts = parsed.accounts || {};
const usernames = Object.keys(accounts);
console.log('store summary:', {
  schemaVersion: schemaVersion ?? '(legacy, will upgrade on next flush)',
  accountCount: usernames.length,
  usernames,
  hasTokensOnDisk: parsed.tokens !== undefined && Object.keys(parsed.tokens || {}).length > 0,
});

if (parsed.tokens && Object.keys(parsed.tokens).length > 0) {
  console.warn('WARN: tokens persisted on disk (server rewrites tokens:{} on flush)');
}

const optionalFutureKeys = ['notes', 'noteReactions', 'noteReports', 'claims', 'claimByAccount', 'claimByParcel'];
for (const k of optionalFutureKeys) {
  if (parsed[k] !== undefined) console.log(`future key present (not validated): ${k}`);
}

for (const user of usernames) {
  if (!/^[a-zA-Z0-9_]{3,16}$/.test(user)) fail(`invalid username key: ${user}`);
  const acc = accounts[user];
  if (!acc || typeof acc !== 'object') {
    fail(`account ${user} must be an object`);
    continue;
  }
  if (typeof acc.salt !== 'string' || acc.salt.length < 8) fail(`account ${user}: missing salt`);
  if (typeof acc.hash !== 'string' || acc.hash.length < 32) fail(`account ${user}: missing hash`);
  if (acc.char != null) {
    if (typeof acc.char !== 'object') fail(`account ${user}: char must be object or null`);
    else {
      if (typeof acc.char.charFile !== 'string') fail(`account ${user}: char.charFile required when char set`);
      if (acc.char.level !== undefined && (!Number.isFinite(acc.char.level) || acc.char.level < 1)) {
        fail(`account ${user}: invalid char.level`);
      }
    }
  }
}

if (!ok) process.exit(1);
console.log('PASS: server store audit');