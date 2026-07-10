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
// Tras el redirect ya no sabemos con QUE proveedor entro el usuario, y
// `loginWithCode` lo necesita. Lo dejamos anotado antes de irnos.
const PROVIDER_KEY = 'sauces_privy_provider';

export async function resumeLogin(appId) {
  const privy = ensureClient(appId);
  const ret = readOAuthReturn();
  if (ret) {
    let provider = 'google';
    try { provider = localStorage.getItem(PROVIDER_KEY) || 'google'; } catch {}
    try {
      await privy.auth.oauth.loginWithCode(ret.code, ret.state, provider);
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    } finally {
      try { localStorage.removeItem(PROVIDER_KEY); } catch {}
    }
  }
  const token = await privy.getAccessToken().catch(() => null);
  return token ? { ok: true, token } : { ok: false };
}

// Proveedores habilitados en el app de Privy. Si agregas otro en el dashboard,
// agregalo aca tambien: pasar uno apagado hace que Privy rechace el redirect.
export const PROVIDERS = ['google', 'discord'];

// Manda al usuario al proveedor. La pagina se recarga al volver; `resumeLogin`
// termina el trabajo.
export async function loginWithProvider(appId, provider, redirectUri) {
  if (!PROVIDERS.includes(provider)) throw new Error('privy: proveedor no soportado: ' + provider);
  const privy = ensureClient(appId);
  const target = redirectUri || (location.origin + location.pathname + location.search);
  try { localStorage.setItem(PROVIDER_KEY, provider); } catch {}
  const res = await privy.auth.oauth.generateURL(provider, target);
  // Verificado contra Google y Discord: el campo es `url`. Los otros dos quedan
  // de red de seguridad por si el SDK cambia de nombre.
  const url = res && (res.url || res.oauth_url || res.authorization_url);
  if (!url) throw new Error('privy: no devolvio url de oauth (campos: ' + Object.keys(res || {}).join(',') + ')');
  location.assign(url);
}

export function loginWithGoogle(appId, redirectUri) {
  return loginWithProvider(appId, 'google', redirectUri);
}

export async function getAccessToken(appId) {
  return ensureClient(appId).getAccessToken().catch(() => null);
}

export async function logout(appId) {
  try { await ensureClient(appId).auth.logout(); } catch {}
}
