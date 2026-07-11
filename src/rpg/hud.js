// HUD del RPG: UI pura de DOM (sin three.js). Inyecta su propio <style> una
// sola vez y vive en posiciones fixed con z-index bajo para no tapar las capas
// de onboarding/loading. Estetica toon: oscuro translucido, texto con sombra
// para contraste sobre cualquier fondo del mundo.

const STYLE_ID = 'rpg-hud-style';

// Inyecta el bloque de estilos una sola vez por documento. El minimapa vive en
// top:14 right:14 con 196px de ancho, asi que el tracker de quest se ancla
// debajo (top:188) alineado a la derecha y con el mismo ancho.
function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const css = `
:root { --rpg-hud-left: max(12px, env(safe-area-inset-left)); --rpg-hud-bottom-width: 270px; }
.rpg-hud-root { position: fixed; inset: 0; pointer-events: none; z-index: 40;
  --hud-ivory: #fff6d9; --hud-cream: #f4dfad; --hud-gold: #e7bd61;
  --hud-gold-hot: #fff0a8; --hud-gold-soft: rgba(236,196,105,.44);
  --hud-red: #ff5f4f; --hud-red-deep: #8e171d; --hud-jade: #59d59a;
  --hud-emerald: #55c68e; --hud-ink: rgba(7,10,16,.78);
  --hud-panel: rgba(13,18,25,.72); --hud-shadow: rgba(0,0,0,.54); --hud-panel-radius: 10px;
  font-family: 'Fredoka', system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: var(--hud-ivory); text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; }
.rpg-hud-root * { box-sizing: border-box; }
.rpg-hud-panel { position: fixed; isolation: isolate;
  background:
    linear-gradient(180deg, rgba(255,255,255,.09), rgba(255,255,255,0) 28%),
    radial-gradient(circle at 18% -18%, rgba(255,234,171,.25), rgba(255,234,171,0) 38%),
    radial-gradient(circle at 92% 120%, rgba(67,185,128,.19), rgba(67,185,128,0) 44%),
    linear-gradient(135deg, rgba(24,32,42,.82), rgba(8,11,17,.92));
  border: 1px solid var(--hud-gold-soft); border-radius: var(--hud-panel-radius); padding: 10px 12px;
  -webkit-backdrop-filter: blur(12px) saturate(1.28); backdrop-filter: blur(12px) saturate(1.28);
  text-shadow: 0 1px 3px rgba(0,0,0,.92);
  box-shadow: 0 16px 36px var(--hud-shadow), 0 0 0 1px rgba(255,255,255,.06) inset,
    0 1px 0 rgba(255,255,255,.14) inset, 0 -1px 0 rgba(0,0,0,.58) inset; }
.rpg-hud-panel::before { content: ''; position: absolute; inset: 1px; border-radius: calc(var(--hud-panel-radius) - 2px);
  border: 1px solid rgba(255,255,255,.08); pointer-events: none; z-index: 0;
  box-shadow: 0 0 0 1px rgba(5,7,12,.34), inset 0 0 18px rgba(231,189,97,.08); }
.rpg-hud-panel::after { content: ''; position: absolute; inset: 0; border-radius: var(--hud-panel-radius);
  background:
    linear-gradient(90deg, rgba(231,189,97,.72), rgba(231,189,97,0) 18% 82%, rgba(231,189,97,.5)) top/100% 1px no-repeat,
    linear-gradient(90deg, rgba(231,189,97,.28), rgba(231,189,97,0) 22% 78%, rgba(231,189,97,.24)) bottom/100% 1px no-repeat,
    linear-gradient(95deg, rgba(255,255,255,.17), rgba(255,255,255,0) 28% 72%, rgba(231,189,97,.13));
  opacity: .64; pointer-events: none; z-index: 0; }
.rpg-hud-panel > * { position: relative; z-index: 1; }
.rpg-hud-bottom { left: var(--rpg-hud-left); right: auto;
  bottom: max(12px, env(safe-area-inset-bottom)); transform: none;
  box-sizing: border-box;
  width: var(--rpg-hud-bottom-width); display: flex; flex-direction: column; gap: 5px;
  min-height: 80px; max-width: calc(100vw - 24px); padding: 9px 12px 9px 56px; }
.rpg-hud-bottom::before { box-shadow: 0 0 22px rgba(231,189,97,.12) inset; }
.rpg-hud-bottom.is-hp-low { border-color: rgba(255,126,83,.62);
  box-shadow: 0 16px 36px var(--hud-shadow), 0 0 16px rgba(255,95,79,.18),
    0 0 0 1px rgba(255,255,255,.06) inset; }
.rpg-hud-bottom.is-hp-critical { animation: rpgHudDanger 980ms ease-in-out infinite; }
.rpg-hud-lvl-badge { position: absolute; left: 8px; top: 50%; transform: translateY(-50%);
  width: 38px; height: 38px; border-radius: 999px; display: grid; place-items: center;
  background:
    radial-gradient(circle at 35% 22%, #fff8d4 0 13%, #f5cf69 14% 34%, #a46f23 65%, #37200c 100%);
  border: 1px solid rgba(255,230,161,.88); color: #190f07; font-size: 16px; font-weight: 800;
  text-shadow: 0 1px 0 rgba(255,255,255,.42);
  box-shadow: 0 0 0 3px rgba(7,10,16,.9), 0 8px 22px rgba(0,0,0,.45),
    0 0 24px rgba(231,189,97,.38), inset 0 1px 0 rgba(255,255,255,.72); }
.rpg-hud-lvl-badge::after { content: ''; position: absolute; inset: 5px; border-radius: inherit;
  border: 1px solid rgba(79,42,10,.48); pointer-events: none; }
.rpg-hud-stat { position: relative; min-width: 0; flex: 1 1 0; }
.rpg-hud-stat::before { content: ''; position: absolute; left: -8px; top: 5px; bottom: 3px;
  width: 2px; border-radius: 999px; background: linear-gradient(180deg, rgba(255,240,168,.74), rgba(255,240,168,0)); opacity: .52; }
.rpg-hud-label { font-size: 10px; font-weight: 800; letter-spacing: .6px; text-transform: uppercase;
  display: flex; align-items: baseline; justify-content: space-between; gap: 10px; min-height: 12px;
  margin-bottom: 4px; color: var(--hud-cream); line-height: 1; }
.rpg-hud-label span:first-child { display: inline-flex; align-items: center; gap: 5px; min-width: 0; }
.rpg-hud-label span:first-child::before { content: ''; width: 7px; height: 7px; border-radius: 999px;
  background: var(--hud-gold); box-shadow: 0 0 10px rgba(231,189,97,.58); flex: 0 0 auto; }
.rpg-hud-stat-hp .rpg-hud-label span:first-child::before { background: var(--hud-red); box-shadow: 0 0 10px rgba(255,95,79,.62); }
.rpg-hud-stat-xp .rpg-hud-label span:first-child::before { background: var(--hud-gold-hot); }
.rpg-hud-label span:last-child { color: #fff8df; font-variant-numeric: tabular-nums; white-space: nowrap; flex: 0 0 auto; }
.rpg-hud-bar { position: relative; height: 11px; border-radius: 999px;
  background: linear-gradient(180deg, rgba(3,5,9,.92), rgba(16,20,30,.82)); overflow: hidden;
  border: 1px solid rgba(231,189,97,.22);
  box-shadow: inset 0 2px 6px rgba(0,0,0,.82), 0 1px 0 rgba(255,255,255,.08); }
.rpg-hud-bar::before { content: ''; position: absolute; inset: 2px; border-radius: inherit;
  border: 1px solid rgba(255,255,255,.05); pointer-events: none; z-index: 3; }
.rpg-hud-bar::after { content: ''; position: absolute; left: 4px; right: 4px; top: 3px;
  height: 2px; border-radius: 999px; background: linear-gradient(90deg, rgba(255,255,255,.44), rgba(255,255,255,0));
  opacity: .6; pointer-events: none; z-index: 2; }
.rpg-hud-fill { position: absolute; inset: 0; width: 0%; border-radius: 999px;
  z-index: 1; transition: width 280ms cubic-bezier(0.16,1,0.3,1), filter 180ms ease, transform 180ms ease;
  box-shadow: 0 0 14px rgba(255,255,255,.12), inset 0 -7px 12px rgba(0,0,0,.22); }
.rpg-hud-fill::after { content: ''; position: absolute; left: 0; right: 0; top: 0;
  height: 50%; border-radius: 999px 999px 0 0;
  background: linear-gradient(180deg, rgba(255,255,255,.54), rgba(255,255,255,0)); }
.rpg-hud-ghost { position: absolute; inset: 0; width: 0%; border-radius: 999px; z-index: 0;
  transition: width 620ms cubic-bezier(0.16,1,0.3,1); opacity: .58; filter: blur(.2px); }
.rpg-hud-ghost-hp { background: linear-gradient(90deg, rgba(255,220,118,.46), rgba(255,95,79,.36)); }
.rpg-hud-ghost-foe { background: linear-gradient(90deg, rgba(255,213,104,.42), rgba(255,95,79,.32)); }
.rpg-hud-ghost-xp { background: linear-gradient(90deg, rgba(255,240,168,.24), rgba(89,213,154,.26)); opacity: .38; }
.rpg-hud-fill-hp { background: linear-gradient(90deg, #9d1e22, #ed4536 58%, #ff8a62); }
.rpg-hud-fill-xp { background: linear-gradient(90deg, #9d6a1d, #e8b946 56%, #fff0a8); }
.rpg-hud-fill-foe { background: linear-gradient(90deg, #7d161a, #da332b 60%, #ff8467); }
.rpg-hud-fill.is-pop { animation: rpgFillPop 260ms cubic-bezier(0.16,1.4,0.3,1); }
.rpg-hud-delta { position: absolute; right: 3px; top: 13px; z-index: 6;
  min-width: 38px; color: #fff0a8; font-size: 10px; font-weight: 900; line-height: 1;
  letter-spacing: .4px; text-align: right; white-space: nowrap; opacity: 0;
  transform: translateY(4px) scale(.92); filter: brightness(1.08);
  text-shadow: 0 1px 2px rgba(0,0,0,.96), 0 0 9px currentColor; }
.rpg-hud-delta.is-gain { color: #8cf3bd; }
.rpg-hud-delta.is-loss { color: #ff9c82; }
.rpg-hud-delta.is-level { color: #fff0a8; font-size: 9px; letter-spacing: .8px; }
.rpg-hud-delta.is-on { animation: rpgHudDelta 820ms cubic-bezier(0.16,1,0.3,1) forwards; }
.rpg-hud-gold .rpg-hud-delta { right: 3px; top: -14px; min-width: 46px; }
.rpg-hud-bottom.is-hp-low .rpg-hud-fill-hp { background: linear-gradient(90deg, #7d1217, #f44336 58%, #ffc06f); filter: saturate(1.16); }
.rpg-hud-target { top: max(12px, env(safe-area-inset-top)); left: 50%; transform: translateX(-50%);
  width: clamp(236px, 25vw, 312px); text-align: left; display: none; border-color: rgba(255,118,87,.52);
  min-height: 72px; padding: 8px 12px 10px; overflow: hidden; }
.rpg-hud-target.is-on { display: block; animation: rpgTargetIn 180ms cubic-bezier(0.16,1,0.3,1); }
.rpg-hud-target.is-locked { border-color: rgba(255,210,74,.72);
  box-shadow: 0 16px 36px var(--hud-shadow), 0 0 14px rgba(255,210,74,.12),
    0 0 0 1px rgba(255,255,255,.06) inset; }
.rpg-hud-target.is-locked .rpg-hud-target-mark { color: #ffe69a; opacity: 1; }
.rpg-hud-target.is-hit { animation: rpgTargetHit 220ms cubic-bezier(0.16,1,0.3,1); }
.rpg-hud-target.is-low { border-color: rgba(255,206,92,.72);
  box-shadow: 0 16px 36px var(--hud-shadow), 0 0 18px rgba(255,196,80,.18),
    0 0 0 1px rgba(255,255,255,.06) inset; }
.rpg-hud-target-head { display: flex; align-items: center; justify-content: space-between;
  gap: 10px; margin-bottom: 4px; }
.rpg-hud-target-mark { color: #ffceb2; font-size: 9px; font-weight: 900; letter-spacing: 1.4px;
  text-transform: uppercase; opacity: .82; }
.rpg-hud-target-hp { color: #fff0a8; font-size: 11px; font-weight: 900;
  font-variant-numeric: tabular-nums; text-shadow: 0 0 12px rgba(231,189,97,.32); }
.rpg-hud-target .rpg-hud-name { font-size: 12px; font-weight: 900;
  margin-bottom: 6px; letter-spacing: .65px; color: #ffe4ce; text-transform: uppercase;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rpg-hud-target.is-low .rpg-hud-name { color: #fff0a8; }
.rpg-hud-target.is-low .rpg-hud-fill-foe { background: linear-gradient(90deg, #a9261b, #ff5f35 62%, #ffd46c); }
@keyframes rpgTargetIn {
  from { opacity: 0; transform: translateX(-50%) translateY(-7px) scale(.96); }
  to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
}
@keyframes rpgTargetInLeft {
  from { opacity: 0; transform: translateY(-7px) scale(.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.rpg-hud-quest { top: var(--ui-streak-top, 188px); right: var(--ui-rail-right, max(14px, env(safe-area-inset-right)));
  width: min(196px, var(--ui-map-size, 196px));
  min-height: 78px; font-size: 12px; line-height: 1.35; overflow: hidden; }
.rpg-hud-quest .rpg-hud-qtitle { font-weight: 800; font-size: 10px; letter-spacing: 1px;
  text-transform: uppercase; color: var(--hud-gold); margin-bottom: 5px; display: flex; align-items: center; gap: 6px; }
.rpg-hud-quest .rpg-hud-qtitle::before { content: ''; width: 6px; height: 6px; border-radius: 999px;
  background: var(--hud-jade); box-shadow: 0 0 10px rgba(89,213,154,.66); }
.rpg-hud-quest .rpg-hud-qbody { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.rpg-hud-quest .rpg-hud-qcount { flex: 0 0 auto; font-weight: 900; color: #fff0a8;
  font-variant-numeric: tabular-nums; padding: 1px 6px; border-radius: 999px;
  background: rgba(255,240,168,.1); border: 1px solid rgba(231,189,97,.24); }
.rpg-hud-quest .rpg-hud-qtext { min-width: 0; color: #fff7df; overflow-wrap: anywhere; }
.rpg-hud-qbar { height: 4px; margin-top: 8px; border-radius: 999px; overflow: hidden;
  background: rgba(2,5,8,.54); border: 1px solid rgba(231,189,97,.14); }
.rpg-hud-qfill { height: 100%; width: 0%; border-radius: inherit;
  background: linear-gradient(90deg, var(--hud-jade), #fff0a8); transition: width 260ms cubic-bezier(0.16,1,0.3,1); }
.rpg-hud-toast { left: 50%; bottom: max(132px, calc(env(safe-area-inset-bottom) + 132px));
  transform: translate(-50%, -8px); width: max-content; max-width: min(360px, calc(100vw - 28px));
  background:
    radial-gradient(circle at 50% 0%, rgba(255,230,161,.2), rgba(255,230,161,0) 48%),
    rgba(10,12,18,.84);
  border-color: rgba(231,189,97,.62); font-size: 12px; font-weight: 800; letter-spacing: .4px;
  text-align: center; padding: 8px 14px; border-radius: 8px; color: #fff3c2;
  opacity: 0; transition: opacity 320ms ease, transform 320ms ease; pointer-events: none; }
.rpg-hud-toast.is-on { opacity: 1; transform: translate(-50%, 0); }
.rpg-hud-toast::before { content: ''; position: absolute; left: 8px; right: 8px; bottom: 4px;
  height: 2px; border-radius: 999px; background: linear-gradient(90deg, rgba(255,240,168,.95), rgba(96,214,160,.85));
  transform: scaleX(0); transform-origin: left center; opacity: 0; }
.rpg-hud-toast.is-on::before { opacity: .86; animation: rpgToastLife 1800ms linear forwards; }
@keyframes rpgToastLife { from { transform: scaleX(1); } to { transform: scaleX(0); } }
.rpg-hud-gold { position: absolute; right: 7px; top: -35px; display: flex;
  align-items: center; gap: 6px; padding: 4px 11px 4px 5px; border-radius: 999px;
  background:
    radial-gradient(circle at 18% 0%, rgba(255,244,196,.22), rgba(255,244,196,0) 34%),
    rgba(9,12,18,.88);
  border: 1px solid rgba(231,189,97,.58); box-shadow: 0 8px 20px rgba(0,0,0,.42),
    inset 0 1px 0 rgba(255,255,255,.1); font-size: 14px; font-weight: 800;
  color: #fff0b6; font-variant-numeric: tabular-nums; }
.rpg-hud-gold i { width: 18px; height: 18px; border-radius: 999px; font-style: normal;
  display: grid; place-items: center; font-size: 10px; font-weight: 900; color: #5b3507;
  background: radial-gradient(circle at 35% 28%, #fff8ce, #f2c24b 52%, #9c6516);
  border: 1px solid #5f3a09; box-shadow: inset 0 1px 0 rgba(255,255,255,.64); }
.rpg-hud-gold.is-bump { animation: rpgGoldBump 300ms cubic-bezier(0.16,1.4,0.3,1); }
.rpg-hud-top { position: fixed;
  right: calc(var(--ui-rail-right, max(14px, env(safe-area-inset-right))) + var(--ui-map-size, 196px) + 12px);
  top: var(--ui-streak-top, 252px);
  z-index: 30; width: 140px; min-height: 78px; padding: 8px 10px;
  font-size: 11px; line-height: 1.45; display: none; }
.rpg-hud-top .t-title { font-weight: 800; color: var(--hud-gold); font-size: 10px;
  letter-spacing: 1px; margin-bottom: 3px; text-transform: uppercase; }
.rpg-hud-top .t-row { display: flex; align-items: baseline; justify-content: space-between;
  gap: 7px; min-height: 17px; color: #fff4d4; }
.rpg-hud-top .t-row span:first-child { overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; }
.rpg-hud-top .t-row b { color: #ff8975; font-variant-numeric: tabular-nums; white-space: nowrap; }
body.ui-panel-open .rpg-hud-top,
body.ui-panel-open .rpg-hud-quest,
body.ui-panel-open .rpg-hud-streak { display: none !important; }
.rpg-gsplat { position: fixed; inset: 0; z-index: 38; pointer-events: none; opacity: 0; }
.rpg-gsplat.is-on { animation: gsplat .9s ease-out; }
@keyframes gsplat { 0% { opacity: 0; } 12% { opacity: .76; } 100% { opacity: 0; } }
@keyframes rpgHudDanger {
  0%, 100% { box-shadow: 0 16px 36px var(--hud-shadow), 0 0 10px rgba(255,95,79,.12), 0 0 0 1px rgba(255,255,255,.06) inset; }
  50% { box-shadow: 0 16px 36px var(--hud-shadow), 0 0 22px rgba(255,95,79,.28), 0 0 0 1px rgba(255,255,255,.08) inset; }
}
@keyframes rpgFillPop {
  0% { transform: scaleY(1); filter: brightness(1); }
  45% { transform: scaleY(1.18); filter: brightness(1.22); }
  100% { transform: scaleY(1); filter: brightness(1); }
}
@keyframes rpgGoldBump {
  0% { transform: translateY(0) scale(1); filter: brightness(1); }
  45% { transform: translateY(-2px) scale(1.06); filter: brightness(1.22); }
  100% { transform: translateY(0) scale(1); filter: brightness(1); }
}
@keyframes rpgHudDelta {
  0% { opacity: 0; transform: translateY(4px) scale(.92); }
  18%, 68% { opacity: 1; transform: translateY(-2px) scale(1); }
  100% { opacity: 0; transform: translateY(-13px) scale(1); }
}
@keyframes rpgTargetHit {
  0% { transform: translateX(-50%) scale(1); filter: brightness(1); }
  44% { transform: translateX(-50%) scale(1.018); filter: brightness(1.28); }
  100% { transform: translateX(-50%) scale(1); filter: brightness(1); }
}
@keyframes rpgTargetHitLeft {
  0% { transform: scale(1); filter: brightness(1); }
  44% { transform: scale(1.018); filter: brightness(1.28); }
  100% { transform: scale(1); filter: brightness(1); }
}
.rpg-hud-hurt { position: fixed; inset: 0; z-index: 39; pointer-events: none;
  opacity: 0; background:
    radial-gradient(ellipse at center, rgba(0,0,0,0) 58%, rgba(170,20,24,.45) 100%),
    radial-gradient(circle at 50% 50%, rgba(255,128,87,.12), rgba(255,128,87,0) 48%);
  transition: opacity 90ms ease-out; }
.rpg-hud-hurt.is-on { opacity: 1; }
.rpg-hud-death { position: fixed; inset: 0; z-index: 48; display: none;
  align-items: center; justify-content: center; flex-direction: column; gap: 10px;
  background:
    radial-gradient(circle at 50% 42%, rgba(104,18,22,.48), rgba(9,8,13,.82) 66%),
    linear-gradient(180deg, rgba(0,0,0,.26), rgba(0,0,0,.5));
  padding: max(24px, env(safe-area-inset-top)) max(18px, env(safe-area-inset-right))
    max(24px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left));
  text-align: center; pointer-events: none; }
.rpg-hud-death.is-on { display: flex; }
.rpg-hud-death .d-title { font-size: 46px; font-weight: 800; letter-spacing: 2px;
  color: #ff9a82; text-shadow: 0 4px 28px rgba(0,0,0,.92), 0 0 22px rgba(255,84,58,.36); }
.rpg-hud-death .d-sub { font-size: 15px; font-weight: 600; color: #f8e1d9; }
.rpg-hud-death .d-count { font-size: 30px; font-weight: 800; color: #fff0a8;
  text-shadow: 0 0 18px rgba(231,189,97,.42); }
.rpg-hud-streak { right: max(24px, env(safe-area-inset-right)); top: 42%; text-align: right;
  background: none; border: none; box-shadow: none; -webkit-backdrop-filter: none; backdrop-filter: none;
  width: 168px; padding: 0; opacity: 0; transform: scale(.6); transform-origin: right center;
  transition: opacity 180ms ease, transform 180ms cubic-bezier(0.16,1.6,0.3,1); }
.rpg-hud-streak::before, .rpg-hud-streak::after { display: none; }
.rpg-hud-streak.is-on { opacity: 1; transform: scale(1); }
.rpg-hud-streak .s-num { font-size: 34px; font-weight: 900; color: #ff6a4e; line-height: 1;
  text-shadow: 0 2px 0 rgba(58,8,0,.9), 0 0 20px rgba(255,75,44,.56), 0 8px 22px rgba(0,0,0,.42); }
.rpg-hud-streak .s-label { font-size: 10px; font-weight: 900; letter-spacing: 2.4px;
  color: #ffe3c0; text-transform: uppercase; }
.rpg-hud-streak .s-mult { font-size: 15px; font-weight: 900; color: #fff0a8; }
.rpg-hud-banner { left: 50%; top: 22%; transform: translate(-50%, -10px) scale(.85);
  background:
    radial-gradient(circle at 50% 0%, rgba(255,230,161,.18), rgba(255,230,161,0) 52%),
    rgba(32,8,10,.82);
  border-color: rgba(231,189,97,.62); font-size: 24px; font-weight: 900; letter-spacing: 2px;
  text-align: center; color: #ff9a82; padding: 14px 30px; border-radius: 10px;
  text-transform: uppercase; opacity: 0; width: max-content; max-width: min(520px, calc(100vw - 28px));
  line-height: 1.15; overflow-wrap: anywhere;
  transition: opacity 260ms ease, transform 260ms cubic-bezier(0.16,1.4,0.3,1); }
.rpg-hud-banner.is-on { opacity: 1; transform: translate(-50%, 0) scale(1); }
@media (min-width: 681px) and (hover: hover) {
  body .rpg-skill-root { --slot-size: 50px !important; --slot-gap: 6px !important; }
  body .rpg-skill-root .rpg-skill-resbox { height: 26px; padding: 4px 7px; }
  body .rpg-skill-root .rpg-skill-label { height: 8px; margin-bottom: 2px; font-size: 8.5px; line-height: 8px; }
  body .rpg-skill-root .rpg-skill-bar { height: 6px; }
  body .rpg-skill-root .rpg-skill-slot .s-emoji { font-size: 22px; }
}
@media (max-width: 1120px) and (min-width: 821px) {
  :root { --rpg-hud-bottom-width: 260px; }
  .rpg-hud-bottom { left: var(--rpg-hud-left); right: auto;
    bottom: max(12px, env(safe-area-inset-bottom)); transform: none;
    width: var(--rpg-hud-bottom-width); min-width: 240px; min-height: 76px;
    padding: 8px 11px 8px 52px; gap: 5px; }
  .rpg-hud-lvl-badge { left: 8px; width: 36px; height: 36px; font-size: 15px; }
  .rpg-hud-gold { top: -31px; right: 4px; font-size: 13px; }
  .rpg-hud-label { font-size: 10px; letter-spacing: .6px; }
  .rpg-hud-bar { height: 13px; }
}
@media (max-width: 720px) {
  :root { --rpg-hud-left: max(8px, env(safe-area-inset-left)); --rpg-hud-bottom-width: 260px; }
  .rpg-hud-bottom { left: max(8px, env(safe-area-inset-left)); right: auto;
    bottom: max(8px, env(safe-area-inset-bottom)); transform: none;
    width: min(260px, calc(100vw - 112px)); min-width: 214px; min-height: 80px;
    padding: 10px 12px 10px 60px; gap: 6px; }
  .rpg-hud-lvl-badge { left: 8px; width: 42px; height: 42px; font-size: 18px; }
  .rpg-hud-gold { top: -32px; right: 4px; font-size: 13px; }
  .rpg-hud-target { top: max(58px, calc(env(safe-area-inset-top) + 58px));
    left: max(8px, env(safe-area-inset-left)); transform: none;
    width: min(228px, calc(100vw - 160px)); padding: 6px 10px 7px; }
  .rpg-hud-target.is-on { animation-name: rpgTargetInLeft; }
  .rpg-hud-target.is-hit { animation-name: rpgTargetHitLeft; }
  .rpg-hud-target .rpg-hud-name { font-size: 11px; margin-bottom: 4px; }
  .rpg-hud-target-mark { font-size: 8px; letter-spacing: 1px; }
  .rpg-hud-target-hp { font-size: 10px; }
  .rpg-hud-quest { top: var(--ui-streak-top, 176px); right: var(--ui-rail-right, max(8px, env(safe-area-inset-right)));
    width: min(176px, calc(100vw - 144px), var(--ui-map-size, 176px)); font-size: 11px; }
  .rpg-hud-top { top: var(--ui-streak-top, 236px);
    right: calc(var(--ui-rail-right, max(8px, env(safe-area-inset-right))) + var(--ui-map-size, 118px) + 10px);
    width: 128px; min-height: 72px; }
  .rpg-hud-toast { bottom: max(90px, calc(env(safe-area-inset-bottom) + 90px)); max-width: calc(100vw - 24px); }
  .rpg-hud-streak { right: max(12px, env(safe-area-inset-right)); top: 38%; }
  .rpg-hud-banner { top: 20%; font-size: 19px; padding: 11px 18px; }
  .rpg-hud-death .d-title { font-size: 34px; letter-spacing: 1.4px; }
  .rpg-hud-death .d-sub { max-width: 28rem; font-size: 13px; line-height: 1.35; }
  .rpg-hud-death .d-count { font-size: 26px; }
}
@media (max-width: 390px) {
  :root { --rpg-hud-bottom-width: 244px; }
  .rpg-hud-bottom { width: min(244px, calc(100vw - 112px)); min-width: 0; padding-left: 54px; }
  .rpg-hud-label { font-size: 10px; letter-spacing: .6px; }
  .rpg-hud-bar { height: 13px; }
  .rpg-hud-quest { width: 156px; }
}
@media (max-width: 340px) {
  :root { --rpg-hud-bottom-width: calc(100vw - 112px); }
  .rpg-hud-bottom { width: calc(100vw - 112px); min-height: 78px; padding: 8px 9px 8px 48px; }
  .rpg-hud-lvl-badge { left: 7px; width: 32px; height: 32px; font-size: 14px; }
  .rpg-hud-label { gap: 5px; font-size: 9.5px; letter-spacing: .4px; }
  .rpg-hud-gold { right: 2px; }
  .rpg-hud-target { width: min(168px, calc(100vw - 148px)); }
  .rpg-hud-quest { width: min(118px, var(--ui-map-size, 118px)); padding: 8px 9px; }
  .rpg-hud-top { width: min(112px, calc(100vw - 154px)); }
}

@media (max-height: 660px) {
  :root { --rpg-hud-left: max(10px, env(safe-area-inset-left)); --rpg-hud-bottom-width: 236px; }
  .rpg-hud-bottom { left: var(--rpg-hud-left); right: auto;
    bottom: max(8px, env(safe-area-inset-bottom)); transform: none;
    width: var(--rpg-hud-bottom-width); min-width: 220px; min-height: 68px;
    padding: 7px 10px 7px 48px; gap: 4px; }
  .rpg-hud-lvl-badge { left: 7px; width: 32px; height: 32px; font-size: 14px; }
  .rpg-hud-label { font-size: 9px; letter-spacing: .4px; margin-bottom: 2px; }
  .rpg-hud-bar { height: 9px; }
  .rpg-hud-gold { position: absolute; top: -29px; right: 4px; margin: 0;
    padding: 2px 9px 2px 4px; gap: 5px; font-size: 12px; }
  .rpg-hud-gold i { width: 16px; height: 16px; font-size: 9px; }
  .rpg-hud-toast { top: max(86px, calc(env(safe-area-inset-top) + 86px)); bottom: auto; }
  .rpg-hud-target { top: max(8px, env(safe-area-inset-top)); }
}
@media (max-height: 660px) and (min-width: 681px) and (hover: hover) {
  body .rpg-skill-root { --slot-size: 42px !important; --slot-gap: 5px !important; }
  body .rpg-skill-root .rpg-skill-resbox { height: 23px; padding: 3px 6px; }
  body .rpg-skill-root .rpg-skill-slot .s-emoji { font-size: 19px; }
  body .rpg-skill-root .rpg-skill-slot .s-key { min-width: 19px; height: 17px; font-size: 8.5px; }
  body .rpg-skill-root .rpg-skill-slot .s-cost { min-width: 16px; height: 13px; font-size: 8px; }
}
@media (max-height: 660px) and (min-width: 561px) {
  .rpg-hud-bottom { width: var(--rpg-hud-bottom-width); min-width: 220px;
    padding: 7px 10px 7px 48px; }
  .rpg-hud-lvl-badge { width: 32px; height: 32px; font-size: 14px; }
  .rpg-hud-label { gap: 6px; }
}
@media (max-height: 660px) and (max-width: 560px) {
  .rpg-hud-bottom { width: min(268px, calc(100vw - 92px)); min-width: 218px;
    padding: 7px 10px 7px 52px; }
  .rpg-hud-lvl-badge { width: 34px; height: 34px; font-size: 15px; }
  .rpg-hud-gold { font-size: 11px; padding-right: 8px; }
  .rpg-hud-toast { top: max(146px, calc(env(safe-area-inset-top) + 146px));
    bottom: auto; }
}
@media (max-height: 660px) and (max-width: 720px) {
  .rpg-hud-target { top: max(58px, calc(env(safe-area-inset-top) + 58px));
    left: max(8px, env(safe-area-inset-left)); transform: none;
    width: min(228px, calc(100vw - 160px)); }
  .rpg-hud-target.is-on { animation-name: rpgTargetInLeft; }
  .rpg-hud-target.is-hit { animation-name: rpgTargetHitLeft; }
}
@media (pointer: coarse) {
  body .rpg-skill-root { --slot-size: clamp(44px, 13vw, 50px) !important; }
  body .rpg-skill-root .rpg-skill-slot { min-width: 44px; min-height: 44px; }
  body .tc-pot { scale: .6; }
  .rpg-hud-toast { top: max(146px, calc(env(safe-area-inset-top) + 146px));
    bottom: auto; }
}
@media (pointer: coarse) and (max-height: 660px) {
  body .tc-pot { scale: .667; }
}
@media (prefers-reduced-motion: reduce) {
  .rpg-hud-fill, .rpg-hud-ghost, .rpg-hud-qfill, .rpg-hud-toast, .rpg-hud-streak, .rpg-hud-banner { transition-duration: 1ms; }
  .rpg-hud-target.is-on, .rpg-hud-target.is-hit, .rpg-hud-bottom.is-hp-critical,
  .rpg-hud-fill.is-pop, .rpg-hud-gold.is-bump { animation-duration: 1ms; animation-iteration-count: 1; }
  .rpg-hud-delta.is-on { animation: none; opacity: 1; transform: none; }
  .rpg-hud-toast.is-on::before { animation-duration: 1ms; }
  .rpg-gsplat.is-on { animation-duration: 1ms; }
}`;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = css;
  document.head.appendChild(el);
}

