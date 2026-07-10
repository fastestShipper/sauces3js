// Verificacion de access tokens de Privy (login con Google).
//
// Un access token de Privy es un JWT firmado con ES256. Para VERIFICARLO solo
// hace falta la clave de verificacion (PUBLICA, formato SPKI) y el app id.
// El "app secret" NO se usa aca: ese es para llamar a la API server-side de Privy.
//
// Claims que exige Privy (docs.privy.io/authentication/user-authentication/access-tokens):
//   iss = 'privy.io'
//   aud = <app id>
//   sub = DID del usuario (identidad estable, es la que atamos a la cuenta)
//   exp = expira ~1h despues de emitirse
//
// Config por ENTORNO, nunca en el codigo:
//   PRIVY_APP_ID
//   PRIVY_JWKS_URL           (opcional; por defecto se deriva del app id)
//   PRIVY_VERIFICATION_KEY   (opcional; PEM SPKI para pinear una sola clave)
//
// Por defecto se usa el JWKS PUBLICO de Privy. Ese endpoint publica VARIAS claves
// (Privy las rota): pinear una sola con PRIVY_VERIFICATION_KEY hace que los logins
// se caigan el dia que rote. El JWKS sigue la rotacion solo, y `jose` lo cachea.
//
// El "app secret" NO aparece por ningun lado: no se necesita para verificar.
//
// FALLA CERRADO: sin config, TODO token se rechaza. Nunca "si no hay clave,
// dejalo pasar".

const jose = require('jose');

const PRIVY_ISSUER = 'privy.io';
// margen para relojes desfasados entre el VPS y Privy
const CLOCK_TOLERANCE_S = 30;

const APP_ID = process.env.PRIVY_APP_ID || '';
const RAW_KEY = process.env.PRIVY_VERIFICATION_KEY || '';
const JWKS_URL = process.env.PRIVY_JWKS_URL || (APP_ID ? defaultJwksUrl(APP_ID) : '');

function defaultJwksUrl(appId) {
  return `https://auth.privy.io/api/v1/apps/${appId}/jwks.json`;
}

// En systemd/.env la clave suele venir con "\n" literales en una sola linea.
function normalizePem(raw) {
  const pem = String(raw || '').trim().replace(/\\n/g, '\n');
  return pem;
}

// Cache de resolvedores: uno por (url) y uno por (pem).
const _remoteSets = new Map();
function remoteJwks(url) {
  let set = _remoteSets.get(url);
  if (!set) {
    set = jose.createRemoteJWKSet(new URL(url), {
      cacheMaxAge: 10 * 60 * 1000,   // relee las claves cada 10 min
      cooldownDuration: 30 * 1000,   // no martillea Privy si llega un kid raro
      timeoutDuration: 5000,
    });
    _remoteSets.set(url, set);
  }
  return set;
}

const _pinnedKeys = new Map();
function pinnedKey(pem) {
  let p = _pinnedKeys.get(pem);
  if (!p) { p = jose.importSPKI(normalizePem(pem), 'ES256'); _pinnedKeys.set(pem, p); }
  return p;
}

function isConfigured() {
  return !!APP_ID && (!!JWKS_URL || !!RAW_KEY);
}

// Devuelve { ok, subject, email, error }. NUNCA lanza.
async function verifyPrivyToken(token, opts = {}) {
  const appId = opts.appId || APP_ID;
  const rawKey = opts.verificationKey || RAW_KEY;
  const jwksUrl = opts.jwksUrl || (opts.appId ? '' : JWKS_URL);
  if (!appId || (!rawKey && !jwksUrl)) return { ok: false, error: 'privy_not_configured' };
  if (typeof token !== 'string' || token.length < 20 || token.length > 4096) {
    return { ok: false, error: 'bad_token' };
  }

  try {
    // la clave pineada gana; si no, el JWKS remoto (que sigue la rotacion)
    const key = rawKey ? await pinnedKey(rawKey) : remoteJwks(jwksUrl);
    const { payload } = await jose.jwtVerify(token, key, {
      issuer: PRIVY_ISSUER,
      audience: appId,
      algorithms: ['ES256'],          // no aceptamos `alg: none` ni HS256
      clockTolerance: CLOCK_TOLERANCE_S,
    });
    const subject = String(payload.sub || '');
    if (!subject) return { ok: false, error: 'no_subject' };
    return { ok: true, subject, sessionId: String(payload.sid || '') };
  } catch (err) {
    // no filtramos el detalle del error al cliente
    return { ok: false, error: 'invalid_token', detail: err && err.code };
  }
}

module.exports = {
  PRIVY_ISSUER,
  APP_ID,
  JWKS_URL,
  defaultJwksUrl,
  isConfigured,
  verifyPrivyToken,
  normalizePem,
};
