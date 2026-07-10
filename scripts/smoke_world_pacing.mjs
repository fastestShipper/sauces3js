import { readFileSync } from 'node:fs';

function fail(message) {
  console.error('FAIL:', message);
  process.exit(1);
}

const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server/server.js', import.meta.url), 'utf8');
const citymesh = readFileSync(new URL('../src/citymesh.js', import.meta.url), 'utf8');

if (!/const DAYNIGHT_MS = 1500000\b/.test(app)) fail('client day/night cycle must stay 25 minutes');
if (!/const DAYNIGHT_MS = 1500000\b/.test(server)) fail('server day/night cycle must stay 25 minutes');
if (!/const GRUTA_SPAWN = \[-62, -7\]/.test(app)) fail('new players must spawn in the gruta');
if (!/playerSpawn = GRUTA_SPAWN/.test(app)) fail('player spawn must use GRUTA_SPAWN');
if (!/player\.pos\.set\(GRUTA_SPAWN\[0\], 0, GRUTA_SPAWN\[1\]\)/.test(app)) fail('respawn must return to the gruta');

if (!/const WAVE_EVERY_MS = Math\.max\(900000, Number\(process\.env\.WAVE_EVERY_MS\) \|\| 900000\);/.test(server)) fail('default wave interval must stay at 15 minutes minimum');
if (!/const WAVE_SIZE = 4;/.test(server)) fail('default wave size must stay moderated but still feel like a horde');
if (!/!inSafeZone\(c\)/.test(server)) fail('waves must ignore players inside the gruta');
if (!/waveN % 10 === 0/.test(server)) fail('wave bosses must stay rare');
if (!/Date\.now\(\) \+ 75000/.test(server)) fail('normal wave TTL must leave enough time to engage without accumulating');
if (!/x: SAFE_X, z: SAFE_Z/.test(server)) fail('server-side new player position must start in gruta');
if (!/boss: !!mob\.boss/.test(server)) fail('boss death metadata must use the internal boss flag');
if (/me\.x\s*=\s*Number\.isFinite\(Number\(m\.x\)\)/.test(server) ||
  /me\.z\s*=\s*Number\.isFinite\(Number\(m\.z\)\)/.test(server)) {
  fail('server hi must not accept client-provided initial spawn coordinates');
}

if (!/ped && !parkStonePath && parkEdge/.test(citymesh)) {
  fail('park non-path pedestrian concrete should become grass');
}
if (!/nearGreen\(p\[0\], p\[1\], 62\.0\)/.test(citymesh)) {
  fail('park edge sidewalks need a wider grass suppression radius');
}
if (!/parkEdgeGrassApron\(lawn, city, ring\)/.test(citymesh)) {
  fail('park borders need a grass apron over concrete fill');
}
if (!/quad\(-18\.0, -0\.05\)/.test(citymesh) || !/quad\(0\.05, 32\.0\)/.test(citymesh)) {
  fail('park grass apron must be wide enough to hide concrete borders');
}
if (!/parkStonePath \? Math\.min\(rawFull, 1\.45\)/.test(citymesh)) {
  fail('park stone paths must stay narrow');
}
if (!/walkInPark/.test(citymesh)) {
  fail('park edge sidewalks should be suppressed');
}
if (!/playhouse/.test(citymesh) || !/safety tiles/.test(citymesh) || !/shade canopy/.test(citymesh) || !/rope dome/.test(citymesh) || !/rope bridge/.test(citymesh) || !/rubber tile grid/.test(citymesh) || !/tire swing/.test(citymesh) || !/climbing wall/.test(citymesh) || !/Toddler zone/.test(citymesh)) {
  fail('main park playground needs richer equipment');
}

console.log('PASS: world pacing, gruta spawn and park surface rules');
