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

// customizacion visual: slots de rig + accesorios + paleta (allowlists duras)
const CU_RIGS = ['knight', 'barbarian', 'mage', 'ranger', 'rogue', 'rogue_hooded', 'druid'];
const CU_ACCS = ['cape_knight', 'helmet', 'visor', 'bearhat', 'hat_mage', 'cape_mage', 'quiver', 'cape_ranger', 'mask', 'cape_rogue', 'backpack'];
function sanitizeCu(cu) {
  const rig = (v) => (CU_RIGS.includes(v) ? v : null);
  return {
    t: clampInt(cu && cu.t, 0, 3),
    hd: rig(cu && cu.hd), tr: rig(cu && cu.tr), lg: rig(cu && cu.lg),
    ac: Array.isArray(cu && cu.ac) ? cu.ac.filter((x) => CU_ACCS.includes(x)).slice(0, 5) : null,
  };
}

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
      kind: clean(it.kind, 12),
      heal: clampNum(it.heal, 0, 10000),
    });
  }

  return {
    className: clean(raw.className, 20),
    charFile,
    level: clampInt(raw.level, 1, 200),
    xp: clampNum(raw.xp, 0, 1e9),
    hpMax: clampNum(raw.hpMax, 1, 100000),
    custom: sanitizeCu(raw.custom),
    gold: clampNum(raw.gold, 0, 1e9),
    inv,
    equipId: clean(raw.equipId, 40),
  };
}

// ---------------------------------------------------------------------------
// MOBS server-authoritative: el server es dueno de los mobs, compartidos por
// todos los clientes. Tienen spawn, aggro, chase, leash y golpe server-side.
// ---------------------------------------------------------------------------

const MOB_SPAWNS_PATH = path.join(__dirname, 'mob_spawns.json');
// cap >= spawns totales: TODAS las zonas pobladas desde el arranque. Con 40
// de 66 el orden del JSON dejaba vacias las zonas cercanas al spawn/parque
// tras cada restart ("faltan los mobs") hasta que los respawns rotaban.
const MOB_CAP = 66;
const MOB_RESPAWN_MS = 7000;   // ARPG: la horda vuelve rapido, farmeo sin huecos
const MOB_DMG_MAX = 3000;
const MOB_TICK_MS = 100;
const MOB_AGGRO_RANGE = 24;   // zombies agresivos pero sin trenes interminables
const MOB_ATTACK_RANGE = 2.0;   // el zombie se pega al cuerpo antes de morder
const MOB_LEASH_RANGE = 42;
const MOB_SPEED = 4.2;
const MOB_RETURN_SPEED = 3.0;
const MOB_WANDER_SPEED = 1.35;
const MOB_WANDER_RADIUS = 4.5;
const MOB_WANDER_REACH = 0.45;
const MOB_WANDER_PAUSE_MIN_MS = 600;
const MOB_WANDER_PAUSE_MAX_MS = 1800;
const MOB_ATTACK_CD_MS = 1500;   // la horda rodea y asusta, no tritura en 2s

// top 5 de rachas del dia (se resetea cada 24h)
let topStreaks = [];
const rankReset = setInterval(() => { topStreaks = []; broadcastAll({ t: 'top', list: [] }); }, 86400000);
if (rankReset.unref) rankReset.unref();

const mobs = new Map();   // mobId -> { id, x, z, spawnX, spawnZ, h, state, lvl, hp, hpMax, kind }
let nextMobId = 1;        // contador propio de mobs, separado del de jugadores
let mobSpawns = [];       // lista de { x, z, lvl, zone } cargada del JSON

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
      const lvl = clampInt(s.lvl, 1, 5);
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
      mobSpawns.push({ x, z, lvl, zone: clean(s.zone || '', 28) });
    }
  } catch {
    mobSpawns = [];
  }
}

// crea un objeto mob desde un spawn. hpMax = 30 + lvl*16 (early amable); boss x4.
function makeMob(id, spawn) {
  const hpMax = (30 + spawn.lvl * 16) * (spawn.boss ? 4 : 1);
  return {
    id,
    x: spawn.x,
    z: spawn.z,
    spawnX: spawn.x,
    spawnZ: spawn.z,
    h: 0,
    state: 'idle',
    lvl: spawn.lvl,
    hp: hpMax,
    hpMax,
    boss: !!spawn.boss,
    kind: spawn.lvl - 1,
    zone: spawn.zone || '',
    targetId: null,
    hitCdMs: 0,
    wanderX: null,
    wanderZ: null,
    nextWanderMs: 0,
  };
}

