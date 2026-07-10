const fs = require('fs');
const path = require('path');

const CELL_SIZE = 24;
const INDEX_PAD = 3;
const DATA_PATH = path.join(__dirname, 'world_obstacles.json');

let obstacles = [];
try {
  const parsed = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  if (parsed && parsed.schemaVersion === 1 && Array.isArray(parsed.obstacles)) {
    obstacles = parsed.obstacles.filter((entry) => (
      Array.isArray(entry)
      && entry.length >= 10
      && entry.length % 2 === 0
      && entry.every(Number.isFinite)
      && entry[2] > entry[0]
      && entry[3] > entry[1]
    ));
  }
} catch (error) {
  console.warn('[world-obstacles] disabled:', error && error.message);
}

const grid = new Map();
for (let index = 0; index < obstacles.length; index++) {
  const entry = obstacles[index];
  const minX = Math.floor((entry[0] - INDEX_PAD) / CELL_SIZE);
  const maxX = Math.floor((entry[2] + INDEX_PAD) / CELL_SIZE);
  const minZ = Math.floor((entry[1] - INDEX_PAD) / CELL_SIZE);
  const maxZ = Math.floor((entry[3] + INDEX_PAD) / CELL_SIZE);
  for (let cx = minX; cx <= maxX; cx++) {
    for (let cz = minZ; cz <= maxZ; cz++) {
      const key = cx + ',' + cz;
      let entries = grid.get(key);
      if (!entries) {
        entries = [];
        grid.set(key, entries);
      }
      entries.push(index);
    }
  }
}

function insidePolygon(entry, x, z) {
  let inside = false;
  for (let i = 4, j = entry.length - 2; i < entry.length; j = i, i += 2) {
    const xi = entry[i], zi = entry[i + 1];
    const xj = entry[j], zj = entry[j + 1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function segmentDistanceSq(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq)) : 0;
  const x = ax + dx * t, z = az + dz * t;
  const ox = px - x, oz = pz - z;
  return ox * ox + oz * oz;
}

function nearPolygonEdge(entry, x, z, margin) {
  const limit = margin * margin;
  for (let i = 4, j = entry.length - 2; i < entry.length; j = i, i += 2) {
    if (segmentDistanceSq(x, z, entry[j], entry[j + 1], entry[i], entry[i + 1]) <= limit) return true;
  }
  return false;
}

function pointBlocked(x, z, pad = 0) {
  const px = Number(x), pz = Number(z);
  if (!Number.isFinite(px) || !Number.isFinite(pz)) return true;
  const key = Math.floor(px / CELL_SIZE) + ',' + Math.floor(pz / CELL_SIZE);
  const margin = Math.max(0, Math.min(INDEX_PAD, Number(pad) || 0));
  for (const index of (grid.get(key) || [])) {
    const entry = obstacles[index];
    if (px < entry[0] - margin || px > entry[2] + margin || pz < entry[1] - margin || pz > entry[3] + margin) continue;
    if (insidePolygon(entry, px, pz) || (margin > 0 && nearPolygonEdge(entry, px, pz, margin))) return true;
  }
  return false;
}

function obstacleStats() {
  return { obstacles: obstacles.length, cells: grid.size, enabled: obstacles.length > 0 };
}

module.exports = {
  CELL_SIZE,
  pointBlocked,
  obstacleStats,
};
