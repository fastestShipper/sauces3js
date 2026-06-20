// Zone file integrity: OSM-only persisted geometry, no procedural filler in zone.json.
import { readFileSync } from 'fs';
import { City } from '../src/citygen.js';

const EXPECTED_OSM_BUILDINGS = 312;
const ZONE_PATH = './assets/zone.json';

let ok = true;
function fail(msg) {
  console.error('FAIL:', msg);
  ok = false;
}

const raw = JSON.parse(readFileSync(ZONE_PATH, 'utf8'));

if (!raw.origin || typeof raw.origin.lat !== 'number' || typeof raw.origin.lon !== 'number') {
  fail('zone.json missing origin.lat/lon');
}

for (const key of ['buildings', 'roads', 'green']) {
  if (!Array.isArray(raw[key])) fail(`zone.json missing or invalid array: ${key}`);
}

const buildings = raw.buildings || [];
if (buildings.length !== EXPECTED_OSM_BUILDINGS) {
  fail(`expected ${EXPECTED_OSM_BUILDINGS} OSM buildings, got ${buildings.length}`);
}

for (let i = 0; i < buildings.length; i++) {
  const b = buildings[i];
  if (!b || typeof b !== 'object') {
    fail(`building[${i}] is not an object`);
    continue;
  }
  if (!Array.isArray(b.p) || b.p.length < 3) {
    fail(`building[${i}] missing footprint polygon (p, >= 3 points)`);
  } else {
    for (let j = 0; j < b.p.length; j++) {
      const pt = b.p[j];
      if (!Array.isArray(pt) || pt.length < 2 || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) {
        fail(`building[${i}].p[${j}] invalid point`);
      }
    }
  }
  if (typeof b.h !== 'number' || !Number.isFinite(b.h) || b.h <= 0) {
    fail(`building[${i}] missing valid height h`);
  }
  if (b.osm === false || b.procedural === true || b.filler === true) {
    fail(`building[${i}] looks like procedural filler persisted in zone.json`);
  }
}

const persistedCount = buildings.length;
const city = new City(JSON.parse(JSON.stringify(raw)));
if (city.data.buildings.length !== persistedCount) {
  fail(`City() default mutated building count: ${persistedCount} -> ${city.data.buildings.length}`);
}

console.log('zone integrity:', {
  origin: !!raw.origin,
  buildings: buildings.length,
  roads: (raw.roads || []).length,
  green: (raw.green || []).length,
});

if (!ok) process.exit(1);
console.log('PASS: zone integrity audit');