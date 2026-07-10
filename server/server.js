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
const { MAX_WEAPON_ATK, MAX_PLAYER_LEVEL, maxPlayerHit } = require('./combat_limits');
const { verifyPrivyToken, isConfigured: privyConfigured } = require('./auth_privy');
const {
  SAFE_X,
  SAFE_Z,
  SAFE_R,
  MOB_PERSONAS,
  mobPersona,
  zoneBalance,
  mobHpMax,
  mobDamage,
} = require('./mob_balance');

const { guardMovement, MOVEMENT_MAX_CREDIT } = require('./movement_guard');
const {
  chooseMobStep,
  findOpenSpawnAround,
  findWanderTarget,
  mobPointAllowed,
} = require('./mob_navigation');
const { obstacleStats } = require('./world_obstacles');

const PORT = Number(process.env.SAUCES_PORT) || 8456;
// maxPayload: el default de `ws` es 100MB. Ningun mensaje legitimo pasa de unos
// KB (el mas grande es un save con 60 items), y el frame se bufferea entero
// antes de que corra cualquier validacion.
const wss = new WebSocketServer({ port: PORT, host: '127.0.0.1', maxPayload: 64 * 1024 });

let nextId = 1;
const clients = new Map();   // id -> { ws, name, char, x, z, h, a, account }

// ---------------------------------------------------------------------------
// Cuentas: store en disco + tokens en memoria
// ---------------------------------------------------------------------------

const STORE_PATH = process.env.SAUCES_STORE_PATH
  ? path.resolve(process.env.SAUCES_STORE_PATH)
  : path.join(__dirname, 'accounts.json');
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

// Migracion a Google: la contrasena sobrevive SOLO hasta que cada jugador ata su
// cuenta (privylink). Poner AUTH_PASSWORD_ENABLED=0 la apaga del todo.
const PASSWORD_AUTH_ENABLED = process.env.AUTH_PASSWORD_ENABLED !== '0';

// Guard de progresion del save (ver sanitizeChar). Los niveles se ganan de a uno;
// +2 tolera un doble level-up entre saves. El oro tolera una venta grande de
// inventario, pero no un salto a 1e9.
const MAX_LEVEL_GAIN_PER_SAVE = 2;
const MAX_GOLD_GAIN_PER_SAVE = 20000;
// MITIGACION, no cura: el oro sigue siendo client-authoritative. El cap por save
// solo sirve junto a este rate limit (si no, spameas saves y sumas el maximo cada
// vez). La cura real es una economia server-side que cuente kills y ventas.
const SAVE_MIN_INTERVAL_MS = 3000;

// Recall a la gruta (tecla B). El cliente canaliza 2s; el server valida que la
// canalizacion haya pasado de verdad y que no estes en combate. Solo entonces
// autoriza la aparicion en la gruta (ver movement_guard.homeGrant).
const RECALL_CHANNEL_MS = 1800;        // margen bajo los 2s del cliente
const RECALL_COMBAT_LOCK_MS = 5000;    // no se recalla huyendo de un golpe
const RECALL_GRANT_MS = 4000;          // ventana para usar el permiso
const RESPAWN_GRANT_MS = 15000;        // morir siempre te devuelve a la gruta
const RECALL_CD_MS = 8000;

// Los skills de party tienen cd 28-30s en classes.js. 24s deja margen a la
// latencia y al haste, pero mata la rotacion infinita de buffs.
const PSKILL_CD_MS = 24000;

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

// scrypt es caro A PROPOSITO. Corriendo en el bucle de eventos (scryptSync), cada
// login congelaba el mobTick, los broadcasts y el movimiento de TODOS los jugadores
// mientras se calculaba. La version asincrona lo manda al threadpool de libuv.
const scryptAsync = require('util').promisify(crypto.scrypt);

async function hashPassword(pass, salt) {
  const buf = await scryptAsync(pass, salt, 64);
  return buf.toString('hex');
}

// verificacion timing-safe. Devuelve false ante cualquier inconsistencia.
async function verifyPassword(pass, salt, expectedHex) {
  try {
    const got = await scryptAsync(pass, salt, 64);
    const want = Buffer.from(String(expectedHex || ''), 'hex');
    if (got.length !== want.length) return false;
    return crypto.timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

// Los tokens de sesion EXPIRAN y se pueden revocar. Antes eran eternos: un token
// filtrado servia para siempre, y el Map crecia sin techo mientras el server viviera.
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // 7 dias
const TOKEN_SWEEP_MS = 60 * 60 * 1000;

function newToken(user) {
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, { user, exp: Date.now() + TOKEN_TTL_MS });
  return token;
}

// Devuelve la cuenta del token si sigue vivo; si expiro lo borra.
function accountForToken(token) {
  if (typeof token !== 'string') return null;
  const rec = tokens.get(token);
  if (!rec) return null;
  if (rec.exp <= Date.now()) { tokens.delete(token); return null; }
  return rec.user;
}

// Invalida TODAS las sesiones de una cuenta (cambio de credenciales, claim, etc).
function revokeTokensFor(user) {
  let n = 0;
  for (const [token, rec] of tokens) {
    if (rec.user === user) { tokens.delete(token); n++; }
  }
  return n;
}

const tokenSweep = setInterval(() => {
  const now = Date.now();
  for (const [token, rec] of tokens) if (rec.exp <= now) tokens.delete(token);
}, TOKEN_SWEEP_MS);
if (tokenSweep.unref) tokenSweep.unref();

// RATE LIMIT de auth. Sin esto: fuerza bruta libre, y como scrypt es caro, un
// chorro de intentos congela el bucle de eventos (mobs, broadcasts) para TODOS.
const AUTH_MAX_PER_CONN = 6;
const AUTH_CONN_WINDOW_MS = 60 * 1000;
const AUTH_MAX_PER_IP = 24;
const AUTH_IP_WINDOW_MS = 10 * 60 * 1000;
const authByIp = new Map();   // ip -> { count, resetAt }

function authRateLimited(client) {
  const now = Date.now();
  if (!client._authWindow || now > client._authWindow.resetAt) {
    client._authWindow = { count: 0, resetAt: now + AUTH_CONN_WINDOW_MS };
  }
  client._authWindow.count++;
  if (client._authWindow.count > AUTH_MAX_PER_CONN) return true;

  const ip = client.ip || 'unknown';
  let bucket = authByIp.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + AUTH_IP_WINDOW_MS };
    authByIp.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count > AUTH_MAX_PER_IP;
}

