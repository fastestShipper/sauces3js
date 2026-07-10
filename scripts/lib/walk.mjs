// Caminata LEGITIMA para los smokes.
//
// El movement guard del server acota la distancia por paquete al "credito" de
// movimiento (MOVEMENT_MAX_CREDIT metros, regenerando a MOVEMENT_MAX_SPEED m/s).
// Los smokes viejos teleportaban con un solo `s` a 100m; desde que existe el
// guard, el server los clampea y el jugador nunca llega. No es un bug del juego:
// es el test que hace trampa. Este helper camina como camina un jugador.

const MAX_CREDIT = 8;          // server/movement_guard.js MOVEMENT_MAX_CREDIT
const MAX_SPEED = 34;          // server/movement_guard.js MOVEMENT_MAX_SPEED
const STEP = 5.5;              // metros por paquete, bajo el credito
const TICK_MS = 200;           // regenera 6.8m, mas que el paso

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Camina en linea recta desde (fromX,fromZ) hasta (toX,toZ) mandando paquetes
// `s` que el guard acepta. Devuelve la posicion final enviada.
export async function walkTo(client, from, to, extra = {}) {
  let x = from.x, z = from.z;
  const send = (px, pz) => client.send({
    t: 's', x: px, z: pz, h: 0, a: 'Walking', hp: 100, hm: 100, lv: 1, ...extra,
  });

  send(x, z);
  await wait(TICK_MS);

  for (let guard = 0; guard < 400; guard++) {
    const dx = to.x - x, dz = to.z - z;
    const dist = Math.hypot(dx, dz);
    if (dist <= 0.35) break;
    const step = Math.min(STEP, dist);
    x += (dx / dist) * step;
    z += (dz / dist) * step;
    send(x, z);
    await wait(TICK_MS);
  }
  return { x, z };
}

export { MAX_CREDIT, MAX_SPEED, wait };
