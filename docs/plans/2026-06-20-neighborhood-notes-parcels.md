# Neighborhood Notes and Symbolic Homes Implementation Plan

> For Hermes: Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build an Elden Ring inspired asynchronous note system plus parcel/home anchors so players can leave memories, tips, and symbolic home claims in the real Los Sauces map.

**Architecture:** Keep the current no-bundler Three.js client and tiny WebSocket relay. Add stable parcel data generated from OSM into `assets/parcels.json`, extend the relay store with notes, reactions, reports, and claims, then render nearby approved notes as lightweight instanced world markers. Guest players can read notes; authenticated accounts can create, react, report, and claim symbolic homes.

**Tech Stack:** Three.js 0.161 via importmap, vanilla JS modules, Node `ws` relay, JSON file persistence with atomic flush for MVP.

**Non-goals:** No character work, no free-form unmoderated text in MVP, no public repo, no bundler, no database migration in MVP.

---

## Team Assignments

- **Maestro:** Own integration, commit order, deploy, production verification.
- **Arch:** Own OSM parcel extraction, address confidence, claimable rules, POI anchoring.
- **Spark:** Own player interaction UX: create/read note, nearby prompts, keyboard flow.
- **Mesh:** Own marker rendering, batching, distance culling, performance budget.
- **Poly:** Own visual language for notes, plaques, stickers, chalk marks, signs. Use procedural assets first.
- **Crash:** Own QA matrix: guest, logged-in user, moderation/reporting, reconnect, production smoke.
- **Wave, later:** Ambient audio and discovery sound cues, not MVP.
- **Brick:** No UE5 work for MVP.

---

## Data Model

### `assets/parcels.json`

Generated from `assets/zone.json` plus OSM metadata.

```json
{
  "worldId": "los_sauces",
  "version": "20260620n1",
  "parcels": [
    {
      "parcelId": "osm:way:123456789",
      "osmId": 123456789,
      "buildingIndex": 42,
      "center": { "x": -12.4, "z": 55.8 },
      "street": "Jirón Los Sauces",
      "number": "202",
      "displayAddress": "Los Sauces 202",
      "buildingType": "residential",
      "claimable": true,
      "confidence": "osm"
    }
  ]
}
```

### Relay store extension in `server/accounts.json`

```json
{
  "accounts": {},
  "tokens": {},
  "notes": {},
  "noteReactions": {},
  "noteReports": {},
  "claims": {}
}
```

### Public note payload

```json
{
  "noteId": "note_ab12",
  "worldId": "los_sauces",
  "x": -42.2,
  "z": 18.9,
  "anchorType": "parcel",
  "anchorId": "osm:way:123456789",
  "author": "zpw",
  "category": "memory",
  "template": "here_was",
  "tokens": ["bodega"],
  "text": "Aquí había una bodega.",
  "status": "approved",
  "likes": 0,
  "nostalgia": 0,
  "reports": 0,
  "createdAt": 1781950000000
}
```

---

## Message Types

Client to server:

```js
{ t: 'notes_req', x, z, radius }
{ t: 'note_create', x, z, anchorType, anchorId, category, template, tokens }
{ t: 'note_react', noteId, reaction }
{ t: 'note_report', noteId, reason }
{ t: 'claims_req', x, z, radius }
{ t: 'claim_create', parcelId, title, template, tokens }
```

Server to client:

```js
{ t: 'notes', list }
{ t: 'note_add', note }
{ t: 'note_update', noteId, likes, nostalgia, reports }
{ t: 'claims', list }
{ t: 'claim_add', claim }
{ t: 'note_error', error }
```

---

## Safety Rules

- Guests can read only.
- Authenticated users can create notes, react, report, and claim.
- MVP text uses templates and allowlisted tokens only.
- No exact personal data in templates.
- No note can say "vive aquí".
- Use "casa simbólica", "recuerdo", "viví cerca", "esta cuadra".
- Report threshold hides a note locally and marks it `review` server-side.
- Rate limit note creation per account and per IP-ish connection.

