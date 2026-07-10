import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
    this.values = new Set();
  }

  setFrom(value) {
    this.values = new Set(String(value).split(/\s+/).filter(Boolean));
    this.sync();
  }

  sync() {
    this.owner._className = [...this.values].join(' ');
  }

  add(...names) {
    names.forEach(name => this.values.add(name));
    this.sync();
  }

  remove(...names) {
    names.forEach(name => this.values.delete(name));
    this.sync();
  }

  contains(name) {
    return this.values.has(name);
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.contains(name) : !!force;
    if (enabled) this.add(name);
    else this.remove(name);
    return enabled;
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.style = { transform: '', opacity: '' };
    this.classList = new FakeClassList(this);
    this._className = '';
    this.textContent = '';
    this.id = '';
    this.tabIndex = -1;
    this.parentNode = null;
  }

  set className(value) {
    this.classList.setFrom(value);
  }

  get className() {
    return this._className;
  }

  get offsetWidth() {
    return 74;
  }

  append(...children) {
    children.forEach(child => this.appendChild(child));
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  dispatch(type, init = {}) {
    const event = {
      changedTouches: [],
      code: '',
      repeat: false,
      prevented: false,
      stopped: false,
      preventDefault() { this.prevented = true; },
      stopPropagation() { this.stopped = true; },
      ...init,
    };
    for (const handler of this.listeners.get(type) || []) handler(event);
    return event;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  querySelector(selector) {
    if (!selector.startsWith('.')) return null;
    const className = selector.slice(1);
    for (const child of this.children) {
      if (child.classList.contains(className)) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }

  getBoundingClientRect() {
    if (this.classList.contains('tc-stick')) {
      return { left: 10, top: 20, right: 110, bottom: 120, width: 100, height: 100 };
    }
    return { left: 0, top: 0, right: 74, bottom: 74, width: 74, height: 74 };
  }
}

const document = {
  head: new FakeElement('head'),
  body: new FakeElement('body'),
  createElement(tagName) {
    return new FakeElement(tagName);
  },
  getElementById(id) {
    const visit = (root) => {
      if (root.id === id) return root;
      for (const child of root.children) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    };
    return visit(this.head) || visit(this.body);
  },
  elementFromPoint() {
    return this.body;
  },
};

const timers = new Map();
let nextTimerId = 1;
const globalListeners = new Map();
const context = {
  console,
  document,
  navigator: { maxTouchPoints: 1 },
  window: { ontouchstart: null },
  innerWidth: 390,
  requestAnimationFrame(callback) {
    callback();
  },
  setTimeout(callback) {
    const id = nextTimerId++;
    timers.set(id, callback);
    return id;
  },
  clearTimeout(id) {
    timers.delete(id);
  },
  addEventListener(type, handler) {
    const handlers = globalListeners.get(type) || [];
    handlers.push(handler);
    globalListeners.set(type, handlers);
  },
};
context.globalThis = context;
vm.createContext(context);

const source = await readFile(new URL('../src/touch.js', import.meta.url), 'utf8');
const executable = source
  .replace(
    /^import .*?;\s*/m,
    "const actionLabel = (action) => String(Number(action.replace('consumable', '')) + 1); const keybindChangeEvent = () => 'keybind-change'; ",
  )
  .replace(
    'export function installTouchControls',
    'globalThis.installTouchControls = function installTouchControls',
  );
vm.runInContext(executable, context, { filename: 'src/touch.js' });

const actionEvents = [];
const player = {
  keys: {},
  locked: false,
  yaw: 0,
  pitch: 0.5,
  setActionDown(action, down) {
    actionEvents.push({ action, down });
  },
};
const combatCalls = { cycle: 0, poke: 0 };
const combat = {
  targetId: null,
  pvpId: null,
  _cycleTarget() {
    combatCalls.cycle++;
  },
  manualAttack() {
    return false;
  },
  pokeAttack() {
    combatCalls.poke++;
  },
};

assert.equal(context.installTouchControls({ player, combat }), true);
const stick = document.body.querySelector('.tc-stick');
const guide = document.body.querySelector('.tc-stick-guide');
const nub = document.body.querySelector('.tc-nub');
const attack = document.body.querySelector('.tc-atk');
assert.ok(stick && guide && nub && attack, 'touch feedback elements must mount');

const styleText = document.getElementById('touch-style').textContent;
assert.match(styleText, /@media \(max-width:680px\)/, 'portrait layout constraint must remain');
assert.match(styleText, /@media \(max-height:660px\).*pointer:coarse/, 'touch landscape constraint must remain');
assert.match(styleText, /prefers-reduced-motion:reduce/, 'feedback must respect reduced motion');

const stickStart = stick.dispatch('touchstart', {
  changedTouches: [{ identifier: 7, clientX: 110, clientY: 70 }],
});
assert.equal(stickStart.prevented, true, 'joystick start must prevent browser gestures');
assert.equal(stick.classList.contains('is-active'), true, 'joystick must show its active state');
assert.equal(player.keys.KeyD, true, 'rightward joystick input must keep the existing movement action');
assert.equal(guide.style.transform, 'rotate(90.0deg) scaleY(1.000)', 'guide must expose deterministic direction and intensity');
assert.equal(guide.style.opacity, '0.900', 'guide must expose full input strength');
assert.equal(nub.style.transform, 'translate(42px,0px)', 'nub must keep the existing bounded travel');

stick.dispatch('touchend', {
  changedTouches: [{ identifier: 7, clientX: 110, clientY: 70 }],
});
assert.equal(stick.classList.contains('is-active'), false, 'joystick active feedback must clear');
assert.equal(guide.style.transform, '', 'joystick direction feedback must reset');
assert.equal(guide.style.opacity, '', 'joystick intensity feedback must reset');
assert.deepEqual(
  [player.keys.KeyW, player.keys.KeyA, player.keys.KeyS, player.keys.KeyD],
  [false, false, false, false],
  'joystick release must clear movement actions',
);

const attackStart = attack.dispatch('touchstart', {
  changedTouches: [{ identifier: 9, clientX: 350, clientY: 700 }],
});
assert.equal(attackStart.prevented, true, 'button press must prevent browser gestures');
assert.equal(attackStart.stopped, true, 'button press must not leak into camera drag');
assert.equal(attack.classList.contains('is-pressed'), true, 'button must expose a held state');
assert.equal(attack.classList.contains('is-pulsing'), true, 'button must expose tap confirmation');
assert.deepEqual(combatCalls, { cycle: 1, poke: 1 }, 'attack press must preserve one existing combat action');

attack.dispatch('touchstart', {
  changedTouches: [{ identifier: 9, clientX: 350, clientY: 700 }],
});
assert.deepEqual(combatCalls, { cycle: 1, poke: 1 }, 'held touch must not repeat the action');

attack.dispatch('touchcancel', {
  changedTouches: [{ identifier: 9, clientX: 350, clientY: 700 }],
});
assert.equal(attack.classList.contains('is-pressed'), false, 'cancel must clear the held state');

for (const callback of timers.values()) callback();
assert.equal(attack.classList.contains('is-pulsing'), false, 'tap confirmation must settle cleanly');

assert.ok(
  actionEvents.some(event => event.action === 'moveRight' && event.down),
  'joystick must continue using the existing virtual movement action',
);
console.log('PASS: touch joystick direction and intensity feedback');
console.log('PASS: touch button press, pulse, cancel, and single-fire lifecycle');
