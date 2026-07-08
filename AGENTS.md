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
- **Zombies**: server-authoritative, personalidades (corredor/tanque/normal), rodean en manada, muerden desfasado. Los spots de farmeo tienen clusters; oleadas cada `WAVE_EVERY_MS`; Abominación (boss) cada 2 oleadas + un boss guardián fijo.
- **Zonas especiales**: la GRUTA (`SAFE_X,SAFE_Z,SAFE_R`) es refugio total (mobs no entran ni targetean dentro). El edificio hueco en `(3,-47)` está SELLADO (`SEAL_*`) para todos.
- **Ciclo día/noche**: reloj compartido por `Date.now()` (misma fórmula cliente/server, `DAYNIGHT_MS=600000`, 40% noche); de noche las hordas crecen.
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

- **Repo original (privado)**: `github.com/zpwpe/sauces3js` — ramas `main`, `feat/realismo-sauces`, `sauces420v4201`.
- **Docs vivos**: `CHANGELOG.md`, `PATCH_NOTES.md`, `README.md`.
- **Origen del mundo**: OSM `-12.0871209,-76.9852216` (San Borja, Los Sauces), `assets/zone.json`.
- **three.js**: r161 vía importmap jsDelivr. Los shaders van por `MeshStandardMaterial.onBeforeCompile` (preservan sombras/fog/ACES).
- **Generación de assets** (opcional, no requerido para correr): imágenes/3D/audio se generaron con servicios externos; un fork puede regenerar o usar los GLB/MP3 ya commiteados.

Cuando tengas dudas de un sistema, abre el archivo de §4 y lee sus comentarios de cabecera: casi todos explican el porqué de las decisiones no obvias.