// representacion publica del mob para los clientes.
function mobView(m) {
  return { id: m.id, x: m.x, z: m.z, h: m.h, state: m.state, lvl: m.lvl, hp: m.hp, hpMax: m.hpMax, kind: m.kind, zone: m.zone, b: m.boss ? 1 : 0 };
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

function nearestMobTarget(mob) {
  let best = null;
  let bestD = MOB_AGGRO_RANGE;
  for (const [id, c] of clients) {
    if (!Number.isFinite(c.x) || !Number.isFinite(c.z)) continue;
    // la gruta es refugio TOTAL: los refugiados no son targeteables (sin esto
    // las oleadas campean el respawn = cadena de muertes sin escape)
    if (Math.hypot(c.x - SAFE_X, c.z - SAFE_Z) < SAFE_R) continue;
    const leashD = Math.hypot(c.x - mob.spawnX, c.z - mob.spawnZ);
    if (leashD > MOB_LEASH_RANGE) continue;
    const d = Math.hypot(c.x - mob.x, c.z - mob.z);
    if (d < bestD) { bestD = d; best = [id, c, d]; }
  }
  return best;
}

function stepToward(mob, tx, tz, step) {
  const dx = tx - mob.x, dz = tz - mob.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.01) return false;
  const s = Math.min(step, d);
  const nx = mob.x + (dx / d) * s;
  const nz = mob.z + (dz / d) * s;
  // los zombies no pisan la gruta (perimetro sagrado)
  if (Math.hypot(nx - SAFE_X, nz - SAFE_Z) < SAFE_R - 3) return false;
  mob.x = nx;
  mob.z = nz;
  mob.h = Math.atan2(dx, dz);
  return true;
}

function clearMobWander(mob) {
  mob.wanderX = null;
  mob.wanderZ = null;
}

function setMobWanderTarget(mob, now) {
  const a = Math.random() * Math.PI * 2;
  const r = MOB_WANDER_RADIUS * (0.35 + Math.sqrt(Math.random()) * 0.65);
  mob.wanderX = mob.spawnX + Math.cos(a) * r;
  mob.wanderZ = mob.spawnZ + Math.sin(a) * r;
  mob.nextWanderMs = now + MOB_WANDER_PAUSE_MIN_MS + Math.random() * (MOB_WANDER_PAUSE_MAX_MS - MOB_WANDER_PAUSE_MIN_MS);
}

function stepMobWander(mob, now, dt) {
  const distHome = Math.hypot(mob.x - mob.spawnX, mob.z - mob.spawnZ);
  if (distHome > MOB_WANDER_RADIUS + 1.5) {
    clearMobWander(mob);
    return stepToward(mob, mob.spawnX, mob.spawnZ, MOB_RETURN_SPEED * dt);
  }
  if (Number.isFinite(mob.wanderX) && Number.isFinite(mob.wanderZ)) {
    if (Math.hypot(mob.x - mob.wanderX, mob.z - mob.wanderZ) <= MOB_WANDER_REACH) {
      clearMobWander(mob);
      mob.nextWanderMs = now + MOB_WANDER_PAUSE_MIN_MS + Math.random() * (MOB_WANDER_PAUSE_MAX_MS - MOB_WANDER_PAUSE_MIN_MS);
      return false;
    }
    return stepToward(mob, mob.wanderX, mob.wanderZ, MOB_WANDER_SPEED * dt);
  }
  if (!mob.nextWanderMs || now >= mob.nextWanderMs) {
    setMobWanderTarget(mob, now);
    return stepToward(mob, mob.wanderX, mob.wanderZ, MOB_WANDER_SPEED * dt);
  }
  return false;
}

// balance: los clusters fundian al lvl 1 en segundos; pegan menos y desde
// mas cerca para que la primera experiencia no sea morir camninando
function mobDamage(mob) {
  return 4 + mob.lvl * 2;   // balance horda: varios pegando a la vez
}

