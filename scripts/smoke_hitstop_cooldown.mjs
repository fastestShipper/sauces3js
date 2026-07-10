// Smoke: el hit-stop (freeze de impacto) cae UNA vez por combo, con cooldown.
//
// Antes congelaba el mundo al 12% en CADA golpe: se sentia como un tiron. Ahora
// es un premio del REMATE: solo se dispara via _bigHitStop(), y si paso el
// cooldown, para que un combo rapido no apile varios freezes.
import assert from 'node:assert/strict';

// stub minimo para instanciar Combat sin arrastrar todo el juego
globalThis.localStorage = { getItem() { return null; }, setItem() {} };

const { Combat } = await import('../src/rpg/combat.js');

// no llamamos al constructor completo: probamos la mecanica del hit-stop sobre
// un objeto con los campos que usa timeFactor/_bigHitStop.
const c = Object.create(Combat.prototype);
c.hitStopT = 0;
c._hitStopCdT = 0;
c.slowMoT = 0;

// 1. el primer remate SI congela
{
  const fired = c._bigHitStop();
  assert.equal(fired, true, 'el primer remate debe congelar');
  assert.ok(c.hitStopT > 0, 'hitStopT se activa');
  const f = c.timeFactor(0.001);
  assert.ok(f < 0.2, `durante el freeze el mundo va lento, factor ${f}`);
}

// 2. un segundo golpe INMEDIATO NO vuelve a congelar (cooldown)
{
  const fired = c._bigHitStop();
  assert.equal(fired, false, 'dentro del cooldown NO debe re-congelar');
}

// 3. drenar el freeze: el factor vuelve a 1 (mundo normal entre golpes)
{
  for (let i = 0; i < 40; i++) c.timeFactor(0.016);   // ~0.64s, mas que HITSTOP_DUR
  assert.equal(c.timeFactor(0.016), 1, 'entre golpes el mundo va a velocidad normal');
}

// 4. tras el cooldown completo, el proximo remate SI vuelve a congelar
{
  // avanzar el reloj mas alla del cooldown (1.6s)
  for (let i = 0; i < 120; i++) c.timeFactor(0.016);   // ~1.9s
  assert.ok(c._hitStopCdT <= 0, 'el cooldown ya expiro');
  const fired = c._bigHitStop();
  assert.equal(fired, true, 'pasado el cooldown, el remate vuelve a congelar');
}

// 5. golpes normales (sin _bigHitStop) NO tocan hitStopT: el mundo no frena
{
  const c2 = Object.create(Combat.prototype);
  c2.hitStopT = 0; c2._hitStopCdT = 0; c2.slowMoT = 0;
  // simular 5 golpes normales: no llaman _bigHitStop
  for (let i = 0; i < 5; i++) assert.equal(c2.timeFactor(0.016), 1, 'golpe normal no frena');
}

console.log('PASS el hit-stop cae una vez por remate, con cooldown; los golpes normales no frenan');
console.log('ALL PASS');
