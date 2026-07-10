# Los Sauces — Agent Onboarding & Handoff

Guía completa para que un agente (o dev) retome el proyecto en un **fork**. Léela entera antes de tocar código.

> Convención del proyecto: la UI y el contenido son en **español neutro**; el código, comentarios y nombres van en **inglés o español según el archivo** (el juego usa comentarios en español por herencia; respeta el estilo del archivo que edites). Nunca uses guiones largos (— / --) en texto de UI.

---

## 1. Qué es

**Los Sauces** es un MMO ARPG de zombies renderizado con **three.js r161**, ambientado en una reconstrucción del barrio real de San Borja (Los Sauces, Lima) a partir de datos OSM. Un jugador elige un héroe, farmea zombies en un barrio abierto, sube de nivel, customiza su personaje y sobrevive oleadas. Es multijugador: un relay WebSocket sincroniza jugadores y mobs.

- **Género**: ARPG top-down/tercera persona, farmeo tipo MU/Diablo con gore, oleadas y bosses.
- **Estética**: toon pastel + realismo selectivo (pasto GPU, sauces GLB, autos, fachadas limeñas).
- **Estado**: en producción, iterando rápido. Todo el gameplay corre.

---

## 2. Arquitectura (lo esencial)

```
CLIENTE (navegador)                         SERVER (Node.js)
─────────────────────                       ─────────────────
index.html  (importmap CDN, sin bundler)    server/server.js  (relay WS, autoritativo de mobs)
  └─ src/app.js  (entry: boot del mundo)       ├─ WS  :8456   (juego)
       ├─ src/citygen.js  (layout ciudad)      ├─ HTTP:8457   (/health)
       ├─ src/citymesh.js (meshes merged)      ├─ accounts.json     (cuentas + saves, atomico)
       ├─ src/net.js      (cliente WS)         └─ mob_spawns.json   ({spawns:[...]}, spots de farmeo)
       ├─ src/player.js   (heroe local)
       ├─ src/rpg/*       (combate, skills, hud, loot, mobs, effects, classes, charcustom...)
       └─ src/veg, npcs, props, carstyle, introscene, sfx...
```

**Clave**: NO hay bundler. `index.html` trae un `<script type="importmap">` que apunta a `three@0.161.0` en jsDelivr. Los módulos `src/*.js` se importan con un sufijo de versión `?v=YYYYMMDD<letra>` (cache-busting). **Cada deploy debe re-estampar ese sufijo en TODOS los imports** (ver §5).

**El server es autoritativo de los mobs**: decide HP, posición, spawn, muerte, daño. El cliente solo dibuja lo que el server manda (interpola posiciones, reproduce animaciones). El jugador es semi-autoritativo (manda su pos/hp; el server sanea y rebroadcast).

### Puertos (local)
| Puerto | Qué | Cómo |
|--------|-----|------|
| 8123   | HTTP del juego (estáticos) | cualquier server estático apuntando a la raíz del repo |
| 8456   | WebSocket del relay | `node server/server.js` |
| 8457   | Health check | `curl http://127.0.0.1:8457/health` |

---

## 3. Setup local (fork limpio)

```bash
# 1. dependencias del server
cd server && npm install    # solo 'ws'

# 2. arrancar el relay (autoritativo de mobs)
WAVE_EVERY_MS=30000 node server.js     # WAVE_EVERY_MS bajo = oleadas frecuentes para QA
# health: curl http://127.0.0.1:8457/health  -> {"ok":true,...,"mobs":N}

# 3. servir los estáticos desde la RAÍZ del repo (otra terminal)
#    cualquier server estático sirve; el juego es 100% archivos + CDN
python -m http.server 8123          # o `npx serve -l 8123`, etc.

# 4. abrir el juego apuntando al relay local:
#    http://127.0.0.1:8123/?ws=ws%3A%2F%2Flocalhost%3A8456&grass=high
```

El parámetro `?ws=` (URL-encoded) sobrescribe el endpoint del relay. Sin él, el cliente intenta el WS de producción. `?grass=high|low|off` controla el pasto; `?perf=high` fuerza perfil desktop en un dispositivo touch; `?procedural=0` apaga la densidad de relleno de la ciudad.

### Verificar que compila
```bash
# sintaxis de cada archivo tocado ANTES de deployar (los .js son ESM)
node --check src/app.js
node --check server/server.js
# etc — hazlo SIEMPRE tras editar
```

---

## 4. Mapa de archivos (dónde vive cada cosa)

### Cliente — mundo
- `src/app.js` — **entry**. Boot del renderer/escena/luces, carga de assets, wiring de todos los sistemas, loop principal, ciclo día/noche, borde del mundo, sello del edificio (3,-47). `APP_VERSION` vive aquí.
- `src/citygen.js` — layout procedural + OSM: footprints, calles, verde, colisión 2D (`inRealBuilding`), recorte a 1km (`WORLD_ANCHOR`/`WORLD_RADIUS`), relleno denso (`fillFrontageStrips`/`fillInteriorCarpet`).
- `src/citymesh.js` — construye los meshes MERGED por buckets (`wall/glass/trim/door/roof`). Toldos, cornisas, zócalos van A LOS BUCKETS (nunca meshes por edificio).
- `src/veg/grass.js` — pasto GPU instanced con shader de viento (`onBeforeCompile`). `src/veg/flowers.js` — matas de flores.
- `src/introscene.js` — escena 3D de fondo del login/loading (parque con sauces GLB reales, cámara paseando / alameda durante la carga).
- `src/npcs.js` — `StreetLife` (autos que circulan + peatones). `src/carstyle.js` — materiales/pintura/faros/ruedas de los autos.
- `src/props.js` — mobiliario: bancas, lámparas, hidrantes, planters, pérgola.
- `src/worldmat.js` — texturas procedurales (cielo toon, ground). `src/landmark.js` — edificio hero real "Los Sauces 202". `src/minimap.js`, `src/pois.js`, `src/parcels.js`.

### Cliente — RPG (`src/rpg/`)
- `combat.js` — **el corazón**. Action-combat (auto-engage al mob más cercano, X togglea auto/manual), combos, cleave, crits, racha, cast de skills (`castSkill`), daño recibido (`_onPlayerHit`), Gracia Divina de Diosito, PvP manual, hit-stop/slow-mo (`timeFactor`).
- `classes.js` — los 4 héroes + Diosito (GOD). Cada uno: `char` (rig GLB), `tint`, `weapon`, `combatStyle`, `resource`, `skills[4]` (Q/E/R/F). Los slots R son skills de PARTY.
- `charcustom.js` — customización mix-and-match: 7 rigs KayKit comparten esqueleto, sus piezas (cabeza/torso/piernas/accesorios) se re-bindean por nombre de hueso. `composeCharacter()`.
- `skills.js` — barra Q/E/R/F, recurso (furia/maná/energía), cooldowns, UI.
- `mobs.js` — `MobField`: renderiza los zombies que el server posee. Variedad de animaciones por id (ataque/idle/muerte de pools), personalidades k2, interpolación con snap, culling por distancia (LOD).
- `effects.js` — VFX: sangre, charcos, desmembramiento, arcos de espada, novas, proyectiles, números de daño, screen shake, level-up burst. **Todos los pools tienen caps duros** (rendimiento).
- `hud.js` — vida/nivel/oro, target frame, racha, banner, toast, vignette de daño, splatter de sangre, leaderboard.
- `loot.js` — inventario + drops + tienda (Bodega Ojeda) + vender/vender-todo-común. `economy.js` — wallet, drops. `equip.js`, `fx.js` (tiers de arma).
- `account.js` — auth por WS (login/registro).

