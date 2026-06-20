// Parcel layer audit: stable anchors only (no claims, owners, disputes, notes, UGC).
import { readFileSync, existsSync } from 'fs';

const ZONE_PATH = './assets/zone.json';
const PARCELS_PATH = './assets/parcels.json';
const EXPECTED_WORLD = 'los_sauces';
const CONFIDENCE = new Set(['osm', 'partial', 'inferred']);

const FORBIDDEN_KEYS = new Set([
  'claim', 'claims', 'owner', 'owners', 'dispute', 'disputes',
  'note', 'notes', 'author', 'user', 'userId', 'ugc', 'coResident', 'coResidents',
]);

let ok = true;
function fail(msg) {
  console.error('FAIL:', msg);
  ok = false;
}

function collectForbidden(obj, path = '') {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => collectForbidden(v, `${path}[${i}]`));
    return;
  }
  for (const k of Object.keys(obj)) {
    const lower = k.toLowerCase();
    if (lower === 'claimable') {
      collectForbidden(obj[k], path ? `${path}.${k}` : k);
      continue;
    }
    if (FORBIDDEN_KEYS.has(lower) || lower.includes('claim') || lower.includes('dispute')) {
      fail(`forbidden field at ${path}.${k}`);
    }
    collectForbidden(obj[k], path ? `${path}.${k}` : k);
  }
}

if (!existsSync(PARCELS_PATH)) {
  fail('assets/parcels.json missing');
  process.exit(1);
}

let raw;
try {
  raw = JSON.parse(readFileSync(PARCELS_PATH, 'utf8'));
} catch (e) {
  fail(`assets/parcels.json invalid JSON: ${e.message}`);
  process.exit(1);
}

if (raw.worldId !== EXPECTED_WORLD) {
  fail(`worldId must be "${EXPECTED_WORLD}", got ${JSON.stringify(raw.worldId)}`);
}

if (!Array.isArray(raw.parcels)) {
  fail('parcels must be an array');
  process.exit(1);
}

const zone = JSON.parse(readFileSync(ZONE_PATH, 'utf8'));
const buildingCount = (zone.buildings || []).length;
if (raw.parcels.length !== buildingCount) {
  fail(`parcel count ${raw.parcels.length} must equal zone buildings ${buildingCount}`);
}

collectForbidden(raw);

const parcelIds = new Set();
const buildingIndexes = new Set();
let claimableCount = 0;

for (let i = 0; i < raw.parcels.length; i++) {
  const p = raw.parcels[i];
  if (!p || typeof p !== 'object') {
    fail(`parcels[${i}] not an object`);
    continue;
  }

  for (const key of ['parcelId', 'buildingIndex', 'center', 'displayAddress', 'claimable', 'confidence']) {
    if (!(key in p)) fail(`parcels[${i}] missing ${key}`);
  }

  if (typeof p.parcelId !== 'string' || !p.parcelId.length) {
    fail(`parcels[${i}] parcelId must be non-empty string`);
  } else if (!/^osm:way:\d+$/.test(p.parcelId) && !/^fp:[a-f0-9]{8,64}$/i.test(p.parcelId)) {
    fail(`parcels[${i}] parcelId not stable-looking: ${p.parcelId}`);
  }
  if (parcelIds.has(p.parcelId)) fail(`duplicate parcelId ${p.parcelId}`);
  parcelIds.add(p.parcelId);

  if (!Number.isInteger(p.buildingIndex) || p.buildingIndex < 0 || p.buildingIndex >= buildingCount) {
    fail(`parcels[${i}] buildingIndex out of range: ${p.buildingIndex}`);
  }
  if (buildingIndexes.has(p.buildingIndex)) fail(`duplicate buildingIndex ${p.buildingIndex}`);
  buildingIndexes.add(p.buildingIndex);

  if (!p.center || typeof p.center !== 'object') {
    fail(`parcels[${i}] center must be object`);
  } else {
    if (typeof p.center.x !== 'number' || !Number.isFinite(p.center.x)) {
      fail(`parcels[${i}] center.x must be finite number`);
    }
    if (typeof p.center.z !== 'number' || !Number.isFinite(p.center.z)) {
      fail(`parcels[${i}] center.z must be finite number`);
    }
  }

  if (typeof p.displayAddress !== 'string') {
    fail(`parcels[${i}] displayAddress must be string`);
  }

  if (typeof p.claimable !== 'boolean') {
    fail(`parcels[${i}] claimable must be boolean`);
  } else if (p.claimable) claimableCount++;

  if (!CONFIDENCE.has(p.confidence)) {
    fail(`parcels[${i}] confidence must be osm|partial|inferred, got ${p.confidence}`);
  }
}

if (claimableCount <= 0) {
  fail('claimable parcel count must be > 0');
}

const confCounts = { osm: 0, partial: 0, inferred: 0 };
for (const p of raw.parcels) confCounts[p.confidence] = (confCounts[p.confidence] || 0) + 1;

console.log('parcels audit:', {
  count: raw.parcels.length,
  claimable: claimableCount,
  confidence: confCounts,
});

if (!ok) process.exit(1);
console.log('PASS: parcels audit');