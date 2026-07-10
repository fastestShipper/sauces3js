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
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.glb', 'model/gltf-binary'],
  ['.gltf', 'model/gltf+json'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.wasm', 'application/wasm'],
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

function padBox(box, pad) {
  return box && {
    left: box.left - pad,
    top: box.top - pad,
    right: box.right + pad,
    bottom: box.bottom + pad,
    width: box.width + pad * 2,
    height: box.height + pad * 2,
  };
}

function intersects(a, b, pad = 0) {
  const aa = padBox(a, pad);
  const bb = padBox(b, pad);
  return !!(aa && bb && !(aa.right <= bb.left || bb.right <= aa.left || aa.bottom <= bb.top || bb.bottom <= aa.top));
}

async function inspectViewport(browser, base, cfg) {
  const context = await browser.newContext({
    viewport: { width: cfg.width, height: cfg.height },
    deviceScaleFactor: 1,
    isMobile: !!cfg.mobile,
    hasTouch: !!cfg.mobile,
  });
  const page = await context.newPage();
  const armFeedbackProbe = (targetSelector, feedbackClass) => page.evaluate(({ targetSelector, feedbackClass }) => {
    window.__consumableFeedbackProbe?.observer?.disconnect();
    const seen = { target: false, rail: false };
    const sample = () => {
      seen.target ||= !!document.querySelector(`${targetSelector}.${feedbackClass}`);
      seen.rail ||= !!document.querySelector(`.rpg-cons.${feedbackClass}`);
    };
    const observer = new MutationObserver(sample);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
    window.__consumableFeedbackProbe = { observer, sample, seen };
    sample();
  }, { targetSelector, feedbackClass });
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(`${base}/?trailer=1&offline=1&class=verdugo`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction((build) => window.__SAUCES_BUILD__?.version === build && window.__game?.player?.root, expectedBuild, { timeout: 60000 });
  await page.waitForTimeout(700);

  const snap = await page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    return {
      quickRole: document.querySelector('.rpg-cons')?.getAttribute('role') || '',
      quickLabel: document.querySelector('.rpg-cons')?.getAttribute('aria-label') || '',
      quickDisplay: getComputedStyle(document.querySelector('.rpg-cons')).display,
      consumables: box('.rpg-cons'),
      skills: box('.rpg-skill-root'),
      hud: box('.rpg-hud-bottom'),
      keybinds: box('.kb-toggle'),
      touchPotion: box('.tc-pot'),
      touchKeys: [...document.querySelectorAll('.tc-pot-key')].map(el => el.textContent),
      touchPotions: [...document.querySelectorAll('.tc-pot')].map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, label: el.textContent.trim() };
      }),
      buttons: [...document.querySelectorAll('.rpg-cons-btn')].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          width: r.width,
          height: r.height,
          label: el.getAttribute('aria-label') || '',
          shortcut: el.getAttribute('aria-keyshortcuts') || '',
          disabled: el.getAttribute('aria-disabled') || '',
        };
      }),
    };
  });
  assert.deepEqual(errors, [], `${cfg.name} console errors`);
  assert.equal(snap.quickRole, 'toolbar', `${cfg.name} quick consumables expose a toolbar role`);
  assert.equal(snap.quickLabel, 'Consumibles rápidos', `${cfg.name} quick consumables expose an aria label`);
  assert.equal(snap.buttons.length, 3, `${cfg.name} renders three quick consumable buttons`);
  if (cfg.mobile) {
    assert.equal(snap.quickDisplay, 'none', `${cfg.name} hides duplicate keyboard quickbar on touch screens`);
  } else {
    assert.deepEqual(
      snap.buttons.map(({ width, height }) => [width, height]),
      cfg.quickSizes.map(size => [size, size]),
      `${cfg.name} quick consumables render at the compact g42 size`,
    );
    assert.equal(intersects(snap.consumables, snap.skills, 8), false, `${cfg.name} consumables overlap skills`);
    assert.equal(intersects(snap.consumables, snap.hud, 8), false, `${cfg.name} consumables overlap HUD`);
    assert.equal(intersects(snap.consumables, snap.keybinds, 8), false, `${cfg.name} consumables overlap keybind button`);
  }
  assert.equal(intersects(snap.skills, snap.hud, 4), false, `${cfg.name} skills overlap HUD`);
  const reboundKeys = await page.evaluate(async (build) => {
    const mod = await import('/src/keybinds.js?v=' + build);
    mod.setKeybind('consumable0', 'KeyZ');
    await new Promise(resolve => requestAnimationFrame(resolve));
    return {
      quick: [...document.querySelectorAll('.rpg-cons-btn .c-key')].map(el => el.textContent),
      touch: [...document.querySelectorAll('.tc-pot-key')].map(el => el.textContent),
    };
  }, expectedBuild);
  assert.equal((cfg.mobile ? reboundKeys.touch : reboundKeys.quick)[0], 'Z', `${cfg.name} consumable key label updates after rebind`);

  const prepared = await page.evaluate(async (mobile) => {
    const { inventory, combat, hud } = window.__game.rpg;
    inventory.items = [
      { id: 'smoke_potion_strong', name: 'Poción de prueba fuerte', kind: 'potion', heal: 80, count: 3 },
      { id: 'smoke_potion_minor', name: 'Poción de prueba menor', kind: 'potion', heal: 35, count: 1 },
    ];
    window.__game.player.pos.set(combat.safeCenter[0] + 40, 0, combat.safeCenter[1]);
    combat.hpMax = 200;
    combat.hp = 20;
    hud.setHP(combat.hp, combat.hpMax);
    inventory._render();
    inventory.onChange();
    await new Promise(resolve => requestAnimationFrame(resolve));
    window.__game.player.locked = false;
    const readQuick = () => [...document.querySelectorAll('.rpg-cons-btn')].map((el) => ({
      state: el.dataset.state,
      count: Number(el.dataset.count),
      heal: Number(el.dataset.heal),
      countText: el.querySelector('.c-count')?.textContent || '',
      healText: el.querySelector('.c-heal')?.textContent || '',
      nameText: el.querySelector('.c-name')?.textContent || '',
      label: el.getAttribute('aria-label') || '',
      width: el.offsetWidth,
      height: el.offsetHeight,
    }));
    const visible = document.querySelector(mobile ? '.tc-pot-0' : '.rpg-cons-btn[data-slot="0"]');
    return {
      hp: combat.hp,
      quick: readQuick(),
      visibleSize: visible ? { width: visible.offsetWidth, height: visible.offsetHeight } : null,
      touch: [...document.querySelectorAll('.tc-pot')].map((el) => ({
        countText: el.querySelector('.tc-pot-count')?.textContent || '',
        healText: el.querySelector('.tc-pot-heal')?.textContent || '',
        disabled: el.getAttribute('aria-disabled') || '',
      })),
    };
  }, !!cfg.mobile);
  assert.equal(prepared.hp, 20, `${cfg.name} deterministic health setup`);
  assert.deepEqual(prepared.quick.map(slot => slot.state), ['ready', 'ready', 'empty'], `${cfg.name} exposes ready and empty states`);
  assert.deepEqual(prepared.quick.map(slot => slot.count), [3, 1, 0], `${cfg.name} exposes consumable quantities`);
  assert.deepEqual(prepared.quick.map(slot => slot.heal), [80, 35, 0], `${cfg.name} exposes consumable healing values`);
  assert.equal(prepared.quick[0].countText, '3', `${cfg.name} renders the primary quantity badge`);
  assert.equal(prepared.quick[0].healText, '+80', `${cfg.name} renders the primary healing badge`);
  assert.equal(prepared.quick[2].nameText, 'Vacío', `${cfg.name} renders an explicit empty label`);
  assert.equal(prepared.quick[2].countText, '0', `${cfg.name} keeps an empty quantity badge`);
  assert.equal(prepared.quick[2].healText, 'SIN STOCK', `${cfg.name} keeps an empty healing state`);
  if (cfg.mobile) {
    assert.deepEqual(prepared.touch.map(slot => slot.countText), ['3', '1', '0'], `${cfg.name} syncs touch quantities`);
    assert.deepEqual(prepared.touch.map(slot => slot.healText), ['+80', '+35', 'POT'], `${cfg.name} syncs touch healing states`);
  }

  const reboundTargetSelector = cfg.mobile ? '.tc-pot-0' : '.rpg-cons-btn[data-slot="0"]';
  await armFeedbackProbe(reboundTargetSelector, 'is-use-feedback');
  await page.keyboard.press('KeyZ');
  const keyboardUse = await page.evaluate((mobile) => {
    const target = document.querySelector(mobile ? '.tc-pot-0' : '.rpg-cons-btn[data-slot="0"]');
    const quick = document.querySelector('.rpg-cons-btn[data-slot="0"]');
    const toast = document.querySelector('.rpg-hud-toast');
    const probe = window.__consumableFeedbackProbe;
    probe?.sample();
    probe?.observer?.disconnect();
    return {
      hp: window.__game.rpg.combat.hp,
      count: Number(quick?.dataset.count),
      countText: quick?.querySelector('.c-count')?.textContent || '',
      targetFeedback: probe?.seen.target || target?.classList.contains('is-use-feedback') || false,
      railFeedback: probe?.seen.rail || document.querySelector('.rpg-cons')?.classList.contains('is-use-feedback') || false,
      toastOn: toast?.classList.contains('is-on') || false,
      toastText: toast?.textContent || '',
    };
  }, !!cfg.mobile);
  assert.equal(keyboardUse.hp, 100, `${cfg.name} remapped key applies the configured healing value`);
  assert.equal(keyboardUse.count, 2, `${cfg.name} remapped key decrements one consumable`);
  assert.equal(keyboardUse.countText, '2', `${cfg.name} remapped key refreshes the quantity badge`);
  assert.equal(keyboardUse.targetFeedback, true, `${cfg.name} remapped key triggers target feedback`);
  assert.equal(keyboardUse.railFeedback, true, `${cfg.name} remapped key triggers quickbar feedback`);
  assert.equal(keyboardUse.toastOn, true, `${cfg.name} remapped key shows use feedback`);
  assert.match(keyboardUse.toastText, /Poción de prueba fuerte.*\+80 HP/, `${cfg.name} use feedback reports healing`);

  await page.waitForTimeout(500);
  const resetKeys = await page.evaluate(async (build) => {
    const mod = await import('/src/keybinds.js?v=' + build);
    mod.resetKeybinds();
    await new Promise(resolve => requestAnimationFrame(resolve));
    return {
      quick: [...document.querySelectorAll('.rpg-cons-btn .c-key')].map(el => el.textContent),
      touch: [...document.querySelectorAll('.tc-pot-key')].map(el => el.textContent),
    };
  }, expectedBuild);
  assert.equal((cfg.mobile ? resetKeys.touch : resetKeys.quick)[0], '1', `${cfg.name} consumable key label resets after defaults`);

  const primarySelector = cfg.mobile ? '.tc-pot-0' : '.rpg-cons-btn[data-slot="0"]';
  const primaryBox = await page.locator(primarySelector).boundingBox();
  assert.ok(primaryBox, `${cfg.name} primary pointer target is visible`);
  await armFeedbackProbe(primarySelector, 'is-use-feedback');
  if (cfg.mobile) await page.touchscreen.tap(primaryBox.x + primaryBox.width / 2, primaryBox.y + primaryBox.height / 2);
  else await page.mouse.click(primaryBox.x + primaryBox.width / 2, primaryBox.y + primaryBox.height / 2);
  const pointerUse = await page.evaluate((mobile) => {
    const target = document.querySelector(mobile ? '.tc-pot-0' : '.rpg-cons-btn[data-slot="0"]');
    const quick = document.querySelector('.rpg-cons-btn[data-slot="0"]');
    const probe = window.__consumableFeedbackProbe;
    probe?.sample();
    probe?.observer?.disconnect();
    return {
      hp: window.__game.rpg.combat.hp,
      count: Number(quick?.dataset.count),
      targetFeedback: probe?.seen.target || target?.classList.contains('is-use-feedback') || false,
      width: target?.offsetWidth || 0,
      height: target?.offsetHeight || 0,
    };
  }, !!cfg.mobile);
  assert.equal(pointerUse.hp, 180, `${cfg.name} pointer use applies healing`);
  assert.equal(pointerUse.count, 1, `${cfg.name} pointer use decrements one consumable`);
  assert.equal(pointerUse.targetFeedback, true, `${cfg.name} pointer use triggers target feedback`);
  assert.deepEqual(
    { width: pointerUse.width, height: pointerUse.height },
    prepared.visibleSize,
    `${cfg.name} primary target keeps stable layout dimensions after use`,
  );

  const emptySelector = cfg.mobile ? '.tc-pot-2' : '.rpg-cons-btn[data-slot="2"]';
  const emptyBox = await page.locator(emptySelector).boundingBox();
  assert.ok(emptyBox, `${cfg.name} empty pointer target is visible`);
  await armFeedbackProbe(emptySelector, 'is-empty-feedback');
  if (cfg.mobile) await page.touchscreen.tap(emptyBox.x + emptyBox.width / 2, emptyBox.y + emptyBox.height / 2);
  else await page.mouse.click(emptyBox.x + emptyBox.width / 2, emptyBox.y + emptyBox.height / 2);
  const emptyUse = await page.evaluate((mobile) => {
    const usedTarget = document.querySelector(mobile ? '.tc-pot-0' : '.rpg-cons-btn[data-slot="0"]');
    const emptyTarget = document.querySelector(mobile ? '.tc-pot-2' : '.rpg-cons-btn[data-slot="2"]');
    const emptyQuick = document.querySelector('.rpg-cons-btn[data-slot="2"]');
    const probe = window.__consumableFeedbackProbe;
    probe?.sample();
    probe?.observer?.disconnect();
    return {
      hp: window.__game.rpg.combat.hp,
      state: emptyQuick?.dataset.state || '',
      count: Number(emptyQuick?.dataset.count),
      heal: Number(emptyQuick?.dataset.heal),
      emptyFeedback: probe?.seen.target || emptyTarget?.classList.contains('is-empty-feedback') || false,
      staleUseFeedback: usedTarget?.classList.contains('is-use-feedback') || false,
      toastOn: document.querySelector('.rpg-hud-toast')?.classList.contains('is-on') || false,
    };
  }, !!cfg.mobile);
  assert.equal(emptyUse.hp, 180, `${cfg.name} empty use does not change health`);
  assert.equal(emptyUse.state, 'empty', `${cfg.name} empty slot keeps explicit state`);
  assert.equal(emptyUse.count, 0, `${cfg.name} empty slot keeps zero quantity`);
  assert.equal(emptyUse.heal, 0, `${cfg.name} empty slot keeps zero healing`);
  assert.equal(emptyUse.emptyFeedback, true, `${cfg.name} empty use triggers feedback`);
  assert.equal(emptyUse.staleUseFeedback, false, `${cfg.name} feedback does not stick to the previous target`);
  assert.equal(emptyUse.toastOn, true, `${cfg.name} empty use shows feedback`);

  await page.waitForTimeout(500);
  const settled = await page.evaluate((mobile) => {
    const size = (selector) => {
      const el = document.querySelector(selector);
      return el ? { width: el.offsetWidth, height: el.offsetHeight } : null;
    };
    return {
      primary: size(mobile ? '.tc-pot-0' : '.rpg-cons-btn[data-slot="0"]'),
      feedbackCount: document.querySelectorAll('.is-use-feedback,.is-empty-feedback').length,
    };
  }, !!cfg.mobile);
  assert.deepEqual(settled.primary, prepared.visibleSize, `${cfg.name} target dimensions remain stable after feedback`);
  assert.equal(settled.feedbackCount, 0, `${cfg.name} feedback classes clear after animation`);
  if (cfg.mobile) {
    assert.ok(snap.touchPotion, `${cfg.name} renders an easy touch potion button`);
    assert.equal(snap.touchPotions.length, 3, `${cfg.name} renders three easy touch potion buttons`);
    assert.equal(snap.touchKeys.length, 3, `${cfg.name} touch potion buttons expose key labels`);
    assert.equal(intersects(snap.touchPotion, snap.skills, 6), false, `${cfg.name} potion touch button overlaps skills`);
    assert.equal(intersects(snap.touchPotion, snap.hud, 6), false, `${cfg.name} potion touch button overlaps HUD`);
    for (const pot of snap.touchPotions) {
      assert.equal(intersects(pot, snap.skills, 6), false, `${cfg.name} touch potion ${pot.label} overlaps skills`);
      assert.equal(intersects(pot, snap.hud, 6), false, `${cfg.name} touch potion ${pot.label} overlaps HUD`);
    }
    assert.deepEqual(
      snap.touchPotions.map(({ width, height }) => [Math.round(width), Math.round(height)]),
      cfg.touchSizes.map(size => [size, size]),
      `${cfg.name} touch consumables preserve compact accessible targets`,
    );
    for (let i = 0; i < snap.touchPotions.length; i++) {
      for (let j = i + 1; j < snap.touchPotions.length; j++) {
        assert.equal(intersects(snap.touchPotions[i], snap.touchPotions[j], 3), false, `${cfg.name} touch potion buttons overlap each other`);
      }
    }
  }
  for (let i = 0; i < snap.buttons.length; i++) {
    const btn = snap.buttons[i];
    assert.ok(btn.label.startsWith('Consumible ' + (i + 1) + ','), `${cfg.name} consumable button has slot aria label`);
    assert.ok(btn.shortcut.length > 0, `${cfg.name} consumable button exposes aria-keyshortcuts`);
    assert.ok(btn.disabled === 'true' || btn.disabled === 'false', `${cfg.name} consumable button exposes aria-disabled`);
  }
  if (!cfg.mobile) assert.ok(snap.buttons[0].width >= snap.buttons[1].width, `${cfg.name} primary potion button should be easiest to tap`);

  await page.evaluate(() => {
    if (window.__game?.player) window.__game.player.locked = false;
  });
  await page.keyboard.press('KeyI');
  await page.waitForFunction(() => document.querySelector('.rpg-inv')?.classList.contains('is-open'), null, { timeout: 5000 });
  const invSnap = await page.evaluate(() => {
    const style = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        display: cs.display,
        opacity: Number(cs.opacity),
        pointerEvents: cs.pointerEvents,
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    };
    return {
      bodyPanelOpen: document.body.classList.contains('ui-panel-open'),
      bodyInventoryOpen: document.body.classList.contains('ui-inventory-open'),
      playerLocked: !!window.__game?.player?.locked,
      inventory: style('.rpg-inv'),
      consumables: style('.rpg-cons'),
      skills: style('.rpg-skill-root'),
      hud: style('.rpg-hud-bottom'),
      keybinds: style('.kb-toggle'),
      touchStick: style('.tc-stick'),
      touchPotion: style('.tc-pot'),
    };
  });
  assert.equal(invSnap.bodyPanelOpen, true, `${cfg.name} inventory marks global panel open`);
  assert.equal(invSnap.bodyInventoryOpen, true, `${cfg.name} inventory marks inventory open`);
  assert.equal(invSnap.playerLocked, true, `${cfg.name} inventory locks player input`);
  assert.equal(invSnap.consumables.display, 'none', `${cfg.name} inventory hides quick consumables`);
  assert.equal(invSnap.skills.opacity, 0, `${cfg.name} inventory fades skills`);
  assert.equal(invSnap.hud.opacity, 0, `${cfg.name} inventory fades HUD`);
  assert.equal(invSnap.keybinds.display, 'none', `${cfg.name} inventory hides keybind toggle`);
  if (cfg.mobile) {
    assert.equal(invSnap.touchStick.opacity, 0, `${cfg.name} inventory fades touch stick`);
    assert.equal(invSnap.touchPotion.opacity, 0, `${cfg.name} inventory fades touch potion`);
  }

  await page.keyboard.press('KeyI');
  try {
    await page.waitForFunction(() => {
      const el = document.querySelector('.rpg-inv');
      return !!el && !el.classList.contains('is-open');
    }, null, { timeout: 15000 });
  } catch (err) {
    const stuck = await page.evaluate(() => ({
      inventoryClass: document.querySelector('.rpg-inv')?.className || null,
      bodyClass: document.body?.className || '',
      playerLocked: !!window.__game?.player?.locked,
      actionLabel: document.querySelector('.rpg-cons-btn .c-key')?.textContent || null,
      activeTag: document.activeElement?.tagName || null,
    }));
    throw new Error(`${cfg.name} inventory did not close after KeyI: ${JSON.stringify(stuck)}; ${err.message}`);
  }
  const closedSnap = await page.evaluate(() => ({
    bodyPanelOpen: document.body.classList.contains('ui-panel-open'),
    bodyInventoryOpen: document.body.classList.contains('ui-inventory-open'),
    playerLocked: !!window.__game?.player?.locked,
  }));
  assert.equal(closedSnap.bodyPanelOpen, false, `${cfg.name} closing inventory clears panel state`);
  assert.equal(closedSnap.bodyInventoryOpen, false, `${cfg.name} closing inventory clears inventory state`);
  assert.equal(closedSnap.playerLocked, false, `${cfg.name} closing inventory restores player input`);

  await page.evaluate(() => {
    if (window.__game?.player) window.__game.player.locked = false;
  });
  await page.evaluate(() => document.querySelector('.kb-toggle')?.click());
  await page.waitForFunction(() => document.querySelector('.kb-panel')?.classList.contains('on'), null, { timeout: 10000 });
  const keySnap = await page.evaluate((mobile) => {
    const style = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        display: cs.display,
        opacity: Number(cs.opacity),
        pointerEvents: cs.pointerEvents,
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    };
    const beforeYaw = window.__game?.player?.yaw || 0;
    let afterYaw = beforeYaw;
    if (mobile && typeof Touch === 'function' && typeof TouchEvent === 'function') {
      const panel = document.querySelector('.kb-panel');
      const r = panel.getBoundingClientRect();
      const x = r.left + r.width * 0.5;
      const y = r.top + Math.min(40, r.height * 0.5);
      const t0 = new Touch({ identifier: 91, target: document.body, clientX: x, clientY: y });
      const t1 = new Touch({ identifier: 91, target: document.body, clientX: x + 80, clientY: y + 20 });
      window.dispatchEvent(new TouchEvent('touchstart', { changedTouches: [t0], bubbles: true, cancelable: true }));
      window.dispatchEvent(new TouchEvent('touchmove', { changedTouches: [t1], bubbles: true, cancelable: true }));
      afterYaw = window.__game?.player?.yaw || 0;
    }
    return {
      bodyPanelOpen: document.body.classList.contains('ui-panel-open'),
      playerLocked: !!window.__game?.player?.locked,
      panel: style('.kb-panel'),
      consumables: style('.rpg-cons'),
      skills: style('.rpg-skill-root'),
      hud: style('.rpg-hud-bottom'),
      touchStick: style('.tc-stick'),
      touchPotion: style('.tc-pot'),
      yawDelta: afterYaw - beforeYaw,
    };
  }, !!cfg.mobile);
  assert.equal(keySnap.bodyPanelOpen, true, `${cfg.name} keybind panel marks global panel open`);
  assert.equal(keySnap.playerLocked, true, `${cfg.name} keybind panel locks player input`);
  assert.ok(keySnap.panel.height >= cfg.minKeyPanelHeight, `${cfg.name} keybind panel is too short`);
  assert.equal(keySnap.consumables.display, 'none', `${cfg.name} keybind panel hides quick consumables`);
  assert.equal(keySnap.skills.opacity, 0, `${cfg.name} keybind panel fades skills`);
  assert.equal(keySnap.hud.opacity, 0, `${cfg.name} keybind panel fades HUD`);
  if (cfg.mobile) {
    assert.equal(keySnap.touchStick.opacity, 0, `${cfg.name} keybind panel fades touch stick`);
    assert.equal(keySnap.touchPotion.opacity, 0, `${cfg.name} keybind panel fades touch potion`);
    assert.equal(Math.abs(keySnap.yawDelta) < 0.0001, true, `${cfg.name} touch over keybind panel moved camera`);
  }

  console.log(`PASS: ${cfg.name}`, {
    consumables: {
      left: Math.round(snap.consumables.left),
      top: Math.round(snap.consumables.top),
      right: Math.round(snap.consumables.right),
      bottom: Math.round(snap.consumables.bottom),
    },
    buttons: snap.buttons.map(b => `${Math.round(b.width)}x${Math.round(b.height)}`),
  });
  await context.close();
}