### Cliente — infra
- `src/net.js` — cliente WebSocket: manda estado del jugador (~10Hz), recibe roster/mobs/posiciones/daño/party/leaderboard. Materializa jugadores remotos.
- `src/weapons.js` — adjunta armas a los slots de mano (bones KayKit), define combos por estilo.
- `src/sfx.js` — audio WebAudio: samples reales (`assets/sfx/`, `gen/` de MuAPI, `kenney/` CC0) + síntesis de fallback.
- `src/touch.js` — joystick + botones para móvil. `src/chat.js`, `src/social.js`, `src/trailer.js`.

### Server
- `server/server.js` — relay WS. Cuentas (scrypt, `accounts.json` atómico), sanitización anti-cheat, mobs autoritativos (`mobTick` a 10Hz: aggro/chase/leash/separación boids/rodeo/personalidades/zigzag/ataque desfasado), oleadas (`WAVE_EVERY_MS`), bosses, TTL, día/noche, party, PvP, leaderboard.
- `server/mob_spawns.json` — **formato `{"spawns":[{x,z,lvl,zone,boss?}]}`** (un array plano da 0 mobs). Spots de farmeo.

### Assets (`assets/models/*.glb`, 33 archivos)
Rigs de personaje (`char_*.glb` KayKit), `kaykit_skeletons.glb` (zombies, 4 rigs, 95 clips de animación, comprimido con Draco), `char_anims*.glb` (clips del héroe), autos (`k_*.glb`), árboles (`trees_real.glb` = sauces, `bushes_real.glb`), `kaykit_weapons.glb`, `sky.hdr`.

---

## 5. Deploy playbook (CRÍTICO)

> **En un fork, la infra de producción del original NO aplica.** El original deploya a un VPS propio por SSH. Un fork necesita su propio hosting. Lo que SÍ se conserva es el **ritual de estampado de versión** — sin él, los usuarios quedan pegados a builds viejos por caché.

**El ritual (adáptalo a tu hosting):**
```bash
# 1. bump del sufijo de versión en TODOS los imports + APP_VERSION
OLD=20260709m ; NEW=20260710a
sed -i "s/?v=$OLD/?v=$NEW/g" index.html src/*.js src/rpg/*.js src/veg/*.js
sed -i "s/const APP_VERSION = '$OLD'/const APP_VERSION = '$NEW'/" src/app.js

# 2. verificar sintaxis de lo tocado
node --check src/app.js && node --check server/server.js   # + cada archivo editado

# 3. commit (repos SIEMPRE privados por defecto; nunca push directo a main sin permiso)
git add -A -- index.html src/ server/
git commit -m "..."

# 4. subir estáticos (index.html + src/ + assets si cambiaron) a tu hosting
#    y reiniciar el relay si tocaste server/server.js

# 5. verificar en prod que el stamp llegó
curl -s https://TU-DOMINIO/index.html | grep -o 'app.js?v=[0-9a-z]*'
```

**Regla de caché (el original la aprendió a golpes)**: el HTML debe servirse con `Cache-Control: no-cache` (revalida siempre) para que el nuevo stamp llegue sin hard-refresh. Los `src/` y `assets/` pueden cachearse porque el `?v=` cambia. Configúralo en tu server/CDN.

**GLBs regenerables**: cárgalos con `?v=` + APP_VERSION también, o el navegador sirve versiones viejas tras regenerarlos.

---

## 6. Cómo hacer QA de verdad (o te mentirás a ti mismo)

1. **Bench de FPS SÍNCRONO, nunca el rAF.** Chrome throttlea el `requestAnimationFrame` a 1-2fps cuando la ventana está ocluida (incluso con `visibilityState=visible` y foco). Mide así:
   ```js
   const r = window.__SAUCES_R__, sc = window.__SAUCES_SCENE__, cam = window.__SAUCES_CAM__;
   const gl = r.getContext(); const t0 = performance.now();
   for (let i=0;i<60;i++) r.render(sc, cam); gl.finish();
   const ms = (performance.now()-t0)/60;   // ms por frame reales
   ```
2. **Para QA de combate/mobs, CAMINA con WASD reales** (dispatch de KeyboardEvent `KeyW`, etc). Teleportar con `window.__game.player.pos.set(...)` NO sincroniza con el server: los mobs (autoritativos) quedan donde el server te cree, y verás fantasmas de interpolación que no pelean.
3. **Globals de debug** expuestos: `window.__game` (`.player .net .scene .renderer .camera`), `window.__SAUCES_R__/__SCENE__/__CAM__/__BUILD__`, `window.__SAUCES_MOBILE__`.
4. **¿Es lag de server o de cliente?** Intercepta `net.ws.onmessage`, cuenta paquetes `mpos`/seg y mide gaps. El server sano manda ~10/seg con gap ~100ms.
5. **Móvil**: perfil automático al detectar touch (pixelRatio 1.0, sombras OFF, gore reducido, LOD agresivo). Verifica con las DevTools en modo device o `?` sin `perf=high`.

---

## 7. Gotchas aprendidos (no repitas estos errores)

- **`mob_spawns.json` DEBE ser `{"spawns":[...]}`**. Un array plano carga 0 mobs (el loader busca `.spawns`).
- **Escribir archivos con emojis en scripts Python**: si pasas emojis como surrogates escapados (`🦌`) por `unicode_escape`, el `write` puede lanzar `UnicodeEncodeError` DESPUÉS de que `open(...,'w')` ya truncó el archivo → **archivo a 0 bytes**, y si va en un `&&` chain, se deploya roto. Regla: `data = s.encode('utf-8')` ANTES de abrir en `'w'` (valida el encode primero), escribe bytes, y usa el carácter emoji directo (no surrogates). Verifica `wc -c` del archivo en prod tras un deploy sospechoso.
- **`str.replace()` en un patch ancla en la PRIMERA coincidencia.** Si el mismo patrón existe en dos métodos (p.ej. absorción de escudo en `_onPlayerHit` y `takePvpHit`), tu cambio entra en uno solo. Verifica en ambos.
- **`Material.clone()` NO copia `onBeforeCompile`.** Reinstálalo en cada clon (los shaders de autos/pasto).
- **Chrome throttlea rAF con ventana ocluida** (ver §6.1). Y el `AudioContext` puede correr acelerado. Bench síncrono siempre.
- **Consola Windows en cp1252** miente con UTF-8: para verificar contenido con tildes/emoji, lee los bytes crudos y decodifica como UTF-8, no por `print`/stdin.
- **El relay local en background muere entre sesiones.** Si ves `mobs:0` o `ws undefined`, revisa `curl :8457/health` y reinícialo antes de culpar al código.
- **Teleport ≠ sincronizar** (ver §6.2).

---

## 8. Diseño del gameplay (contrato con el mundo)