const authIpSweep = setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of authByIp) if (now > b.resetAt) authByIp.delete(ip);
}, AUTH_IP_WINDOW_MS);
if (authIpSweep.unref) authIpSweep.unref();

// indice DID de Privy -> nombre de cuenta. Se reconstruye desde el store.
const privyIndex = new Map();
function rebuildPrivyIndex() {
  privyIndex.clear();
  for (const [user, acc] of Object.entries(store.accounts || {})) {
    if (acc && acc.privySub) privyIndex.set(acc.privySub, user);
  }
}

loadStore();
rebuildPrivyIndex();
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

const DODGE_KEYS = new Set(['Forward', 'Backward', 'Left', 'Right']);
function cleanDodgeKey(raw) {
  const key = clean(raw, 12);
  return DODGE_KEYS.has(key) ? key : '';
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
      // el atk del arma alimenta _playerAtk(): sin este techo el cliente se
      // fabrica un arma de 100000 y el techo de dano por nivel no sirve de nada.
      atk: clampNum(it.atk, 0, MAX_WEAPON_ATK),
      kind: clean(it.kind, 12),
      heal: clampNum(it.heal, 0, 10000),
    });
  }

  // GUARD DE PROGRESION: el save es client-authoritative, asi que un cliente
  // modificado se declara nivel 200 con 1e9 de oro. Los niveles llegan de a uno:
  // acotamos el CRECIMIENTO contra lo ya persistido, no solo el valor absoluto.
  const prev = (store.accounts[account] && store.accounts[account].char) || null;
  const prevLevel = prev ? clampInt(prev.level, 1, MAX_PLAYER_LEVEL) : 1;
  const prevGold = prev ? clampNum(prev.gold, 0, 1e9) : 0;
  const level = Math.min(
    clampInt(raw.level, 1, MAX_PLAYER_LEVEL),
    prevLevel + MAX_LEVEL_GAIN_PER_SAVE,
  );
  const gold = Math.min(
    clampNum(raw.gold, 0, 1e9),
    prevGold + MAX_GOLD_GAIN_PER_SAVE,
  );

  return {
    className: clean(raw.className, 20),
    charFile,
    level,
    xp: clampNum(raw.xp, 0, 1e9),
    hpMax: clampNum(raw.hpMax, 1, 100000),
    custom: sanitizeCu(raw.custom),
    gold,
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
const MOB_CAP = 90;
const MOB_RESPAWN_MS = 16000;   // frena el farmeo de nivel sin vaciar las zonas
const MOB_DMG_MAX = 3000;
const MOB_TICK_MS = 100;
const MOB_HIT_RATE_MS = 300;   // rate por objetivo: permite combos, cleave y skills AoE
const MOB_SKILL_HIT_RATE_MS = 120;   // skills no deben quedar bloqueadas por el golpe basico previo
const MOB_BLEED_HIT_RATE_MS = 160;   // bleed tickea rapido, pero no como spam libre
const MOB_AGGRO_RANGE = 28;   // zombies agresivos pero sin trenes interminables
const MOB_ATTACK_RANGE = 2.0;   // el zombie se pega al cuerpo antes de morder
const MOB_ATTACK_WINDUP_MS = 220;   // mordida telegrafiada: anim primero, dano despues
const MOB_ATTACK_COMMIT_RANGE = MOB_ATTACK_RANGE + 0.75;   // margen para que no falle por interpolacion
const MOB_STAGGER_INTERRUPT_CD_MS = 650;   // skill/heavy cortan mordida sin dejar re-mordida instantanea
const MOB_LEASH_RANGE = 48;
const MOB_SPEED = 5.0;
const MOB_RETURN_SPEED = 3.4;
const MOB_WANDER_SPEED = 1.35;
const MOB_WANDER_RADIUS = 4.5;
const MOB_WANDER_REACH = 0.45;
const MOB_WANDER_PAUSE_MIN_MS = 600;
const MOB_WANDER_PAUSE_MAX_MS = 1800;
const MOB_ATTACK_CD_MS = 1200;   // la horda rodea y asusta, no tritura en 2s

// --- AI de horda: separacion, rodeo, personalidades, timing organico, zigzag ---
const MOB_SEP_RADIUS = 1.6;      // a menos de 1.6m entre mobs hay empujon anti-apilamiento
const MOB_SEP_FORCE = 2.5;       // m/s del empuje (suave: ~0.25m por tick, no teleport)
const MOB_SEP_MAX_CHECK = 8;     // vecinos maximos revisados por mob y tick (perf con 90 mobs)
const MOB_SURROUND_DIST = 6;     // a esta distancia del objetivo se abren en anillo
const MOB_SURROUND_R = 1.5;      // radio del anillo (< MOB_ATTACK_RANGE: siguen mordiendo)
const MOB_ZIGZAG_AMP = 0.9;      // metros de desvio lateral senoidal en la persecucion
const MOB_FIRST_HIT_JITTER_MS = 600;   // primer golpe desfasado 0-600ms (manada no sincronizada)
const MOB_GROWL_CHANCE = 0.10;   // 10%: tras golpear, "grunido de pausa"
const MOB_GROWL_MS = 800;        // 0.8s extra sin atacar durante el grunido
// RUIDO DE COMBATE: cada golpe despierta mobs cercanos al impacto. Aumenta la
// presion ARPG sin subir dano ni romper el leash de cada spawn.
const MOB_NOISE = {
  basic: { range: 22, max: 7, ms: 3400, boostMs: 1100 },
  heavy: { range: 24, max: 8, ms: 3800, boostMs: 1250 },
  cleave: { range: 28, max: 10, ms: 4400, boostMs: 1500 },
  skill: { range: 32, max: 12, ms: 5400, boostMs: 1800 },
  bleed: { range: 12, max: 3, ms: 1600, boostMs: 600 },
  kill: { range: 36, max: 14, ms: 6600, boostMs: 2200 },
};
const MOB_NOISE_RUSH_MULT = 1.22;

// Persona and zone curves are isolated so balance can be tested without booting the relay.

// top 5 de rachas del dia (se resetea cada 24h)
let topStreaks = [];
const publicTopStreaks = () => topStreaks.map(({ name, v }) => ({ name, v }));
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
      if (!mobPointAllowed(x, z, { clearance: 1 })) continue;
      mobSpawns.push({ x, z, lvl, zone: clean(s.zone || '', 28), boss: !!s.boss, fodder: !!s.fodder, giant: !!s.giant });
    }
  } catch {
    mobSpawns = [];
  }
}