---

## Task 1: Preserve stable OSM IDs in zone generation

**Objective:** Ensure each building can become a stable parcel anchor.

**Files:**
- Modify: `tools/fetch_zone.py`
- Modify after regeneration: `assets/zone.json`
- Test: `scripts/audit_parcels.mjs`

**Steps:**
1. In `tools/fetch_zone.py`, when creating each building object, add:
   - `osm`: `el["id"]`
   - `street`: `addr:street` if present
   - `addr`: existing `addr:housenumber`
2. Add node/relation address query support later only if needed. MVP keeps building way addresses.
3. Regenerate `assets/zone.json` only through the script.
4. Run:
   ```bash
   python tools/fetch_zone.py
   node scripts/audit_building_count.mjs
   ```
5. Expected:
   ```txt
   PASS: building count audit
   After City() default: 312
   ```

**Commit:**
```bash
git add tools/fetch_zone.py assets/zone.json scripts/audit_building_count.mjs
git commit -m "feat: preserve OSM building ids for parcels"
```

---

## Task 2: Generate `assets/parcels.json`

**Objective:** Create a stable parcel layer for homes, notes, and future claims.

**Files:**
- Create: `tools/build_parcels.py`
- Create: `assets/parcels.json`
- Create: `scripts/audit_parcels.mjs`

**Implementation:**
- Read `assets/zone.json`.
- For each building, compute centroid.
- Create `parcelId`:
  - preferred: `osm:way:${b.osm}`
  - fallback: `fp:${stableFootprintHash}`
- Determine `claimable`:
  - true for `house`, `residential`, `apartments`, `yes` unless named as public/sensitive
  - false for `school`, `commercial`, `retail`, parks, unknown sensitive names
- `displayAddress`:
  - if street and number: `${street} ${number}`
  - if only number: `Casa ${number}`
  - otherwise: `Casa simbólica cerca de ${nearestRoadName}`
- Add `confidence`: `osm`, `partial`, or `inferred`.

**Verification:**
```bash
python tools/build_parcels.py
node scripts/audit_parcels.mjs
```

Expected:
```txt
PASS: parcels have stable ids
PASS: claimable count > 0
PASS: every parcel has center
```

---

## Task 3: Load parcels in the client

**Objective:** Make parcel data available to gameplay without changing city generation.

**Files:**
- Create: `src/parcels.js`
- Modify: `src/app.js`

**API:**
```js
export class ParcelIndex {
  constructor(data) {}
  nearest(x, z, maxDist = 8) {}
  nearby(x, z, radius = 40) {}
}

export async function loadParcels() {
  const data = await (await fetch('./assets/parcels.json?v=20260620n1')).json();
  return new ParcelIndex(data);
}
```

**Verification:**
- Browser expression after boot:
  ```js
  window.__game.parcels.nearest(window.__game.player.pos.x, window.__game.player.pos.z)
  ```
- Expected: nearest parcel or null, no console errors.

---

## Task 4: Extend server store for notes and claims

**Objective:** Persist approved template notes, reactions, reports, and symbolic home claims.

**Files:**
- Modify: `server/server.js`
- Existing persistence: `server/accounts.json`

**Implementation details:**
- Store shape:
  ```js
  let store = { accounts: {}, tokens: {}, notes: {}, noteReactions: {}, noteReports: {}, claims: {} };
  ```
- On load, preserve missing keys as `{}`.
- On flush, write all store sections except tokens.
- Add validators:
  ```js
  const NOTE_CATEGORIES = new Set(['memory', 'tip', 'warning', 'event']);
  const NOTE_TEMPLATES = new Set(['here_was', 'careful_with', 'memory_near', 'good_place_for', 'look_near']);
  const NOTE_TOKENS = new Set(['bodega', 'parque', 'casa', 'esquina', 'avenida', 'cofre', 'misión', 'perro bravo', 'recuerdo']);
  ```
