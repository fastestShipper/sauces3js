import assert from 'node:assert/strict';

globalThis.location = { hostname: '127.0.0.1', search: '?ws=ws%3A%2F%2F127.0.0.1%3A8456' };
globalThis.WebSocket = class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
  }
  send() {}
};

const { Net } = await import('../src/net.js?smoke=mpos-bootstrap');

function makeNet() {
  return new Net({ add() {} }, {
    name: 'Smoke',
    charFile: 'char_knight.glb',
    custom: null,
    cur: 'Idle',
    heading: 0,
    pos: { x: 0, z: 0 },
  }, null);
}

{
  const net = makeNet();
  const snapshots = [];
  const moves = [];
  net.onMobsSnapshot = (list) => snapshots.push(list);
  net.onMobMove = (mob) => moves.push({ ...mob });

  net._onMsg({
    t: 'mpos',
    list: [
      { id: 7, x: 1.25, z: -2.5, h: 0.75, state: 'walk', lvl: 3, hp: 24, hpMax: 30, kind: 2, zone: 'starter', b: 0 },
      { id: 8, x: 3, z: 4, h: 0, state: 'idle', lvl: 2, hp: 18, hpMax: 18, kind: 1, zone: 'starter', b: 0 },
    ],
  });

  assert.equal(net.mobs.size, 2, 'full mpos bootstraps mob state before mobs snapshot');
  assert.equal(snapshots.length, 1, 'bootstrap emits one synthetic snapshot');
  assert.equal(snapshots[0].length, 2);
  assert.equal(moves.length, 2, 'bootstrap still feeds move callbacks');
  assert.equal(net.mobs.get(7).x, 1.25);

  net._onMsg({ t: 'mpos', list: [{ id: 7, x: 9, z: 10, h: 1.5, state: 'attack' }] });
  assert.equal(snapshots.length, 1, 'later partial mpos does not repeat bootstrap');
  assert.equal(net.mobs.get(7).x, 9);
  assert.equal(net.mobs.get(7).state, 'attack');

  let playerHits = 0;
  net.onPlayerHit = () => { playerHits++; };
  net._onMsg({ t: 'phit', id: 7, dmg: 4, hp: null, told: 1 });
  assert.equal(playerHits, 0, 'mob damage is gated until mob visuals are ready');
  net.mobsVisualReady = true;
  net._onMsg({ t: 'phit', id: 7, dmg: 4, hp: null, told: 1 });
  assert.equal(playerHits, 0, 'mob damage is still gated until that mob has a visual');
  net.mobVisualIds.add('7');
  net._onMsg({ t: 'phit', id: 7, dmg: 4, hp: null, told: 1 });
  assert.equal(playerHits, 1, 'mob damage resumes once that mob visual is ready');
}

{
  const net = makeNet();
  let snapshots = 0;
  net.onMobsSnapshot = () => { snapshots++; };
  net._onMsg({ t: 'mpos', list: [{ id: 9, x: 1, z: 2 }] });
  assert.equal(net.mobs.size, 0, 'partial mpos without hpMax/lvl is not treated as a snapshot');
  assert.equal(snapshots, 0);
}

console.log('PASS: net bootstraps mob state from full mpos packets');
