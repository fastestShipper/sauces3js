// Verify world texture manifest files exist on disk.
import { readFileSync, statSync } from 'fs';
import { join } from 'path';

const TEX = 'assets/textures';
const REQUIRED = [
  'asphalt_real.jpg',
  'sidewalk.jpg',
  'paving_real.jpg',
  'grass2.jpg',
  'plaster.jpg',
  'concrete.jpg',
  'sky.hdr',
];

let ok = true;
for (const f of REQUIRED) {
  const p = join(TEX, f);
  try {
    const st = statSync(p);
    if (st.size < 1000) {
      console.error('FAIL: too small', f);
      ok = false;
    } else {
      console.log('OK', f, Math.round(st.size / 1024) + 'KB');
    }
  } catch {
    console.error('FAIL: missing', f);
    ok = false;
  }
}

const manifest = readFileSync('docs/assets-world.md', 'utf8');
if (!manifest.includes('asphalt_real.jpg')) {
  console.error('FAIL: docs/assets-world.md incomplete');
  ok = false;
}

if (!ok) process.exit(1);
console.log('PASS: world asset manifest check');