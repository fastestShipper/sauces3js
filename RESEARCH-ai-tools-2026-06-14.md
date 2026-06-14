# Research: herramientas IA para el juego de los Sauces

Fecha: 2026-06-14
Contexto: Y:\work\sauces3js (three.js manual, GTA-style, mapa REAL de Los Sauces San Borja desde OSM, deploy en sauces.controla.group). Evaluación de 4 fuentes que mandó el Comandante.

---

## TL;DR (qué nos sirve y qué no)

| Fuente | Qué es | Sirve para Sauces | Prioridad |
|--------|--------|-------------------|-----------|
| **Blender MCP (ahujasid)** | Control de Blender por IA via MCP, con PolyHaven + Sketchfab + Hyper3D/Rodin + Hunyuan3D | SÍ, directo. Genera/importa assets reales (autos, NPCs, props, edificios) y exporta GLB para GLTFLoader | **ALTA** |
| **Higgsfield Supercomputer / Gaming** | Capa agéntica: describes un juego y arma código+assets+3D, hosteado en su plataforma, multiplayer con un toggle | Como fuente de assets sueltos quizá. Como motor NO (nos sacaría del mapa real y de nuestra infra) | MEDIA (solo assets, verificar export) |
| **Tesana (Muranyi-3)** | Motor end-to-end: prompt -> juego entero (mecánicas, mundo, lógica, UI) en tiempo real | NO directo. Incompatible con nuestro enfoque hand-built de mapa real. Inspiración/benchmark | BAJA (watch) |
| **v0 Shopify storefront game (E. Suárez)** | Tienda Shopify jugable: caminas, entras a locales, compras productos reales, multiplayer, template forkable | NO para el GTA. SÍ relevante para el negocio white-label commerce de Control A | MEDIA (otro frente) |

**Decisión:** el único drop-in real para los Sauces es **Blender MCP**. Lo demás es motor cerrado (Tesana/Higgsfield) o pertenece a otro producto (Shopify game).

---

## 1. @grok -> Blender + MCP (`ahujasid/blender-mcp`)

Tweet de Grok (14-jun-2026) con el paso a paso de Blender + MCP para control por LLM (Claude/Codex):

1. Blender 4.2+ (5.1+ para soporte oficial)
2. Instalar `uv` (package manager)
3. Agregar el addon community MCP
4. Correr el server: `uvx blender-mcp`

**Qué trae (confirmado en el repo):**
- Crear/modificar/borrar objetos 3D en la escena
- Aplicar/asignar materiales y colores
- Ejecutar código Python arbitrario dentro de Blender
- **PolyHaven**: descargar modelos, texturas y HDRIs (GRATIS)
- **Sketchfab**: buscar, previsualizar y descargar modelos
- **Hyper3D/Rodin** y **Hunyuan3D**: generar modelos 3D por IA (text/image -> 3D)
- Geometry Nodes (status, info, crear redes de nodos)
- Screenshots del viewport

**Por qué nos sirve:** hoy TODO en `citymesh.js` es geometría procedural. Con esto pasamos a assets reales para Fase 2: autos conducibles, personajes de gangs (rigeables), props de calle, mobiliario. Pipeline: generar/buscar en Blender -> exportar GLB -> cargar con GLTFLoader en three.js. Los HDRIs de PolyHaven además mejorarían la iluminación del cielo del juego.

**Caveat paranoico:** Hyper3D/Hunyuan generan plata-cuesta o cuota; PolyHaven/Sketchfab tienen assets gratis con licencia que hay que respetar (revisar licencia por modelo antes de meterlo al deploy público).

---

## 2. Higgsfield Supercomputer (`/supercomputer/gaming`)

Lanzado mayo 2026. Capa agéntica: describes un brief y el sistema planifica el workflow, elige los modelos y entrega assets. El orquestador usa Claude + Gemini + GPT como ruteo.

**Para gaming:**
- Describes un juego en lenguaje natural -> arma código, assets, 3D, build jugable con URL para compartir, sin engine ni setup
- "create a low-poly island" -> assets 3D, entornos y personajes metidos en el juego
- Hosting + build + URL automáticos, corre en el browser
- Multiplayer con un toggle: lobbies y state sync incluidos

**Veredicto para Sauces:** es un motor/host CERRADO. Si lo usáramos como motor perderíamos (a) el mapa REAL de Los Sauces desde OSM, (b) nuestro control fino del z-fighting/materiales, (c) el deploy en Lima. NO lo adoptamos como motor. Posible uso marginal: pedirle assets 3D sueltos ("low-poly car peruano", "vendedor ambulante") SI exporta GLB; eso está sin confirmar y hay que probarlo antes de apostar.

---

## 3. Tesana (@TesanaAI) -> motor Muranyi-3

tesana.ai. "Make games with AI". Con el modelo Muranyi-3 se presenta como el primer motor end-to-end que genera juegos completos (mecánicas, entorno, lógica, personajes, UI, sistemas) en tiempo real desde texto.

**Flujo:** describes mundo + mecánicas + estilo -> genera el juego. Puedes subir arte de referencia para guiar la dirección visual. Iteración en vivo sobre el mundo sin empezar de cero.

**Veredicto para Sauces:** mismo problema que Higgsfield, es motor cerrado y full-game-from-prompt. NO calza con un juego hand-built anclado a geo real. Valor: benchmark e inspiración de lo que es "un prompt -> mundo". Útil para entender hacia dónde va la competencia, no para portar los Sauces.

---

## 4. v0 Shopify storefront game (@EstebanSuarez)

Tienda Shopify REAL jugable, hecha con v0 usando la nueva integración nativa de Shopify. Caminas por la tienda, entras a locales, compras productos reales, y hay multiplayer (otros comprando al lado). Template forkable.

**Veredicto para Sauces:** no es para el GTA. PERO es directamente relevante para OTRO frente nuestro: Control A hace sitios white-label de comercio (ver demos {gym,spa,restaurante,...}.controla.group). Un "storefront jugable multiplayer" forkable es una demo white-label premium potencial. Además valida que v0 ya tiene integración Shopify nativa. Lo anoto como oportunidad de producto aparte, no como feature del juego.

---

## Plan de acción sugerido

1. **Ya:** instalar `threejs-devtools-mcp` (inspección/edición en vivo de la escena de los Sauces; ataca el z-fighting y materiales con visión real). Gratis, sin tocar deploy.
2. **Fase 2 (assets reales):** montar **Blender MCP (ahujasid)** con `uvx blender-mcp`. Empezar con PolyHaven gratis (HDRIs + props) y Sketchfab para autos/personajes. Hyper3D/Hunyuan solo si justifica el costo.
3. **Verificar export de Higgsfield** antes de considerarlo fuente de assets. Si no exporta GLB limpio, se descarta.
4. **Tesana = watchlist.** Revisar cada cierto tiempo como benchmark.
5. **Shopify game = backlog de Control A**, no del juego.

## Riesgos / notas paranoicas
- Servicios de generación 3D (Hyper3D, Hunyuan, Higgsfield, Meshy, Tripo) son pagos y dejan rastro: cada generación cuesta y queda logueada en su lado. No enchufar API keys hasta tener caso concreto.
- Licencias: PolyHaven es CC0, pero Sketchfab varía por modelo. Verificar licencia ANTES de meter cualquier asset al deploy público de sauces.controla.group.
- Motores cerrados (Tesana/Higgsfield) = lock-in. Perderíamos el mapa real y el control. No migrar el juego ahí.