- **Combate ARPG**: acércate y peleas solo (auto-engage al más cercano); X togglea auto/manual; Q/E/R/F son skills con cooldown (R = skill de PARTY que beneficia a todo el grupo). Combos con cancel-window, cleave en arco, crits, racha con multiplicador de oro/XP.
- **4 héroes** (Verdugo/Piromante/Cazadora/Sombra) + Diosito (GOD, cuenta validada por el server, "Gracia Divina": a 1 HP se vuelve holográfico con lifesteal 99%). Cada héroe: recurso propio, arma, aura, estilo de combo, 4 skills.
- **Zombies**: server-authoritative, personalidades (corredor/tanque/normal), rodean en manada, muerden desfasado. Los spots de farmeo tienen clusters; oleadas cada `WAVE_EVERY_MS` con default minimo 15 min, entre 4 y 8 mobs; Abominación (boss) cada 10 oleadas + un boss guardián fijo.
- **Zonas especiales**: la GRUTA (`SAFE_X,SAFE_Z,SAFE_R`) es refugio total (mobs no entran ni targetean dentro). El edificio hueco en `(3,-47)` está SELLADO (`SEAL_*`) para todos.
- **Ciclo día/noche**: reloj compartido por `Date.now()` (misma fórmula cliente/server, `DAYNIGHT_MS=1500000`, 40% noche); de noche las hordas crecen.
- **Economía**: matas → oro + drops; Bodega Ojeda vende pociones/armas; vendes loot (Shift+clic o "vender todo común"). Regen de recursos alto = rotación frenética de skills.

---

## 9. Reglas de trabajo para el agente

1. **Verifica antes de afirmar.** No digas "listo" sin `node --check` + un QA real (bench síncrono, caminar en el mundo). El dueño valora la paranoia.
2. **Repos PRIVADOS por defecto.** Nunca crees uno público sin pedido explícito.
3. **No pushear a `main` sin permiso** (usa ramas). El original trabaja en `feat/realismo-sauces` y `sauces420v4201`.
4. **Cirugía, no reescritura.** Cada línea cambiada debe trazar al pedido. Respeta el estilo del archivo (comentarios en español, sin `;` de más, sin guiones largos).
5. **Rendimiento primero** cuando toques el loop o los mobs (objetivo: 60fps con ~90 zombies; móvil jugable). Todo pool de efectos necesita cap duro.
6. **Usa agentes en paralelo** para trabajo independiente (autos, fachadas, animaciones, AI corrieron en paralelo con buen resultado). Dales reglas duras de "solo toca estos archivos" para evitar conflictos.
7. **Secretos**: nunca hardcodees claves API ni credenciales en el repo. El GOD del server y las keys de generación de assets (MuAPI/etc) van por variables de entorno; un fork usa las suyas.

---

## 10. Referencias rápidas

- **Parche prod 20260709g5**: `sauces.controla.group` quedo en `APP_VERSION=20260709g5`.
  - Consumibles: botones rapidos y tactiles mas grandes, con smoke en desktop, mobile portrait y touch landscape.
  - Shake: multiplicador global mas bajo, menor duracion y radio local mas corto para que peleas lejanas no muevan la camara.
  - Parques: senderos `path` siguen como piedra; concreto peatonal de borde queda suprimido y el apron de pasto cubre mas borde.
  - Mundo: ciclo dia/noche `DAYNIGHT_MS=1500000`; oleadas default minimo 60 min; spawn inicial cliente y server en la gruta.
  - QA usado: `npm run build`, `node scripts/smoke_foundation.mjs`, `node scripts/smoke_quick_consumable_ui.mjs`, `node scripts/audit_park_clearance.mjs`, smoke externo contra prod y captura `tmp/prod-20260709g5-render.png`.
- **Parche prod 20260709g6**: `sauces.controla.group` quedo en `APP_VERSION=20260709g6`.
  - Inventario: las pociones iguales se apilan por nombre/curacion. Beber baja una unidad y vender paga la pila completa.
  - UX/economia: las 3 pociones iniciales de la gruta ocupan 1 slot con contador `x3`, reduciendo basura de inventario.
  - QA usado: `npm run build`, `node scripts/smoke_foundation.mjs`, `node scripts/smoke_inventory_potion_stack.mjs`, `node scripts/smoke_quick_consumable_ui.mjs`, smoke externo contra prod y captura `tmp/prod-20260709g6-render.png`.
- **Parche prod 20260709g7**: `sauces.controla.group` quedo en `APP_VERSION=20260709g7`.
  - Combate: el ultimo tick de sangrado melee emite un cierre gore corto sin repetir VFX en cada tick.
  - QA usado: `npm run build`, `node scripts/smoke_foundation.mjs`, `node scripts/smoke_bleed_pressure.mjs`, `node scripts/smoke_quick_consumable_ui.mjs`, smoke externo contra prod y captura `tmp/prod-20260709g7-render.png`.
- **Parche prod 20260709g8**: `sauces.controla.group` quedo en `APP_VERSION=20260709g8`.
  - UX: botones tactiles de pociones mas grandes, con contador real, estado vacio y separacion validada en mobile portrait y touch landscape.
  - Mundo: shake global mas bajo, bordes de parques cubiertos con apron de pasto mas ancho, concreto peatonal cerca de parques mas suprimido y playground principal con puente de cuerda y carrusel bajo extra.
  - Balance: oleadas minimo 90 min, tamano base 1, boss cada 30 oleadas y TTL normal 60s. El cliente ya no manda `x/z` en `hi`, el spawn lo decide el server en la gruta.
  - QA usado: `npm run build`, `node scripts/smoke_foundation.mjs`, `node scripts/smoke_quick_consumable_ui.mjs`, `node scripts/audit_park_clearance.mjs`, smoke externo contra prod y capturas `tmp/prod-20260709g8-mobile.png`, `tmp/prod-20260709g8-desktop.png`.
- **Parche prod 20260709g9**: `sauces.controla.group` queda en `APP_VERSION=20260709g9`.
  - Combate/animacion: los cadaveres que se deslizan tras un remate dejan un rastro corto de sangre con cap duro, sin cambiar dano ni reglas.
  - Mundo: shake global todavia mas bajo y muerte cercana con pulso local mas discreto.
  - QA usado: `npm run build`, `node scripts/smoke_foundation.mjs`, `node scripts/smoke_effect_smooth_shake.mjs`, `node scripts/smoke_mob_death_feedback.mjs`, `node scripts/smoke_effect_caps.mjs`, smoke externo contra prod y captura `tmp/prod-20260709g9-desktop.png`.
- **Parche prod 20260709g10**: `sauces.controla.group` queda en `APP_VERSION=20260709g10`.
  - UI: fix responsive para pantallas touch horizontales bajas. La barra de skills ya no se fuerza a la esquina derecha sobre botones tactiles; ese layout queda solo para desktop con hover.
  - QA usado: `node scripts/smoke_quick_consumable_ui.mjs`, `node scripts/smoke_skill_ui_cache.mjs`, `npm run build`, smoke externo contra prod y captura `tmp/prod-20260709g10-touch-landscape.png`.
