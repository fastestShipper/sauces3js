import assert from 'node:assert/strict';
import * as THREE from 'three';

const handlers = new Map();

function addHandler(name, fn) {
  if (!handlers.has(name)) handlers.set(name, []);
  handlers.get(name).push(fn);
}

function fire(name, event = {}) {
  for (const fn of handlers.get(name) || []) fn(event);
}

function lockTarget(name) {
  return {
    name,
    requestCount: 0,
    closest() { return false; },
    requestPointerLock() {
      this.requestCount++;
      document.pointerLockElement = this;
      fire('pointerlockchange');
      return Promise.resolve();
    },
  };
}

const canvas = lockTarget('canvas');
const body = lockTarget('body');
const uiButton = {
  requestCount: 0,
  closest(selector) {
    return String(selector || '').includes('button');
  },
  requestPointerLock() {
    this.requestCount++;
    document.pointerLockElement = this;
    fire('pointerlockchange');
    return Promise.resolve();
  },
};

globalThis.window = {};
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.addEventListener = addHandler;
globalThis.document = {
  hidden: false,
  pointerLockElement: null,
  body,
  querySelector(selector) {
    return selector === 'canvas' ? canvas : null;
  },
  addEventListener(name, fn) { addHandler(name, fn); },
  exitPointerLock() {
    this.pointerLockElement = null;
    fire('pointerlockchange');
  },
};

const { Player } = await import('../src/player.js');

const scene = new THREE.Scene();
const city = { collides() { return false; } };
const player = new Player(scene, city, [0, 0], {});

assert.equal(player.isMouseCaptured(), false, 'mouse should start uncaptured');
assert.equal(player.requestMouseCapture(canvas), true, 'explicit canvas capture should be accepted');
assert.equal(player.isMouseCaptured(), true, 'canvas pointer lock should mark mouse captured');
assert.equal(canvas.requestCount, 1, 'canvas should receive pointer lock request');

player.releaseMouseCapture();
assert.equal(player.isMouseCaptured(), false, 'release should clear pointer lock');

assert.equal(player.requestMouseCapture(uiButton), true, 'direct UI capture should fall back to canvas');
assert.equal(uiButton.requestCount, 0, 'UI target should not receive pointer lock');
assert.equal(canvas.requestCount, 2, 'UI target should fall back to canvas capture');

player.releaseMouseCapture();
fire('mousedown', { button: 0, target: uiButton });
assert.equal(player.isMouseCaptured(), false, 'mousedown on UI should not capture mouse');

fire('mousedown', {
  button: 2,
  target: canvas,
  preventDefault() { this.prevented = true; },
});
assert.equal(player.isMouseCaptured(), true, 'right mouse on canvas should capture mouse');

fire('blur');
assert.equal(player.isMouseCaptured(), false, 'window blur should release pointer lock');

player.locked = true;
assert.equal(player.requestMouseCapture(canvas), false, 'locked player should not capture mouse');

console.log('PASS: player pointer lock capture and release smoke');
