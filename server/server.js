// Sauces multiplayer: tiny WebSocket relay. Each client sends its own state
// (pos/heading/anim); the server fans it out to everyone else. No physics, no
// rooms, just a shared walk-around. Runs on 127.0.0.1, nginx proxies
// wss://sauces.controla.group/ws to it.
//
// ADD: cuentas de usuario + persistencia. Login/registro por WS, hashing scrypt,
// tokens en memoria, y guardado de personaje en accounts.json (escritura atomica,
// debounce). El relay sigue funcionando para clientes Anon que nunca se loguean.
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = 8456;
const wss = new WebSocketServer({ port: PORT, host: '127.0.0.1' });

let nextId = 1;
const clients = new Map();   // id -> { ws, name, char, x, z, h, a, account }

// ---------------------------------------------------------------------------
// Cuentas: store en disco + tokens en memoria
// ---------------------------------------------------------------------------

const STORE_PATH = path.join(__dirname, 'accounts.json');
const STORE_TMP = STORE_PATH + '.tmp';
const STORE_SCHEMA_VERSION = 1;
const HEALTH_PORT = Number(process.env.SAUCES_HEALTH_PORT) || 8457;
const FLUSH_WARN_MS = Number(process.env.STORE_FLUSH_WARN_MS) || 50;

// charFiles permitidos. char_cernunnos.glb es SOLO de Diosito (cuenta zpw).
const CHAR_ALLOWLIST = [
  'char_knight.glb',
  'char_mage.glb',
  'char_ranger.glb',
  'char_rogue_hooded.glb',
  'char_cernunnos.glb',
];
const GOD_CHAR = 'char_cernunnos.glb';

// Cuenta dios desde el ENTORNO (no en el codigo). El server guarda solo el HASH,
// nunca la contrasena en texto plano. Si faltan las vars, el camino dios queda
// DESHABILITADO. Se setean en el systemd: GOD_USER, GOD_PASS_SALT, GOD_PASS_HASH.
const GOD_USER = process.env.GOD_USER || '';
const GOD_PASS_SALT = process.env.GOD_PASS_SALT || '';
const GOD_PASS_HASH = process.env.GOD_PASS_HASH || '';
const GOD_ENABLED = !!(GOD_USER && GOD_PASS_SALT && GOD_PASS_HASH);
if (!GOD_ENABLED) console.warn('[auth] camino dios DESHABILITADO: faltan GOD_USER/GOD_PASS_SALT/GOD_PASS_HASH');

// store en memoria. tokens NO se persiste. Unknown top-level keys are preserved for future phases.
let store = { schemaVersion: STORE_SCHEMA_VERSION, accounts: {} };
let storeExtra = {};
const tokens = new Map();     // token -> username (solo en memoria)
let dirty = false;
let lastFlushMs = 0;

// carga inicial. Si el archivo no existe o esta corrupto, arrancamos vacios.
function loadStore() {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const known = new Set(['schemaVersion', 'accounts', 'tokens']);
    storeExtra = {};
    if (parsed && typeof parsed === 'object') {
      for (const k of Object.keys(parsed)) {
        if (!known.has(k)) storeExtra[k] = parsed[k];
      }
    }
    store = {
      schemaVersion: Number(parsed && parsed.schemaVersion) || STORE_SCHEMA_VERSION,
      accounts: (parsed && typeof parsed.accounts === 'object' && parsed.accounts) || {},
    };
  } catch {
    store = { schemaVersion: STORE_SCHEMA_VERSION, accounts: {} };
    storeExtra = {};
  }
}

// marca el store como sucio para que el flush con debounce lo escriba.
function markDirty() { dirty = true; }