const server = await startServer();
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;

try {
  const browser = await chromium.launch({ headless: true });
  const viewports = [
    { id: 'desktop-low', name: 'desktop low 714x522', width: 714, height: 522, quickSizes: [38, 32, 32], minKeyPanelHeight: 250 },
    { id: 'compact', name: 'compact screenshot 967x546', width: 967, height: 546, quickSizes: [38, 32, 32], minKeyPanelHeight: 250 },
    { id: 'desktop', name: 'desktop 1366x768', width: 1366, height: 768, quickSizes: [44, 35, 35], minKeyPanelHeight: 250 },
    { id: 'mobile', name: 'mobile 390x844', width: 390, height: 844, mobile: true, touchSizes: [59, 46, 46], minKeyPanelHeight: 420 },
    { id: 'touch-landscape', name: 'touch landscape 896x414', width: 896, height: 414, mobile: true, touchSizes: [55, 45, 45], minKeyPanelHeight: 140 },
  ];
  const selected = process.env.SMOKE_VIEWPORT
    ? viewports.filter(({ id }) => id === process.env.SMOKE_VIEWPORT)
    : viewports;
  assert.ok(selected.length, `unknown SMOKE_VIEWPORT ${process.env.SMOKE_VIEWPORT}`);
  for (const viewport of selected) await inspectViewport(browser, base, viewport);
  await browser.close();
} finally {
  await new Promise(resolve => server.close(resolve));
}

console.log('PASS: quick consumable UI smoke');
