import assert from 'node:assert/strict';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

globalThis.location = { hostname: '127.0.0.1', search: '?ws=ws%3A%2F%2F127.0.0.1%3A8456' };

const loads = [];
const sockets = [];
const sent = [];
GLTFLoader.prototype.loadAsync = function loadAsync(url) {
  loads.push(url);
  return new Promise(() => {});
};

globalThis.WebSocket = class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 1;
    sockets.push(this);
    queueMicrotask(() => this.onopen?.());
  }
  send(raw) { sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; }
};

const { Net } = await import('../src/net.js?smoke=eager-connect');

const net = new Net({ add() {} }, {
  name: 'Smoke',
  charFile: 'char_knight.glb',
  custom: null,
  cur: 'Idle',
  heading: 0,
  pos: { x: 12.34, z: 56.78 },
}, null);

await new Promise((resolve) => setTimeout(resolve, 0));

assert.equal(sockets.length, 1, 'websocket connects even while remote clips are pending');
assert.equal(sockets[0].url, 'ws://127.0.0.1:8456');
assert.equal(sent[0]?.t, 'hi', 'initial handshake was sent');
assert.equal('x' in sent[0], false, 'initial handshake should not send client-owned spawn x');
assert.equal('z' in sent[0], false, 'initial handshake should not send client-owned spawn z');
assert.equal(loads.length, 0, 'remote clip loading is deferred during initial connect');

net._ensureClipsReady();
assert.ok(loads.length > 0, 'remote clip loading can start on demand');

console.log('PASS: net connects before remote animation clips start loading');
