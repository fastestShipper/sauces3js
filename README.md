# Los Sauces · San Borja (sauces3js)

Juego web estilo GTA del barrio **Los Sauces, San Borja (Lima, Perú)**, construido sobre datos reales de OpenStreetMap. three.js puro, sin bundler.

> **LIVE.** El juego corre en https://sauces.controla.group. Cualquier cambio al sitio en vivo sale de este repo.

## Stack
- three.js 0.161 via importmap CDN (sin build, sin node_modules)
- Geometría procedural del barrio en `src/citymesh.js` desde `assets/zone.json` (OSM)
- Assets reales en `assets/` (modelos GLB/GLTF, texturas, HDR de cielo, SFX)

## Estructura
```
index.html            # entry, importmap CDN, carga src/app.js
src/
  app.js              # bootstrap: escena, render loop, luces, sombras, cámara
  citygen.js          # genera la malla de la ciudad desde zone.json
  citymesh.js         # construcción de edificios, calles, veredas, props
  landmark.js         # edificio ancla Los Sauces 202
  npcs.js             # peatones y tráfico (AnimationMixer)
  player.js           # personaje, controles, cámara 3ra persona
  minimap.js          # minimapa
assets/
  zone.json           # datos OSM del barrio
  models/ textures/ sfx/
audit_*.mjs           # scripts de auditoría de geometría (z-fighting, medianeras)
```

## Correr local
```bash
# servidor estático con no-cache (Chrome cachea módulos ES agresivo)
python -m http.server 8000   # o el serve.py del proyecto
# abrir http://localhost:8000
```

## Deploy
Copia directa al webroot de Lima (NO re-publish, eso rompe el SSL):
```bash
# Lima 187.77.229.244, ssh/scp -P 2222 (agent key)
scp -P 2222 -r src index.html assets root@187.77.229.244:/var/www/sauces.controla.group/
```
Tras cada cambio: bumpear `?v=` en `index.html` para romper cache.

## Controles
WASD moverse · ESPACIO saltar · clic derecho girar cámara · rueda zoom
