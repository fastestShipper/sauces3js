import fs from 'node:fs';

const FILE = new URL('../assets/pois-local.json', import.meta.url);
const ALLOWED_CATEGORIES = new Set([
  'bodega', 'clinic', 'services', 'parking', 'shop', 'street', 'corner', 'paradero', 'park', 'landmark',
]);
const ALLOWED_SOURCES = new Set(['osm', 'osm-road', 'local-public']);
const FORBIDDEN_KEYS = /owner|claim|dispute|note|author|user|ugc|freeText|comment|resident|phone|email/i;
const FORBIDDEN_TEXT = /vive\s+aqu[ií]|propietario|due[nñ]o|tel[eé]fono|whatsapp|correo|@/i;

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function walk(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(key)) fail(`forbidden key ${path}.${key}`);
    if (typeof child === 'string' && FORBIDDEN_TEXT.test(child)) fail(`forbidden text at ${path}.${key}`);
    walk(child, `${path}.${key}`);
  }
}

const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
if (data.worldId !== 'los_sauces') fail('worldId must be los_sauces');
if (!Array.isArray(data.pois)) fail('pois must be an array');
if (data.pois.length < 10) fail(`expected at least 10 POIs, got ${data.pois.length}`);
walk(data);

const ids = new Set();
const categories = new Map();
for (const [index, poi] of data.pois.entries()) {
  const label = `pois[${index}]`;
  if (!poi.id || typeof poi.id !== 'string') fail(`${label}.id missing`);
  if (ids.has(poi.id)) fail(`duplicate id ${poi.id}`);
  ids.add(poi.id);
  if (!Number.isFinite(poi.x) || !Number.isFinite(poi.z)) fail(`${label} has invalid coordinates`);
  if (Math.abs(poi.x) > 1200 || Math.abs(poi.z) > 1200) fail(`${label} is outside expected zone bounds`);
  if (!ALLOWED_CATEGORIES.has(poi.category)) fail(`${label} has forbidden category ${poi.category}`);
  if (!ALLOWED_SOURCES.has(poi.source)) fail(`${label} has forbidden source ${poi.source}`);
  if (!poi.title || poi.title.length > 64) fail(`${label}.title invalid`);
  if (!poi.description || poi.description.length > 140) fail(`${label}.description invalid`);
  categories.set(poi.category, (categories.get(poi.category) || 0) + 1);
}

console.log('poi audit:', {
  count: data.pois.length,
  categories: Object.fromEntries([...categories.entries()].sort()),
  sources: [...new Set(data.pois.map(p => p.source))].sort(),
});
console.log('PASS: public POI audit');