// crea un objeto mob desde un spawn. hpMax = 30 + lvl*16 (early amable); boss x4;
// la personalidad multiplica hp/velocidad/dano encima de eso.
function makeMob(id, spawn) {
  const persona = mobPersona(id, !!spawn.boss);
  const zb = zoneBalance(spawn);
  const hpMax = mobHpMax(spawn, persona);
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
    // El Gigante del Parque: rig propio (Rig_Large). Si este flag no se propaga,
    // nace como esqueleto normal (el mismo bug que ya tuvo `boss` una vez).
    giant: !!spawn.giant,
    kind: spawn.lvl - 1,
    zone: spawn.zone || '',
    targetId: null,
    hitCdMs: 0,
    wanderX: null,
    wanderZ: null,
    nextWanderMs: 0,
    persona,
    attackDueMs: 0,
    attackTargetId: null,
    attackDmg: 0,
    scentTargetId: null,
    scentUntilMs: 0,
    scentBoostUntilMs: 0,
    zoneDmgMult: zb.dmg,
    zoneSpeedMult: zb.speed,
    // RODEO: angulo propio alrededor del objetivo (angulo aureo por id = reparto parejo)
    surroundA: (id * 2.39996323) % (Math.PI * 2),
    // ZIGZAG: fase propia del desvio senoidal (que no caminen en fila india)
    zigPhase: (id * 1.7) % (Math.PI * 2),
    // TIMING: false hasta el primer contacto de cada enganche => primer golpe desfasado
    _engaged: false,
  };
}

// representacion publica del mob para los clientes.
// k2 = personalidad (0 normal, 1 corredor, 2 tanque) por si el cliente quiere pintarla.
function mobView(m) {
  const k2 = m.persona === 'corredor' ? 1 : (m.persona === 'tanque' ? 2 : 0);
  return { id: m.id, x: m.x, z: m.z, h: m.h, state: m.state, lvl: m.lvl, hp: m.hp, hpMax: m.hpMax, kind: m.kind, k2, zone: m.zone, b: m.boss ? 1 : 0, g: m.giant ? 1 : 0 };
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
  const next = chooseMobStep(mob, tx, tz, step);
  if (!next) return false;
  mob.x = next.x;
  mob.z = next.z;
  mob.h = next.h;
  return true;
}

// SEPARACION boids barata: empuje suave lejos de los mobs del MISMO pack
// (mismo targetId). NO es O(n^2): los packs se arman en una pasada O(n) por
// tick y cada mob revisa a lo sumo MOB_SEP_MAX_CHECK vecinos (offset por id
// para que no miren todos a los mismos). No toca mob.h: siguen mirando al
// objetivo mientras se acomodan.
function applyMobSeparation(mob, pack, dt) {
  if (!pack || pack.length < 2) return;
  const n = pack.length;
  const start = mob.id % n;   // ventana propia por id: reparte los chequeos
  let px = 0, pz = 0, checked = 0, found = false;
  for (let k = 0; k < n && checked < MOB_SEP_MAX_CHECK; k++) {
    const o = pack[(start + k) % n];
    if (o === mob || o.hp <= 0) continue;
    checked++;
    const dx = mob.x - o.x, dz = mob.z - o.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= MOB_SEP_RADIUS * MOB_SEP_RADIUS) continue;
    const d = Math.sqrt(d2);
    if (d < 0.001) {
      // apilados EXACTOS: separa con angulo aureo por id (unico por mob, evita NaN)
      const a = (mob.id * 2.39996323) % (Math.PI * 2);
      px += Math.cos(a); pz += Math.sin(a);
    } else {
      const w = (MOB_SEP_RADIUS - d) / MOB_SEP_RADIUS;   // mas cerca = mas empuje
      px += (dx / d) * w; pz += (dz / d) * w;
    }
    found = true;
  }
  if (!found) return;
  const m = Math.hypot(px, pz);
  if (m < 0.0001) return;
  const nx = mob.x + (px / m) * MOB_SEP_FORCE * dt;
  const nz = mob.z + (pz / m) * MOB_SEP_FORCE * dt;
  if (!mobPointAllowed(nx, nz)) return;
  mob.x = nx;
  mob.z = nz;
}

function clearMobWander(mob) {
  mob.wanderX = null;
  mob.wanderZ = null;
}

