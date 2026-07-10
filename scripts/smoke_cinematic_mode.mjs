import { readFileSync } from 'node:fs';

function fail(message) {
  console.error('FAIL:', message);
  process.exit(1);
}

const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const start = app.indexOf('const cinematicShots = [');
const end = app.indexOf('let streetT = 0;', start);
if (start < 0 || end < 0) fail('cinematic mode block is missing');
const block = app.slice(start, end);

if (!/body\.\$\{CINEMATIC_CLASS\}>:not\(#app\)/.test(app)) fail('cinematic CSS must preserve the app canvas');
if (!/cursor:none!important/.test(app)) fail('cinematic mode must hide the cursor');
if (!/duration: 9[\s\S]*duration: 10\.5[\s\S]*duration: 8\.5/.test(block)) {
  fail('cinematic shots must rotate on deterministic 8 to 12 second durations');
}
if (!/event\.code !== 'F9'[\s\S]*event\.repeat[\s\S]*player\.locked[\s\S]*isEditableTextTarget\(event\.target\)/.test(block)) {
  fail('F9 must ignore repeats, chat and editable controls');
}
if (/event\.code !== 'F7'|event\.key !== 'F7'/.test(block)) fail('F7 must not toggle cinematic mode');
if (!/classList\.toggle\(CINEMATIC_CLASS, next\)/.test(block)) fail('cinematic UI class is not reversible');
if (!/hideCinematicWorldUi\(\)[\s\S]*restoreCinematicWorldUi\(\)/.test(block)) fail('cinematic world labels must hide and restore');
if (!/restoreGameplayCamera\(\);\s*player\.update\(dt, camera\)/.test(app)) {
  fail('gameplay camera must update independently under cinematic mode');
}
if (!/alpha = 1 - Math\.exp\(-step \* 1\.8\)/.test(block)) fail('cinematic interpolation must depend on dt');
if (!/camera\.lookAt\(player\.pos\.x, player\.pos\.y \+ 1\.35, player\.pos\.z\)/.test(block)) {
  fail('cinematic camera must always look at the player');
}
if (/player\.pos\.(set|copy)|releaseMouseCapture|requestMouseCapture|autoAttack\s*=/.test(block)) {
  fail('cinematic mode must not mutate gameplay, pointer lock or auto attack');
}

console.log('PASS: hidden F9 cinematic mode is reversible and gameplay-neutral');