- **Parche prod 20260709g11**: `sauces.controla.group` queda en `APP_VERSION=20260709g11`.
  - Combate/animacion: mobs heridos caminan con cojera visual sutil y dejan gotas pequenas de sangre mientras avanzan. Es solo cliente, no cambia velocidad ni dano autoritativo.
  - Rendimiento: las gotas usan el pool/cap existente de manchas y expiran como efecto acotado.
  - QA usado: `node scripts/smoke_mob_hit_feedback.mjs`, `node scripts/smoke_effect_caps.mjs`, `node scripts/smoke_mob_death_feedback.mjs`, `node scripts/smoke_foundation.mjs`, `npm run build`, smoke externo contra prod y captura `tmp/prod-20260709g11-desktop.png`.
- **Parche prod 20260709g13**: `sauces.controla.group` queda en `APP_VERSION=20260709g13`.
  - UX: desktop mantiene quickbar de 3 consumibles; touch oculta la quickbar duplicada y deja 3 botones tactiles grandes con tecla, cantidad y curacion.
  - Mundo: shake global y radio local bajan otra vez; concreto de bordes de parques se suprime con radio mayor y apron de pasto mas ancho; playground principal gana grilla de caucho, soportes extra, cuerda y bancas.
  - Balance: ciclo dia/noche sigue en 25 min; spawn nuevo y respawn siguen en la gruta; oleadas default minimo 120 min, tamano base 1, boss cada 45 oleadas y TTL normal 45s.
  - QA usado: `node scripts/smoke_quick_consumable_ui.mjs`, `node scripts/smoke_world_pacing.mjs`, `node scripts/smoke_effect_smooth_shake.mjs`, `node scripts/smoke_local_camera_shake.mjs`, `node scripts/audit_park_clearance.mjs`, `node scripts/smoke_foundation.mjs`, `npm run build`, smoke externo contra prod y capturas `tmp/prod-20260709g13-desktop-clean.png`, `tmp/prod-20260709g13-touch-clean.png`.
- **Parche prod 20260709g14**: `sauces.controla.group` queda en `APP_VERSION=20260709g14`.
  - Combate/animacion: `Player.combatLunge()` y dash aplican una inclinacion visual corta sobre el grupo del personaje. No cambia root, posicion autoritativa, dano ni server.
  - QA usado: `node scripts/smoke_player_body_lean.mjs`, `node scripts/smoke_player_attack_window.mjs`, `node scripts/smoke_player_dash_animation.mjs`, `node scripts/smoke_player_action_cleanup.mjs`, `node scripts/smoke_foundation.mjs`, `npm run build`, smoke externo contra prod y captura `tmp/prod-20260709g14-body-lean.png`.
- **Parche prod 20260709g15**: `sauces.controla.group` queda en `APP_VERSION=20260709g15`.
  - UX: consumibles desktop pasan a un carril vertical separado del HUD y skills. Touch mantiene quickbar duplicada oculta y botones tactiles de pocion mas grandes.
  - Mundo: shake global baja otra vez, radio local mas corto, bordes de parque con deteccion y apron de pasto mas agresivos, y juegos infantiles con tire swing, climbing wall y juguetes pequenos.
  - Balance: ciclo dia/noche sigue en 25 min; spawn nuevo y respawn siguen en la gruta; oleadas default minimo 180 min, tamano base 1, boss cada 60 oleadas y TTL normal 45s.
  - Animacion: ataques basicos melee y skills melee ahora inclinan el cuerpo igual que dash/lunge, sin afectar arqueros ni magia.
  - QA usado: `node scripts/smoke_quick_consumable_ui.mjs`, `node scripts/smoke_world_pacing.mjs`, `node scripts/smoke_effect_smooth_shake.mjs`, `node scripts/smoke_local_camera_shake.mjs`, `node scripts/audit_park_clearance.mjs`, `node scripts/smoke_player_body_lean.mjs`, `node scripts/smoke_foundation.mjs`, `npm run build`, smoke externo contra prod y capturas `tmp/prod-20260709g15-desktop-ui.png`, `tmp/prod-20260709g15-touch-ui.png`.
- **Parche prod 20260709g16**: `sauces.controla.group` queda en `APP_VERSION=20260709g16`.
  - UX: consumibles desktop quedan en una barra horizontal facil de ver sobre el HUD, con separacion validada en 714x522, 967x546 y 1366x768. Touch conserva 3 botones tactiles grandes, con mas espacio entre el principal y el segundo.
  - Mundo: shake global baja de nuevo y el radio local se acorta mas. Bordes de parques reciben apron de pasto mas ancho y alto; concreto peatonal cerca de parques se detecta con radio mayor. El playground principal agrega zona toddler, troncos bajos, bancas y modulo pequeno.
  - Balance: ciclo dia/noche sigue en 25 min; spawn nuevo y respawn siguen en la gruta; oleadas default minimo 240 min, tamano base 1, boss cada 80 oleadas y TTL normal 35s.
  - QA usado: `node scripts/smoke_quick_consumable_ui.mjs`, `node scripts/smoke_world_pacing.mjs`, `node scripts/smoke_effect_smooth_shake.mjs`, `node scripts/smoke_local_camera_shake.mjs`, `node scripts/audit_park_clearance.mjs`, `node scripts/audit_mob_spawns.mjs`, `node scripts/smoke_foundation.mjs`, `npm run build`.
- **Parche prod 20260709g17**: `sauces.controla.group` queda en `APP_VERSION=20260709g17`.
  - Animacion multiplayer: los jugadores remotos ahora inclinan visualmente el cuerpo en ataques basicos melee, skills melee y dash. La inclinacion se aplica solo al grupo visual clonado, no al root, posicion, dano ni server.
  - Seguridad visual: ranger, mage y cernunnos mantienen ataques ranged/magic sin fake lean melee. Muerte y recuperacion limpian el lean para evitar poses residuales.
  - QA usado: `node scripts/smoke_net_remote_body_lean.mjs`, `node scripts/smoke_net_remote_skill_animation.mjs`, `node scripts/smoke_net_remote_dodge.mjs`, `node scripts/smoke_foundation.mjs`, `npm run build`.

- **Parche prod 20260709g18**: `sauces.controla.group` queda en `APP_VERSION=20260709g18`.
  - UX: consumibles desktop suben a 110/88 px y 88/74 px en pantallas compactas. Touch usa un grupo de 98/76 px arriba de las skills en vertical y un carril inferior de 82/68 px en horizontal, sin solapar HUD, skills ni controles.
  - Mundo: shake global vuelve a bajar, el radio local queda en 0.32/0.95 y las muertes cercanas tienen un pulso mas discreto. Los bordes peatonales de parques reciben supresion y apron de pasto mas agresivos. El playground principal suma mesa de picnic, bebedero, letrero y troncos de equilibrio.
  - Balance: ciclo dia/noche sigue en 25 min; spawn nuevo y respawn siguen en la gruta; oleadas default minimo 300 min.
  - QA usado: `node --check` sobre 41 archivos, auditoria directa de 24 smokes, `npm run build`, HTTP y WebSocket local, mediciones reales en 714x522, 967x546, 1366x768, 390x844, 390x600 y 896x414, health remoto, HTTPS publico y handshake WSS externo.