// escritura ATOMICA: escribe a .tmp y renombra. Nunca crashea el server.
function flushStore() {
  if (!dirty) return;
  const t0 = process.hrtime.bigint();
  try {
    const payload = {
      schemaVersion: STORE_SCHEMA_VERSION,
      ...storeExtra,
      accounts: store.accounts,
      tokens: {},
    };
    const data = JSON.stringify(payload);
    fs.writeFileSync(STORE_TMP, data);
    fs.renameSync(STORE_TMP, STORE_PATH);
    dirty = false;
    lastFlushMs = Number(process.hrtime.bigint() - t0) / 1e6;
    if (lastFlushMs >= FLUSH_WARN_MS) {
      console.warn('[store] slow flush', lastFlushMs.toFixed(1), 'ms', 'bytes', Buffer.byteLength(data, 'utf8'));
    } else if (process.env.STORE_LOG_FLUSH === '1') {
      console.log('[store] flush', lastFlushMs.toFixed(2), 'ms');
    }
  } catch (e) {
    // no tiramos el server por un fallo de disco; reintentamos en el proximo tick.
    console.error('flushStore error', e && e.message);
  }
}

// hashing de password con scrypt. salt nuevo por cuenta.
function hashPassword(pass, salt) {
  return crypto.scryptSync(pass, salt, 64).toString('hex');
}

