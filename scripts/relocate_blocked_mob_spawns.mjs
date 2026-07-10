import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { pointBlocked } = require('../server/world_obstacles');

const SPAWN_CLEARANCE = 1;
const MIN_SEPARATION = 1.8;
const SAFE_X = -62;
const SAFE_Z = -7;
const SAFE_RADIUS = 30;
const GOLDEN_ANGLE = 2.399963229728653;
const sourceUrl = new URL('../server/mob_spawns.json', import.meta.url);

const payload = JSON.parse(await readFile(sourceUrl, 'utf8'));
const spawns = Array.isArray(payload.spawns) ? payload.spawns : [];
const originalBlocked = spawns
  .map((spawn, index) => pointBlocked(spawn.x, spawn.z, SPAWN_CLEARANCE) ? index : -1)
  .filter((index) => index >= 0);
const relocated = [];

function validCandidate(x, z, movingIndex) {
  if (pointBlocked(x, z, SPAWN_CLEARANCE)) return false;
  if (Math.hypot(x - SAFE_X, z - SAFE_Z) < SAFE_RADIUS + 2) return false;
  return spawns.every((other, index) => (
    index === movingIndex || Math.hypot(x - other.x, z - other.z) >= MIN_SEPARATION
  ));
}

for (const index of originalBlocked) {
  const spawn = spawns[index];
  let candidate = null;
  for (let ring = 1; ring <= 60 && !candidate; ring++) {
    const radius = ring * 0.5;
    const samples = Math.max(24, Math.ceil(Math.PI * 2 * radius / 0.65));
    for (let sample = 0; sample < samples; sample++) {
      const angle = index * GOLDEN_ANGLE + sample * Math.PI * 2 / samples;
      const x = Math.round((spawn.x + Math.cos(angle) * radius) * 10) / 10;
      const z = Math.round((spawn.z + Math.sin(angle) * radius) * 10) / 10;
      if (validCandidate(x, z, index)) {
        candidate = { x, z, distance: Math.hypot(x - spawn.x, z - spawn.z) };
        break;
      }
    }
  }
  if (!candidate) throw new Error(`No open relocation found for spawn ${index}`);
  const from = { x: spawn.x, z: spawn.z };
  spawn.x = candidate.x;
  spawn.z = candidate.z;
  relocated.push({ index, zone: spawn.zone || '', from, to: { x: spawn.x, z: spawn.z }, distance: +candidate.distance.toFixed(2) });
}

const remainingBlocked = spawns
  .map((spawn, index) => pointBlocked(spawn.x, spawn.z, SPAWN_CLEARANCE) ? index : -1)
  .filter((index) => index >= 0);
if (remainingBlocked.length) throw new Error(`Blocked spawns remain: ${remainingBlocked.join(', ')}`);

await writeFile(sourceUrl, `${JSON.stringify(payload, null, 1)}\n`);
console.log(JSON.stringify({
  clearance: SPAWN_CLEARANCE,
  relocatedCount: relocated.length,
  maxDistance: +Math.max(0, ...relocated.map((entry) => entry.distance)).toFixed(2),
  relocated,
}));