function mobTick() {
  if (!clients.size || !mobs.size) return;
  const dt = MOB_TICK_MS / 1000;
  const now = Date.now();
  const changed = [];
  for (const mob of mobs.values()) {
    if (mob.hp <= 0) continue;
    // zombies de oleada vencidos: de vuelta a la tumba (sin loot, by -1).
    // Sin TTL las oleadas se ACUMULAN sin limite (176 mobs en el QA local).
    if (mob._dieAtMs && now > mob._dieAtMs) {
      mobs.delete(mob.id);
      broadcastAll({ t: 'mdead', id: mob.id, by: -1, party: [] });
      continue;
    }
    mob.hitCdMs = Math.max(0, (mob.hitCdMs || 0) - MOB_TICK_MS);
    const distHome = Math.hypot(mob.x - mob.spawnX, mob.z - mob.spawnZ);
    let state = 'idle';
    if (distHome > MOB_LEASH_RANGE) {
      mob.targetId = null;
      if (stepToward(mob, mob.spawnX, mob.spawnZ, MOB_RETURN_SPEED * dt)) state = 'walk';
    } else {
      const target = nearestMobTarget(mob);
      if (target) {
        const [tid, c, d] = target;
        mob.targetId = tid;
        clearMobWander(mob);
        if (d > MOB_ATTACK_RANGE) {
          // PANICO: al verte cerca CORREN (x1.7), y en el ultimo tramo EMBISTEN
          const rush = d < 4 ? 2.3 : (d < 11 ? 1.7 : 1);
          if (stepToward(mob, c.x, c.z, MOB_SPEED * rush * dt)) state = 'walk';
        } else {
          mob.h = Math.atan2(c.x - mob.x, c.z - mob.z);
          state = 'attack';
          if (mob.hitCdMs <= 0) {
            mob.hitCdMs = MOB_ATTACK_CD_MS;
            send(c.ws, { t: 'phit', id: mob.id, dmg: mobDamage(mob), hp: null });
          }
        }
      } else {
        mob.targetId = null;
        if (stepMobWander(mob, now, dt)) state = 'walk';
      }
    }
    if (mob.state !== state || state !== 'idle') {
      mob.state = state;
      changed.push(mobView(mob));
    }
  }
  if (changed.length) broadcastAll({ t: 'mpos', list: changed });
}

spawnInitialMobs();

// OLEADAS ZOMBIE: cada ~4 min brota una horda temporal alrededor de un jugador
// al azar. Sin _spawn => no respawnean: limpiarla ES el evento (botin de racha).
const WAVE_EVERY_MS = Number(process.env.WAVE_EVERY_MS) || 240000;
const WAVE_SIZE = 10;
// ciclo dia/noche por reloj compartido: 10 min, el ultimo 40% es NOCHE.
// El cliente usa la misma formula (Date.now) para el visual: sincronia gratis.
const DAYNIGHT_MS = 600000;
function isNight() { return (Date.now() % DAYNIGHT_MS) / DAYNIGHT_MS >= 0.6; }
let waveN = 0;
const waveTimer = setInterval(() => {
  const players = [...clients.values()].filter((c) => c.ws && c.ws.readyState === 1);
  if (!players.length) return;
  const c = players[Math.floor(Math.random() * players.length)];
  // la oleada ESCALA con el poder del objetivo (estimado por su hpMax):
  // un novato recibe 4 zombies suaves; un veterano, 10 y de nivel alto
  const power = Math.max(0, Math.round(((c.hm || 100) - 100) / 50));
  waveN++;
  const night = isNight();
  // NOCHE DE LOS MUERTOS: la horda nocturna es mas grande y mas brava
  let size = Math.min(night ? 14 : WAVE_SIZE, Math.round((4 + power) * (night ? 1.5 : 1)));
  const lvlCap = Math.min(5, 2 + Math.ceil(power / 2) + (night ? 1 : 0));
  // cada 3ra oleada trae un BOSS: la ABOMINACION (hp x4, nivel alto, TTL largo)
  const withBoss = waveN % 3 === 0;
  for (let i = 0; i < size; i++) {
    const ang = Math.random() * Math.PI * 2;
    const dist = 16 + Math.random() * 24;
    let sx = c.x + Math.cos(ang) * dist;
    let sz = c.z + Math.sin(ang) * dist;
    // la oleada nunca brota pegada a la gruta (el refugio se respeta)
    const dg = Math.hypot(sx - SAFE_X, sz - SAFE_Z);
    if (dg < SAFE_R + 14) {
      const k = (SAFE_R + 14) / Math.max(dg, 0.01);
      sx = SAFE_X + (sx - SAFE_X) * k;
      sz = SAFE_Z + (sz - SAFE_Z) * k;
    }
    const spawn = {
      x: sx,
      z: sz,
      lvl: 1 + Math.floor(Math.random() * lvlCap),
      zone: 'oleada',
    };
    const id = nextMobId++;
    const mob = makeMob(id, spawn);
    // TTL: si nadie lo mata, se despawnea solo (sin esto las oleadas se
    // ACUMULAN sin limite y el server se llena de zombies fantasma)
    mob._dieAtMs = Date.now() + 90000;
    mobs.set(id, mob);
    broadcastAll({ t: 'mspawn', mob: mobView(mob) });
  }
  if (withBoss) {
    const ang = Math.random() * Math.PI * 2;
    let bx = c.x + Math.cos(ang) * 26, bz = c.z + Math.sin(ang) * 26;
    const dg = Math.hypot(bx - SAFE_X, bz - SAFE_Z);
    if (dg < SAFE_R + 14) {
      const k = (SAFE_R + 14) / Math.max(dg, 0.01);
      bx = SAFE_X + (bx - SAFE_X) * k;
      bz = SAFE_Z + (bz - SAFE_Z) * k;
    }
    const id = nextMobId++;
    const mob = makeMob(id, { x: bx, z: bz, lvl: Math.min(5, 3 + Math.ceil(power / 2)), zone: 'boss', boss: true });
    mob._dieAtMs = Date.now() + 240000;
    mobs.set(id, mob);
    broadcastAll({ t: 'mspawn', mob: mobView(mob) });
  }
  broadcastAll({ t: 'wave', x: Math.round(c.x), z: Math.round(c.z), boss: withBoss ? 1 : 0, night: night ? 1 : 0 });
  console.log('oleada zombie sobre', c.name, '@', Math.round(c.x), Math.round(c.z));
}, WAVE_EVERY_MS);
if (waveTimer.unref) waveTimer.unref();
const mobTimer = setInterval(mobTick, MOB_TICK_MS);
if (mobTimer.unref) mobTimer.unref();

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
// PVP: golpes jugador-a-jugador via relay. El server valida rango, cadencia,
// party y zona segura; la VIDA sigue siendo del cliente victima (como phit).
// ---------------------------------------------------------------------------