// verificacion timing-safe. Devuelve false ante cualquier inconsistencia.
function verifyPassword(pass, salt, expectedHex) {
  try {
    const got = crypto.scryptSync(pass, salt, 64);
    const want = Buffer.from(String(expectedHex || ''), 'hex');
    if (got.length !== want.length) return false;
    return crypto.timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

function newToken(user) {
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, user);
  return token;
}

loadStore();
// flush con debounce: a lo sumo cada 2s.
const flushTimer = setInterval(flushStore, 2000);
if (flushTimer.unref) flushTimer.unref();

function shutdown() {
  flushStore();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ---------------------------------------------------------------------------
// helpers de red
// ---------------------------------------------------------------------------

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(exceptId, obj) {
  const s = JSON.stringify(obj);
  for (const [id, c] of clients) if (id !== exceptId && c.ws.readyState === 1) c.ws.send(s);
}
// broadcastAll: manda a TODOS los clientes conectados, incluido el emisor.
function broadcastAll(obj) {
  const s = JSON.stringify(obj);
  for (const [, c] of clients) if (c.ws.readyState === 1) c.ws.send(s);
}

// quita caracteres de control (< 32) sin regex de escapes; recorta a max chars
function clean(raw, max) {
  return [...String(raw || '')].filter((c) => c.charCodeAt(0) >= 32).join('').trim().slice(0, max);
}

// numero clamp a [min,max]; NaN/invalido cae a min.
function clampNum(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

// entero clamp a [min,max].
function clampInt(v, min, max) {
  return Math.round(clampNum(v, min, max));
}

// ---------------------------------------------------------------------------
// saneado del personaje guardado (anti-cheat + limites)
// ---------------------------------------------------------------------------

function sanitizeChar(raw, account) {
  if (!raw || typeof raw !== 'object') return null;

  // charFile debe estar en la allowlist. Cernunnos solo para Diosito.
  const charFile = String(raw.charFile || '');
  if (!CHAR_ALLOWLIST.includes(charFile)) return null;
  if (charFile === GOD_CHAR && account !== GOD_USER) return null;   // rechaza el save entero

  // inventario: array, cap 60 entradas, cada item saneado.
  const invIn = Array.isArray(raw.inv) ? raw.inv : [];
  const inv = [];
  for (let i = 0; i < invIn.length && inv.length < 60; i++) {
    const it = invIn[i];
    if (!it || typeof it !== 'object') continue;
    inv.push({
      id: clean(it.id, 40),
      name: clean(it.name, 40),
      weaponName: clean(it.weaponName, 40),
      tier: clean(it.tier, 40),
      classReq: clean(it.classReq, 40),
      atk: clampNum(it.atk, 0, 100000),
    });
  }

  return {
    className: clean(raw.className, 20),
    charFile,
    level: clampInt(raw.level, 1, 200),
    xp: clampNum(raw.xp, 0, 1e9),
    hpMax: clampNum(raw.hpMax, 1, 100000),
    inv,
    equipId: clean(raw.equipId, 40),
  };
}

// ---------------------------------------------------------------------------
// MOBS server-authoritative: el server es dueno de los mobs, compartidos por
// todos los clientes. Estaticos (no se mueven). Carga spawns de mob_spawns.json.
// ---------------------------------------------------------------------------

const MOB_SPAWNS_PATH = path.join(__dirname, 'mob_spawns.json');
const MOB_CAP = 40;
const MOB_RESPAWN_MS = 12000;
const MOB_DMG_MAX = 3000;

const mobs = new Map();   // mobId -> { id, x, z, lvl, hp, hpMax, kind }
let nextMobId = 1;        // contador propio de mobs, separado del de jugadores
let mobSpawns = [];       // lista de { x, z, lvl } cargada del JSON

// lee los spawns en startup. Si falta o esta corrupto, no hay mobs.
function loadMobSpawns() {
  try {
    const raw = fs.readFileSync(MOB_SPAWNS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const list = (parsed && Array.isArray(parsed.spawns)) ? parsed.spawns : [];
    mobSpawns = [];
    for (const s of list) {
      if (!s || typeof s !== 'object') continue;
      const x = Number(s.x), z = Number(s.z);
      const lvl = clampInt(s.lvl, 1, 3);
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
      mobSpawns.push({ x, z, lvl });
    }
  } catch {
    mobSpawns = [];
  }
}

// crea un objeto mob desde un spawn. hpMax = 40 + lvl*22; kind = lvl-1 (0..2).
function makeMob(id, spawn) {
  const hpMax = 40 + spawn.lvl * 22;
  return { id, x: spawn.x, z: spawn.z, lvl: spawn.lvl, hp: hpMax, hpMax, kind: spawn.lvl - 1 };
}

// representacion publica del mob para los clientes.
function mobView(m) {
  return { id: m.id, x: m.x, z: m.z, lvl: m.lvl, hp: m.hp, hpMax: m.hpMax, kind: m.kind };
}

// spawnea hasta MOB_CAP mobs en spawns DISTINTOS (toma los primeros N).
function spawnInitialMobs() {
  loadMobSpawns();
  const cap = Math.min(MOB_CAP, mobSpawns.length);
  for (let i = 0; i < cap; i++) {
    const id = nextMobId++;
    const mob = makeMob(id, mobSpawns[i]);
    mob._spawn = mobSpawns[i];   // guardamos el spawn original para el respawn
    mobs.set(id, mob);
  }
}

spawnInitialMobs();

// ---------------------------------------------------------------------------
// PARTY: grupos de jugadores. partyId -> Set<connId>, y connId -> partyId.
// ---------------------------------------------------------------------------

const parties = new Map();    // partyId -> Set<connId>
const partyOf = new Map();    // connId -> partyId
let nextPartyId = 1;

// devuelve los conn-ids de los miembros de la party de connId, o [] si no tiene.
function partyMemberIds(connId) {
  const pid = partyOf.get(connId);
  if (!pid) return [];
  const set = parties.get(pid);
  if (!set) return [];
  return [...set];
}

// arma el payload { members: [{id, name}] } de una party.
function partyMembersPayload(pid) {
  const set = parties.get(pid);
  if (!set) return [];
  const members = [];
  for (const cid of set) {
    const c = clients.get(cid);
    if (c) members.push({ id: cid, name: c.name });
  }
  return members;
}

// manda el estado de la party a todos sus miembros conectados.
function sendPartyToMembers(pid) {
  const set = parties.get(pid);
  if (!set) return;
  const members = partyMembersPayload(pid);
  for (const cid of set) {
    const c = clients.get(cid);
    if (c) send(c.ws, { t: 'party', members });
  }
}

// saca a connId de su party. Si la party queda con <2, se disuelve.
// Devuelve el partyId afectado (para refrescar a los que quedan) o null.
function removeFromParty(connId) {
  const pid = partyOf.get(connId);
  if (!pid) return null;
  partyOf.delete(connId);
  const set = parties.get(pid);
  if (!set) return null;
  set.delete(connId);
  if (set.size < 2) {
    // disolver: limpiar el partyOf de los que queden y borrar la party.
    for (const cid of set) partyOf.delete(cid);
    parties.delete(pid);
    return null;   // ya no hay party que refrescar (avisamos aparte abajo)
  }
  return pid;
}

// ---------------------------------------------------------------------------
// conexion WS
// ---------------------------------------------------------------------------

wss.on('connection', (ws, req) => {
  const id = nextId++;
  const me = { ws, name: 'Anon', char: 'char_knight.glb', x: 0, z: 0, h: 0, a: 'Idle', account: null };
  clients.set(id, me);
  console.log('conn', id, 'from', req && req.socket && req.socket.remoteAddress, '| total', clients.size);
  send(ws, { t: 'id', id });

  ws.on('message', (buf) => {
    let m;
    try { m = JSON.parse(buf); } catch { return; }

    if (m.t === 'register') {
      const user = String(m.user || '');
      const pass = String(m.pass || '');
      if (!/^[a-zA-Z0-9_]{3,16}$/.test(user) || (GOD_USER && user.toLowerCase() === GOD_USER.toLowerCase())) {
        send(ws, { t: 'auth', ok: false, error: 'Usuario invalido' });
        return;
      }
      if (pass.length < 4 || pass.length > 64) {
        send(ws, { t: 'auth', ok: false, error: 'Contrasena invalida' });
        return;
      }
      if (store.accounts[user]) {
        send(ws, { t: 'auth', ok: false, error: 'Ese usuario ya existe' });
        return;
      }
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = hashPassword(pass, salt);
      store.accounts[user] = { salt, hash, char: null };
      markDirty();
      const token = newToken(user);
      me.account = user;
      send(ws, { t: 'auth', ok: true, god: false, user, char: null, token });
      return;
    }

    if (m.t === 'login') {
      const user = String(m.user || '');
      const pass = String(m.pass || '');

      // GOD: usuario exacto + verificacion del HASH (provisto por el entorno).
      if (GOD_ENABLED && user === GOD_USER && verifyPassword(pass, GOD_PASS_SALT, GOD_PASS_HASH)) {
        if (!store.accounts[GOD_USER]) {
          store.accounts[GOD_USER] = { salt: GOD_PASS_SALT, hash: GOD_PASS_HASH, char: null };
          markDirty();
        }
        me.account = GOD_USER;
        const token = newToken(GOD_USER);
        send(ws, { t: 'auth', ok: true, god: true, user: GOD_USER, char: store.accounts[GOD_USER].char, token });
        return;
      }

      const acc = store.accounts[user];
      if (!acc || !verifyPassword(pass, acc.salt, acc.hash)) {
        send(ws, { t: 'auth', ok: false, error: 'Usuario o contrasena incorrectos' });
        return;
      }
      me.account = user;
      const token = newToken(user);
      send(ws, { t: 'auth', ok: true, god: false, user, char: acc.char, token });
      return;
    }

    if (m.t === 'save') {
      if (!me.account) return;   // solo cuentas logueadas guardan
      const sanitized = sanitizeChar(m.char, me.account);
      if (!sanitized) return;    // save invalido o anti-cheat: ignorar
      if (!store.accounts[me.account]) return;
      store.accounts[me.account].char = sanitized;
      markDirty();
      return;
    }

    if (m.t === 'hi') {
      // si trae token valido, atamos la conexion a la cuenta (para los saves).
      if (m.token && tokens.has(m.token)) me.account = tokens.get(m.token);
      me.name = clean(m.name, 16) || 'Anon';
      me.char = String(m.char || 'char_knight.glb').slice(0, 40);
      const players = [];
      for (const [oid, c] of clients) {
        if (oid !== id) players.push({ id: oid, name: c.name, char: c.char, x: c.x, z: c.z, h: c.h, a: c.a });
      }
      send(ws, { t: 'roster', players });
      // estado actual de los mobs compartidos (server-authoritative).
      send(ws, { t: 'mobs', list: [...mobs.values()].map(mobView) });
      broadcast(id, { t: 'join', id, name: me.name, char: me.char, x: me.x, z: me.z, h: me.h, a: me.a });
    } else if (m.t === 's') {
      me.x = m.x; me.z = m.z; me.h = m.h; me.a = m.a;
      broadcast(id, { t: 's', id, x: m.x, z: m.z, h: m.h, a: m.a });
    } else if (m.t === 'atk') {
      broadcast(id, { t: 'atk', id });
    } else if (m.t === 'chat') {
      const text = clean(m.text, 200);   // chat de mundo: saneado + reenviado con el nombre del server
      if (!text) return;
      broadcast(id, { t: 'chat', id, name: me.name, text });

    // --- MOBS ---
    } else if (m.t === 'mhit') {
      // dano a un mob. id de mob valido, mob vivo, dmg finito clamp 0..3000.
      const mid = Number(m.id);
      if (!Number.isInteger(mid)) return;
      const mob = mobs.get(mid);
      if (!mob || mob.hp <= 0) return;
      const dmg = clampNum(m.dmg, 0, MOB_DMG_MAX);
      mob.hp -= dmg;
      if (mob.hp > 0) {
        broadcastAll({ t: 'mhp', id: mob.id, hp: mob.hp });
      } else {
        // muerto: sacar del mapa, calcular party del que lo mato, avisar a todos.
        const spawn = mob._spawn;
        const deadId = mob.id;
        mobs.delete(deadId);
        broadcastAll({ t: 'mdead', id: deadId, by: id, party: partyMemberIds(id) });
        // respawn en MOB_RESPAWN_MS: mismo id, mismo spawn, hp lleno.
        if (spawn) {
          const timer = setTimeout(() => {
            const fresh = makeMob(deadId, spawn);
            fresh._spawn = spawn;
            mobs.set(deadId, fresh);
            broadcastAll({ t: 'mspawn', mob: mobView(fresh) });
          }, MOB_RESPAWN_MS);
          if (timer.unref) timer.unref();
        }
      }

    // --- PARTY ---
    } else if (m.t === 'pinvite') {
      // invita a un cliente por su conn-id. Solo le llega al invitado.
      const to = Number(m.to);
      if (!Number.isInteger(to) || to === id) return;
      const target = clients.get(to);
      if (!target) return;
      send(target.ws, { t: 'pinvited', from: id, name: me.name });

    } else if (m.t === 'paccept') {
      // acepta una invitacion del conn-id `from`. Ambos deben seguir conectados.
      const from = Number(m.from);
      if (!Number.isInteger(from) || from === id) return;
      const inviter = clients.get(from);
      if (!inviter) return;
      let pid = partyOf.get(from);
      if (pid && parties.has(pid)) {
        // el invitante ya tiene party: sumamos al que acepta.
        // si el que acepta estaba en otra party, lo sacamos primero.
        const prev = partyOf.get(id);
        if (prev && prev !== pid) {
          const stillPid = removeFromParty(id);
          if (stillPid) sendPartyToMembers(stillPid);
        }
        parties.get(pid).add(id);
        partyOf.set(id, pid);
      } else {
        // party nueva con ambos.
        pid = nextPartyId++;
        parties.set(pid, new Set([from, id]));
        partyOf.set(from, pid);
        partyOf.set(id, pid);
      }
      sendPartyToMembers(pid);

    } else if (m.t === 'pleave') {
      const pid = partyOf.get(id);
      if (!pid) { send(ws, { t: 'party', members: [] }); return; }
      const stillPid = removeFromParty(id);
      send(ws, { t: 'party', members: [] });
      if (stillPid) sendPartyToMembers(stillPid);
    }
  });

  ws.on('close', () => {
    // limpieza de party: sacar al que se va y refrescar a los que quedan.
    const stillPid = removeFromParty(id);
    clients.delete(id);
    if (stillPid) sendPartyToMembers(stillPid);
    broadcast(id, { t: 'leave', id });
  });
  ws.on('error', () => {});
});

const http = require('http');
const healthServer = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/health/') {
    const body = JSON.stringify({
      ok: true,
      service: 'sauces-mp',
      schemaVersion: STORE_SCHEMA_VERSION,
      clients: clients.size,
      mobs: mobs.size,
      lastFlushMs,
      dirty,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
    return;
  }
  res.writeHead(404).end();
});
healthServer.listen(HEALTH_PORT, '127.0.0.1', () => {
  console.log('sauces-mp health on 127.0.0.1:' + HEALTH_PORT + '/health');
});
if (healthServer.unref) healthServer.unref();

console.log('sauces-mp relay listening on 127.0.0.1:' + PORT);
