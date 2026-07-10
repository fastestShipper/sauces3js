// Cliente de cuentas: abre una conexion corta al relay, hace register/login y
// devuelve { ok, god, char, token, error }. El token despues lo usa Net en su
// 'hi' para atar la conexion de juego a la cuenta (y poder guardar progreso).
// WS_URL: SIEMPRE el server de prod, salvo en localhost donde se permite el override
// ?ws=... (solo para test). En produccion el override se ignora a proposito: si no,
// un link malicioso ?ws=wss://evil podria robar usuario+contraseña (phishing).
const PROD_WS = 'wss://sauces.controla.group/ws';
const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
export const WS_URL = isLocal
  ? (new URLSearchParams(location.search).get('ws') || PROD_WS)
  : PROD_WS;

// App id de Privy. Es PUBLICO (viaja en el token como `aud`), pero vive en el
// HTML y no en el codigo para poder cambiarlo sin rebuildear nada.
export const PRIVY_APP_ID =
  (typeof document !== 'undefined'
    && document.querySelector('meta[name="privy-app-id"]')?.content) || '';

// El SDK de Privy va pre-bundleado en un asset aparte (el juego no tiene bundler).
// Se carga PEREZOSAMENTE: son ~137 KB gzip que no hacen falta si entras de invitado.
let _privyModule = null;
export function loadPrivy() {
  if (!_privyModule) _privyModule = import('../../assets/js/privy-auth.js');
  return _privyModule;
}

// Login con Google/Discord. `token` es el access token de Privy; el relay lo
// verifica contra el JWKS publico. `user` solo hace falta la PRIMERA vez.
export function privyAuthRequest(token, user) {
  return wsRequest(
    (ws) => ws.send(JSON.stringify(user ? { t: 'privy', token, user } : { t: 'privy', token })),
    'auth',
  );
}

// CLAIM de migracion: entra con la contrasena vieja y ata el Google/Discord a esa
// misma cuenta. Ambos mensajes viajan por LA MISMA conexion, porque el server
// exige que ya estes autenticado en ella para aceptar el `privylink`.
export function privyLinkRequest(user, pass, token) {
  return new Promise((resolve) => {
    let ws;
    try { ws = new WebSocket(WS_URL); }
    catch { resolve({ ok: false, error: 'No se pudo conectar al servidor' }); return; }
    let done = false;
    const finish = (r) => { if (done) return; done = true; try { ws.close(); } catch { /* noop */ } resolve(r); };
    const to = setTimeout(() => finish({ ok: false, error: 'Sin respuesta del servidor' }), 10000);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'login', user, pass }));
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'auth') {
        if (!m.ok) { clearTimeout(to); finish(m); return; }
        ws.send(JSON.stringify({ t: 'privylink', token }));   // ya autenticado en ESTA conexion
        return;
      }
      if (m.t === 'link') { clearTimeout(to); finish(m); }
    };
    ws.onerror = () => { clearTimeout(to); finish({ ok: false, error: 'Error de conexion' }); };
  });
}

// una peticion corta: abre WS, manda, espera UN tipo de respuesta.
function wsRequest(sendFn, expect) {
  return new Promise((resolve) => {
    let ws;
    try { ws = new WebSocket(WS_URL); }
    catch { resolve({ ok: false, error: 'No se pudo conectar al servidor' }); return; }
    let done = false;
    const finish = (r) => { if (done) return; done = true; try { ws.close(); } catch { /* noop */ } resolve(r); };
    const to = setTimeout(() => finish({ ok: false, error: 'Sin respuesta del servidor' }), 10000);
    ws.onopen = () => sendFn(ws);
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === expect) { clearTimeout(to); finish(m); }
    };
    ws.onerror = () => { clearTimeout(to); finish({ ok: false, error: 'Error de conexion' }); };
  });
}

// mode = 'register' | 'login'. Resuelve siempre (nunca rechaza) con el objeto de auth.
export function authRequest(mode, user, pass) {
  return new Promise((resolve) => {
    let ws;
    try { ws = new WebSocket(WS_URL); }
    catch { resolve({ ok: false, error: 'No se pudo conectar al servidor' }); return; }
    let done = false;
    const finish = (r) => { if (done) return; done = true; try { ws.close(); } catch { /* noop */ } resolve(r); };
    const to = setTimeout(() => finish({ ok: false, error: 'Sin respuesta del servidor' }), 8000);
    ws.onopen = () => ws.send(JSON.stringify({ t: mode, user, pass }));
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'auth') { clearTimeout(to); finish(m); }
    };
    ws.onerror = () => { clearTimeout(to); finish({ ok: false, error: 'Error de conexion' }); };
  });
}