function setMobWanderTarget(mob, now) {
  const target = findWanderTarget(mob.spawnX, mob.spawnZ, MOB_WANDER_RADIUS);
  if (target) {
    mob.wanderX = target.x;
    mob.wanderZ = target.z;
  } else {
    clearMobWander(mob);
  }
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


function clearMobAttackWindup(mob) {
  mob.attackDueMs = 0;
  mob.attackTargetId = null;
  mob.attackDmg = 0;
}

function interruptMobAttackWindup(mob) {
  if (!mob || !(mob.attackDueMs > 0)) return false;
  const tid = mob.attackTargetId;
  const c = clients.get(tid);
  if (c && c.ws && c.ws.readyState === 1) send(c.ws, { t: 'pmiss', id: mob.id, told: 1, stagger: 1 });
  clearMobAttackWindup(mob);
  mob.hitCdMs = Math.max(mob.hitCdMs || 0, MOB_STAGGER_INTERRUPT_CD_MS);
  return true;
}

function clearMobScent(mob) {
  mob.scentTargetId = null;
  mob.scentUntilMs = 0;
  mob.scentBoostUntilMs = 0;
}

function validMobAttackTarget(mob, c) {
  if (!c || !c.ws || c.ws.readyState !== 1) return false;
  if (!Number.isFinite(c.x) || !Number.isFinite(c.z)) return false;
  if (inSafeZone(c)) return false;
  return Math.hypot(c.x - mob.spawnX, c.z - mob.spawnZ) <= MOB_LEASH_RANGE + 1;
}

function scentMobTarget(mob, now) {
  if (!mob.scentTargetId || !mob.scentUntilMs || now > mob.scentUntilMs) {
    clearMobScent(mob);
    return null;
  }
  const c = clients.get(mob.scentTargetId);
  if (!validMobAttackTarget(mob, c)) {
    clearMobScent(mob);
    return null;
  }
  const d = Math.hypot(c.x - mob.x, c.z - mob.z);
  return [mob.scentTargetId, c, d, true];
}

function stirCombatNoise(sourceId, source, x, z, kind, now) {
  const spec = MOB_NOISE[kind] || MOB_NOISE.basic;
  if (!source || !Number.isFinite(source.x) || !Number.isFinite(source.z)) return 0;
  if (inSafeZone(source)) return 0;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
  const candidates = [];
  for (const mob of mobs.values()) {
    if (!mob || mob.hp <= 0) continue;
    if (!validMobAttackTarget(mob, source)) continue;
    const d = Math.hypot(mob.x - x, mob.z - z);
    if (d > spec.range) continue;
    candidates.push({ mob, d });
  }
  candidates.sort((a, b) => a.d - b.d);
  let stirred = 0;
  for (const { mob } of candidates) {
    if (stirred >= spec.max) break;
    clearMobWander(mob);
    if (mob.attackDueMs > 0 && mob.attackTargetId !== sourceId) clearMobAttackWindup(mob);
    mob.targetId = sourceId;
    mob.scentTargetId = sourceId;
    mob.scentUntilMs = Math.max(mob.scentUntilMs || 0, now + spec.ms);
    mob.scentBoostUntilMs = Math.max(mob.scentBoostUntilMs || 0, now + spec.boostMs);
    mob._engaged = false;
    stirred++;
  }
  return stirred;
}

function faceMobTarget(mob, c) {
  mob.h = Math.atan2(c.x - mob.x, c.z - mob.z);
}

function beginMobAttackWindup(mob, tid, c, now) {
  faceMobTarget(mob, c);
  mob.attackTargetId = tid;
  mob.attackDueMs = now + MOB_ATTACK_WINDUP_MS;
  mob.attackDmg = mobDamage(mob);
  mob.hitCdMs = MOB_ATTACK_CD_MS;
  // GRUNIDO: 10% de las veces se toma 0.8s extra tras golpear (ritmo organico)
  if (Math.random() < MOB_GROWL_CHANCE) mob.hitCdMs += MOB_GROWL_MS;
  broadcastAll({
    t: 'matk',
    id: mob.id,
    target: tid,
    ms: MOB_ATTACK_WINDUP_MS,
    x: mob.x,
    z: mob.z,
    h: mob.h,
  });
}

function commitMobAttackWindup(mob, c) {
  if (validMobAttackTarget(mob, c)) {
    const d = Math.hypot(c.x - mob.x, c.z - mob.z);
    if (d <= MOB_ATTACK_COMMIT_RANGE) {
      faceMobTarget(mob, c);
      c.lastDamagedAt = Date.now();   // combat lock: no se recalla bajo fuego
      send(c.ws, { t: 'phit', id: mob.id, dmg: mob.attackDmg || mobDamage(mob), hp: null, told: 1 });
    } else {
      send(c.ws, { t: 'pmiss', id: mob.id, told: 1 });
    }
  }
  clearMobAttackWindup(mob);
}

function mobTick() {
  if (!clients.size || !mobs.size) return;
  const dt = MOB_TICK_MS / 1000;
  const now = Date.now();
  const changed = [];
  // pasada O(n): agrupa mobs por targetId (del tick anterior, persiste) para
  // la separacion. Un tick de lag en el pack es invisible e irrelevante.
  const packs = new Map();
  for (const mob of mobs.values()) {
    if (mob.hp <= 0 || mob.targetId == null) continue;
    let arr = packs.get(mob.targetId);
    if (!arr) { arr = []; packs.set(mob.targetId, arr); }
    arr.push(mob);
  }
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
      clearMobAttackWindup(mob);
      clearMobScent(mob);
      mob.targetId = null;
      mob._engaged = false;   // enganche roto: el proximo primer golpe vuelve a desfasarse
      if (stepToward(mob, mob.spawnX, mob.spawnZ, MOB_RETURN_SPEED * dt)) state = 'walk';
    } else if (mob.attackDueMs > 0) {
      const pendingTid = mob.attackTargetId;
      const pendingTarget = clients.get(pendingTid);
      if (!validMobAttackTarget(mob, pendingTarget)) {
        clearMobAttackWindup(mob);
        if (mob.scentTargetId === pendingTid) clearMobScent(mob);
        mob.targetId = null;
        mob._engaged = false;
      } else {
        mob.targetId = pendingTid;
        faceMobTarget(mob, pendingTarget);
        state = 'attack';
        if (now >= mob.attackDueMs) commitMobAttackWindup(mob, pendingTarget);
        applyMobSeparation(mob, packs.get(pendingTid), dt);
      }
    } else {
      const target = scentMobTarget(mob, now) || nearestMobTarget(mob);
      if (target) {
        const [tid, c, d, noisy] = target;
        mob.targetId = tid;
        clearMobWander(mob);
        const pk = MOB_PERSONAS[mob.persona] || MOB_PERSONAS.normal;
        if (d > MOB_ATTACK_RANGE) {
          // PANICO: al verte cerca CORREN (x1.7), y en el ultimo tramo EMBISTEN
          const rush = (d < 4 ? 2.3 : (d < 11 ? 1.7 : 1)) * (noisy && now < (mob.scentBoostUntilMs || 0) ? MOB_NOISE_RUSH_MULT : 1);
          // RODEO: cerca del objetivo cada mob apunta a SU punto del anillo,
          // no al centro del jugador => la manada rodea en vez de apilarse
          let tx = c.x, tz = c.z;
          if (d < MOB_SURROUND_DIST) {
            tx = c.x + Math.sin(mob.surroundA) * MOB_SURROUND_R;
            tz = c.z + Math.cos(mob.surroundA) * MOB_SURROUND_R;
          }
          // ZIGZAG: desvio senoidal perpendicular al avance (fase por id,
          // periodo ~1.6s) que se apaga al acercarse para no fallar la mordida
          const zigK = Math.min(1, (d - MOB_ATTACK_RANGE) / 6);
          const zig = Math.sin(now / 260 + mob.zigPhase) * MOB_ZIGZAG_AMP * zigK;
          const ux = (c.x - mob.x) / d, uz = (c.z - mob.z) / d;
          tx += -uz * zig;
          tz += ux * zig;
          if (stepToward(mob, tx, tz, MOB_SPEED * rush * pk.speed * (mob.zoneSpeedMult || 1) * dt)) state = 'walk';
        } else {
          mob.h = Math.atan2(c.x - mob.x, c.z - mob.z);
          state = 'attack';
          if (!mob._engaged) {
            // primer contacto del enganche: golpe DESFASADO 0-600ms para que
            // la manada no muerda toda en el mismo frame
            mob._engaged = true;
            mob.hitCdMs = Math.max(mob.hitCdMs, Math.random() * MOB_FIRST_HIT_JITTER_MS);
          } else if (mob.hitCdMs <= 0) {
            beginMobAttackWindup(mob, tid, c, now);
          }
        }
        // SEPARACION: acomodo suave contra companeros del mismo pack (walk y attack)
        applyMobSeparation(mob, packs.get(tid), dt);
      } else {
        mob.targetId = null;
        clearMobScent(mob);
        mob._engaged = false;
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
console.log('[world-obstacles]', JSON.stringify(obstacleStats()));

// OLEADAS ZOMBIE: brotan de forma espaciada; evento fuerte, no ruido constante.
// al azar. Sin _spawn => no respawnean: limpiarla ES el evento (botin de racha).
const WAVE_EVERY_MS = Math.max(1500000, Number(process.env.WAVE_EVERY_MS) || 1500000);
const WAVE_BASE_SIZE = 3;
const WAVE_MAX_SIZE = 5;
const WAVE_TTL_MS = 60000;
const WAVE_BOSS_TTL_MS = 180000;
let waveN = 0;
function hasActiveWave() {
  for (const mob of mobs.values()) {
    if (mob._waveId != null) return true;
  }
  return false;
}
const waveTimer = setInterval(() => {
  if (hasActiveWave()) return;
  const players = [...clients.values()].filter((c) => c.ws && c.ws.readyState === 1 && !inSafeZone(c));
  if (!players.length) return;
  const c = players[Math.floor(Math.random() * players.length)];
  // la oleada ESCALA con el poder del objetivo (estimado por su hpMax):
  // un novato recibe 3 zombies suaves; un veterano, hasta 5 y de nivel alto
  const power = Math.max(0, Math.round(((c.hm || 100) - 100) / 50));
  waveN++;
  const size = Math.min(WAVE_MAX_SIZE, WAVE_BASE_SIZE + Math.floor(power / 3));
  const lvlCap = Math.min(5, 2 + Math.ceil(power / 2));
  // La ABOMINACION debe sentirse especial, no aparecer cada pocos minutos.
  const withBoss = waveN % 10 === 0;
  let bossSpawned = false;
  for (let i = 0; i < size; i++) {
    const open = findOpenSpawnAround(c.x, c.z, 16, 40, { attempts: 32 });
    if (!open) continue;
    const spawn = {
      x: open.x,
      z: open.z,
      lvl: 1 + Math.floor(Math.random() * lvlCap),
      zone: 'oleada',
    };
    const id = nextMobId++;
    const mob = makeMob(id, spawn);
    mob._waveId = waveN;
    mob._dieAtMs = Date.now() + WAVE_TTL_MS;
    mobs.set(id, mob);
    broadcastAll({ t: 'mspawn', mob: mobView(mob) });
  }
  if (withBoss) {
    const open = findOpenSpawnAround(c.x, c.z, 24, 30, { attempts: 32 });
    if (open) {
      const id = nextMobId++;
      const mob = makeMob(id, { x: open.x, z: open.z, lvl: Math.min(5, 3 + Math.ceil(power / 2)), zone: 'boss', boss: true });
      mob._waveId = waveN;
      mob._dieAtMs = Date.now() + WAVE_BOSS_TTL_MS;
      mobs.set(id, mob);
      broadcastAll({ t: 'mspawn', mob: mobView(mob) });
      bossSpawned = true;
    }
  }
  // Keep the legacy field so older clients stay protocol-compatible.
  broadcastAll({ t: 'wave', x: Math.round(c.x), z: Math.round(c.z), boss: bossSpawned ? 1 : 0, night: 0 });
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
function inSafeZone(c) {
  if (!Number.isFinite(c.x) || !Number.isFinite(c.z)) return true;
  return Math.hypot(c.x - SAFE_X, c.z - SAFE_Z) < SAFE_R;
}

// Nivel en el que el server CREE al jugador, para calcular su techo de dano.
// Cuentas: el nivel persistido (ya protegido por el guard de progresion), con
// tolerancia para los niveles ganados desde el ultimo save.
// Invitados: no persisten nada, asi que el nivel que reportan se acota por el
// tiempo que llevan conectados. Nadie llega a nivel 99 en tres segundos.
const GUEST_MINUTES_PER_LEVEL = 0.75;
function authoritativeLevel(c) {
  if (!c) return 1;
  const acc = c.account && store.accounts[c.account];
  const stored = acc && acc.char ? clampInt(acc.char.level, 1, MAX_PLAYER_LEVEL) : 0;
  if (stored) return Math.min(MAX_PLAYER_LEVEL, stored + MAX_LEVEL_GAIN_PER_SAVE);
  const minutes = Math.max(0, (Date.now() - (c.joinedAt || 0)) / 60000);
  const ceiling = 1 + Math.floor(minutes / GUEST_MINUTES_PER_LEVEL);
  return Math.max(1, Math.min(clampInt(c.lv || 1, 1, MAX_PLAYER_LEVEL), ceiling));
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
  const me = {
    ws, name: 'Anon', char: 'char_knight.glb', x: SAFE_X, z: SAFE_Z, h: 0, a: 'Idle', account: null,
    lastMoveAt: Date.now(), moveCredit: MOVEMENT_MAX_CREDIT,
    joinedAt: Date.now(), greeted: false, alive: true,
    ip: (req && req.socket && req.socket.remoteAddress) || 'unknown',
  };
  clients.set(id, me);
  console.log('conn', id, 'from', req && req.socket && req.socket.remoteAddress, '| total', clients.size);
  send(ws, { t: 'id', id });

  ws.on('message', async (buf) => {
    let m;
    try { m = JSON.parse(buf); } catch { return; }

    // LOGIN CON GOOGLE (via Privy). El cliente trae un access token JWT; el server
    // lo verifica contra la clave publica de Privy y lo ata al DID del usuario.
    if (m.t === 'privy') {
      if (authRateLimited(me)) {
        send(ws, { t: 'auth', ok: false, error: 'Demasiados intentos. Espera un momento.' });
        return;
      }
      const verdict = await verifyPrivyToken(m.token);
      if (!verdict.ok) {
        send(ws, { t: 'auth', ok: false, error: 'No se pudo verificar tu sesion de Google' });
        return;
      }
      const did = verdict.subject;
      const existing = privyIndex.get(did);
      if (existing && store.accounts[existing]) {
        me.account = existing;
        const token = newToken(existing);
        send(ws, {
          t: 'auth', ok: true, god: existing === GOD_USER, user: existing,
          char: store.accounts[existing].char, token,
        });
        return;
      }
      // DID nuevo: hace falta un nombre de cuenta para crearla.
      const user = String(m.user || '');
      if (!user) { send(ws, { t: 'auth', ok: false, needsUsername: true, error: 'Elige un nombre' }); return; }
      if (!/^[a-zA-Z0-9_]{3,16}$/.test(user) || (GOD_USER && user.toLowerCase() === GOD_USER.toLowerCase())) {
        send(ws, { t: 'auth', ok: false, needsUsername: true, error: 'Usuario invalido' });
        return;
      }
      if (store.accounts[user]) {
        send(ws, { t: 'auth', ok: false, needsUsername: true, error: 'Ese usuario ya existe' });
        return;
      }
      store.accounts[user] = { salt: null, hash: null, privySub: did, char: null };
      privyIndex.set(did, user);
      markDirty();
      me.account = user;
      send(ws, { t: 'auth', ok: true, god: false, user, char: null, token: newToken(user) });
      return;
    }

    // CLAIM de migracion: una cuenta vieja de contrasena se ata a un Google.
    // Despues de esto, esa cuenta entra por Google. Se corre UNA vez por cuenta.
    if (m.t === 'privylink') {
      if (authRateLimited(me)) { send(ws, { t: 'link', ok: false, error: 'Demasiados intentos' }); return; }
      if (!me.account || !store.accounts[me.account]) {
        send(ws, { t: 'link', ok: false, error: 'Inicia sesion con tu contrasena primero' });
        return;
      }
      const verdict = await verifyPrivyToken(m.token);
      if (!verdict.ok) { send(ws, { t: 'link', ok: false, error: 'Token invalido' }); return; }
      const did = verdict.subject;
      const owner = privyIndex.get(did);
      if (owner && owner !== me.account) {
        send(ws, { t: 'link', ok: false, error: 'Ese Google ya esta atado a otra cuenta' });
        return;
      }
      const acc = store.accounts[me.account];
      acc.privySub = did;
      // el claim retira la contrasena: la cuenta pasa a ser solo-Google.
      acc.salt = null;
      acc.hash = null;
      privyIndex.set(did, me.account);
      markDirty();
      revokeTokensFor(me.account);   // fuerza re-login por el camino nuevo
      send(ws, { t: 'link', ok: true, user: me.account });
      return;
    }

    if (m.t === 'register') {
      if (!PASSWORD_AUTH_ENABLED) {
        send(ws, { t: 'auth', ok: false, error: 'Entra con Google' });
        return;
      }
      if (authRateLimited(me)) {
        send(ws, { t: 'auth', ok: false, error: 'Demasiados intentos. Espera un momento.' });
        return;
      }
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
      const hash = await hashPassword(pass, salt);
      store.accounts[user] = { salt, hash, char: null };
      markDirty();
      const token = newToken(user);
      me.account = user;
      send(ws, { t: 'auth', ok: true, god: false, user, char: null, token });
      return;
    }

    if (m.t === 'login') {
      if (!PASSWORD_AUTH_ENABLED) {
        send(ws, { t: 'auth', ok: false, error: 'Entra con Google' });
        return;
      }
      if (authRateLimited(me)) {
        send(ws, { t: 'auth', ok: false, error: 'Demasiados intentos. Espera un momento.' });
        return;
      }
      const user = String(m.user || '');
      const pass = String(m.pass || '');

      // GOD: usuario exacto + verificacion del HASH (provisto por el entorno).
      if (GOD_ENABLED && user === GOD_USER && await verifyPassword(pass, GOD_PASS_SALT, GOD_PASS_HASH)) {
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
      // una cuenta ya migrada a Google no tiene hash: no entra por contrasena.
      if (!acc || !acc.hash || !await verifyPassword(pass, acc.salt, acc.hash)) {
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
      // rate limit: sin esto, el cap de crecimiento por save no acota nada
      // (spameas saves y sumas el maximo cada vez), y cada save ensucia el store.
      const nowSave = Date.now();
      if (nowSave - (me.lastSaveAt || 0) < SAVE_MIN_INTERVAL_MS) return;
      me.lastSaveAt = nowSave;
      const sanitized = sanitizeChar(m.char, me.account);
      if (!sanitized) return;    // save invalido o anti-cheat: ignorar
      if (!store.accounts[me.account]) return;
      store.accounts[me.account].char = sanitized;
      markDirty();
      return;
    }

    if (m.t === 'hi') {
      // UN saludo por conexion. Repetirlo reenviaba roster+mobs y broadcasteaba
      // `join` a todos: amplificacion O(N) gratis, y ademas teleportaba a la
      // gruta sin permiso. Un reconnect abre un socket nuevo, no reusa este.
      if (me.greeted) return;
      me.greeted = true;
      // si trae token valido, atamos la conexion a la cuenta (para los saves).
      const tokenUser = accountForToken(m.token);
      if (tokenUser) me.account = tokenUser;
      me.name = clean(m.name, 16) || 'Anon';
      // char SOLO de la allowlist: se rebroadcastea y cada cliente lo usa como
      // ruta de asset (path traversal si va crudo). Cernunnos solo Diosito.
      const wantChar = String(m.char || '');
      me.char = (CHAR_ALLOWLIST.includes(wantChar) && !(wantChar === GOD_CHAR && me.account !== GOD_USER))
        ? wantChar : 'char_knight.glb';
      // customizacion visual mix-and-match: saneada y rebroadcasteada
      me.cu = sanitizeCu(m.cu);
      // Initial spawn is server-owned. The movement packet can update position
      // after join, but non-standard clients cannot override the gruta spawn.
      me.x = SAFE_X;
      me.z = SAFE_Z;
      me.h = Number.isFinite(Number(m.h)) ? clampNum(m.h, -10, 10) : me.h;
      me.lastMoveAt = Date.now();
      me.moveCredit = MOVEMENT_MAX_CREDIT;
      me.a = clean(m.a, 12) || 'Idle';
      me.hp = clampInt(m.hp ?? 100, 0, 100000);
      me.hm = clampInt(m.hm ?? 100, 1, 100000);
      me.lv = clampInt(m.lv ?? 1, 1, 99);
      const players = [];
      for (const [oid, c] of clients) {
        if (oid !== id) players.push({ id: oid, name: c.name, char: c.char, cu: c.cu, lv: c.lv, x: c.x, z: c.z, h: c.h, a: c.a, hp: c.hp, hm: c.hm });
      }
      send(ws, { t: 'roster', players });
      // estado actual de los mobs compartidos (server-authoritative).
      send(ws, { t: 'mobs', list: [...mobs.values()].map(mobView) });
      broadcast(id, { t: 'join', id, name: me.name, char: me.char, cu: me.cu, lv: me.lv, x: me.x, z: me.z, h: me.h, a: me.a, hp: me.hp, hm: me.hm });
      // presencia: avisa a mis amigos conectados que entre, y mandame mi lista
      if (me.account) {
        notifyFriendPresence(me.account);
        send(ws, { t: 'flist', friends: friendsPayload(me.account) });
      }
      if (topStreaks.length) send(ws, { t: 'top', list: publicTopStreaks() });
    } else if (m.t === 'recall') {
      // el cliente EMPIEZA la canalizacion de la tecla B. El server la cronometra.
      const now = Date.now();
      if (me.recallStartAt && now - me.recallStartAt < RECALL_CD_MS) return;
      if (now - (me.lastDamagedAt || 0) < RECALL_COMBAT_LOCK_MS) {
        send(ws, { t: 'recallfail', reason: 'combat' });
        return;
      }
      me.recallStartAt = now;

    } else if (m.t === 's') {
      // Position remains responsive locally, but impossible jumps are corrected server-side.
      const now = Date.now();
      me.hp = clampInt(m.hp, 0, 100000); me.hm = clampInt(m.hm ?? 100, 1, 100000);
      me.lv = clampInt(m.lv ?? 1, 1, 99);

      // AUTORIZACION de aparicion en la gruta. Dos caminos legitimos:
      //  1. moriste: el server lo ve (hp<=0) y te deja volver.
      //  2. canalizaste la tecla B el tiempo completo sin recibir dano.
      if (me.hp <= 0) me.homeGrantUntil = now + RESPAWN_GRANT_MS;
      else if (me.recallStartAt && now - me.recallStartAt >= RECALL_CHANNEL_MS) {
        me.recallStartAt = 0;
        me.homeGrantUntil = now + RECALL_GRANT_MS;
      }
      const homeGrant = (me.homeGrantUntil || 0) > now;

      const rawX = Number(m.x), rawZ = Number(m.z);
      const requestedX = Number.isFinite(rawX) ? clampNum(rawX, -3000, 3000) : me.x;
      const requestedZ = Number.isFinite(rawZ) ? clampNum(rawZ, -3000, 3000) : me.z;
      const movement = guardMovement(me, requestedX, requestedZ, now, { homeGrant });
      me.x = movement.x; me.z = movement.z;
      if (movement.home) me.homeGrantUntil = 0;   // el permiso se consume de una
      if (movement.corrected) {
        send(ws, { t: 'corr', x: me.x, z: me.z, reason: 'speed' });
      }
      me.h = clampNum(m.h, -10, 10); me.a = clean(m.a, 12) || 'Idle';
      const stateMsg = { t: 's', id, x: me.x, z: me.z, h: me.h, a: me.a, hp: me.hp, hm: me.hm, lv: me.lv };
      const dk = me.a === 'Dash' ? cleanDodgeKey(m.dk) : '';
      if (dk) stateMsg.dk = dk;
      broadcast(id, stateMsg);
    } else if (m.t === 'atk') {
      const kind = clean(m.k, 24);
      const msg = kind ? { t: 'atk', id, k: kind } : { t: 'atk', id };
      const tt = clean(m.tt, 12);
      if (tt === 'mob' || tt === 'player' || tt === 'point') msg.tt = tt;
      const tid = clean(m.tid, 24);
      if (tid) msg.tid = tid;
      const tx = Number(m.tx), tz = Number(m.tz);
      if (Number.isFinite(tx) && Number.isFinite(tz)) {
        msg.tx = clampNum(tx, -3000, 3000);
        msg.tz = clampNum(tz, -3000, 3000);
      }
      const am = Number(m.am);
      if (Number.isFinite(am)) msg.am = clampNum(am, 0.75, 1.5);
      broadcast(id, msg);
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
      // 20m cubre proyectiles y AoE alrededor del target; el feel melee lo pone el cliente.
      if (Math.hypot(mob.x - me.x, mob.z - me.z) > 20.0) return;
      const now = Date.now();
      if (!me.lastMobHitAt) me.lastMobHitAt = new Map();
      const rawKind = clean(m.k || 'basic', 12);
      const hitKind = rawKind === 'skill' || rawKind === 'cleave' || rawKind === 'bleed' || rawKind === 'heavy' ? rawKind : 'basic';
      const rateKind = hitKind === 'heavy' ? 'basic' : hitKind;
      const hitRateMs = rateKind === 'bleed' ? MOB_BLEED_HIT_RATE_MS : (rateKind === 'basic' ? MOB_HIT_RATE_MS : MOB_SKILL_HIT_RATE_MS);
      const hitKey = mid + ':' + rateKind;
      const lastHitAt = me.lastMobHitAt.get(hitKey) || 0;
      if (now - lastHitAt < hitRateMs) return;
      me.lastMobHitAt.set(hitKey, now);
      if (me.lastMobHitAt.size > 256) {
        const cutoff = now - 5000;
        for (const [oldKey, t] of me.lastMobHitAt) if (t < cutoff) me.lastMobHitAt.delete(oldKey);
      }
      // El cliente propone el dano; el server lo acota a lo que un jugador de
      // ese nivel puede producir. Sin esto, dmg=3000 mata cualquier boss.
      const dmgCap = Math.min(MOB_DMG_MAX, maxPlayerHit(authoritativeLevel(me), hitKind));
      const dmg = clampNum(m.dmg, 0, dmgCap);
      const hpBefore = mob.hp;
      mob.hp -= dmg;
      const staggered = mob.hp > 0
        && (hitKind === 'skill' || hitKind === 'cleave' || hitKind === 'heavy')
        && interruptMobAttackWindup(mob);
      stirCombatNoise(id, me, mob.x, mob.z, hitKind, now);
      if (mob.hp > 0) {
        broadcastAll({
          t: 'mhp',
          id: mob.id,
          hp: mob.hp,
          dmg,
          k: hitKind,
          by: id,
          sx: me.x,
          sz: me.z,
          stagger: staggered ? 1 : 0,
        });
      } else {
        // muerto: sacar del mapa, calcular party del que lo mato, avisar a todos.
        const spawn = mob._spawn;
        const deadId = mob.id;
        const party = partyMemberIds(id);
        const deathMsg = {
          t: 'mdead',
          id: deadId,
          by: id,
          party,
          x: mob.x,
          z: mob.z,
          lvl: mob.lvl,
          hpMax: mob.hpMax,
          hpBefore,
          dmg,
          k: hitKind,
          sx: me.x,
          sz: me.z,
          boss: !!mob.boss,
        };
        mobs.delete(deadId);
        broadcastAll(deathMsg);
        stirCombatNoise(id, me, deathMsg.x, deathMsg.z, 'kill', now);
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
      if (me._rankAt && nowMs - me._rankAt < 4000) return;
      me._rankAt = nowMs;
      const v = clampInt(m.v, 2, 80);
      const name = clean(me.name || 'Explorador', 20) || 'Explorador';
      const cur = topStreaks.find((e) => e.name === name);
      if (cur) {
        if (v > cur.v) cur.v = v;
        cur.at = nowMs;
      } else {
        topStreaks.push({ name, v, at: nowMs });
      }
      topStreaks.sort((a, b) => (b.v - a.v) || ((b.at || 0) - (a.at || 0)));
      if (topStreaks.length > 5) topStreaks.length = 5;
      broadcastAll({ t: 'top', list: publicTopStreaks() });
    } else if (m.t === 'pskill') {
      // skill de PARTY: reenvia el buff/cura a los miembros del grupo del
      // emisor. Allowlist de tipos + clamps + cooldown anti-spam de 2.5s.
      const PSKILL_KINDS = new Set(['heal', 'dmgbuff', 'haste', 'shield']);
      const kind = String(m.kind || '');
      if (!PSKILL_KINDS.has(kind)) return;
      const nowMs = Date.now();
      // cooldown POR TIPO. Uno solo de 2.5s dejaba rotar haste/shield/heal y
      // mantener al party buffeado permanentemente (los CD reales son 28-30s).
      if (!me._pskillAt) me._pskillAt = new Map();
      if (nowMs - (me._pskillAt.get(kind) || 0) < PSKILL_CD_MS) return;
      me._pskillAt.set(kind, nowMs);
      const v = Math.max(0, Math.min(kind === 'shield' ? 60 : 1, Number(m.v) || 0));
      const dur = Math.max(0, Math.min(12, Number(m.dur) || 0));
      const fromName = me.name || me.account || 'aliado';
      for (const mid of partyMemberIds(id)) {
        if (mid === id) continue;
        const c = clients.get(mid);
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
      const pvpCap = Math.min(PVP_DMG_MAX, maxPlayerHit(authoritativeLevel(me), 'basic'));
      const dmg = clampNum(m.dmg, 0, pvpCap);
      // registrar el atacante en la VICTIMA: pvpdead solo vale contra esto
      target.lastAttackerId = id;
      target.lastAttackerMs = now;
      target.lastDamagedAt = now;      // combat lock del recall
      target.recallStartAt = 0;        // recibir un golpe CANCELA la canalizacion
      send(target.ws, { t: 'pvph', from: id, name: me.name, dmg });
      broadcastAll({ t: 'pvpi', from: id, to, dmg });

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

  ws.on('pong', () => { me.alive = true; });

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

// HEARTBEAT. `ws` no chequea liveness solo: una conexion medio abierta (laptop
// suspendida, wifi cortado sin FIN) nunca dispara 'close', asi que el jugador
// quedaba de FANTASMA en el roster de todos, y su party nunca se disolvia.
const HEARTBEAT_MS = 30000;
const heartbeat = setInterval(() => {
  for (const c of clients.values()) {
    if (!c.ws) continue;
    if (c.alive === false) { try { c.ws.terminate(); } catch {} continue; }
    c.alive = false;
    try { c.ws.ping(); } catch {}
  }
}, HEARTBEAT_MS);
if (heartbeat.unref) heartbeat.unref();

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
