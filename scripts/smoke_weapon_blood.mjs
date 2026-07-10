// Smoke: el arma melee se EMPAPA de sangre al matar.
//
// Regresion de diseno: el arma ganaba 0.038 por kill hasta un techo de 0.52, y
// decaia 0.0052/s. Matando cada 7s el equilibrio quedaba en ~0.05: invisible.
// El bug no estaba en el shader sino en la curva ganancia/decaimiento.
import assert from 'node:assert/strict';

const { BloodCoat } = await import('../src/rpg/bloodcoat.js');

// jugador falso: un mesh "sostenido" (arma) y uno de cuerpo. BloodCoat solo
// necesita `player.char` con traverse; sin materiales reales no pinta nada,
// pero las intensidades (que es lo que se rompio) se calculan igual.
function fakePlayer() {
  return { char: { traverse() {} } };
}

function coat(style) {
  return new BloodCoat({ player: fakePlayer(), combatStyle: style });
}

// OJO: update() acota dt a 0.5s porque es un delta POR FRAME. Pasarle 120 de
// golpe solo avanza medio segundo. Para simular tiempo real hay que iterar.
function advance(bc, seconds, step = 0.5) {
  for (let t = 0; t < seconds; t += step) bc.update(step);
}

// 1. UN kill ya deja el arma claramente sangrienta.
{
  const bc = coat('2h');
  bc.recordKill(1);
  assert.ok(bc.weaponIntensity >= 0.3,
    `un kill deberia ensuciar el arma, quedo en ${bc.weaponIntensity}`);
  console.log(`PASS 1 kill -> arma en ${bc.weaponIntensity.toFixed(3)} (antes 0.038)`);
}

// 2. Tres kills la dejan casi empapada.
{
  const bc = coat('1h');
  for (let i = 0; i < 3; i++) bc.recordKill(1);
  assert.ok(bc.weaponIntensity >= 0.9, `3 kills deberian empapar, quedo en ${bc.weaponIntensity}`);
  console.log(`PASS 3 kills -> arma en ${bc.weaponIntensity.toFixed(3)}`);
}

// 3. El equilibrio en combate real (un kill cada 7s) es ALTO, no invisible.
//    Esto es exactamente lo que estaba roto.
{
  const bc = coat('dual');
  for (let round = 0; round < 12; round++) {
    bc.recordKill(1);
    advance(bc, 7);          // 7 segundos entre kills
  }
  assert.ok(bc.weaponIntensity > 0.6,
    `el equilibrio de combate deberia mantener el arma sucia, quedo en ${bc.weaponIntensity}`);
  console.log(`PASS equilibrio matando cada 7s -> ${bc.weaponIntensity.toFixed(3)} (antes ~0.05)`);
}

// 4. Sigue secandose: tras un rato largo sin matar, el arma se limpia.
{
  const bc = coat('2h');
  bc.recordKill(1);
  advance(bc, 120);
  assert.equal(bc.weaponIntensity, 0, 'tras 2 minutos sin matar el arma debe secarse');
  console.log('PASS tras 120s sin matar el arma se seca');
}

// 5. Las clases a distancia NO ensucian el arma (no hay hoja que manchar).
{
  const bc = coat('magic');
  bc.recordKill(1);
  assert.equal(bc.weaponIntensity, 0, 'un mago no ensangrienta su baston');
  assert.ok(bc.bodyIntensity > 0, 'pero el cuerpo si se salpica');
  console.log('PASS ranged: arma limpia, cuerpo salpicado');
}

// 6. El cuerpo sigue siendo SUTIL (no se toco su curva).
{
  const bc = coat('2h');
  bc.recordKill(1);
  assert.ok(bc.bodyIntensity < 0.1, `el cuerpo debe seguir sutil, quedo en ${bc.bodyIntensity}`);
  console.log(`PASS cuerpo sutil tras 1 kill (${bc.bodyIntensity.toFixed(3)})`);
}

// 7. morir limpia todo
{
  const bc = coat('2h');
  bc.recordKill(5);
  bc.clear();
  assert.equal(bc.weaponIntensity, 0);
  assert.equal(bc.bodyIntensity, 0);
  console.log('PASS morir/respawnear limpia la sangre');
}

console.log('ALL PASS');