const PVP_RANGE = 5.0;
const PVP_DMG_MAX = 300;
const PVP_CD_MS = 650;
const SAFE_X = -62, SAFE_Z = -7, SAFE_R = 30;   // gruta / respawn = zona segura

function inSafeZone(c) {
  if (!Number.isFinite(c.x) || !Number.isFinite(c.z)) return true;
  return Math.hypot(c.x - SAFE_X, c.z - SAFE_Z) < SAFE_R;
}

function samePartyIds(a, b) {
  const pa = partyOf.get(a);
  return !!pa && pa === partyOf.get(b);
}

// ---------------------------------------------------------------------------
// FRIENDS: amistades mutuas persistidas en la cuenta (accounts.json). Solo
// cuentas logueadas; los invitados no tienen friends. Presencia via flist push.
// ---------------------------------------------------------------------------

const FRIENDS_CAP = 50;

function accountFriends(user) {
  const acc = store.accounts[user];
  if (!acc) return [];
  if (!Array.isArray(acc.friends)) acc.friends = [];
  return acc.friends;
}

function friendsPayload(user) {
  const online = new Map();   // accountUser -> connId
  for (const [cid, c] of clients) if (c.account) online.set(c.account, cid);
  return accountFriends(user).map((u) => ({
    user: u,
    online: online.has(u),
    id: online.has(u) ? online.get(u) : null,
  }));
}

function pushFriendList(user) {
  for (const [, c] of clients) {
    if (c.account === user) send(c.ws, { t: 'flist', friends: friendsPayload(user) });
  }
}

// cuando `user` entra o sale, refresca el flist de sus amigos conectados
function notifyFriendPresence(user) {
  if (!user) return;
  for (const [, c] of clients) {
    if (c.account && c.account !== user && accountFriends(c.account).includes(user)) {
      send(c.ws, { t: 'flist', friends: friendsPayload(c.account) });
    }
  }
}

// ---------------------------------------------------------------------------
// conexion WS
// ---------------------------------------------------------------------------