- **Parche prod 20260709g19**: `sauces.controla.group` queda en `APP_VERSION=20260709g19`.
  - Combate: tus impactos melee, finishers, cleave y rupturas vuelven a emitir shake local con caida hasta 3.2 m, suficiente para el alcance real del golpe.
  - Aislamiento: las muertes de mobs ajenos conservan el radio corto 0.32/0.95. El multiplicador global sutil de g18 no cambia, por lo que peleas lejanas siguen sin mover tu camara.
  - QA usado: 63 smokes directos sin fallos, incluidos cleave, timing de impacto, kill frenzy, muerte lejana y shake sutil; `node --check` sobre 41 archivos, `npm run build`, HTTPS publico y carga completa del HUD en navegador de produccion.

- **Parche prod 20260709g20**: `sauces.controla.group` queda en `APP_VERSION=20260709g20`.
  - Animacion de mobs: Attack, Hit, Spawn y Death entran con crossfade de 80 ms; el regreso a Idle/Walk usa 120 ms. Los one-shots conservan el ultimo frame durante la mezcla para eliminar cortes secos.
  - Seguridad y rendimiento: la accion anterior se detiene despues del fade mediante una cola corta. Solo cambia el mixer del rig clonado; no modifica root, posicion, IA, velocidad, dano, server, geometria ni materiales.
  - QA usado: 64 smokes directos sin fallos, nuevo `smoke_mob_action_blend.mjs`, 10 repeticiones del timing de proyectiles, `node --check`, `npm run build`, relay aislado con health y WebSocket, carga local y produccion sin errores de consola.

- **Parche prod 20260709g21**: `sauces.controla.group` queda en `APP_VERSION=20260709g21`.
  - Animacion multiplayer: Attack, Dodge, Hit y Death de jugadores remotos entran con crossfade de 60 a 80 ms; el regreso a Idle/Walk usa 120 a 140 ms. Los clips anteriores se limpian despues del fade y el loop activo no se reinicia cada frame.
  - Seguridad de gameplay: solo cambia el mixer del rig remoto. No cambia paquetes, interpolacion, root, posicion, dano, cooldowns ni autoridad del server.
  - Reset de progresion: 14 personajes existentes quedaron en nivel 1, XP 0, HP maximo 100, oro 0, inventario vacio y sin equipo. Una cuenta sin personaje no requirio cambios. Respaldo: `/opt/sauces-mp/accounts.json.bak-2026-07-09T21-32-29-904Z`.
  - QA usado: 65 smokes puros sin fallos, incluido `smoke_net_remote_action_blend.mjs`; 20 repeticiones de timing de impacto; `node --check` sobre 41 archivos; carga local y produccion en navegador con canvas, HUD, 4 skills, 3 consumibles y consola limpia; HTTPS 200 y handshake WSS externo. El build Vite del prototipo `modern/` no corrio por `spawn EPERM` del sandbox y no empaqueta el cliente clasico desplegado.

- **Parche prod 20260709g22**: `sauces.controla.group` queda en `APP_VERSION=20260709g22`.
  - UX premium: HUD y barra de 4 skills ganan jerarquia, contraste, estados de cooldown/buffer/recurso, keybinds largos y dimensiones estables. Se verificaron sin solapes con consumibles en desktop, compacto, mobile vertical y mobile horizontal.
  - Progresion: nivel 1 requiere 70 XP y la curva usa exponente 1.32. La racha de XP queda amortiguada y limitada a 1.35x; el primer nivel toma unas 20 kills con racha completa o 24 kills faciles sin racha.
  - Dificultad por zonas: starter y gruta mantienen perfiles suaves; spot1/2/5 suben a perfil medio; spot3/4/6 y boulevard usan perfil duro. En el relay real, spot7 promedia 36.1 HP, spot3 128.1, spot6 140 y el guardian 906.
  - Cooldowns y economia: skills normales quedan entre 5.2 y 34 s segun slot; oro 78%, material 8%, pocion 3.5% y gear 2.2%. Los materiales se convierten en oro en vez de perderse invisibles, el multiplicador de oro se limita a 2x y la tienda cuesta 30/90/240.
  - Server: las curvas autoritativas viven en `server/mob_balance.js`, cubiertas por `smoke_zone_difficulty_balance.mjs`, sin cambiar protocolo ni formato de saves.
  - QA usado: 66 smokes puros sin fallos, 20 repeticiones de fallback de impacto, `node --check` sobre 42 archivos, relay local y produccion con 86 mobs, cuatro viewports sin solapes, canvas no vacio, consola limpia, HTTPS 200 y WSS externo. Respaldos: `/root/deploy-backups/sauces-web-20260709T220509Z-before-20260709g22.tar.gz` y `/root/deploy-backups/sauces-server-20260709T220509Z-before-20260709g22.tar.gz`.

- **Parche prod 20260709g23**: `sauces.controla.group` queda en `APP_VERSION=20260709g23`.
  - Animacion local: locomocion usa crossfade de 80 ms, salida de acciones 100 ms y recuperacion de muerte 160 ms. Los combos forzados ya no cortan el clip anterior antes de mezclar.
  - Seguridad de gameplay: no cambia root, ventanas de dano, cancel windows, cooldowns, movimiento ni protocolo de red.
  - QA usado: 67 smokes puros sin fallos, `node --check` sobre 42 archivos, auditoria Blender 5.1 de 5 GLB y 225 referencias de clips sin faltantes, navegador local y produccion sin errores, HTTPS 200 y WSS externo. Respaldo: `/root/deploy-backups/sauces-web-20260709T221657Z-before-20260709g23.tar.gz`.

- **Parche prod 20260709g24**: `sauces.controla.group` queda en `APP_VERSION=20260709g24`.
  - Consumibles: tres controles rapidos con estados listos/vacios, cantidad, curacion, feedback de clic/tecla/toque y targets estables. Una pocion ya no se consume con vida completa.
  - Camara: shake local corto y sutil, con multiplicadores globales `0.14` de amplitud y `0.62` de duracion. Tus impactos caen hasta 3.2 m y muertes ajenas hasta 0.95 m; peleas lejanas no mueven la camara.
  - Pacing: ciclo dia/noche de 25 min. Las hordas aparecen como evento cada 15 min, tienen 4 a 8 mobs, TTL normal de 75 s y boss cada 10 oleadas. La gruta queda excluida.
  - Mundo: los 47 poligonos verdes conservan cesped y apron sobre concreto, solo los senderos `path` quedan como piedra. El parque principal incluye juegos ampliados y el spawn nuevo/respawn sigue en `[-62,-7]`.
  - Server: la metadata de muerte de bosses usa `mob.boss`, corrigiendo el flag falso anterior.
  - QA usado: 71 smokes puros sin fallos, `node --check` sobre 42 archivos, `npm run build`, auditoria Blender 5.1, navegador real en 1280x720, 390x844 y 896x414 sin solapes ni errores, HTTPS 200, WSS externo y relay sano con 86 mobs. Los 13 smokes que lanzan procesos externos se omitieron por el limite `spawn EPERM`; sus flujos HTTP, WSS y browser se validaron directamente.
  - Respaldos: `/root/deploy-backups/sauces-web-20260709T223924Z-before-20260709g24.tar.gz`, `/root/deploy-backups/sauces-server-20260709T223924Z-before-20260709g24.tar.gz` y `/root/deploy-backups/sauces-accounts-20260709T223924Z-before-20260709g24.json`.