function clamp01(n) {
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export class HUD {
  constructor(rootEl) {
    injectStyle();
    const root = document.createElement('div');
    root.className = 'rpg-hud-root';
    root.innerHTML = `
      <div class="rpg-hud-panel rpg-hud-bottom">
        <div class="rpg-hud-lvl-badge">1</div>
        <div class="rpg-hud-gold"><i>G</i><span class="rpg-hud-gold-num">0</span><span class="rpg-hud-delta rpg-hud-delta-gold" aria-hidden="true"></span></div>
        <div class="rpg-hud-stat rpg-hud-stat-hp">
          <div class="rpg-hud-label"><span>VIDA</span><span class="rpg-hud-hp-num">0/0</span></div>
          <div class="rpg-hud-bar"><div class="rpg-hud-ghost rpg-hud-ghost-hp"></div><div class="rpg-hud-fill rpg-hud-fill-hp"></div></div>
          <span class="rpg-hud-delta rpg-hud-delta-hp" aria-hidden="true"></span>
        </div>
        <div class="rpg-hud-stat rpg-hud-stat-xp">
          <div class="rpg-hud-label"><span class="rpg-hud-xp-lvl">Nivel 1</span><span class="rpg-hud-xp-num">0/0</span></div>
          <div class="rpg-hud-bar"><div class="rpg-hud-ghost rpg-hud-ghost-xp"></div><div class="rpg-hud-fill rpg-hud-fill-xp"></div></div>
          <span class="rpg-hud-delta rpg-hud-delta-xp" aria-hidden="true"></span>
        </div>
      </div>
      <div class="rpg-hud-panel rpg-hud-target">
        <div class="rpg-hud-target-head">
          <span class="rpg-hud-target-mark">OBJETIVO</span>
          <span class="rpg-hud-target-hp">100%</span>
        </div>
        <div class="rpg-hud-name"></div>
        <div class="rpg-hud-bar"><div class="rpg-hud-ghost rpg-hud-ghost-foe"></div><div class="rpg-hud-fill rpg-hud-fill-foe"></div></div>
      </div>
      <div class="rpg-hud-panel rpg-hud-quest">
        <div class="rpg-hud-qtitle">MISIÓN</div>
        <div class="rpg-hud-qbody"><span class="rpg-hud-qcount">0/0</span><span class="rpg-hud-qtext"></span></div>
        <div class="rpg-hud-qbar"><div class="rpg-hud-qfill"></div></div>
      </div>
      <div class="rpg-hud-panel rpg-hud-toast" role="status" aria-live="polite"></div>
      <div class="rpg-hud-panel rpg-hud-streak">
        <div class="s-num">x2</div>
        <div class="s-label">Racha</div>
        <div class="s-mult"></div>
      </div>
      <div class="rpg-hud-panel rpg-hud-banner"></div>
      <div class="rpg-hud-panel rpg-hud-top"><div class="t-title">RACHAS HOY</div><div class="t-list"></div></div>
      <div class="rpg-gsplat"></div>
      <div class="rpg-hud-hurt"></div>
      <div class="rpg-hud-death"><div class="d-title">HAS CAÍDO</div>
        <div class="d-sub">La Virgen de la gruta te levanta…</div>
        <div class="d-count">3</div></div>`;
    (rootEl || document.body).appendChild(root);

    this.root = root;
    this.elBottom = root.querySelector('.rpg-hud-bottom');
    this.elHpFill = root.querySelector('.rpg-hud-fill-hp');
    this.elHpGhost = root.querySelector('.rpg-hud-ghost-hp');
    this.elHpNum = root.querySelector('.rpg-hud-hp-num');
    this.elHpDelta = root.querySelector('.rpg-hud-delta-hp');
    this.elXpFill = root.querySelector('.rpg-hud-fill-xp');
    this.elXpGhost = root.querySelector('.rpg-hud-ghost-xp');
    this.elXpNum = root.querySelector('.rpg-hud-xp-num');
    this.elXpLvl = root.querySelector('.rpg-hud-xp-lvl');
    this.elXpDelta = root.querySelector('.rpg-hud-delta-xp');
    this.elLvlBadge = root.querySelector('.rpg-hud-lvl-badge');
    this.elTarget = root.querySelector('.rpg-hud-target');
    this.elTargetName = root.querySelector('.rpg-hud-target .rpg-hud-name');
    this.elTargetHp = root.querySelector('.rpg-hud-target-hp');
    this.elTargetFill = root.querySelector('.rpg-hud-fill-foe');
    this.elTargetGhost = root.querySelector('.rpg-hud-ghost-foe');
    this.elQuestText = root.querySelector('.rpg-hud-qtext');
    this.elQuestCount = root.querySelector('.rpg-hud-qcount');
    this.elQuestFill = root.querySelector('.rpg-hud-qfill');
    this.elToast = root.querySelector('.rpg-hud-toast');
    this.elStreak = root.querySelector('.rpg-hud-streak');
    this.elStreakNum = root.querySelector('.rpg-hud-streak .s-num');
    this.elStreakMult = root.querySelector('.rpg-hud-streak .s-mult');
    this.elBanner = root.querySelector('.rpg-hud-banner');
    this._bannerTimer = null;
    this.elGoldWrap = root.querySelector('.rpg-hud-gold');
    this.elGold = root.querySelector('.rpg-hud-gold-num');
    this.elGoldDelta = root.querySelector('.rpg-hud-delta-gold');
    this.elDeath = root.querySelector('.rpg-hud-death');
    this.elDeathCount = root.querySelector('.rpg-hud-death .d-count');
    this._toastTimer = null;
    this._deltaTimers = new Map();
    this._hpRatio = null;
    this._hpAmount = null;
    this._xpRatio = null;
    this._xpAmount = null;
    this._xpLevel = null;
    this._targetRatio = null;
    this._targetName = '';
    this._targetHp = null;
    this._targetHpMax = null;
    this._targetLocked = null;
    this._goldAmount = null;
  }

  _showDelta(el, text, tone) {
    if (!el || !text) return;
    const activeTimer = this._deltaTimers.get(el);
    if (activeTimer != null) clearTimeout(activeTimer);
    el.textContent = text;
    el.classList.remove('is-on', 'is-gain', 'is-loss', 'is-level');
    void el.offsetWidth;
    el.classList.add('is-on', `is-${tone}`);
    const timer = setTimeout(() => {
      el.classList.remove('is-on', 'is-gain', 'is-loss', 'is-level');
      el.textContent = '';
      this._deltaTimers.delete(el);
    }, 840);
    this._deltaTimers.set(el, timer);
  }

  _showAmountDelta(el, delta) {
    const amount = Math.round(Number(delta) || 0);
    if (amount === 0) return;
    this._showDelta(el, `${amount > 0 ? '+' : '-'}${Math.abs(amount)}`, amount > 0 ? 'gain' : 'loss');
  }

  setGold(n) {
    const amount = Math.max(0, Math.round(n || 0));
    if (this.elGold) this.elGold.textContent = String(amount);
    if (this._goldAmount != null) this._showAmountDelta(this.elGoldDelta, amount - this._goldAmount);
    if (this.elGoldWrap && this._goldAmount != null && amount > this._goldAmount) {
      this.elGoldWrap.classList.remove('is-bump');
      void this.elGoldWrap.offsetWidth;
      this.elGoldWrap.classList.add('is-bump');
    }
    this._goldAmount = amount;
  }

  showDeath() { if (this.elDeath) this.elDeath.classList.add('is-on'); }
  hideDeath() { if (this.elDeath) this.elDeath.classList.remove('is-on'); }
  setDeathCount(t) {
    if (this.elDeathCount) this.elDeathCount.textContent = String(Math.max(0, Math.ceil(t)));
  }

  setHP(cur, max) {
    const c = Math.max(0, Math.round(cur || 0));
    const m = Math.max(1, Math.round(max || 1));
    const ratio = clamp01(c / m);
    const pct = (ratio * 100).toFixed(1) + '%';
    const prev = this._hpRatio == null ? ratio : this._hpRatio;
    this.elHpFill.style.width = pct;
    if (this.elHpGhost) {
      if (ratio < prev) {
        this.elHpGhost.style.transitionDuration = '1ms';
        this.elHpGhost.style.width = (prev * 100).toFixed(1) + '%';
        clearTimeout(this._hpGhostT);
        this._hpGhostT = setTimeout(() => {
          this.elHpGhost.style.transitionDuration = '';
          this.elHpGhost.style.width = pct;
        }, 80);
      } else {
        clearTimeout(this._hpGhostT);
        this.elHpGhost.style.transitionDuration = '180ms';
        this.elHpGhost.style.width = pct;
      }
    }
    if (this.elBottom) {
      this.elBottom.classList.toggle('is-hp-low', ratio > 0 && ratio <= 0.32);
      this.elBottom.classList.toggle('is-hp-critical', ratio > 0 && ratio <= 0.18);
    }
    this.elHpNum.textContent = `${c}/${m}`;
    if (this._hpAmount != null) this._showAmountDelta(this.elHpDelta, c - this._hpAmount);
    this._hpRatio = ratio;
    this._hpAmount = c;
  }

  setXP(cur, max, level) {
    const c = Math.max(0, Math.round(cur || 0));
    const m = Math.max(1, Math.round(max || 1));
    const ratio = clamp01(c / m);
    const pct = (ratio * 100).toFixed(1) + '%';
    const prev = this._xpRatio == null ? ratio : this._xpRatio;
    this.elXpFill.style.width = pct;
    if (this.elXpGhost) this.elXpGhost.style.width = pct;
    if (ratio > prev || (level != null && Number(level) !== this._xpLevel)) {
      this.elXpFill.classList.remove('is-pop');
      void this.elXpFill.offsetWidth;
      this.elXpFill.classList.add('is-pop');
    }
    this.elXpNum.textContent = `${c}/${m}`;
    this.elXpLvl.textContent = `Nivel ${level == null ? 1 : level}`;
    if (this.elLvlBadge) this.elLvlBadge.textContent = String(level == null ? 1 : level);
    const nextLevel = level == null ? 1 : Number(level);
    if (this._xpLevel != null && Number.isFinite(nextLevel) && nextLevel > this._xpLevel) {
      this._showDelta(this.elXpDelta, `NIVEL ${nextLevel}`, 'level');
    } else if (this._xpAmount != null && nextLevel === this._xpLevel) {
      this._showAmountDelta(this.elXpDelta, c - this._xpAmount);
    }
    this._xpRatio = ratio;
    this._xpAmount = c;
    this._xpLevel = nextLevel;
  }

  showTarget(name, hp, hpMax, locked = false) {
    const targetName = name || '';
    const h = Math.max(0, Math.round(hp || 0));
    const hm = Math.max(1, Math.round(hpMax || 1));
    const isLocked = !!locked;
    if (this._targetName === targetName
      && this._targetHp === h
      && this._targetHpMax === hm
      && this._targetLocked === isLocked) return false;
    this.elTargetName.textContent = targetName;
    const ratio = clamp01(h / hm);
    const pct = (ratio * 100).toFixed(1) + '%';
    const prev = this._targetName === targetName && this._targetRatio != null ? this._targetRatio : ratio;
    this.elTargetFill.style.width = pct;
    if (this.elTargetGhost) {
      if (ratio < prev) {
        this.elTargetGhost.style.transitionDuration = '1ms';
        this.elTargetGhost.style.width = (prev * 100).toFixed(1) + '%';
        clearTimeout(this._targetGhostT);
        this._targetGhostT = setTimeout(() => {
          this.elTargetGhost.style.transitionDuration = '';
          this.elTargetGhost.style.width = pct;
        }, 70);
      } else {
        clearTimeout(this._targetGhostT);
        this.elTargetGhost.style.transitionDuration = '180ms';
        this.elTargetGhost.style.width = pct;
      }
    }
    if (this.elTargetHp) this.elTargetHp.textContent = Math.round(ratio * 100) + '%';
    this.elTarget.classList.toggle('is-low', ratio > 0 && ratio <= 0.25);
    this.elTarget.classList.toggle('is-locked', isLocked);
    if (ratio < prev) {
      this.elTarget.classList.remove('is-hit');
      void this.elTarget.offsetWidth;
      this.elTarget.classList.add('is-hit');
      clearTimeout(this._targetHitT);
      this._targetHitT = setTimeout(() => this.elTarget.classList.remove('is-hit'), 240);
    }
    this.elTarget.classList.add('is-on');
    this._targetRatio = ratio;
    this._targetName = targetName;
    this._targetHp = h;
    this._targetHpMax = hm;
    this._targetLocked = isLocked;
    return true;
  }

  hideTarget() {
    this.elTarget.classList.remove('is-on');
    this.elTarget.classList.remove('is-low');
    this.elTarget.classList.remove('is-hit');
    this.elTarget.classList.remove('is-locked');
    this._targetRatio = null;
    this._targetName = '';
    this._targetHp = null;
    this._targetHpMax = null;
    this._targetLocked = null;
  }

  setQuest(text, cur, goal) {
    this.elQuestText.textContent = ' ' + (text || '');
    const c = Math.max(0, Math.round(cur || 0));
    const g = Math.max(0, Math.round(goal || 0));
    this.elQuestCount.textContent = `${c}/${g}`;
    if (this.elQuestFill) this.elQuestFill.style.width = (g > 0 ? clamp01(c / g) * 100 : 0).toFixed(1) + '%';
  }

  // contador de racha: numero grande con pop (re-dispara la animacion en cada kill)
  showStreak(n, mult) {
    if (!this.elStreak) return;
    this.elStreakNum.textContent = 'x' + n;
    this.elStreakMult.textContent = mult > 1 ? '+' + Math.round((mult - 1) * 100) + '% botin' : '';
    this.elStreak.classList.remove('is-on');
    void this.elStreak.offsetWidth;   // reflow: reinicia la transicion de pop
    this.elStreak.classList.add('is-on');
  }

  hideStreak() { if (this.elStreak) this.elStreak.classList.remove('is-on'); }

  // banner central grande (oleadas / eventos). Se va solo a los 4s.
  banner(text) {
    if (!this.elBanner) return;
    this.elBanner.textContent = text;
    this.elBanner.classList.add('is-on');
    if (this._bannerTimer) clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => this.elBanner.classList.remove('is-on'), 4000);
  }

  // leaderboard de rachas del dia (top 3 visibles)
  setTop(list) {
    const panel = this.root.querySelector('.rpg-hud-top');
    if (!panel) return;
    const rows = (list || []).slice(0, 3);
    panel.style.display = rows.length ? 'block' : 'none';
    panel.querySelector('.t-list').innerHTML = rows
      .map((e) => '<div class="t-row"><span>' + String(e.name || '?').replace(/[<>&]/g, '') + '</span><b>x' + (Number(e.v) || 0) + '</b></div>')
      .join('');
  }

  // SALPICADURA de sangre en pantalla (kills cercanos): manchas aleatorias
  goreSplat() {
    const el = this.root.querySelector('.rpg-gsplat');
    if (!el) return;
    const blobs = [];
    for (let i = 0; i < 4; i++) {
      const x = 8 + Math.random() * 84, y = 8 + Math.random() * 84;
      const r = 4 + Math.random() * 9;
      blobs.push('radial-gradient(circle ' + r + 'vmin at ' + x + '% ' + y + '%, rgba(150,10,10,.5) 0%, rgba(120,8,8,.32) 40%, rgba(120,8,8,0) 70%)');
    }
    el.style.background = blobs.join(',');
    el.classList.remove('is-on');
    void el.offsetWidth;
    el.classList.add('is-on');
  }

  // vignette roja de 160ms cuando el jugador RECIBE dano
  hurtFlash() {
    const el = this.root.querySelector('.rpg-hud-hurt');
    if (!el) return;
    el.classList.add('is-on');
    clearTimeout(this._hurtT);
    this._hurtT = setTimeout(() => el.classList.remove('is-on'), 160);
  }

  toast(text) {
    this.elToast.textContent = text || '';
    this.elToast.classList.add('is-on');
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.elToast.classList.remove('is-on');
      this._toastTimer = null;
    }, 1800);
  }
}

