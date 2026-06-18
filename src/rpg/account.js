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
