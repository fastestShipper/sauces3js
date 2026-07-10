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
//   PRIVY_VERIFICATION_KEY   (PEM SPKI; los \n literales se aceptan)
//
// FALLA CERRADO: sin config, TODO token se rechaza. Nunca "si no hay clave,
// dejalo pasar".

const jose = require('jose');

const PRIVY_ISSUER = 'privy.io';
// margen para relojes desfasados entre el VPS y Privy
const CLOCK_TOLERANCE_S = 30;

const APP_ID = process.env.PRIVY_APP_ID || '';
const RAW_KEY = process.env.PRIVY_VERIFICATION_KEY || '';

// En systemd/.env la clave suele venir con "\n" literales en una sola linea.
function normalizePem(raw) {
  const pem = String(raw || '').trim().replace(/\\n/g, '\n');
  return pem;
}

let keyPromise = null;
function verificationKey() {
  if (!keyPromise) keyPromise = jose.importSPKI(normalizePem(RAW_KEY), 'ES256');
  return keyPromise;
}

function isConfigured() {
  return !!APP_ID && !!RAW_KEY;
}

// Devuelve { ok, subject, email, error }. NUNCA lanza.
async function verifyPrivyToken(token, opts = {}) {
  const appId = opts.appId || APP_ID;
  const rawKey = opts.verificationKey || RAW_KEY;
  if (!appId || !rawKey) return { ok: false, error: 'privy_not_configured' };
  if (typeof token !== 'string' || token.length < 20 || token.length > 4096) {
    return { ok: false, error: 'bad_token' };
  }

  try {
    const key = opts.verificationKey
      ? await jose.importSPKI(normalizePem(opts.verificationKey), 'ES256')
      : await verificationKey();
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
  isConfigured,
  verifyPrivyToken,
  normalizePem,
};
