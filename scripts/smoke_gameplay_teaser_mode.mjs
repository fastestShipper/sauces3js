import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const trailer = readFileSync(new URL('../src/trailer.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');

assert.match(trailer, /const TRAILER_DURATION = 42;/, 'teaser duration stays fixed at 42 seconds');
assert.match(trailer, /const HORDE_SIZE = 22;/, 'teaser uses a dense 22 zombie horde');
assert.match(trailer, /PARTY_IDS = Object\.freeze\(\['verdugo', 'piromante', 'cazadora', 'sombra'\]\)/, 'all four real classes are declared');
for (const id of ['verdugo', 'piromante', 'cazadora', 'sombra']) {
  assert.match(trailer, new RegExp(`id: '${id}'`), `${id} is present in the party setup`);
}
assert.match(trailer, /Object\.values\(mobField\.protos/, 'teaser waits for MobField real assets');
assert.match(trailer, /SkeletonUtils\.clone\(prototype\)/, 'zombies clone the real MobField rig prototypes');
assert.doesNotMatch(trailer, /makeMobBody|CapsuleGeometry|Math\.random/, 'teaser has no placeholder mobs or unseeded randomness');

for (const [name, range] of Object.entries({
  invasion: '0, 8',
  partyReveal: '8, 14',
  combat: '14, 26',
  critical: '26, 30',
  heal: '30, 33',
  ultimates: '33, 39',
  finish: '39, 42',
})) {
  assert.match(trailer, new RegExp(`${name}: \\[${range}\\]`), `${name} beat has the required timing`);
}

const shotsBlock = trailer.slice(trailer.indexOf('const shots = ['), trailer.indexOf('function refreshCleanWorldUi'));
assert.equal((shotsBlock.match(/\{ at:/g) || []).length, 9, 'camera uses nine dramatic shots');
assert.match(trailer, /PARK_CENTER = new THREE\.Vector3\(230, 0, 355\)/, 'teaser remains in the open north park');
assert.match(trailer, /const ARENA_CLEAR_RADIUS = 72;/, 'open arena has a generous reversible foliage clearance radius');
assert.match(trailer, /clearArenaFoliage\(\)[\s\S]*height >= 4\.2 && width >= 0\.9[\s\S]*elements\[13\] -= 220/, 'tall world instances are moved below the trailer arena');
assert.match(trailer, /clearedArenaInstances[\s\S]*object\.setMatrixAt\(index, matrix\)/, 'arena instance matrices are restored on dispose');

assert.match(trailer, /clean: params\.get\('clean'\) === '1'/, 'clean query flag is parsed');
assert.match(trailer, /if \(!clean\) \{[\s\S]*document\.createElement\('div'\)/, 'clean mode skips internal text overlay creation');
assert.match(trailer, /body\.trailer-mode > :not\(#app\)/, 'trailer mode hides regular DOM UI');
assert.match(trailer, /scene\.traverse\([\s\S]*isTrailerWorldUi/, 'clean mode hides world labels');

assert.match(trailer, /VFX_CAPS = Object\.freeze\(\{ fire: 36, arrows: 72, shadow: 36, heal: 32, gore: 112 \}\)/, 'VFX use explicit hard caps');
assert.ok((trailer.match(/new THREE\.InstancedMesh/g) || []).length === 1, 'all particle families use the shared instanced pool factory');
assert.match(trailer, /TrailerFirePool/, 'fire ultimate VFX exist');
assert.match(trailer, /TrailerArrowPool/, 'arrow rain VFX exist');
assert.match(trailer, /TrailerSlash/, 'slash ultimate VFX exist');
assert.match(trailer, /TrailerShadowPool/, 'shadow nova VFX exist');
assert.match(trailer, /TrailerGorePool/, 'gore and disintegration particles exist');
assert.match(trailer, /deathAt = 40\.25/, 'boss remains readable at t40 before the deterministic finish');
assert.match(trailer, /boss \? 2\.15 : 1/, 'boss uses a clearly readable hero scale');
assert.match(trailer, /boss\.basePosition\.copy\(offset\(0, 0, 11\)\)/, 'boss finish remains close behind the hero line');
assert.match(trailer, /recoveryMeters = Array\.from\(\{ length: 3 \}/, 'three downed party members receive visible recovery meters');
assert.match(trailer, /supportEntry = smooth\(inverseLerp\(26, 29\.45, currentTime\)\)/, 'support visibly enters during the critical beat');
assert.match(trailer, /position\.copy\(offset\(15, 0, -10\)\)\.lerp\(criticalPosition, supportEntry\)/, 'support crosses into the critical scene');
assert.match(trailer, /ratio < 0\.35 \? 0xff2038 : ratio < 0\.72 \? 0xffd76a : 0x64ff9c/, 'recovery meters restore from red through gold to green');
assert.match(trailer, /currentTime >= 26 && currentTime < 33[\s\S]*downAmount/, 'three party members rise deterministically before the counterattack');
assert.match(trailer, /clearCenter = smooth\(inverseLerp\(26, 27\.1, currentTime\)\)[\s\S]*position\.lerp\(base, clearCenter\)/, 'horde opens a clear healing arena from 26 to 33 seconds');
assert.match(trailer, /target = offset\(0, 0, -25\)/, 'final hero pose faces the camera');
assert.match(trailer, /THREE\.NormalBlending/, 'boss beam avoids additive white clipping');
assert.match(trailer, /Math\.sin\(\(age \/ 1\.35\) \* Math\.PI\) \* 0\.16/, 'boss beam uses restrained opacity');

assert.match(trailer, /get ready\(\)/, 'capture API exposes ready');
assert.match(trailer, /restart\(\) \{/, 'capture API exposes restart');
assert.match(trailer, /setTime\(value\) \{/, 'capture API exposes setTime');
assert.match(trailer, /Number\(window\.__trailerCaptureTime\)/, 'external forced capture time is consumed');
assert.match(trailer, /applyTimeline\(next\)/, 'forced capture seeks the deterministic timeline');
assert.match(app, /window\.__game\.trailer = trailer/, 'app exposes the trailer API through window.__game');

assert.match(app, /const APP_VERSION = '20260710g57';/, 'app version stamp is unchanged');
assert.match(trailer, /\?v=20260710g57/g, 'existing import stamps remain unchanged');

console.log('PASS: deterministic 42s gameplay teaser mode contract');
