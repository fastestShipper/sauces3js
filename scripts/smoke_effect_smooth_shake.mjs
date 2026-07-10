// El screen shake ahora esta APAGADO por defecto (mareaba y tapaba los
// telegraphs de los mobs). Sigue existiendo detras de `sauces_shake` en
// localStorage: 'off' (default) | 'min' | 'full'.
//
// Este smoke fija las dos mitades del contrato: que por defecto no sacuda, y que
// cuando se enciende siga siendo suave y decaiga como antes.
import assert from 'node:assert/strict';

let shakeMode = 'off';
globalThis.localStorage = {
  getItem(k) { return k === 'sauces_shake' ? shakeMode : null; },
  setItem() {},
};

const { Effects } = await import('../src/rpg/effects.js');

const scene = { add() {}, remove() {} };
const makeFx = () => new Effects(scene, () => null, () => ({ x: 0, z: 0 }));

// 1. Por DEFECTO: no sacude nada.
{
  shakeMode = 'off';
  const fx = makeFx();
  fx.shake(0.1, 0.14);
  assert.equal(fx.shakeT, 0, 'sin shake no debe arrancar el temporizador');
  assert.equal(fx.shakeAmp, 0, 'sin shake la amplitud queda en cero');
  assert.equal(fx.shakeOffset(), null, 'sin shake no hay offset de camara');
  console.log('PASS por defecto la camara NO se sacude');
}

// 2. En 'min' sacude, pero apenas.
{
  shakeMode = 'min';
  const fx = makeFx();
  fx.shake(0.1, 0.14);
  const o = fx.shakeOffset();
  assert.ok(o, 'en min deberia haber offset');
  const mag = Math.hypot(o.x, o.y, o.z);
  assert.ok(mag > 0 && mag < 0.006, `el preset min debe ser minimo, dio ${mag}`);
  console.log(`PASS preset 'min' sacude apenas (${mag.toFixed(5)})`);
}

// 3. En 'full' vale el comportamiento historico: sutil, suave y que decae.
{
  shakeMode = 'full';
  const fx = makeFx();
  fx.shake(0.1, 0.14);
  assert.ok(fx.shakeT >= 0.08 && fx.shakeT <= 0.09, 'shake duration should be short but visible');
  assert.ok(fx.shakeAmp >= 0.013 && fx.shakeAmp <= 0.015, 'shake amplitude should stay subtle');

  const a = fx.shakeOffset();
  const b = fx.shakeOffset();
  assert.deepEqual(b, a, 'shake offset should be stable within the same frame');

  const mag = Math.hypot(a.x, a.y, a.z);
  assert.ok(mag > 0.001 && mag < 0.016, `shake offset should stay subtle, got ${mag}`);

  fx.update(0.016);
  const c = fx.shakeOffset();
  assert.ok(c, 'shake should still exist after a small tick');
  const delta = Math.hypot(c.x - a.x, c.y - a.y, c.z - a.z);
  assert.ok(delta < 0.02, `shake should move smoothly between frames, got ${delta}`);

  fx.update(1);
  assert.equal(fx.shakeOffset(), null, 'shake should clear after its duration');
  assert.equal(fx.shakeAmp, 0, 'shake amplitude should reset after clearing');
  assert.equal(fx.shakeMaxT, 0, 'shake max duration should reset after clearing');
  console.log('PASS preset \'full\' sigue siendo sutil, suave y decae');
}

console.log('ALL PASS');
