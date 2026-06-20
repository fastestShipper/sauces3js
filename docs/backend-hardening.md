# Backend hardening (Phase 2 foundation)

## Current architecture

- **Relay:** `server/server.js` — WebSocket on `127.0.0.1:8456` (nginx proxies `wss://sauces.controla.group/ws`).
- **Persistence:** `server/accounts.json` — atomic write via `.tmp` + rename, debounced flush every 2s.
- **Secrets:** Password salts and scrypt hashes only; tokens stay in memory.

## Store schema (v1)

On flush, the file includes:

```json
{
  "schemaVersion": 1,
  "accounts": { },
  "tokens": {}
}
```

- **`schemaVersion`:** Integer; bump when adding persisted domains (notes, claims, etc.).
- **Unknown top-level keys** loaded from disk are kept in `storeExtra` and written back on flush so future fields can be added without a big-bang migration.
- **`tokens`:** Always emptied on disk (legacy files may still contain `{}`).

## Instrumentation

- **`lastFlushMs`:** Duration of last successful flush (exposed on `/health`).
- **Slow flush:** Logs a warning when flush duration ≥ `STORE_FLUSH_WARN_MS` (default 50 ms).
- **`STORE_LOG_FLUSH=1`:** Log every flush duration.

## Health endpoint

- **URL:** `http://127.0.0.1:8457/health` (override with `SAUCES_HEALTH_PORT`).
- **Not proxied** by default on production nginx; use on the VPS via SSH tunnel or local ops.
- **Payload:** `{ ok, service, schemaVersion, clients, mobs, lastFlushMs, dirty }`.

## Audits

```bash
node scripts/audit_server_store.mjs
```

Validates account object shape; never prints `salt` or `hash`. Tolerates missing `notes` / `claims`.

## SQLite migration (deferred)

Stay on JSON until:

- Store size or flush time routinely exceeds comfortable bounds (watch slow-flush warnings).
- Phase 5+ needs queryable claims/notes with reports.

Suggested path when needed:

1. Introduce `server/store.sqlite` with migrations table.
2. One-shot import from `accounts.json`.
3. Dual-write period, then cut over flush to SQLite only.
4. Keep `schemaVersion` in a `meta` table.

No migration code ships in the foundation slice; this document is the decision record.

## Risks not addressed in foundation

- Single-file JSON still blocks the event loop on large `JSON.stringify` (mitigation: size cap + SQLite later).
- No rate limits on register/login (future).
- WS stress / 50-reconnect script (future `scripts/ws_stress.mjs`).