- Create note text server-side from template and tokens. Do not trust client text.
- Rate limit: max 5 creates per account per 10 minutes.
- `note_create` requires `me.account`.
- `note_react` requires `me.account` and one reaction per note per account.
- `note_report` requires `me.account`.
- `claim_create` requires `me.account`, one active claim per `parcelId` in MVP.

**Verification:**
- Use a local Node script or browser console to send WS messages after login.
- Confirm `server/accounts.json` contains `notes` and `claims`.

---

## Task 5: Client note networking

**Objective:** Add a clean client API for note operations.

**Files:**
- Modify: `src/net.js`
- Create: `src/notes.js`

**Net additions:**
```js
this.onNotes = null;
this.onNoteAdd = null;
this.onNoteUpdate = null;
this.onClaims = null;
this.onClaimAdd = null;

requestNotes(x, z, radius) { this._send({ t: 'notes_req', x, z, radius }); }
createNote(payload) { this._send({ t: 'note_create', ...payload }); }
reactNote(noteId, reaction) { this._send({ t: 'note_react', noteId, reaction }); }
reportNote(noteId, reason) { this._send({ t: 'note_report', noteId, reason }); }
requestClaims(x, z, radius) { this._send({ t: 'claims_req', x, z, radius }); }
createClaim(payload) { this._send({ t: 'claim_create', ...payload }); }
```

**Verification:**
- Browser console confirms `net.requestNotes` exists.
- Server returns `{ t: 'notes', list: [] }` with no errors.

---

## Task 6: Render lightweight world note markers

**Objective:** Show nearby notes as subtle Elden Ring style markers integrated into the barrio.

**Files:**
- Create: `src/notes.js`
- Modify: `src/app.js`
- Optionally modify: `src/props.js`

**Visual:**
- `memory`: small warm glowing paper/sticker on ground or wall-facing billboard.
- `tip`: small chalk mark.
- `warning`: faint red caution mark.
- `event`: small pinned notice.

**Performance rules:**
- Max 24 visible note markers.
- Request notes every 8 seconds or when moving more than 25 meters.
- Distance cull over 80 meters.
- Use shared geometries/materials.

**API:**
```js
export class WorldNotes {
  constructor(scene, camera, net, parcelIndex) {}
  update(dt, playerPos) {}
  openNearest(playerPos) {}
  startCreateAt(playerPos) {}
}
```

**Verification:**
- Create seeded notes in server store.
- Enter world.
- Markers appear.
- No console errors.
- Building count remains 312.

---

## Task 7: Read note UI

**Objective:** Let players read and react to nearby notes without blocking movement permanently.

**Files:**
- Create: `src/noteui.js`
- Modify: `index.html`
- Modify: `src/app.js`

**UX:**
- Prompt near marker: `E Leer recuerdo`.
- Panel shows:
  - category label
  - note text
  - author display
  - reactions: `Útil`, `Nostálgico`, `Reportar`
- Keys:
  - `E`: read nearest note
  - `Escape`: close panel

**Verification:**
- Read note.
- React.
- Server broadcasts `note_update`.
- Panel closes with Escape.

---

## Task 8: Create note UI with templates

**Objective:** Let authenticated players leave safe template notes.

**Files:**
- Modify: `src/noteui.js`
- Modify: `src/app.js`

**UX:**
- Key `N`: open create note panel.
- If guest: show `Crea una cuenta para dejar recuerdos`.
- Step 1: choose category.
- Step 2: choose template.
- Step 3: choose token.
- Preview final text.
- Submit sends `note_create`.

**MVP templates:**
```txt
Aquí había {token}.
Cuidado con {token}.
Recuerdo de infancia cerca de {token}.
Buen lugar para {token}.
Busca cerca de {token}.
```

**Verification:**
- Guest cannot create.
- Logged-in user creates note.
- Note appears without reload.

---

