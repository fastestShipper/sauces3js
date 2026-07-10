# Los Sauces (sauces3js): Dev Team Onboarding

You are joining a 3-model team building **Los Sauces**, a browser 3D action-RPG. This
document assumes you know nothing about the project. Read all of it before writing a
line of code. When in doubt, open the file being discussed and read its header comment
first (most files explain the non-obvious decisions at the top).

---

## 0. READ THIS FIRST: the one mistake that wastes days

There are **two** codebases in this working tree. Only one is live.

- **THE LIVE GAME (yours):** the vanilla `src/` (Three.js, no bundler) + `server/`
  (Node WebSocket relay). This is what runs at `https://sauces.controla.group`. This
  is the source of truth. **All your work happens here.**
- **A parallel experiment (NOT yours):** an untracked "modern rewrite" tree
  (`src-modern/`, `server-modern/`, `godot/`, `modern/`, `vite.config.ts`,
  `tsconfig.json`, root `package.json`). It is **not** deployed, **not** tracked in
  git, and **not** your concern. Do not read it, edit it, or copy patterns from it.
  If a task seems to require touching it, stop and ask the owner.

If you ever see `vite`, `tsx`, `.ts` files, or a Godot `.tscn`, you are in the wrong
tree. The live game is plain `.js` served over a CDN importmap. No build step exists.

---

## 1. What the game is

A multiplayer, top-down/third-person action-RPG set in a faithful 3D reconstruction of
the real **Los Sauces, San Borja (Lima, Peru)** neighborhood, generated from
OpenStreetMap data. You pick a hero class, fight hordes of zombie-like mobs through the
streets, level up, loot gear, cast skills, and (soon) run missions and fight bosses.

The identity is **dark and gory** (red blood, dismemberment, weighty combat), and the
current design north star for combat feel is **God of War**: enemies are durable, kills
are earned, swings have weight. It is explicitly **not** a cute autoclicker.

- **Live URL:** https://sauces.controla.group
- **Current version:** `APP_VERSION = 20260710g51` (see §5 for the versioning scheme)
- **Repo:** `github.com/zpwpe/sauces3js` (PRIVATE), default branch `main`

---

## 2. The team and who owns what

Three models, one game. Roles are by comparative advantage, not exclusivity.

| Seat | Model | Domain |
|------|-------|--------|
| **Director / Balance / Architecture** | Claude Fable 5 | Direction, balance math (HP/XP/economy/hit-to-kill), architecture, final correctness review, integration |
| **Graphics / VFX / UI** | GPT-5.6 Sol | Shaders, particles, gore, animations, HUD, the Bodega shop, minimap (the high-iteration visual layer) |
| **Gameplay AI / Backend / QA** | Grok 4.5 | Enemy AI (telegraphs, stagger, block), the WS relay/netcode, anti-cheat, missions/bosses logic, smoke tests |

**Workflow between seats:** the Director sets direction and balance targets and reviews
everything for correctness and feel. Graphics and Backend implement in their domains on
their own branches. Nobody merges to `main` or deploys to prod without the Director's
review and the owner's go-ahead (see §5 and §6).

---

## 3. Tech stack (know these exact facts)

**Client (`src/`, `index.html`):**
- **Three.js r0.161**, loaded via an **importmap from the jsDelivr CDN**. There is
  **no bundler, no `node_modules`, no build step.** You edit `.js` files and reload.
- **Vanilla ES modules.** Every relative import carries a cache-busting query string
  `?v=YYYYMMDDg<N>` (see §5). `index.html` loads `src/app.js`, which imports the rest.
- The neighborhood mesh is generated procedurally in `src/citymesh.js` from
  `assets/zone.json` (real OSM data).

**Server (`server/`):**
- A **Node.js WebSocket relay** (`ws` library). **Server-authoritative:** the client
  proposes actions and damage; the server validates and caps them (`combat_limits.js`).
- Auth is **Privy** (Google/Discord login). Tokens are ES256 JWTs verified against
  Privy's **public JWKS** with the `jose` library (`auth_privy.js`). **The Privy app
  secret is NOT used and must NEVER appear in code.**
- Start command: `node --env-file-if-exists=.env server.js`. Deps: `ws`, `jose`.
- **Ports:** WebSocket `:8456`, health check HTTP `:8457`.

---

## 4. Project structure