- **Parche prod 20260709g25**: `sauces.controla.group` queda en `APP_VERSION=20260709g25`.
  - Camara: la oclusion consulta la altura real de cada edificio. Un techo bajo no comprime la vista si el rayo pasa por encima; una pared alta mantiene la camara delante y convierte la distancia perdida en elevacion controlada.
  - Seguimiento: la camara entra rapido cuando aparece un obstaculo y recupera distancia con suavidad. No cambia movimiento, combate, root, red ni colisiones del jugador.
  - QA usado: 72 smokes puros sin fallos, nuevo `smoke_camera_occlusion.mjs`, `node --check` sobre 42 archivos, `npm run build`, navegador local y produccion en 1280x720 y 390x844 sin errores ni overflow, HTTPS 200 y WSS externo.
  - Respaldo: `/root/deploy-backups/sauces-web-20260709T225723Z-before-20260709g25.tar.gz`.

- **Production patch 20260709g26**: `sauces.controla.group` runs `APP_VERSION=20260709g26`.
  - Movement authority: the relay grants bounded movement credit at 34 m/s with an 8 m burst budget. Normal sprint, dash and packet jitter remain responsive; arbitrary teleports receive a `corr` packet. Exact Gruta return remains legal.
  - World navigation: server movement uses 28,483 exact building polygons indexed into 4,830 spatial cells. Pursuit side-steps walls, separation cannot push mobs into geometry, wander targets stay open, and waves/bosses retry open spawn points.
  - Spawn repair: all 86 fixed mobs retain their zone, level, boss and fodder metadata with at least 1 m initial building clearance. The runtime uses 0.85 m clearance and recovered 4,200 live movement updates without a blocked position.
  - QA: 45 JavaScript syntax checks, 66 selected pure smokes, TypeScript `--noEmit`, park/spawn audits, a two-client relay test, production HTTPS/WSS, and real browser runs at 1280x720 and 390x844 with clean console and no horizontal overflow. Vite's optional `modern/` prototype build was blocked by sandbox `spawn EPERM`; the deployed classic modular client does not use that bundle.
  - Production invariants: service active, health clean, 86 mobs, 15 accounts, 14 characters, zero reset violations. Root disk remains at 100% with about 1.6 GB free.
  - Backups: `/root/deploy-backups/sauces-web-20260709T232951Z-before-20260709g26.tar.gz`, `/root/deploy-backups/sauces-server-20260709T232951Z-before-20260709g26.tar.gz`, and `/root/deploy-backups/sauces-accounts-20260709T232951Z-before-20260709g26.json`.

- **Production patch 20260709g27**: `sauces.controla.group` runs `APP_VERSION=20260709g27`.
  - Animation continuity: active mid-range mob locomotion and one-shots now update every rendered frame. Active far-visible mobs retain a 24 Hz pose floor, while idle and hidden skeletons keep the previous performance LOD.
  - Timing accuracy: mixer throttling preserves the accumulated remainder instead of discarding it, keeping 30/60/120 FPS simulations within one frame of real elapsed time.
  - Premium UX: HP, XP, level and gold changes gain reusable transient deltas and trailing bars. Touch controls gain joystick direction/intensity feedback plus press and pulse states, with reduced-motion support and unchanged dimensions.
  - Gameplay contract: no damage, cooldown, movement speed, balance, spawn, network protocol or server behavior changed.
  - QA: 45 JavaScript syntax checks, 67 selected pure smokes, TypeScript `--noEmit`, focused animation/touch tests, and local/production browser runs at 1280x720 and 390x844 with clean console, stable canvas, three HUD delta nodes and no horizontal overflow.
  - Backup: `/root/deploy-backups/sauces-web-20260709T235159Z-before-20260709g27.tar.gz`.

- **Production patch 20260709g28**: `sauces.controla.group` runs `APP_VERSION=20260709g28`.
  - Multiplayer animation: moving remotes and active attack, dodge, hit and death states animate every rendered frame in the mid band. Active far remotes retain a 24 Hz pose floor; idle remotes keep the lower-cost LOD.
  - FPS-independent motion: remote position uses exponential response at rate 12 and heading uses rate 10, producing equivalent convergence at 30, 60 and 120 FPS instead of device-dependent drag.
  - Timing accuracy: the remote mixer preserves accumulated remainder rather than discarding it after each throttled update.
  - Gameplay contract: visual interpolation only. Server authority, movement speed, damage, cooldowns, balance and network messages remain unchanged.
  - QA: 45 JavaScript syntax checks, 67 selected pure smokes, TypeScript `--noEmit`, all remote animation regressions, a real two-player WSS browser scene, and production desktop/mobile checks with clean console and no horizontal overflow.
  - Backup: `/root/deploy-backups/sauces-web-20260710T000548Z-before-20260709g28.tar.gz`.

- **Production patch 20260709g29**: `sauces.controla.group` runs `APP_VERSION=20260709g29`.
  - Camera continuity: third-person follow now uses exponential response, so convergence is identical at 30, 60 and 120 FPS instead of depending on frame count.
  - Pacing: occlusion entry uses response rate 38 and distance recovery uses rate 8, matching the previous 60 FPS feel while preserving fast wall avoidance and softer pull-back.
  - Gameplay contract: camera-only change. Player position, collisions, combat, movement speed, animation timing, server authority and protocol remain unchanged.
  - QA: 45 JavaScript syntax checks, 67 selected pure smokes, all player regressions, TypeScript `--noEmit`, deterministic camera simulations, and local/production desktop/mobile browser checks with clean console and no overflow.
  - Backup: `/root/deploy-backups/sauces-web-20260710T001349Z-before-20260709g29.tar.gz`.

- **Production patch 20260709g30**: `sauces.controla.group` runs `APP_VERSION=20260709g30`.
  - Manual combat boundary: only a deliberate primary-button click on the Three.js render surface can queue a basic attack. HUD, consumable, inventory and keybind-panel clicks no longer bubble into combat or leave a buffered `_punchT`. Automatic attacks remain exclusive to explicit auto mode.
  - Useful loot: weapon drops use the current class identifiers and prefer the active class weapon (`axe_2handed`, `staff`, `bow` or `dagger`). Legacy class requirements no longer leak into new gear. Overall gold, material, potion and gear probabilities remain unchanged.
  - Gameplay contract: no damage, cooldown, XP curve, enemy difficulty, movement, spawn, wave cadence, network protocol or server state changed.
  - QA: 45 JavaScript syntax checks, 69 selected pure smokes, TypeScript `--noEmit`, focused pointer/loot regressions, and local plus production browser runs at 1280x720 and 390x844. Both viewports had a clean console and no overflow; the mobile keybind panel measured 370.4x662 inside the viewport.
  - Production state after deploy: service active, health clean and 86 mobs. The root disk remains critical at 99% with about 2.3 GB free.
  - Backup: `/root/deploy-backups/sauces-web-20260710T024744Z-before-20260709g30.tar.gz`.

