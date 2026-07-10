import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/sfx.js', import.meta.url), 'utf8');

assert.match(source, /this\.ambient = null/);
assert.match(source, /this\._startAmbience\(\)/);
assert.match(source, /if \(!this\.ctx \|\| !this\.master \|\| this\.ambient\) return false/);
assert.match(source, /bus\.gain\.value = 0\.032/);
assert.match(source, /lowpass\.frequency\.value = 520/);
assert.match(source, /lfo\.frequency\.value = 0\.055/);
assert.match(source, /bus\.connect\(this\.master\)/);
assert.match(source, /this\.master\.gain\.value = this\.muted \? 0 : 0\.34/);
assert.match(source, /this\.loadingFiles = new Map\(\)/);
assert.match(source, /_loadSample\(file\)/);
assert.doesNotMatch(source, /this\._loadSamples\(\)/);

console.log('PASS: ambient sound is subtle, mute-aware and samples load on demand');
