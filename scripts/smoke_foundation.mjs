// Foundation smoke: audits + optional HTTP + WebSocket handshake (no Playwright required).
import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const require = createRequire(import.meta.url);

const HTTP_BASE = (process.env.SMOKE_HTTP_BASE || 'http://127.0.0.1:8877').replace(/\/$/, '');
const WS_URL = process.env.SMOKE_WS_URL || 'ws://127.0.0.1:8456';
let EXPECTED_BUILD = process.env.SMOKE_BUILD || '';
const SKIP_HTTP = process.env.SMOKE_SKIP_HTTP === '1';
const SKIP_WS = process.env.SMOKE_SKIP_WS === '1';

let ok = true;
function fail(msg) {
  console.error('FAIL:', msg);
  ok = false;
}

function runAudit(script) {
  const r = spawnSync(process.execPath, [path.join(__dirname, script)], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  if (r.status !== 0) fail(`${script} exited ${r.status}`);
}

console.log('--- audits ---');
runAudit('audit_building_count.mjs');
runAudit('audit_zone_integrity.mjs');
runAudit('audit_server_store.mjs');
runAudit('audit_park_clearance.mjs');
runAudit('smoke_zone_difficulty_balance.mjs');
runAudit('audit_mob_spawns.mjs');
runAudit('smoke_world_pacing.mjs');
runAudit('smoke_mob_flag_palette.mjs');
runAudit('smoke_bloodcoat.mjs');
runAudit('smoke_mob_mixer_lod.mjs');
runAudit('smoke_mob_action_blend.mjs');
runAudit('smoke_net_remote_action_blend.mjs');
runAudit('smoke_mob_hit_feedback.mjs');
runAudit('smoke_mob_stagger_interrupt.mjs');
runAudit('smoke_net_remote_mixer_lod.mjs');
runAudit('smoke_damage_number_cache.mjs');
runAudit('smoke_effect_caps.mjs');
runAudit('smoke_effect_shared_geometry.mjs');
runAudit('smoke_effect_smooth_shake.mjs');
runAudit('smoke_inventory_potion_stack.mjs');
runAudit('smoke_bleed_pressure.mjs');
runAudit('smoke_player_pointer_lock.mjs');
runAudit('smoke_player_root_motion_filter.mjs');
runAudit('smoke_player_body_lean.mjs');
runAudit('smoke_camera_occlusion.mjs');
runAudit('smoke_movement_guard.mjs');
runAudit('smoke_world_obstacles.mjs');
runAudit('smoke_player_action_blend.mjs');
runAudit('smoke_touch_feedback.mjs');
runAudit('smoke_ambient_sound.mjs');
runAudit('smoke_g42_app_flow.mjs');
runAudit('smoke_cinematic_mode.mjs');
runAudit('smoke_manual_attack_hold.mjs');
runAudit('smoke_net_remote_body_lean.mjs');
runAudit('smoke_player_hit_impulse.mjs');
runAudit('smoke_melee_attack_settle.mjs');
runAudit('smoke_dash_action_buffer.mjs');
runAudit('smoke_dash_response.mjs');
runAudit('smoke_motion_trails.mjs');

console.log('--- app version (local file) ---');
const appJs = readFileSync(path.join(root, 'src/app.js'), 'utf8');
if (!EXPECTED_BUILD) {
  EXPECTED_BUILD = appJs.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1] || '';
}
if (!EXPECTED_BUILD) {
  fail('src/app.js missing APP_VERSION declaration');
} else if (!appJs.includes(`APP_VERSION = '${EXPECTED_BUILD}'`) && !appJs.includes(`APP_VERSION = "${EXPECTED_BUILD}"`)) {
  fail(`src/app.js missing APP_VERSION ${EXPECTED_BUILD}`);
} else {
  console.log('PASS: APP_VERSION in src/app.js', EXPECTED_BUILD);
}

async function httpCheck() {
  if (SKIP_HTTP) {
    console.log('SKIP: HTTP checks (SMOKE_SKIP_HTTP=1)');
    return;
  }
  console.log('--- HTTP ---', HTTP_BASE);
  try {
    const indexRes = await fetch(`${HTTP_BASE}/index.html`, { redirect: 'follow' });
    if (!indexRes.ok) fail(`index.html HTTP ${indexRes.status}`);
    else console.log('PASS: index.html', indexRes.status);
    const html = await indexRes.text();
    if (!html.includes(EXPECTED_BUILD)) fail(`index.html missing build cache buster ${EXPECTED_BUILD}`);
    else console.log('PASS: index.html references build', EXPECTED_BUILD);

    const appRes = await fetch(`${HTTP_BASE}/src/app.js`, { redirect: 'follow' });
    if (!appRes.ok) fail(`src/app.js HTTP ${appRes.status}`);
    else {
      const body = await appRes.text();
      if (!body.includes('APP_VERSION')) fail('served app.js missing APP_VERSION');
      else console.log('PASS: src/app.js served');
    }
  } catch (e) {
    fail(`HTTP smoke failed (${HTTP_BASE}): ${e.message}`);
    console.log('Hint: python -m http.server 8877 from repo root, or SMOKE_HTTP_BASE=https://sauces.controla.group');
  }
}

function wsCheck() {
  return new Promise((resolve) => {
    if (SKIP_WS) {
      console.log('SKIP: WS checks (SMOKE_SKIP_WS=1)');
      resolve();
      return;
    }
    console.log('--- WebSocket ---', WS_URL);
    let WebSocket;
    try {
      WebSocket = require(path.join(root, 'server/node_modules/ws'));
    } catch {
      fail('ws package not found under server/node_modules (run npm install in server/)');
      resolve();
      return;
    }
    let gotId = false;
    const timer = setTimeout(() => {
      if (!gotId) fail('WS connect timeout (8s) without id handshake');
      try { ws.close(); } catch {}
      resolve();
    }, 8000);
    const ws = new WebSocket(WS_URL);
    ws.on('open', () => {
      console.log('PASS: WS connected');
    });
    ws.on('message', (buf) => {
      try {
        const m = JSON.parse(String(buf));
        if (m.t === 'id' && Number.isInteger(m.id)) {
          gotId = true;
          console.log('PASS: WS handshake id', m.id);
          clearTimeout(timer);
          ws.close();
          resolve();
        }
      } catch {
        fail('WS message not JSON');
        clearTimeout(timer);
        ws.close();
        resolve();
      }
    });
    ws.on('error', (err) => {
      fail(`WS error: ${err.message}`);
      clearTimeout(timer);
      resolve();
    });
  });
}

await httpCheck();
await wsCheck();

if (!ok) process.exit(1);
console.log('PASS: foundation smoke');