- **Production patch 20260709g31**: `sauces.controla.group` runs `APP_VERSION=20260709g31`.
  - Multiplayer action parity: local and remote players now use one shared calculation for cancel locks, visual tails and bow follow-up clips. Remote bow and magic attacks no longer remain blocked for the entire animation after the local player can already chain the next input.
  - Skill animation parity: heavy, support and self-cast skills share the same speed and recovery classification locally and remotely. The visible pose can finish naturally while queued attacks open at the same time on both clients.
  - Blender evidence: Blender 5.1.2 audited five animation GLBs independently after fixing stale action accumulation in the audit script. The files contain 72 total clip references: 11 movement, 15 general, 22 melee, 20 ranged and 4 directional dodge clips.
  - Gameplay contract: visual synchronization only. Damage, hit timing, cooldowns, movement, XP, loot, enemy balance, protocol and server authority remain unchanged.
  - QA: 45 JavaScript syntax checks, 69 selected pure smokes, TypeScript `--noEmit`, focused local/remote timing regressions, a two-client session against the production WSS relay, and local plus production browser runs at 1280x720 and 390x844 with clean consoles and no overflow.
  - Production state after deploy: service active, health clean and 86 mobs. The root disk remains critical at 99% with about 2.3 GB free.
  - Backup: `/root/deploy-backups/sauces-web-20260710T030149Z-before-20260709g31.tar.gz`.

- **Production patch 20260709g32**: `sauces.controla.group` runs `APP_VERSION=20260709g32`.
  - Enemy contact synchronization: every telegraphed mob attack now scales its one-shot speed from the server windup and the measured contact frame of its exact clip. The weapon peak lands 35 ms before the authoritative `phit`, and the claw cue uses the same calculated contact time.
  - Blender evidence: Blender 5.1.2 audited all 380 actions in `kaykit_skeletons.glb`. Peak right-hand velocity occurs at 41.7% for diagonal slice, 56% for chop, 24% for horizontal slice and 26.3% for stab. Runtime speed remains bounded between 1.1x and 3.4x.
  - Fairness: the existing 220 ms server windup, danger circle, miss handling and damage remain unchanged. This patch removes visual timing variance between the four attack clips without making the server hit earlier.
  - Performance: a deterministic 86-mob, 600-frame update benchmark measured about 0.048 ms/frame on desktop logic and 0.028 ms/frame on the low-end mobile profile. The timing calculation runs only when an attack starts, not every frame.
  - QA: 45 JavaScript syntax checks, 69 selected pure smokes, TypeScript `--noEmit`, mob tell/action/evasion/mixer regressions, Blender contact audit, and local plus production browser runs at 1280x720 and 390x844 with clean consoles and no overflow.
  - Production state after deploy: service active, health clean and 86 mobs. The root disk remains critical at 99% with about 2.3 GB free.
  - Backup: `/root/deploy-backups/sauces-web-20260710T031426Z-before-20260709g32.tar.gz`.

- **Production patch 20260709g33**: `sauces.controla.group` runs `APP_VERSION=20260709g33`.
  - Pack targeting: `Tab` now cycles every living hostile within 35 m in deterministic distance order and wraps after the last candidate. Dead mobs, party members, disconnected players and dead remotes are skipped instead of repeatedly selecting the nearest entry.
  - Manual attack intent: one click pins its selected mob while closing distance and waiting for cooldown. A wounded pressure target can no longer steal that click mid-chase, and the buffer is consumed immediately after exactly one attack.
  - Manual-mode contract: the persistent click does not enable auto mode, does not chain after the hit and is still canceled by direct movement, death, chat lock or an invalid target. Explicit auto mode keeps its existing pressure-target behavior.
  - QA: 45 JavaScript syntax checks, 70 selected pure smokes, TypeScript `--noEmit`, new pack-cycle/manual-chase regressions, all auto/manual/skill targeting tests, and local plus production browser runs at 1280x720 and 390x844 with clean consoles and no overflow.
  - Production state after deploy: service active, health clean and 86 mobs. The root disk remains critical at 99% with about 2.3 GB free.
  - Backup: `/root/deploy-backups/sauces-web-20260710T032600Z-before-20260709g33.tar.gz`.

- **Production patch 20260709g34**: `sauces.controla.group` runs `APP_VERSION=20260709g34`.
  - Selection feedback: assisted targets use a quieter teal ring while explicit click/Tab locks keep the original gold ring. The target HUD adds only a subtle gold locked-state border, preserving the existing layout.
  - Target state correctness: auto-assist now routes through the same soft-target path as skills, stale/dead targets clear their ring and lock state together, and death cannot leave a stale `targetLocked` flag behind.
  - Gameplay contract: no damage, cooldown, movement, loot, progression, mob AI, spawn cadence, network protocol or server state changed.
  - QA: 45 JavaScript syntax checks, 71 selected pure smokes, TypeScript `--noEmit`, focused target/skill/auto/manual regressions, local and production browser runs at 1280x720 and 390x844, clean consoles, no overflow, nonblank pixel checks, external `WSS_OPEN`, and 20/20 production file hashes.
  - Production state after deploy: service active, health clean and 86 mobs. Root disk remains critical at 99% with about 2.3 GB free.
  - Backup: `/root/deploy-backups/sauces-web-20260710T033908Z-before-20260709g34.tar.gz`.
  - Next animation priorities for g35: preserve vertical motion while stripping planar root motion, let remote dash interrupt attacks, let heavy remote hits interrupt attacks, advance hidden-mob one-shot timers, and derive death mixer duration from each clip instead of a fixed 1.65 s.

- **Production patch 20260709g35**: `sauces.controla.group` runs `APP_VERSION=20260709g35`.
  - Vertical animation: the shared root-motion filter still plants authoritative X/Z movement but preserves authored Y motion. Leap and jump-chop skills regain their vertical body arc without adding planar drift or changing gameplay position.
  - Remote interruption parity: Dash interrupts an active remote attack on the same network state edge. Heavy remote hits cancel attack follow-ups, queues, timers and delayed cues before crossfading to Hit; light hits keep only the non-interrupting pulse.
  - Remote cleanup: death, recovery and disconnect also cancel delayed attack cues, preventing stale projectiles or area VFX after an action is no longer valid.
  - Mob animation continuity: hidden rigs keep their mixers frozen but their one-shot timers continue. Re-entering the LOD range reconciles to current Idle/Walk instead of replaying an obsolete spawn, hit or attack.
  - Death completion: corpse mixer time derives from each death clip duration at 1.15x plus an 80 ms settle margin. Blender 5.1.2 measured `Death_A=0.8 s`, `Death_B=2.6333 s` and `Death_C_Skeletons=2.0 s`; the long variants now reach their final pose before freezing.
  - Gameplay contract: no damage, cooldown, movement authority, collision, balance, loot, spawn logic, network protocol or server behavior changed.
  - QA: 45 JavaScript syntax checks, 71 selected pure smokes, TypeScript `--noEmit`, Blender clip audit, focused root-motion/remote-interrupt/mob-LOD regressions, local and production browser runs at 1280x720 and 390x844, clean consoles, no overflow, nonblank pixel checks, external `WSS_OPEN`, and 20/20 production file hashes.
  - Production state after deploy: service active, health clean and 86 mobs. Root disk remains critical at 99% with about 2.2 GB free.
  - Backup: `/root/deploy-backups/sauces-web-20260710T035307Z-before-20260709g35.tar.gz`.