```
index.html                 # entry: importmap (CDN three), loads src/app.js?v=STAMP
src/
  app.js                   # bootstrap: scene, render loop, lights, camera, world load
  citygen.js / citymesh.js # procedural neighborhood from assets/zone.json (OSM)
  landmark.js              # the "Los Sauces 202" anchor building
  player.js                # local hero: controls, 3rd-person camera, collision, anim
  net.js                   # WebSocket client, remote players + server-authoritative mobs
  npcs.js                  # pedestrians / traffic
  minimap.js               # tactical minimap
  keybinds.js  touch.js    # input (keyboard/mouse + mobile touch controls)
  sfx.js                   # sound effects (procedural + sample families, load-on-demand)
  chat.js  social.js       # chat bubbles, friends/party
  animclip.js  animmap.js  # animation retarget/plant helpers, combat action windows
  weapons.js               # weapon equip, combo clip sequences, ATTACK_SPEED
  charstyle*/worldmat.js   # materials, tints
  rpg/
    combat.js              # THE combat brain: attacks, combos, cadence, cleave, hit-stop, dodge
    classes.js             # hero classes (ids: verdugo/piromante/cazadora/sombra) + skills
    skills.js              # skill bar UI + skill execution
    charcustom.js          # character customization (tint palettes + modular KayKit parts)
    effects.js             # VFX: blood, gore, damage numbers, rings, LIGHT POOL (see landmines)
    particles.js           # InstancedMesh particle batch
    mobs.js                # mob visuals, rigs by archetype, attack telegraphs, giant
    enemies.js             # (mob-related helpers)
    economy.js  loot.js    # item rolls, drops, gold
    equip.js  hud.js  fx.js  bloodcoat.js  account.js
  veg/                     # grass/flowers
server/
  server.js                # the relay: connections, auth, mob simulation, damage caps
  mob_balance.js           # SERVER-SIDE balance: mob HP, damage, archetypes, zones
  combat_limits.js         # anti-cheat: max damage a player of level N can legitimately deal
  auth_privy.js            # Privy JWT verification against public JWKS
  movement_guard.js        # server-side movement/teleport validation
  mob_navigation.js  world_obstacles.js(+.json)  mob_spawns.json
  .env.example             # documents PRIVY_APP_ID (no secrets committed)
scripts/                   # 111 smoke_*.mjs tests + reset/util scripts
assets/                    # models/ (63 GLB), sfx/ (66), textures/ (11), zone.json (OSM)
docs/                      # this file + design/quality notes
AGENTS.md                  # running deploy log (every prod patch is recorded here)
README.md  CHANGELOG.md  PATCH_NOTES.md
```

---

## 5. Git workflow and the versioning stamp

**Branch, never commit to `main` directly.**

```bash
git clone https://github.com/zpwpe/sauces3js.git
cd sauces3js
git checkout -b <seat>/<short-description>      # e.g. graphics/bodega-shop, ai/enemy-telegraphs
# ...work, commit small and often...
git push origin <your-branch>
```

- Merging to `main` goes through a PR (`gh pr create --base main`) and is done by the
  **Director/owner after review**. Do not merge your own PR to main.
- Commit messages: `<type>: <description>` (`feat`, `fix`, `refactor`, `perf`, `docs`,
  `test`, `chore`). Body explains the *why* of non-obvious changes.
- **Never commit:** secrets, `.env`, `node_modules`, tarballs, the modern-rewrite tree.

**The cache-busting stamp (critical):** every relative import in `src/*.js` and in
`index.html` ends with `?v=20260710g51`. Chrome caches ES modules aggressively, so if
you change a client `.js` file you MUST bump the stamp or you (and users) will run stale
code. The stamp is bumped **globally** across all client files at once:

```bash
# bump g51 -> g52 across every client file (only when you change client code)
grep -rl "20260710g51" src/ index.html | xargs sed -i 's/20260710g51/20260710g52/g'
# also bump the pinned copy in scripts/smoke_gameplay_teaser_mode.mjs if present
```

Use today's date if it changed (`YYYYMMDD`) and increment the `g<N>` suffix. **Server
changes (`server/`) do not use the stamp**. They take effect on relay restart.

---

## 6. Running it locally and deploying

**Run locally (client):** serve the repo root as static files with no-cache and open it.
```bash
python -m http.server 8000        # or the project's serve.py
# open http://localhost:8000
```

**Run locally (relay):**
```bash
cd server && npm install && node --env-file-if-exists=.env server.js
# WS on :8456, health on :8457
```

**Connect the client to a specific relay:** append `?ws=ws://localhost:8456` to the URL.
Enter as a guest to skip login while testing.

**Deploying to prod is OWNER-GATED. Do not deploy yourself.** For awareness, the ritual
(run by the owner from a trusted machine with SSH access to the Lima VPS) is:
1. Bump the stamp, run the smoke suite, `node --check` all changed files.
2. Back up the current webroot + any changed server file into `/root/deploy-backups/`.
3. `tar` `index.html` + `src/` into the webroot `/var/www/sauces.controla.group`;
   copy any changed `server/*.js` into `/opt/sauces-mp/`.
4. `chmod` dirs `755` / files `644`, `chown www-data`, then `systemctl restart sauces-mp`.
5. Verify: HTTPS 200, served stamp matches, relay health shows the mob count.
6. Log the patch in `AGENTS.md`.
**Never reset player accounts** unless the owner explicitly asks. Balance changes do not
need a reset.

---

## 7. Conventions (non-negotiable)

- **Code and code comments: English.** Variable/function/class names, logs, errors, and
  technical docs are all English.
