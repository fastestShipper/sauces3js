import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const appJs = await readFile(path.join(root, 'src/app.js'), 'utf8');
const expectedBuild = appJs.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1];
assert.ok(expectedBuild, 'src/app.js must expose APP_VERSION');

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.glb', 'model/gltf-binary'],
  ['.wasm', 'application/wasm'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.webp', 'image/webp'],
]);

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const u = new URL(req.url || '/', 'http://127.0.0.1');
      let rel = decodeURIComponent(u.pathname);
      if (rel === '/') rel = '/index.html';
      rel = path.normalize(rel).replace(/^([/\\])+/, '');
      const file = path.resolve(root, rel);
      if (!file.startsWith(root + path.sep)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      const s = await stat(file);
      if (!s.isFile()) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME.get(path.extname(file).toLowerCase()) || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function inspectViewport(browser, base, cfg) {
  const context = await browser.newContext({
    viewport: { width: cfg.width, height: cfg.height },
    deviceScaleFactor: 1,
    isMobile: !!cfg.mobile,
    hasTouch: !!cfg.mobile,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));

  await page.goto(`${base}/?codexOnboarding=1&ws=ws%3A%2F%2F127.0.0.1%3A1`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.getByRole('button', { name: /Explorar sin guardar/i }).click({ timeout: 60000 });
  await page.waitForSelector('#onboard', { state: 'visible', timeout: 30000 });
  await page.waitForTimeout(700);

  const snap = await page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const card = document.querySelector('.ob-card');
    const cardStyle = card ? getComputedStyle(card) : null;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      card: box('.ob-card'),
      go: box('#ob-go'),
      preview: box('#ob-preview canvas'),
      grid: box('#ob-grid'),
      custom: box('#ob-custom'),
      onboardDisplay: getComputedStyle(document.querySelector('#onboard')).display,
      cardOverflowY: cardStyle?.overflowY || '',
      cardClientHeight: card?.clientHeight || 0,
      cardScrollHeight: card?.scrollHeight || 0,
    };
  });

  assert.deepEqual(errors, [], `${cfg.name} console errors`);
  assert.equal(snap.onboardDisplay, 'flex', `${cfg.name} onboarding visible`);
  assert.ok(snap.card, `${cfg.name} card exists`);
  assert.ok(snap.go, `${cfg.name} enter button exists`);
  assert.ok(snap.custom, `${cfg.name} custom controls exist`);
  assert.ok(snap.card.top >= -1 && snap.card.bottom <= cfg.height + 1, `${cfg.name} card fits viewport`);
  assert.ok(snap.go.top >= -1 && snap.go.bottom <= cfg.height + 1, `${cfg.name} enter button fits viewport`);
  assert.ok(snap.custom.top <= cfg.height - 96, `${cfg.name} custom controls start too low`);
  assert.ok(snap.custom.bottom <= snap.go.top + 1, `${cfg.name} enter button overlaps custom controls`);
  assert.ok(snap.preview.height <= cfg.maxPreview + 1, `${cfg.name} preview is compact enough`);
  if (snap.cardScrollHeight > snap.cardClientHeight + 2) {
    assert.match(snap.cardOverflowY, /auto|scroll/, `${cfg.name} overflowing card scrolls internally`);
  }

  await page.getByRole('button', { name: /Entrar al barrio/i }).click({ timeout: 10000 });
  await page.waitForFunction(() => !document.querySelector('#onboard'), null, { timeout: 10000 });
  await context.close();
  console.log(`PASS: ${cfg.name}`, {
    card: {
      top: Math.round(snap.card.top),
      bottom: Math.round(snap.card.bottom),
      height: Math.round(snap.card.height),
    },
    buttonBottom: Math.round(snap.go.bottom),
    previewHeight: Math.round(snap.preview.height),
  });
}

const server = await startServer();
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;

try {
  const browser = await chromium.launch({ headless: true });
  await inspectViewport(browser, base, { name: 'onboarding desktop 1366x768', width: 1366, height: 768, maxPreview: 176 });
  await inspectViewport(browser, base, { name: 'onboarding low 714x522', width: 714, height: 522, maxPreview: 112 });
  await inspectViewport(browser, base, { name: 'onboarding mobile 390x844', width: 390, height: 844, mobile: true, maxPreview: 150 });
  await browser.close();
} finally {
  await new Promise(resolve => server.close(resolve));
}

console.log('PASS: onboarding layout smoke');
