import { WebSocket } from '../server/node_modules/ws/wrapper.mjs';

const URL = 'ws://127.0.0.1:8456';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;

function check(name, ok) {
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name);
  if (!ok) failures++;
}

function client(name) {
  const ws = new WebSocket(URL);
  const c = { ws, name, id: null, msgs: [] };
  ws.on('message', (buf) => {
    const m = JSON.parse(buf.toString());
    c.msgs.push(m);
    if (m.t === 'id') c.id = m.id;
  });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.got = (t) => c.msgs.filter((m) => m.t === t);
  c.open = new Promise((resolve) => ws.on('open', resolve));
  return c;
}

const suffix = Date.now().toString(36).slice(-6) + String(process.pid % 10000);
const A = client('rankA' + suffix);
const B = client('rankB' + suffix);
await Promise.all([A.open, B.open]);
await wait(250);

A.send({ t: 'hi', name: A.name, char: 'char_knight.glb' });
B.send({ t: 'hi', name: B.name, char: 'char_mage.glb' });
await wait(300);

A.send({ t: 'rank', v: 80 });
await wait(300);
const top = A.got('top').at(-1) || B.got('top').at(-1);
check('rank report updates top streak list',
  !!top && Array.isArray(top.list) && top.list.some((e) => e.name === A.name && e.v === 80));

A.send({ t: 'pinvite', to: B.id });
await wait(250);
check('party invite reaches target', B.got('pinvited').some((m) => m.from === A.id));
B.send({ t: 'paccept', from: A.id });
await wait(300);
check('party accept creates party for both',
  A.got('party').some((m) => Array.isArray(m.members) && m.members.some((p) => p.id === B.id)) &&
  B.got('party').some((m) => Array.isArray(m.members) && m.members.some((p) => p.id === A.id)));

A.send({ t: 'pskill', kind: 'haste', v: 0.35, dur: 6 });
await wait(350);
check('party skill reaches party member',
  B.got('pskill').some((m) => m.kind === 'haste' && m.from === A.name && m.v === 0.35 && m.dur === 6));

A.ws.close();
B.ws.close();
console.log(failures === 0 ? 'PASS: server rank party smoke' : failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
