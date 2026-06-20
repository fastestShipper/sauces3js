# Sauces Neighborhood MMO Roadmap

**Goal:** Turn Los Sauces into a stable, beautiful, nostalgia-driven RPG/MMO-lite without implementing community claims before the foundation can support them.

**Product rule for future housing:**
- One active house claim per user.
- A user can only claim a house that is not already taken.
- A taken house can be disputed.
- If multiple people credibly lived in the same house, a resolved dispute can turn into collaboration with multiple co-residents.
- Disputes and collaboration are not MVP foundation work. They come after map, gameplay, account, parcel, and moderation gates.

---

## Phase 0: Map and world foundation

**Purpose:** Make the map trustworthy before attaching social memory to it.

**Deliverables:**
- OSM-only city remains default.
- `City()` default building count remains 312.
- `tools/fetch_zone.py` preserves OSM ids, address fields, building type, levels, and centroid data.
- World visuals stay fast and clean.
- Minimap and world geometry align.
- No hand-edited `zone.json`.

**Quality gate:**
- `node scripts/audit_building_count.mjs` passes.
- Desktop target: 60 FPS average, 45 FPS minimum.
- Mobile target: 30 FPS average, 20 FPS minimum.
- Browser console has 0 errors.
- 10-minute walk test has no visible memory leak, z-fighting explosion, or major pop-in.

**Do not build yet:**
- Claims.
- Notes.
- Disputes.
- User-generated text.
- House interiors.

---

## Phase 1: Core gameplay and multiplayer stability

**Purpose:** Make walking, exploring, chat, accounts, reconnect, and basic RPG loop reliable.

**Deliverables:**
- Stable movement and collision against buildings, streets, and parks.
- Guest exploration remains smooth.
- Account login/register works without blocking exploration.
- WebSocket reconnect does not duplicate players or lose state unexpectedly.
- Basic chat is stable.
- RPG systems remain optional and do not hide the map experience.

**Quality gate:**
- 30-minute session with at least 2 clients.
- Guest flow, login flow, reconnect flow pass.
- No console errors.
- No severe desync or ghost players.
- Smoke test covers loading, guest entry, movement, chat, reconnect.

**Do not build yet:**
- Claims UI.
- Note markers.
- Social economy.
- Persistent UGC.

---

## Phase 2: Backend hardening and test harness

**Purpose:** Stop JSON persistence from becoming a trap before adding claims and notes.

**Deliverables:**
- Server store shape versioned.
- Atomic persistence preserved, but with instrumentation for flush time.
- Consider SQLite before public UGC if JSON grows too large.
- Playwright smoke suite for browser flows.
- WS stress script for login, movement, chat, reconnect.
- `/health` or equivalent operational check if deployment allows it.

**Quality gate:**
- Store writes do not block the event loop above acceptable threshold.
- Smoke suite passes locally and against production.
- Server restart preserves accounts correctly.
- 50 reconnect cycles do not duplicate entities.

**Do not build yet:**
- Claims, unless backend store gate passes.
- Reactions and reports.
- Dispute system.

---

## Phase 3: Parcel and address layer

**Purpose:** Create stable anchors for houses and notes without adding social claims yet.

**Deliverables:**
- `assets/parcels.json` generated from `zone.json`.
- Stable `parcelId` per building:
  - preferred: `osm:way:<id>`
  - fallback: stable footprint hash
- Fields:
  - `parcelId`
  - `osmId`
  - `buildingIndex`
  - `center`
  - `street`
  - `number`
  - `displayAddress`
  - `buildingType`
  - `claimable`
  - `confidence`
- `src/parcels.js` loads and indexes parcels.
- In-game debug or minimal HUD can show nearest parcel.

**Quality gate:**
- `node scripts/audit_parcels.mjs` passes.
- Parcel count matches buildings or expected filtered count.
- At least 20 sample parcels manually verified in browser.
- Regenerating `zone.json` does not silently break parcel ids.

**Do not build yet:**
- Claim creation.
- Disputes.
- Notes.

---

## Phase 4: Public POI and nostalgia layer

**Purpose:** Add identity before ownership. The world should feel like Los Sauces before users claim houses.

**Deliverables:**
- `assets/pois-local.json` or equivalent curated POI file.
- Bodegas, parks, schools, corners, paraderos, streets, and landmarks with short safe descriptions.
- POI signs in the world.
- Basic interactions: read place description, see nearby street or landmark.
- No user-generated content yet.