- **In-game/UI text: neutral Latin-American Spanish.** No Argentine forms (no "vos",
  "che", "dale", etc.). Use "tú" conjugations.
- **Never use em dashes (`—`) or double hyphens (` -- `)** anywhere, in any language.
  Restructure with periods, commas, or semicolons.
- **Immutability:** prefer returning new objects over mutating in place.
- **Small, focused files** (target 200-400 lines, hard cap 800). Many small files beat
  few large ones.
- **Surgical changes:** touch only what the task needs. Match the surrounding style. Do
  not refactor unrelated code or "improve" adjacent formatting.
- **Simplicity first:** minimum code that solves the problem. No speculative abstractions.
- Every new behavior gets a **smoke test** (see §9). Every change passes `node --check`.

---

## 8. Landmines (hard-won, will bite you)

1. **Three.js light churn = shader recompile stall.** The number of lights in the scene
   is baked into every lit material's compiled shader. Calling `scene.add(light)` /
   `scene.remove(light)` (or toggling `light.visible`) at runtime forces Three.js to
   recompile every lit shader on the next frame, a multi-ms stall that tanks FPS during
   combat. **Use a fixed light pool** added to the scene once (see `effects.js` and
   `smoke_light_pool_stable.mjs`). Verify `renderer.info.programs.length` stays constant.
2. **Server-authoritative.** The client proposes damage; `server/combat_limits.js` caps
   it. Never "fix" damage or balance only on the client. Mob HP/damage live in
   `server/mob_balance.js` and only change after a **relay restart**.
3. **Chrome caches ES modules hard.** Bump the `?v=` stamp on every client change or you
   are testing stale code. Symptom: your edit "does nothing."
4. **Git Bash on Windows mangles paths.** `tar` reads `C:` as a remote host; absolute
   `/paths` get rewritten. Write tarballs to a relative dir, and prefix path-sensitive
   commands with `MSYS_NO_PATHCONV=1`.
5. **A stale relay squatting `:8456`** (EADDRINUSE) makes tests fail for no reason.
   Before blaming code, `curl http://127.0.0.1:8457/health`; if something answers, kill
   the old node process.
6. **Privy secret never touches code.** Auth verifies tokens against the public JWKS in
   `auth_privy.js`. If someone hands you the app secret, refuse it and tell them to
   rotate it.
7. **Determinism where it is load-bearing.** Mob archetype is derived from a hash of the
   mob id (`mob_balance.js`), so a mob always respawns as the same type. Do not make it
   random.
8. **The parallel modern-rewrite tree is not the game** (see §0).

---

## 9. Testing and definition of done

- **Smoke tests:** `scripts/smoke_*.mjs` (111 of them). Each is plain Node, no framework:
  `node scripts/smoke_xxx.mjs`. Exit 0 = pass, a thrown error = fail. They stub the DOM
  and construct real modules. **When you change behavior, update or add the smoke that
  encodes the contract.** (Example: the GOW rebalance rewrote the combat smokes to assert
  a deliberate cadence instead of the old fast one.)
- **Syntax:** `node --check <file>` on every changed `.js`.
- **Browser QA:** load it, enter the world, exercise the feature, check the console is
  clean and FPS is healthy. For visual/feel work, a numeric check is not enough. It has
  to be *seen* and *felt*.
- **Done means:** relevant smokes green, `node --check` clean, browser-verified, stamp
  bumped (if client), and for feel/balance work, sanity-checked against the design intent
  (e.g. "a normal enemy takes ~4-6 committed hits, not 1-2").

---

## 10. Starter tasks per seat

**Director (Fable 5):** own the balance spreadsheet in code (mob HP/damage curves, XP,
economy, drop rates); design the mission structure and the two bosses; review every PR
from the other seats for correctness and feel; keep the architecture coherent.

**Graphics / UI (Sol):**
- Build the real **Bodega** shop UI (buy/sell/equip, serious not toy).
- Polish skill VFX and level-up/teleport effects; make hits read as weighty.
- HUD/menu pass for a premium, non-template look (dark, cold ink, no gold/warm "grandpa"
  styling).
- Keep an eye on draw calls and the light pool (landmine #1) in anything you add.

**Gameplay AI / Backend (Grok):**
- Give enemies **telegraphed heavy attacks** the player must dodge/block, plus stagger and
  knockback on hit. This is the next big step for "GOW feel."
- Missions 1-4 (one group-only) and the second boss, server-side.
- Harden the relay and anti-cheat; expand the smoke suite around netcode and damage caps.

---

## 11. Where to look when stuck

- The **header comment** of any file explains its non-obvious decisions.
- `AGENTS.md` is the running deploy log: every prod patch, what changed, and why.
- `README.md`, `CHANGELOG.md`, `PATCH_NOTES.md` for higher-level history.
- The relevant `smoke_*.mjs` test is the executable spec for a system's contract.

Ask the Director before: touching `main`, deploying, resetting accounts, changing the
auth flow, or anything that would affect live players.