export function xpNextForLevel(level) {
  return xpRequiredForLevel(level);
}

export function hpMaxForLevel(level) {
  const lvl = Math.max(1, Math.floor(Number(level) || 1));
  return 88 + 12 * lvl;
}

// Progresion del jugador: nivel, XP y vida maxima. La curva inicial ya no regala
// niveles en 3 o 4 kills; el farmeo debe durar mas y sostener el desafio.
export class Progress {
  constructor(onLevel) {
    this.onLevel = typeof onLevel === 'function' ? onLevel : () => {};
    this.level = 1;
    this.xp = 0;
    this.xpNext = xpNextForLevel(this.level);
    this.hpMax = hpMaxForLevel(this.level);
  }

  gainXp(n) {
    const amount = Math.max(0, Math.round(n || 0));
    if (amount === 0) return false;
    this.xp += amount;
    let leveled = false;
    // Puede subir varios niveles de un solo golpe; arrastra el excedente.
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level += 1;
      this.xpNext = xpNextForLevel(this.level);
      this.hpMax = hpMaxForLevel(this.level);
      leveled = true;
      this.onLevel(this.level);
    }
    return leveled;
  }
}

// Registro de misiones. Arranca con una sola quest: matar 8 slimes en el parque.
export class QuestLog {
  constructor() {
    this.text = 'Plaga en el parque (cerca de la tienda Ojeda)';
    this.goal = 8;
    this.cur = 0;
    this.reward = { xp: 120 };
  }

  onKill() {
    this.cur = Math.min(this.goal, this.cur + 1);
    const done = this.cur >= this.goal;
    return { done, cur: this.cur, goal: this.goal, text: this.text, reward: { xp: this.reward.xp } };
  }

  current() {
    return { text: this.text, cur: this.cur, goal: this.goal, done: this.cur >= this.goal };
  }
}
import { xpRequiredForLevel } from './balance.js?v=20260710g54';
