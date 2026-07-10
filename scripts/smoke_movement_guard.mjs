import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  MOVEMENT_MAX_CREDIT,
  HOME_TELEPORT_RADIUS,
  guardMovement,
} = require('../server/movement_guard.js');
const { SAFE_X, SAFE_Z } = require('../server/mob_balance.js');
globalThis.location = { hostname: 'localhost', search: '' };
const { Net } = await import('../src/net.js');


{
  const state = { x: 0, z: 0, lastMoveAt: 1000, moveCredit: MOVEMENT_MAX_CREDIT };
  const result = guardMovement(state, 4.5, 0, 1100);
  assert.equal(result.corrected, false, 'dash-sized movement should stay responsive');
  assert.equal(result.x, 4.5);
  assert.ok(state.moveCredit > 0, 'accepted movement should preserve unused credit');
}

{
  const state = { x: 0, z: 0, lastMoveAt: 1000, moveCredit: MOVEMENT_MAX_CREDIT };
  const result = guardMovement(state, 120, 0, 1100);
  assert.equal(result.corrected, true, 'arbitrary teleport should be corrected');
  assert.ok(result.x > 0 && result.x <= MOVEMENT_MAX_CREDIT, 'correction should consume only available movement credit');
  assert.equal(state.moveCredit, 0);
}

{
  const state = { x: 0, z: 0, lastMoveAt: 1000, moveCredit: 0 };
  guardMovement(state, 0, 0, 1300);
  assert.equal(state.moveCredit, MOVEMENT_MAX_CREDIT, 'standing still should refill burst credit');
  const result = guardMovement(state, 7, 0, 1301);
  assert.equal(result.corrected, false, 'refilled credit should absorb normal packet jitter');
}

{
  // CON permiso del server (respawn, o canalizacion de la tecla B completada)
  const state = { x: 200, z: -150, lastMoveAt: 1000, moveCredit: 0 };
  const result = guardMovement(state, SAFE_X, SAFE_Z, 1100, { homeGrant: true });
  assert.equal(result.corrected, false, 'authorized teleport home should remain legal');
  assert.equal(result.home, true);
  assert.equal(result.x, SAFE_X);
  assert.equal(result.z, SAFE_Z);
  assert.ok(HOME_TELEPORT_RADIUS >= 1);
}

{
  // SIN permiso: el recall instantaneo de un cliente modificado se clampea como
  // cualquier otro salto imposible. Escapar de un PvP teleportandose no vale.
  const state = { x: 200, z: -150, lastMoveAt: 1000, moveCredit: 0 };
  const result = guardMovement(state, SAFE_X, SAFE_Z, 1100);
  assert.equal(result.home, false, 'unauthorized home teleport must not be granted');
  assert.equal(result.corrected, true, 'unauthorized home teleport must be corrected');
  assert.ok(
    Math.hypot(result.x - SAFE_X, result.z - SAFE_Z) > 100,
    'the cheater stays where he was',
  );
}

{
  const state = { x: 10, z: 20, lastMoveAt: 1000, moveCredit: MOVEMENT_MAX_CREDIT };
  const result = guardMovement(state, Number.NaN, undefined, 1100);
  assert.equal(result.corrected, false, 'invalid coordinates should fall back to current position');
  assert.equal(result.x, 10);
  assert.equal(result.z, 20);
}

{
  const copied = { x: 0, y: 0, z: 0 };
  let callback = null;
  const net = Object.create(Net.prototype);
  net.player = {
    pos: { x: 100, y: 2, z: 100 },
    dashT: 0.1,
    hitImpulseT: 0.1,
    keys: { KeyW: true },
    actionKeys: { moveForward: true },
    root: {
      position: {
        copy(pos) {
          copied.x = pos.x;
          copied.y = pos.y;
          copied.z = pos.z;
        },
      },
    },
  };
  net.acc = 0.1;
  net.onPositionCorrection = (value) => { callback = value; };

  Net.prototype._onMsg.call(net, { t: 'corr', x: 4, z: 6, reason: 'speed' });
  assert.deepEqual(net.player.pos, { x: 4, y: 2, z: 6 }, 'client correction should preserve vertical movement');
  assert.equal(net.player.dashT, 0);
  assert.equal(net.player.hitImpulseT, 0);
  assert.deepEqual(net.player.keys, {});
  assert.deepEqual(net.player.actionKeys, {});
  assert.deepEqual(copied, { x: 4, y: 2, z: 6 });
  assert.deepEqual(callback, { x: 4, z: 6, reason: 'speed' });
  assert.equal(net.acc, 0);

  Net.prototype._onMsg.call(net, { t: 'corr', x: 9000, z: 0, reason: 'invalid' });
  assert.deepEqual(net.player.pos, { x: 4, y: 2, z: 6 }, 'client should ignore invalid correction bounds');
}

console.log('PASS: movement guard preserves ARPG motion and corrects arbitrary teleports');
