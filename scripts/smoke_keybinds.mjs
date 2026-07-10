const store = new Map();
globalThis.localStorage = {
  getItem(k) { return store.has(k) ? store.get(k) : null; },
  setItem(k, v) { store.set(k, String(v)); },
  removeItem(k) { store.delete(k); },
};
globalThis.window = { dispatchEvent() {} };
globalThis.CustomEvent = class CustomEvent { constructor(type) { this.type = type; } };

const kb = await import('../src/keybinds.js');

function check(name, ok) {
  if (!ok) throw new Error(name);
  console.log('PASS:', name);
}

kb.resetKeybinds();
check('default skill0 is Q', kb.matchesAction({ code: 'KeyQ' }, 'skill0'));
check('default sprint accepts right shift alias', kb.matchesAction({ code: 'ShiftRight' }, 'sprint'));
check('default chat accepts numpad enter alias', kb.matchesAction({ code: 'NumpadEnter' }, 'chat'));
check('default consumable2 is 3', kb.matchesAction({ code: 'Digit3' }, 'consumable2'));

kb.setKeybind('skill0', 'KeyZ');
check('skill0 remaps to Z', kb.matchesAction({ code: 'KeyZ' }, 'skill0'));
check('skill0 no longer fires on Q after remap', !kb.matchesAction({ code: 'KeyQ' }, 'skill0'));

kb.setKeybind('moveForward', 'ArrowUp');
check('move forward remaps to arrow up', kb.isActionDown({ ArrowUp: true }, 'moveForward'));
check('move forward no longer reads W after remap', !kb.isActionDown({ KeyW: true }, 'moveForward'));

kb.setKeybind('skill1', 'KeyZ');
check('duplicate binding clears previous action', kb.getActionCode('skill0') === '');
check('duplicate binding moves key to new action', kb.matchesAction({ code: 'KeyZ' }, 'skill1'));

kb.setKeybind('skill2', '');
check('cleared action does not match default key', !kb.matchesAction({ code: 'KeyR' }, 'skill2'));

kb.resetKeybinds();
check('reset restores skill0 Q', kb.matchesAction({ code: 'KeyQ' }, 'skill0'));

console.log('PASS: keybind smoke');
