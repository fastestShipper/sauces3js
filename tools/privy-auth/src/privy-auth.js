// Fuente del bundle de login con Google (Privy).
//
// El juego NO tiene bundler: `index.html` usa un importmap y carga three desde un
// CDN. Meterle React + Vite por una pantalla de login seria absurdo. En su lugar
// se pre-bundlea SOLO este modulo con esbuild y se sirve como un asset estatico
// mas (assets/js/privy-auth.js). El juego sigue sin build step.
//
// Este modulo es deliberadamente TONTO: consigue un access token de Google y se
// lo entrega al juego. Toda la logica de cuentas vive en el relay, que verifica
// el token contra el JWKS publico de Privy.
//
// Regenerar:  node tools/privy-auth/build.mjs
import Privy, { LocalStorage } from '@privy-io/js-sdk-core';

const OAUTH_CODE_PARAM = 'privy_oauth_code';
const OAUTH_STATE_PARAM = 'privy_oauth_state';

let client = null;

function ensureClient(appId) {
  if (!appId) throw new Error('privy: falta el appId');
  if (!client) client = new Privy({ appId, storage: new LocalStorage() });
  return client;
}

// Privy vuelve a nuestra URL con ?privy_oauth_code&privy_oauth_state.
// Los limpiamos de la barra para que un F5 no reintente un codigo ya gastado.
function readOAuthReturn() {
  const params = new URLSearchParams(location.search);
  const code = params.get(OAUTH_CODE_PARAM);
  const state = params.get(OAUTH_STATE_PARAM);
  if (!code || !state) return null;
  params.delete(OAUTH_CODE_PARAM);
  params.delete(OAUTH_STATE_PARAM);
  const qs = params.toString();
  history.replaceState({}, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  return { code, state };
}

// Se llama al arrancar la pagina. Si venimos del redirect de Google, termina el
// login y devuelve el access token. Si no, devuelve el token guardado (si sigue
// vivo) o null.
export async function resumeLogin(appId) {
  const privy = ensureClient(appId);
  const ret = readOAuthReturn();
  if (ret) {
    try {
      await privy.auth.oauth.loginWithCode(ret.code, ret.state, 'google');
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }
  const token = await privy.getAccessToken().catch(() => null);
  return token ? { ok: true, token } : { ok: false };
}

// Manda al usuario a Google. La pagina se recarga al volver; `resumeLogin`
// termina el trabajo.
export async function loginWithGoogle(appId, redirectUri) {
  const privy = ensureClient(appId);
  const target = redirectUri || (location.origin + location.pathname + location.search);
  const res = await privy.auth.oauth.generateURL('google', target);
  const url = res && (res.url || res.oauth_url || res.authorization_url);
  if (!url) throw new Error('privy: no devolvio url de oauth');
  location.assign(url);
}

export async function getAccessToken(appId) {
  return ensureClient(appId).getAccessToken().catch(() => null);
}

export async function logout(appId) {
  try { await ensureClient(appId).auth.logout(); } catch {}
}
