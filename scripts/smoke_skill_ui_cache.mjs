import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const file = path.join(root, 'src', 'rpg', 'skills.js');
const src = fs.readFileSync(file, 'utf8');

function fail(message) {
  console.error('FAIL:', message);
  process.exit(1);
}

if (!src.includes('this.elCds = this.elSlots.map')) {
  fail('SkillSystem does not cache cooldown elements');
}

if (!src.includes('this._uiCache = {')) {
  fail('SkillSystem does not cache rendered UI values');
}

const refreshStart = src.indexOf('\n  _refreshUI()');
if (refreshStart < 0) fail('SkillSystem._refreshUI not found');
const refreshEnd = src.indexOf('\n  destroy()', refreshStart);
if (refreshEnd < 0) fail('SkillSystem._refreshUI end not found');
const refreshBody = src.slice(refreshStart, refreshEnd);

if (refreshBody.includes("querySelector('.s-cd')")) {
  fail('SkillSystem._refreshUI still queries .s-cd per refresh');
}

if (refreshBody.includes('_refreshKeyLabels()')) {
  fail('SkillSystem._refreshUI still refreshes key labels every tick');
}

for (const pattern of ['cache.resWidth', 'cache.resText', 'cache.ready', 'cache.buffered', 'cache.cdOn', 'cache.cdP', 'cache.cdText']) {
  if (!refreshBody.includes(pattern)) fail(`SkillSystem._refreshUI missing ${pattern}`);
}

if (!src.includes('addEventListener(keybindChangeEvent(), this._onKeybindsChanged)')) {
  fail('SkillSystem keybind change listener missing');
}

console.log('PASS: skill UI cache smoke');