## Task 9: Symbolic home claims MVP

**Objective:** Let a player claim a nearby claimable parcel symbolically.

**Files:**
- Create: `src/claims.js`
- Modify: `src/noteui.js`
- Modify: `src/app.js`
- Modify: `server/server.js`

**UX:**
- Near claimable parcel, show `H Casa simbólica`.
- If guest: prompt account creation.
- Claim panel:
  - selected address or symbolic label
  - title template: `Casa simbólica de @user`, `Recuerdo familiar`, `Viví cerca de esta cuadra`
  - optional safe token phrase, no free text MVP
- Server creates approved claim if parcel unclaimed.

**Visual:**
- Small plaque near parcel center or nearest road-facing edge.
- Text visible only in interaction panel, not as expensive 3D text.

**Verification:**
- Claim created.
- Other clients receive claim.
- Plaque appears.
- Duplicate claim rejected.

---

## Task 10: Moderation and privacy guardrails

**Objective:** Make UGC safe enough for first users.

**Files:**
- Modify: `server/server.js`
- Modify: `src/noteui.js`
- Create: `docs/moderation-neighborhood-notes.md`

**Rules:**
- No free-form personal names in MVP note text.
- Usernames are already bounded by auth regex.
- Reports threshold 3 moves status to `review`.
- `notes_req` returns only `approved` notes.
- God/admin account can later approve/reject. For MVP, report hiding is enough.

**Verification:**
- Report note 3 times with different test users.
- It disappears from `notes_req`.

---

## Task 11: Smoke tests

**Objective:** Prevent breaking map fidelity or UGC basics.

**Files:**
- Create: `scripts/audit_notes_store.mjs`
- Modify: `scripts/audit_building_count.mjs` only if needed

**Checks:**
```txt
zone default buildings = 312
parcels exist and have stable IDs
note templates are server-side
no approved note has unsafe free text
claims have parcelId and author
```

**Commands:**
```bash
node scripts/audit_building_count.mjs
node scripts/audit_parcels.mjs
node scripts/audit_notes_store.mjs
```

---

## Task 12: Local integration test

**Objective:** Verify the full loop before deploy.

**Commands:**
```bash
cd server && node server.js
python -m http.server 8877
```

Open:
```txt
http://127.0.0.1:8877/?ws=ws://127.0.0.1:8456
```

Manual checks:
- Register test user.
- Enter guest: can read notes, cannot create.
- Enter logged in: can create note.
- Press `E`: read note.
- React to note.
- Report note.
- Press `H`: claim nearby parcel if claimable.
- Refresh: note and claim persist.
- Console has 0 errors.
- `window.__game.city.data.buildings.length === 312`.

---

## Task 13: Deploy and production verification

**Objective:** Ship safely.

**Commands:**
```bash
git status --short
node scripts/audit_building_count.mjs
node scripts/audit_parcels.mjs
node scripts/audit_notes_store.mjs
git add -A
git commit -m "feat: add neighborhood notes and symbolic home claims"
git push origin main
scp -P 2222 -i ~/.ssh/your_key -r index.html src assets scripts server CHANGELOG.md docs YOUR_HOST:/var/www/sauces.controla.group/
```

Production checks:
```bash
curl -sI https://sauces.controla.group/
```

Browser checks:
```js
window.__SAUCES_BUILD__
window.__game.city.data.buildings.length
```

Expected:
```txt
HTTP 200
build version updated
building count 312
console 0 errors
note creation works for account
claim creation works for account
```

---

## Delivery Slice Recommendation

Ship this in 3 PR-sized chunks:

1. **Parcel foundation:** OSM IDs, `parcels.json`, client ParcelIndex, audits.
2. **Neighborhood notes:** server notes, client markers, read/create/react/report UI.
3. **Symbolic claims:** server claims, parcel claim UI, plaques, moderation doc.

Do not bundle all of it into one monster commit. The bugs hide in the seams. Paranoia is correct here.
