const { SAFE_X, SAFE_Z, SAFE_R, OJEDA_X, OJEDA_Z, OJEDA_R } = require('./mob_balance');
const { pointBlocked } = require('./world_obstacles');

const MOB_CLEARANCE = 0.85;
const SIDE_STEP_ANGLES = Object.freeze([0, 0.58, -0.58, 1.05, -1.05, 1.48, -1.48]);

function finitePoint(x, z) {
  return Number.isFinite(Number(x)) && Number.isFinite(Number(z));
}

function outsideProtectedZones(x, z, safeRadius = SAFE_R - 3) {
  // la bodega Ojeda tambien es refugio: ni spawns ni destinos de deriva adentro
  if (Math.hypot(x - OJEDA_X, z - OJEDA_Z) < OJEDA_R) return false;
  return Math.hypot(x - SAFE_X, z - SAFE_Z) >= safeRadius;
}

function mobPointAllowed(x, z, options = {}) {
  const px = Number(x);
  const pz = Number(z);
  if (!finitePoint(px, pz)) return false;
  const clearance = Number.isFinite(Number(options.clearance))
    ? Math.max(0, Number(options.clearance))
    : MOB_CLEARANCE;
  const safeRadius = Number.isFinite(Number(options.safeRadius))
    ? Math.max(0, Number(options.safeRadius))
    : SAFE_R - 3;
  return outsideProtectedZones(px, pz, safeRadius)
    && !pointBlocked(px, pz, clearance);
}

function chooseMobStep(mob, targetX, targetZ, maxStep) {
  if (!mob || !finitePoint(mob.x, mob.z) || !finitePoint(targetX, targetZ)) return null;
  const step = Math.max(0, Number(maxStep) || 0);
  const dx = Number(targetX) - mob.x;
  const dz = Number(targetZ) - mob.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.01 || step <= 0) return null;
  const travel = Math.min(step, distance);
  const ux = dx / distance;
  const uz = dz / distance;
  const direction = Number(mob.id) % 2 === 0 ? 1 : -1;

  for (const baseAngle of SIDE_STEP_ANGLES) {
    const angle = baseAngle * direction;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const vx = ux * cos - uz * sin;
    const vz = ux * sin + uz * cos;
    const x = mob.x + vx * travel;
    const z = mob.z + vz * travel;
    if (!mobPointAllowed(x, z)) continue;
    return { x, z, h: Math.atan2(vx, vz), avoided: baseAngle !== 0 };
  }

  // Old data may leave a mob embedded in geometry. Let it move toward an open
  // target until it exits, while still respecting the sanctuary and seal.
  if (pointBlocked(mob.x, mob.z, MOB_CLEARANCE)
    && !pointBlocked(Number(targetX), Number(targetZ), MOB_CLEARANCE)) {
    const x = mob.x + ux * travel;
    const z = mob.z + uz * travel;
    if (outsideProtectedZones(x, z)) return { x, z, h: Math.atan2(ux, uz), recovering: true };
  }
  return null;
}

function findOpenSpawnAround(centerX, centerZ, minDistance, maxDistance, options = {}) {
  if (!finitePoint(centerX, centerZ)) return null;
  const min = Math.max(0, Number(minDistance) || 0);
  const max = Math.max(min, Number(maxDistance) || min);
  const attempts = Math.max(1, Math.min(100, Math.floor(Number(options.attempts) || 24)));
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const safeRadius = Number.isFinite(Number(options.safeRadius)) ? Number(options.safeRadius) : SAFE_R + 14;
  const clearance = Number.isFinite(Number(options.clearance)) ? Number(options.clearance) : 2;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const angle = random() * Math.PI * 2;
    const distance = min + Math.sqrt(random()) * (max - min);
    const x = Number(centerX) + Math.cos(angle) * distance;
    const z = Number(centerZ) + Math.sin(angle) * distance;
    if (mobPointAllowed(x, z, { clearance, safeRadius })) return { x, z };
  }
  return null;
}

function findWanderTarget(spawnX, spawnZ, radius, random = Math.random) {
  const maxRadius = Math.max(0, Number(radius) || 0);
  for (let attempt = 0; attempt < 12; attempt++) {
    const angle = random() * Math.PI * 2;
    const distance = maxRadius * (0.35 + Math.sqrt(random()) * 0.65);
    const x = Number(spawnX) + Math.cos(angle) * distance;
    const z = Number(spawnZ) + Math.sin(angle) * distance;
    if (mobPointAllowed(x, z)) return { x, z };
  }
  return mobPointAllowed(spawnX, spawnZ) ? { x: Number(spawnX), z: Number(spawnZ) } : null;
}

module.exports = {
  MOB_CLEARANCE,
  mobPointAllowed,
  chooseMobStep,
  findOpenSpawnAround,
  findWanderTarget,
};
