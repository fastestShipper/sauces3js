import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { obstacleStats, pointBlocked } = require('../server/world_obstacles');

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function corr(points) {
  const xs = points.map(p => p.x);
  const zs = points.map(p => p.z);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const mz = zs.reduce((a, b) => a + b, 0) / zs.length;
  const num = xs.reduce((sum, x, i) => sum + (x - mx) * (zs[i] - mz), 0);
  const dx = xs.reduce((sum, x) => sum + (x - mx) ** 2, 0);
  const dz = zs.reduce((sum, z) => sum + (z - mz) ** 2, 0);
  return num / Math.sqrt(dx * dz || 1);
}

function nearestStats(points) {
  const ds = [];
  for (let i = 0; i < points.length; i++) {
    let best = 1e18;
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      best = Math.min(best, Math.hypot(points[i].x - points[j].x, points[i].z - points[j].z));
    }
    ds.push(best);
  }
  return {
    min: Math.min(...ds),
    avg: ds.reduce((a, b) => a + b, 0) / ds.length,
    max: Math.max(...ds),
  };
}

function groupByZone(points) {
  const grouped = new Map();
  for (const point of points) {
    const zone = point.zone || 'missing';
    if (!grouped.has(zone)) grouped.set(zone, []);
    grouped.get(zone).push(point);
  }
  return grouped;
}