// origenes de navegador permitidos (prod + dev local). Clientes sin Origin
// (herramientas no-browser) pasan: el header solo es confiable EN browsers.
const ORIGIN_ALLOW = /^(https:\/\/sauces\.controla\.group|https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

wss.on('connection', (ws, req) => {
  const origin = req && req.headers && req.headers.origin;
  if (origin && !ORIGIN_ALLOW.test(origin)) {
    console.log('conn RECHAZADA por origin', origin);
    ws.close(1008, 'origin');
    return;
  }
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
      // char SOLO de la allowlist: se rebroadcastea y cada cliente lo usa como
      // ruta de asset (path traversal si va crudo). Cernunnos solo Diosito.
      const wantChar = String(m.char || '');
      me.char = (CHAR_ALLOWLIST.includes(wantChar) && !(wantChar === GOD_CHAR && me.account !== GOD_USER))
        ? wantChar : 'char_knight.glb';
      // customizacion visual mix-and-match: saneada y rebroadcasteada
      me.cu = sanitizeCu(m.cu);
      const players = [];
      for (const [oid, c] of clients) {
        if (oid !== id) players.push({ id: oid, name: c.name, char: c.char, cu: c.cu, lv: c.lv, x: c.x, z: c.z, h: c.h, a: c.a, hp: c.hp, hm: c.hm });
      }
      send(ws, { t: 'roster', players });
      // estado actual de los mobs compartidos (server-authoritative).
      send(ws, { t: 'mobs', list: [...mobs.values()].map(mobView) });
      broadcast(id, { t: 'join', id, name: me.name, char: me.char, cu: me.cu, x: me.x, z: me.z, h: me.h, a: me.a });
      // presencia: avisa a mis amigos conectados que entre, y mandame mi lista
      if (me.account) {
        notifyFriendPresence(me.account);
        send(ws, { t: 'flist', friends: friendsPayload(me.account) });
      }
      if (topStreaks.length) send(ws, { t: 'top', list: topStreaks });
    } else if (m.t === 's') {
      // sanitizar SIEMPRE lo que entra (pos/heading/anim) + vida visible p/ todos
      me.x = clampNum(m.x, -3000, 3000); me.z = clampNum(m.z, -3000, 3000);
      me.h = clampNum(m.h, -10, 10); me.a = clean(m.a, 12) || 'Idle';
      me.hp = clampInt(m.hp, 0, 100000); me.hm = clampInt(m.hm ?? 100, 1, 100000);
      me.lv = clampInt(m.lv ?? 1, 1, 99);
      broadcast(id, { t: 's', id, x: me.x, z: me.z, h: me.h, a: me.a, hp: me.hp, hm: me.hm, lv: me.lv });
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
      // 12m cubre al arquero/mago legitimos; el FEEL melee lo pone el cliente (2.7)
      if (Math.hypot(mob.x - me.x, mob.z - me.z) > 12.0) return;
      const now = Date.now();
      if (me.lastMobHitMs && now - me.lastMobHitMs < 650) return;
      me.lastMobHitMs = now;
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
    } else if (m.t === 'rank') {
      // reporte de racha del cliente. Top 5 del dia, upsert por nombre.
      const nowMs = Date.now();
      if (conn._rankAt && nowMs - conn._rankAt < 4000) return;
      conn._rankAt = nowMs;
      const v = clampInt(m.v, 2, 80);
      const name = clean(conn.name || 'Explorador', 20) || 'Explorador';
      const cur = topStreaks.find((e) => e.name === name);
      if (cur) { if (v > cur.v) cur.v = v; } else topStreaks.push({ name, v });
      topStreaks.sort((a, b) => b.v - a.v);
      if (topStreaks.length > 5) topStreaks.length = 5;
      broadcastAll({ t: 'top', list: topStreaks });
    } else if (m.t === 'pskill') {
      // skill de PARTY: reenvia el buff/cura a los miembros del grupo del
      // emisor. Allowlist de tipos + clamps + cooldown anti-spam de 2.5s.
      const PSKILL_KINDS = new Set(['heal', 'dmgbuff', 'haste', 'shield']);
      const kind = String(m.kind || '');
      if (!PSKILL_KINDS.has(kind)) return;
      const nowMs = Date.now();
      if (conn._pskillAt && nowMs - conn._pskillAt < 2500) return;
      conn._pskillAt = nowMs;
      const v = Math.max(0, Math.min(kind === 'shield' ? 60 : 1, Number(m.v) || 0));
      const dur = Math.max(0, Math.min(12, Number(m.dur) || 0));
      const fromName = (conn.char && conn.char.name) || conn.user || 'aliado';
      for (const mid of partyMemberIds(conn.id)) {
        if (mid === conn.id) continue;
        const c = conns.get(mid);
        if (c) send(c.ws, { t: 'pskill', kind, v, dur, from: fromName });
      }
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

    // --- PVP ---
    } else if (m.t === 'pvp') {
      const to = Number(m.to);
      if (!Number.isInteger(to) || to === id) return;
      const target = clients.get(to);
      if (!target) return;
      if (!Number.isFinite(me.x) || !Number.isFinite(target.x)) return;
      if (Math.hypot(target.x - me.x, target.z - me.z) > PVP_RANGE) return;
      if (samePartyIds(id, to)) return;
      if (inSafeZone(me) || inSafeZone(target)) { send(ws, { t: 'pvpsafe' }); return; }
      const now = Date.now();
      if (me.lastPvpMs && now - me.lastPvpMs < PVP_CD_MS) return;
      me.lastPvpMs = now;
      const dmg = clampNum(m.dmg, 0, PVP_DMG_MAX);
      // registrar el atacante en la VICTIMA: pvpdead solo vale contra esto
      target.lastAttackerId = id;
      target.lastAttackerMs = now;
      send(target.ws, { t: 'pvph', from: id, name: me.name, dmg });

    } else if (m.t === 'pvpdead') {
      // la victima anuncia su muerte PvP. Solo vale si `by` la golpeo hace poco
      // (estado server-side): sin esto cualquiera fabrica kills para el feed.
      const by = Number(m.by);
      const now = Date.now();
      if (!Number.isInteger(by) || by !== me.lastAttackerId) return;
      if (!me.lastAttackerMs || now - me.lastAttackerMs > 15000) return;
      if (me.lastDeathMs && now - me.lastDeathMs < 5000) return;   // anti-spam
      me.lastDeathMs = now;
      me.lastAttackerId = null;
      const killer = clients.get(by);
      broadcastAll({ t: 'pvpkill', killer: killer ? killer.name : 'Alguien', victim: me.name });

    // --- FRIENDS ---
    } else if (m.t === 'flist') {
      if (!me.account) { send(ws, { t: 'flist', friends: [], guest: true }); return; }
      send(ws, { t: 'flist', friends: friendsPayload(me.account) });

    } else if (m.t === 'freq') {
      if (!me.account) { send(ws, { t: 'ferr', error: 'Necesitas una cuenta para tener amigos' }); return; }
      const to = Number(m.to);
      if (!Number.isInteger(to) || to === id) return;
      const target = clients.get(to);
      if (!target) return;
      if (!target.account) { send(ws, { t: 'ferr', error: 'Ese jugador explora sin cuenta' }); return; }
      if (target.account === me.account) return;
      if (accountFriends(me.account).includes(target.account)) { send(ws, { t: 'ferr', error: 'Ya son amigos' }); return; }
      // anti-spam + estado: la solicitud queda REGISTRADA en la victima; facc
      // solo acepta solicitudes que realmente existieron.
      const nowReq = Date.now();
      if (me.lastFreqMs && nowReq - me.lastFreqMs < 2000) return;
      me.lastFreqMs = nowReq;
      if (!target.friendReqs) target.friendReqs = new Set();
      if (target.friendReqs.size < 20) target.friendReqs.add(id);
      send(target.ws, { t: 'freqin', from: id, name: me.name, user: me.account });

    } else if (m.t === 'facc') {
      if (!me.account) return;
      const from = Number(m.from);
      // sin solicitud previa registrada NO hay amistad (evita amistades forzadas)
      if (!me.friendReqs || !me.friendReqs.has(from)) return;
      me.friendReqs.delete(from);
      const requester = Number.isInteger(from) ? clients.get(from) : null;
      if (!requester || !requester.account || requester.account === me.account) return;
      const mine = accountFriends(me.account);
      const theirs = accountFriends(requester.account);
      if (!mine.includes(requester.account) && mine.length < FRIENDS_CAP) mine.push(requester.account);
      if (!theirs.includes(me.account) && theirs.length < FRIENDS_CAP) theirs.push(me.account);
      markDirty();
      pushFriendList(me.account);
      pushFriendList(requester.account);
    }
  });

  ws.on('close', () => {
    // limpieza de party: sacar al que se va y refrescar a los que quedan.
    const stillPid = removeFromParty(id);
    clients.delete(id);
    if (stillPid) sendPartyToMembers(stillPid);
    broadcast(id, { t: 'leave', id });
    if (me.account) notifyFriendPresence(me.account);   // presencia: quedo offline
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
