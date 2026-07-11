# Director Combat and Mission Contract

## Combat balance anchors

Balance is measured against expected same-level gear, not the theoretical maximum weapon.

| Encounter | Committed-hit target | Purpose |
|---|---:|---|
| Starter fodder | 1 | Teach targeting without early punishment |
| Rastrera | 3 to 4 | Fast pressure target that rewards quick priority |
| Caminante | 5 | Baseline earned kill |
| Cultista | 3 to 4 | Fragile ranged priority target |
| Saqueador | 7 to 8 | Durable dodge-check enemy |
| Guardian boss | 30 to 34 | Solo-capable first boss with learned mechanics |
| Abomination boss | 42 to 48 party hits | Group damage and coordination check |

The server remains authoritative for mob HP, mob damage, accepted hit size and mission completion. Client timing and VFX may improve feel but cannot change outcome rules.

## Mission sequence

### Mission 1: Ruido en el parque

- Goal: defeat 6 starter mobs near Ojeda.
- Teaches: committed basic attacks, target selection and healing.
- Completion authority: server kill credit within the mission zone.
- Reward: enough XP for clear progress, one potion stack and no guaranteed weapon.

### Mission 2: El patio no responde

- Goal: defeat 3 cultists and interrupt or dodge 2 completed casts.
- Teaches: threat priority and readable telegraphs.
- Completion authority: server records cultist kills and valid dodge or interrupt events.
- Reward: gold that moves the player materially toward one Bodega weapon.

### Mission 3: Guardián de la gruta

- Goal: defeat the existing giant Guardian after clearing 4 nearby protectors.
- Teaches: boss phases, heavy dodge timing and add control.
- Completion authority: server encounter instance with protector gate and boss kill credit.
- Reward: one class-relevant uncommon weapon roll plus boss XP.

### Mission 4: La noche de Los Sauces

- Group-only requirement: 2 to 4 authenticated party members present at encounter start.
- Goal: survive two deterministic waves, then defeat the Abomination.
- Teaches: role spacing, revive pressure, shared target priority and coordinated burst.
- Completion authority: server locks the eligible party roster at start and rejects late reward joins.
- Reward: one weekly boss chest per account, gold, XP and a small epic chance.

## Boss contracts

### Boss 1: Guardian

- Phase 1: slow three-hit chain, frontal heavy slam and a long punish window.
- Phase 2 at 60 percent HP: deterministic protector pair, wider slam, shorter recovery.
- Phase 3 at 25 percent HP: one enrage cycle, no random move selection.
- Anti-cheese: leash reset restores encounter state and HP.

### Boss 2: Abomination

- Phase 1: cleave, marked charge and ground rupture.
- Phase 2 at 70 percent HP: alternating safe lanes and two cultist supports.
- Phase 3 at 35 percent HP: party marks require players to separate before detonation.
- Determinism: phase sequence derives from encounter id and phase counter, never `Math.random()`.
- Anti-cheese: server validates party roster, arena bounds, damage caps and reward eligibility.

## Relay hardening gates before Mission 4 ships

1. Server-owned mission state per account and encounter.
2. Idempotent reward claim keys.
3. Party roster snapshot at encounter start.
4. Per-source hit cadence validation in addition to damage ceilings.
5. Server distance and line-of-sight validation for boss hits.
6. Disconnect grace with a bounded reconnect window.
7. Structured encounter logs without tokens, cookies or private configuration.
