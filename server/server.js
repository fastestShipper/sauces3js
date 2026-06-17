// Sauces multiplayer: tiny WebSocket relay. Each client sends its own state
// (pos/heading/anim); the server fans it out to everyone else. No physics, no
// auth, no rooms — just a shared walk-around. Runs on 127.0.0.1, nginx proxies
// wss://sauces.controla.group/ws to it.
const { WebSocketServer } = require('ws');

const PORT = 8456;
const wss = new WebSocketServer({ port: PORT, host: '127.0.0.1' });

let nextId = 1;
const clients = new Map();   // id -> { ws, name, char, x, z, h, a }

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(exceptId, obj) {
  const s = JSON.stringify(obj);
  for (const [id, c] of clients) if (id !== exceptId && c.ws.readyState === 1) c.ws.send(s);
}

// quita caracteres de control (< 32) sin regex de escapes; recorta a max chars
function clean(raw, max) {
  return [...String(raw || '')].filter((c) => c.charCodeAt(0) >= 32).join('').trim().slice(0, max);
}

wss.on('connection', (ws, req) => {
  const id = nextId++;
  const me = { ws, name: 'Anon', char: 'char_knight.glb', x: 0, z: 0, h: 0, a: 'Idle' };
  clients.set(id, me);
  console.log('conn', id, 'from', req && req.socket && req.socket.remoteAddress, '| total', clients.size);
  send(ws, { t: 'id', id });

  ws.on('message', (buf) => {
    let m;
    try { m = JSON.parse(buf); } catch { return; }
    if (m.t === 'hi') {
      me.name = clean(m.name, 16) || 'Anon';
      me.char = String(m.char || 'char_knight.glb').slice(0, 40);
      const players = [];
      for (const [oid, c] of clients) {
        if (oid !== id) players.push({ id: oid, name: c.name, char: c.char, x: c.x, z: c.z, h: c.h, a: c.a });
      }
      send(ws, { t: 'roster', players });
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
    }
  });

  ws.on('close', () => { clients.delete(id); broadcast(id, { t: 'leave', id }); });
  ws.on('error', () => {});
});

console.log('sauces-mp relay listening on 127.0.0.1:' + PORT);
