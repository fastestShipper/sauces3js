import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const hudSource = await readFile(path.join(root, 'src', 'rpg', 'hud.js'), 'utf8');

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;background:#18202a}</style></head>
<body><script type="module">
  import { HUD } from '/hud.js';
  window.hud = new HUD(document.body);
  window.hudReady = true;
</script></body></html>`;

const server = createServer((req, res) => {
  if (req.url === '/hud.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(hudSource);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;

function dimensions(box) {
  return { width: box.width, height: box.height };
}

async function expectDelta(page, selector, text, tone) {
  const delta = page.locator(selector);
  await delta.waitFor({ state: 'attached' });
  assert.equal(await delta.textContent(), text, `${selector} text mismatch`);
  const classes = await delta.getAttribute('class');
  assert.match(classes || '', /\bis-on\b/, `${selector} did not activate`);
  assert.match(classes || '', new RegExp(`\\bis-${tone}\\b`), `${selector} tone mismatch`);
}

async function runViewport(browser, viewport) {
  const page = await browser.newPage({ viewport });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.hudReady === true);

  const panel = page.locator('.rpg-hud-bottom');
  const initialBox = await panel.boundingBox();
  assert.ok(initialBox, `${viewport.width}x${viewport.height} HUD panel is missing`);

  await page.evaluate(() => {
    window.hud.setHP(100, 100);
    window.hud.setXP(0, 70, 1);
    window.hud.setGold(10);
  });
  assert.equal(await page.locator('.rpg-hud-delta.is-on').count(), 0, 'initial values must not produce deltas');

  await page.evaluate(() => window.hud.setHP(74, 100));
  await expectDelta(page, '.rpg-hud-delta-hp', '-26', 'loss');
  await page.evaluate(() => window.hud.setHP(90, 100));
  await expectDelta(page, '.rpg-hud-delta-hp', '+16', 'gain');

  await page.evaluate(() => window.hud.setGold(18));
  await expectDelta(page, '.rpg-hud-delta-gold', '+8', 'gain');
  await page.evaluate(() => window.hud.setGold(3));
  await expectDelta(page, '.rpg-hud-delta-gold', '-15', 'loss');

  await page.evaluate(() => window.hud.setXP(12, 70, 1));
  await expectDelta(page, '.rpg-hud-delta-xp', '+12', 'gain');
  await page.evaluate(() => window.hud.setXP(2, 170, 2));
  await expectDelta(page, '.rpg-hud-delta-xp', 'NIVEL 2', 'level');

  const activeBox = await panel.boundingBox();
  assert.deepEqual(dimensions(activeBox), dimensions(initialBox), `${viewport.width}x${viewport.height} feedback changed panel size`);

  await page.waitForTimeout(900);
  assert.equal(await page.locator('.rpg-hud-delta.is-on').count(), 0, 'delta feedback did not settle');
  assert.equal(await page.locator('.rpg-hud-delta').count(), 3, 'feedback must reuse three stable DOM nodes');

  const settledBox = await panel.boundingBox();
  assert.deepEqual(dimensions(settledBox), dimensions(initialBox), `${viewport.width}x${viewport.height} settled panel size changed`);
  await page.close();
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
  await runViewport(browser, { width: 1366, height: 768 });
  await runViewport(browser, { width: 390, height: 844 });
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}

console.log('PASS: HUD resource deltas are accurate, reusable, and layout-stable on desktop and mobile');
