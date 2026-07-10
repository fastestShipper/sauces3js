const { SAFE_X, SAFE_Z } = require('./mob_balance');

const MOVEMENT_MAX_SPEED = 34;
const MOVEMENT_MAX_CREDIT = 8;
const MOVEMENT_MAX_ELAPSED_MS = 500;
const HOME_TELEPORT_RADIUS = 3;

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

// `opts.homeGrant` es la AUTORIZACION del server para aparecer en la gruta.
// Sin ella, saltar a la gruta se trata como cualquier otro salto imposible y se
// clampea por velocidad. El teleport (tecla B) y el respawn siguen funcionando
// porque el server los autoriza explicitamente; el recall instantaneo del
// cliente modificado, no.
function guardMovement(state, requestedX, requestedZ, nowMs = Date.now(), opts = {}) {
  const prevX = finiteNumber(state && state.x, SAFE_X);
  const prevZ = finiteNumber(state && state.z, SAFE_Z);
  const nextX = finiteNumber(requestedX, prevX);
  const nextZ = finiteNumber(requestedZ, prevZ);
  const now = finiteNumber(nowMs, Date.now());
  const lastAt = finiteNumber(state && state.lastMoveAt, now);
  const elapsedMs = Math.max(0, Math.min(MOVEMENT_MAX_ELAPSED_MS, now - lastAt));
  const storedCredit = Number.isFinite(Number(state && state.moveCredit))
    ? Math.max(0, Math.min(MOVEMENT_MAX_CREDIT, Number(state.moveCredit)))
    : MOVEMENT_MAX_CREDIT;
  const credit = Math.min(MOVEMENT_MAX_CREDIT, storedCredit + MOVEMENT_MAX_SPEED * elapsedMs / 1000);

  if (state) state.lastMoveAt = now;

  const home = Math.hypot(nextX - SAFE_X, nextZ - SAFE_Z) <= HOME_TELEPORT_RADIUS;
  if (home && opts && opts.homeGrant) {
    if (state) state.moveCredit = 0;
    return { x: nextX, z: nextZ, corrected: false, home: true, allowance: credit };
  }

  const dx = nextX - prevX;
  const dz = nextZ - prevZ;
  const distance = Math.hypot(dx, dz);
  if (distance <= credit + 1e-6) {
    if (state) state.moveCredit = Math.max(0, credit - distance);
    return { x: nextX, z: nextZ, corrected: false, home: false, allowance: credit };
  }

  const scale = credit > 0 && distance > 0 ? credit / distance : 0;
  if (state) state.moveCredit = 0;
  return {
    x: prevX + dx * scale,
    z: prevZ + dz * scale,
    corrected: true,
    home: false,
    allowance: credit,
  };
}

module.exports = {
  MOVEMENT_MAX_SPEED,
  MOVEMENT_MAX_CREDIT,
  HOME_TELEPORT_RADIUS,
  guardMovement,
};