- **Production patch 20260709g36**: `sauces.controla.group` runs `APP_VERSION=20260709g36`.
  - Action commitment: skills now respect the active attack cancel lock and buffer without consuming resource or cooldown early. Basic and skill impacts belong to an action sequence, so a dash before contact cancels uncommitted damage while a dash after release preserves the committed hit.
  - Directed casting: targeted skills face their selected mob before animation and hold that visual heading through release/contact while movement remains authoritative and independent.
  - Authoritative enemy tells: the additive `matk` payload includes `x/z/h`; `Net` forwards the pose and `MobField` applies it before drawing the danger cue or claw. Target switches no longer telegraph toward the previous heading.
  - Hidden-state cleanup: mob attack tell/claw timers continue outside visual LOD and expire silently, preventing stale attack cues when a hidden mob becomes visible again.
  - Mob root motion: all mob clips use the shared planar root-motion filter, preserving Y while planting X/Z. Blender 5.1.2 measured `Death_C_Skeletons` root delta `(0,0,-0.708052)` across frames 0-48; this no longer stacks with corpse `deathKick`.
  - Gameplay contract: damage values, cooldown durations, movement authority, collision, loot, progression and existing protocol fields remain unchanged. The `matk` fields are additive for older clients.
  - QA: 45 JavaScript syntax checks, 71 selected pure smokes, TypeScript `--noEmit`, isolated relay windup test (`matk` to `phit` 326 ms), Blender root-motion measurement, local and production browser runs at 1280x720 and 390x844, clean consoles, no overflow, nonblank pixel checks, external `WSS_OPEN`, 19/19 web hashes and 1/1 server hash.
  - Production state after deploy: service active, health clean and 86 mobs. Root disk remains critical at 99% with about 2.2 GB free.
  - Backups: `/root/deploy-backups/sauces-web-20260710T041700Z-before-20260709g36.tar.gz` and `/root/deploy-backups/sauces-server-20260710T041700Z-before-20260709g36.js`.
  - Next performance priorities for g37: O(1) target-ring updates and cached target HUD writes, shared mob HP/ring geometry, and throttled low-end spawn-queue selection.

- **Production patch 20260709g37**: `sauces.controla.group` runs `APP_VERSION=20260709g37`.
  - Stable target cache: unchanged mob id, lock mode, name and HP no longer call `_setSoftTarget`, rewrite rings or touch target DOM every frame. HP, lock, target id, pressure retarget and death still update immediately.
  - O(1) target rings: `MobField` stores the current target and touches only the previous/new ring. A target selected before its visual is created receives the correct ring when it materializes, and death clears deferred state.
  - Shared mob UI geometry: all mob HP backgrounds, HP fills and target rings reuse three immutable geometries. Per-mob materials remain independent, and corpse disposal never destroys shared shapes.
  - Low-end spawn queue: distant candidates use a linear eligible selection at 7.5 Hz instead of sorting/reinserting every frame. Moving 1.5 m wakes the queue immediately, keeping nearby materialization below 200 ms.
  - Measured gates: the target cache remained write-free after initial state across 600 frames with 90 mobs; the potential 270 per-mob UI geometries collapse to three shared shapes; 600 stationary low-end updates performed zero queue sorts/unshifts.
  - Gameplay and visual contract: target choice, pressure scoring, HP feedback, ring styles, mob appearance, spawn radius, damage, balance and server behavior remain unchanged.
  - QA: 45 JavaScript syntax checks, 73 selected pure smokes, TypeScript `--noEmit`, instrumented cache/geometry/queue tests, local and production browser runs at 1280x720 and 390x844, clean consoles, no overflow, nonblank pixel checks, external `WSS_OPEN` and 20/20 production file hashes.
  - Production state after deploy: service active, health clean and 86 mobs. Root disk remains critical at 99% with about 2.0 GB free.
  - Backup: `/root/deploy-backups/sauces-web-20260710T043102Z-before-20260709g37.tar.gz`.

- **Production patch 20260709g38**: `sauces.controla.group` runs `APP_VERSION=20260709g38`.
  - Live performance meter: the compact FPS counter samples uncapped wall-clock frame time instead of gameplay `dt`. Its tooltip exposes average/worst frame time, draw calls and triangles, and `window.__SAUCES_PERF__` keeps the latest sample for diagnostics.
  - Mob draw-call consolidation: compatible KayKit body parts merge once per prototype while preserving every vertex, weight, material, bone and animation. In production Three.js r161, four representative mobs dropped from 42 to 16 calls with the same 20,900 triangles and active mixers.
  - Mob UI cost: HP background/fill now render in one shader plane. Full-health distant bars use a two-meter hysteresis band; bosses, targets, damaged mobs and nearby attacking threats remain visible. Target rings and the target HUD are unchanged.
  - Stable shared assets: corpse cleanup no longer disposes GLB accessory geometry or textures still shared by living mobs, preventing death-time GPU re-uploads.
  - Los Sauces 202 collision: the rendered landmark now registers its exact oriented footprint in both client collision and the exported server obstacle map. The obsolete circular workaround at `3,-47`, which blocked the wrong zone, was removed.
  - Spawn repair: seven fixed spawns inside the previously hollow landmark were relocated, including the guardian boss from `(0.9,-59.1)` to `(8,-59)`. The server now has 28,484 exact obstacle polygons; all 86 fixed spawns pass one-meter clearance.
  - Consumables: desktop and touch quick-consumable controls render at exactly 50% of their previous visual and interactive size, preserving safe-area anchoring, labels, counts, feedback, clicking/tapping and rebinding.
  - QA: 46 JavaScript syntax checks, 77 selected pure smokes, TypeScript `--noEmit`, exact GLB draw-call measurement in Three.js r161, five consumable viewports (714x522, 967x546, 1366x768, 390x844 and 896x414), collision/navigation/spawn audits, clean production desktop browser console, zero overflow, external `WSS_OPEN`, 22/22 web hashes and 3/3 server hashes.
  - Production state after deploy: service active, health clean and 86 mobs. Root disk remains critical at 99% with about 2.2 GB free.
  - Backups: `/root/deploy-backups/sauces-web-20260710T051527Z-before-20260709g38.tar.gz` and `/root/deploy-backups/sauces-server-20260710T051527Z-before-20260709g38.tar.gz`.

- **Repo original (privado)**: `github.com/zpwpe/sauces3js`, ramas `main`, `feat/realismo-sauces`, `sauces420v4201`.
- **Docs vivos**: `CHANGELOG.md`, `PATCH_NOTES.md`, `README.md`.
- **Origen del mundo**: OSM `-12.0871209,-76.9852216` (San Borja, Los Sauces), `assets/zone.json`.
- **three.js**: r161 vía importmap jsDelivr. Los shaders van por `MeshStandardMaterial.onBeforeCompile` (preservan sombras/fog/ACES).
- **Generación de assets** (opcional, no requerido para correr): imágenes/3D/audio se generaron con servicios externos; un fork puede regenerar o usar los GLB/MP3 ya commiteados.

Cuando tengas dudas de un sistema, abre el archivo de §4 y lee sus comentarios de cabecera: casi todos explican el porqué de las decisiones no obvias.