function axisLaneRepeats(points) {
  const repeats = [];
  for (const [zone, zonePoints] of groupByZone(points)) {
    for (const axis of ['x', 'z']) {
      const counts = new Map();
      for (const point of zonePoints) {
        const key = Number(point[axis]).toFixed(1);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      for (const [coord, count] of counts) {
        if (count > 1) repeats.push(`${zone}:${axis}=${coord}x${count}`);
      }
    }
  }
  return repeats;
}

function segmentDistance(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  if (l2 <= 1e-9) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function roadClearance(point, roads) {
  let best = 1e18;
  for (const road of roads) {
    const pts = road.p || [];
    const halfWidth = Number(road.w || 6) * 0.5;
    for (let i = 0; i < pts.length - 1; i++) {
      best = Math.min(best, segmentDistance(point.x, point.z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) - halfWidth);
    }
  }
  return best;
}

const raw = JSON.parse(readFileSync(new URL('../server/mob_spawns.json', import.meta.url), 'utf8'));
const zone = JSON.parse(readFileSync(new URL('../assets/zone.json', import.meta.url), 'utf8'));
const spawns = Array.isArray(raw.spawns) ? raw.spawns : [];
const obstacleInfo = obstacleStats();
if (!obstacleInfo.enabled || obstacleInfo.obstacles < 1000) fail(`world obstacle index is unavailable: ${JSON.stringify(obstacleInfo)}`);
if (spawns.length < 40) fail(`expected at least 40 mob spawns, got ${spawns.length}`);
for (const [index, spawn] of spawns.entries()) {
  if (!Number.isFinite(spawn.x) || !Number.isFinite(spawn.z)) fail(`spawn ${index} has invalid coordinates`);
  if (!Number.isInteger(spawn.lvl) || spawn.lvl < 1 || spawn.lvl > 5) fail(`spawn ${index} has invalid lvl ${spawn.lvl}`);
  if (spawn.zone && !/^[a-z0-9_-]+$/.test(spawn.zone)) fail(`spawn ${index} has invalid zone ${spawn.zone}`);
}

const active = spawns.slice(0, 40);
const safeSpawn = { x: -62, z: -7, radius: 35 };
const nearestSafe = Math.min(...active.map((s) => Math.hypot(s.x - safeSpawn.x, s.z - safeSpawn.z)));
const c = corr(active);
const nn = nearestStats(active);
const zones = new Set(active.map(s => s.zone || 'missing'));
const levels = active.reduce((acc, s) => { acc[s.lvl] = (acc[s.lvl] || 0) + 1; return acc; }, {});
const laneRepeats = axisLaneRepeats(spawns);
const activeSpotCount = active.filter(s => /^spot\d+$/.test(String(s.zone || ''))).length;
const bossCount = spawns.filter(s => s.boss === true).length;
const calleCount = spawns.filter(s => String(s.zone || '') === 'calle').length;
const starter = spawns.filter(s => String(s.zone || '') === 'starter');
const starterFodder = starter.filter(s => s.fodder === true).length;
const grutaZones = spawns.filter(s => String(s.zone || '') === 'spot7');
const hardZones = spawns.filter(s => ['spot3', 'spot4', 'spot6', 'boss_guardian'].includes(String(s.zone || '')));
const hardAvg = hardZones.reduce((sum, s) => sum + s.lvl, 0) / Math.max(1, hardZones.length);
const playerSpawn = { x: -62, z: -7, radius: 90 };
const nearestPlayer = Math.min(...spawns.map((s) => Math.hypot(s.x - playerSpawn.x, s.z - playerSpawn.z)));
const clearances = active.map(s => roadClearance(s, zone.roads || []));
const minRoadClearance = Math.min(...clearances);
const bbox = {
  minX: Math.min(...active.map(s => s.x)),
  maxX: Math.max(...active.map(s => s.x)),
  minZ: Math.min(...active.map(s => s.z)),
  maxZ: Math.max(...active.map(s => s.z)),
};
const blockedSpawns = spawns
  .map((spawn, index) => pointBlocked(spawn.x, spawn.z, 1) ? index : -1)
  .filter((index) => index >= 0);

console.log('mob spawn audit:', {
  total: spawns.length,
  active: active.length,
  zones: [...zones].sort(),
  levels,
  corr: +c.toFixed(3),
  laneRepeats,
  activeSpotCount,
  bossCount,
  calleCount,
  starterCount: starter.length,
  starterFodder,
  grutaMaxLevel: Math.max(...grutaZones.map(s => s.lvl)),
  hardAvg: +hardAvg.toFixed(2),
  nearestPlayer: +nearestPlayer.toFixed(2),
  minRoadClearance: +minRoadClearance.toFixed(2),
  nearestAvg: +nn.avg.toFixed(2),
  nearestSafe: +nearestSafe.toFixed(2),
  bbox,
  blockedSpawns,
});
if (blockedSpawns.length) fail(`spawns overlap buildings: ${blockedSpawns.join(', ')}`);
if (zones.has('missing') || zones.size < 3) fail(`active spawns need at least 3 named zones, got ${[...zones].join(', ')}`);
if (activeSpotCount < 35) fail(`active spawns must use ARPG combat spots, got ${activeSpotCount}`);
if (bossCount < 1) fail('expected at least one boss guardian spawn');
if (calleCount < 4) fail(`expected calle overflow spawns, got ${calleCount}`);
if (starter.length < 4) fail(`expected starter combat spawns near player start, got ${starter.length}`);
if (starterFodder !== starter.length) fail(`all starter spawns must be fodder, got ${starterFodder}/${starter.length}`);
if (starter.some(s => s.lvl > 2)) fail('starter spawns must stay level 1-2');
if (grutaZones.some(s => s.lvl > 2)) fail('gruta-adjacent spot7 spawns must stay level 1-2');
if (hardZones.length < 20 || hardAvg < 4.1) fail(`hard park zones are too soft, count=${hardZones.length}, avg=${hardAvg.toFixed(2)}`);
if (nearestPlayer > playerSpawn.radius) fail(`player start is too far from first combat, nearest=${nearestPlayer.toFixed(2)}`);
if (minRoadClearance < -8) fail(`active spawns are too deep into roads, min clearance=${minRoadClearance.toFixed(2)}`);
if (Math.abs(c) > 0.9) fail(`active spawns are too line-like, corr=${c.toFixed(3)}`);
if (nn.avg < 2) fail(`active spawns are packed too tightly, nearest avg=${nn.avg.toFixed(2)}`);
if (nearestSafe < safeSpawn.radius) fail(`active spawns are too close to respawn, nearest=${nearestSafe.toFixed(2)}`);
console.log('PASS: mob spawn audit');