**Quality gate:**
- At least 10 real POIs visible or interactable.
- A resident or local user can recognize the zone better than before.
- No privacy-sensitive labels.
- Console 0 errors.

**Do not build yet:**
- User claims.
- Notes by players.
- Free text.

---

## Phase 5: Symbolic house claims MVP

**Purpose:** Add the first version of ownership only after map, gameplay, backend, and parcel anchors are stable.

**Rules:**
- One active claim per account.
- A claim can only be created on a `claimable` parcel.
- If parcel is unclaimed, claim succeeds.
- If parcel is claimed, claim is rejected in MVP.
- Release or admin reset must exist before public testing.

**Deliverables:**
- Server messages:
  - `claims_req`
  - `claim_create`
  - optional `claim_release`
- Store fields:
  - `claims`
  - `claimByAccount`
  - `claimByParcel`
- Client UI near parcel:
  - `H Casa simbólica`
  - display address or symbolic label
  - claim preview
- World plaque marker.

**Quality gate:**
- Account A claims one house.
- Account A cannot claim a second house.
- Account B cannot claim Account A's house.
- Claim persists after server restart.
- Guest can see plaque but cannot claim.
- No console errors.

**Do not build yet:**
- Disputes.
- Collaboration.
- Notes.
- House editing.

---

## Phase 6: Disputes and co-resident resolution

**Purpose:** Support real-life ambiguity without chaos.

**Rules:**
- A dispute does not grant ownership.
- A user with one active claim can dispute their childhood home only if product decides dispute does not count as a second claim.
- Resolution outcomes:
  - reject dispute
  - transfer claim
  - add co-resident collaborator
  - mark house as community memory
- Multiple credible users can become collaborators after resolution.

**Deliverables:**
- Claim states:
  - `claimed`
  - `disputed`
  - `resolved`
  - `community`
- `disputes` store.
- Admin or mutual-resolution flow.
- Audit trail: who disputed, when, parcelId, outcome.
- Collaboration list on claim.

**Quality gate:**
- Dispute cannot bypass one-house rule.
- Duplicate disputes rate-limited.
- Resolution is persisted.
- Collaborators display correctly.
- Privacy-safe language only.

**Do not build yet:**
- Public free-form evidence.
- Uploaded documents.
- Exact personal data.

---

## Phase 7: Neighborhood notes, Elden Ring style

**Purpose:** Add asynchronous community memory after parcel and moderation foundations exist.

**Deliverables:**
- Notes anchored to coordinate, POI, or parcel.
- Guests can read.
- Accounts can create with safe templates.
- Reactions:
  - useful
  - nostalgic
  - funny later
- Reports:
  - privacy
  - insult
  - spam
- Distance culling and max visible markers.

**Quality gate:**
- Max 24 visible note markers.
- Server rate limit active.
- No free text in MVP.
- Report threshold hides note from public requests.
- Notes survive restart.
- No FPS regression.

---

## Phase 8: Gameplay loops around the barrio

**Purpose:** Turn the social layer into an RPG loop.

**Deliverables:**
- POI missions.
- Reputation by street or block.
- Rewards for community contributions.
- Bodega vendors.
- Small events in parks.
- Memory album.

**Quality gate:**
- At least 5 POI missions.
- Rewards do not break economy.
- Players have a reason to revisit houses and notes.
- No grind-only loop.

---

## Hard rules to avoid rollback

- Do not implement social UGC before stable parcel ids.
- Do not implement claims before backend persistence and smoke tests.
- Do not implement disputes before single-claim MVP is proven.
- Do not implement free text before moderation tools exist.
- Do not add house interiors before claims and notes prove retention.
- Do not use building array index as identity.
- Do not make `zone.json` hand-edited truth.
- Do not increase visual density by lying with fake buildings.
- Do not add features that reduce first playable speed.

---

## Recommended execution slices

1. **Stabilize foundation:** map, gameplay, backend smoke tests.
2. **Spatial truth:** OSM ids, parcels, address confidence.
3. **World identity:** curated POIs and signs.
4. **Ownership MVP:** one claim per user, one user per free parcel.
5. **Disputes:** taken house dispute, resolution, co-residents.
6. **Notes:** Elden Ring style memories and tips.
7. **RPG loops:** missions, reputation, events, economy.

This order prevents the expensive mistake: attaching community data to unstable geometry, then having to migrate or delete people's emotional contributions later.
