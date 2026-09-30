# AUTO SALE — YDB/state/outbox audit and zero-downtime normalization plan

## Implementation status — 2026-09-30

### Phase 6 — COMPLETE

Compatibility retirement is implemented and verified on Yandex staging.

Completed:
- browser whole-state persistence has been physically removed from the active bootstrap path;
- `?legacyAutosync`, `__AUTO_SALE_FLUSH__` and browser `PUT /api/auto-sale/state` are gone;
- server `PUT /api/auto-sale/state` is retired by default and returns `410 legacy_state_write_retired`;
- `AUTO_SALE_LEGACY_STATE_WRITE=false`, `AUTO_SALE_YDB_DUAL_WRITE=false`, `AUTO_SALE_YDB_READ_MODE=normalized`;
- normalized domain rows are authoritative for runtime reads and entity commands;
- entity mutations write normalized rows + notification outbox transactionally without updating the compatibility blob;
- the final compatibility blob remains read-only and is archived as a deploy artifact for rollback/audit;
- normalized authoritative reads no longer initialize the legacy state store;
- authoritative YDB reads have bounded retry/timeout handling;
- optimistic entity API and frontend-style entity batches pass live staging gates;
- real manager UI scenario passes: lead creation, edit and status transition persist through entity batches;
- real director UI scenario passes: role switch, overview/pipeline/finance/orders routes and read-only order controls verified;
- UI acceptance emits zero legacy whole-state writes;
- Cloudflare Telegram relay reachability and Yandex runtime Telegram configuration pass diagnostics;
- targeted Telegram delivery uses YDB transactional claim/lease as the concurrency authority and is no longer starved by an in-process notification mutex.

Final acceptance:
- GitHub Actions run `36616444236`: `success`;
- application quality gate: passing;
- Yandex staging deployment: passing;
- normalized authoritative read gate: passing;
- entity API live gate: passing;
- frontend batch live gate: passing;
- legacy whole-state retirement gate: passing;
- frozen legacy snapshot archive: passing;
- manager/director real UI gate: passing;
- full Telegram lifecycle to `@Flyer_Flyer`: passing;
- Telegram lifecycle produced 40 unique delivered messages: 20 client + 20 manager;
- lifecycle completed through `Выдача` with `AUTOWORLD_FULL_LIFECYCLE_OK`;
- temporary QA lead, quote and order cleanup is enforced by the acceptance script and the successful run confirms cleanup completed without assertion failure.

Transient-failure hardening verified:
- lifecycle requests distinguish transient `500/502/503/504/TimeoutError` from business failures;
- ambiguous mutation timeouts reconcile against authoritative normalized state before retrying;
- delivery receipts can be recovered by notification IDs and revision without duplicating business mutations;
- expired `processing` outbox rows are reclaimable through YDB leases;
- targeted notification processing claims IDs directly through YDB instead of waiting on a process-local mutex.

Phase 6 completion criterion is satisfied: one full end-to-end Telegram lifecycle passed on the retired legacy architecture, manager/director UI gates passed, and temporary QA entities were cleaned successfully.

### Phase 5 — COMPLETE

The browser persistence path is now server-primary on Yandex staging.

Frontend persistence:
- initial state includes normalized aggregate `_rowVersions`;
- bootstrap hydrates and maintains lead/quote/order/team/catalog row-version maps;
- ordinary business actions use `POST /api/auto-sale/entities/batch`;
- linked operations are committed atomically, e.g. quote + lead + note and order + payment + lead;
- localStorage is updated only after a successful entity response and acts as UI cache;
- cache writes use `__AUTO_SALE_CACHE_WRITE__` and do not trigger compatibility state sync;
- missing row versions are recovered through a targeted entity GET before mutation;
- stale versions refresh server state and surface an entity conflict to the UI.

Migrated UI paths:
- client/manager lead creation and lead editing;
- client pre-work request editing;
- quote creation, editing, status changes, cloning and client decision;
- order creation and order updates;
- payment append;
- notes/history append;
- catalog create/edit/delete;
- director team create/edit and manager rename propagation;
- Telegram client/staff bindings and manager Telegram cache updates.

Legacy autosave:
- automatic `Storage.prototype.setItem -> PUT /api/auto-sale/state` is disabled by default;
- compatibility autosync can only be opted into with `?legacyAutosync`;
- `__AUTO_SALE_FLUSH__` remains available as an explicit rollback/debug path;
- the compatibility `PUT /api/auto-sale/state` remains on the server during the rollback window.

Entity batch semantics:
- aggregate preconditions use `baseRowVersion`, not global revision;
- notes version the parent lead;
- payments version the parent order;
- unrelated global revision changes are retried internally;
- compound actions validate all affected aggregates and then commit once through the existing serializable YDB transaction.

Final verification:
- quality gate: 227 passed, 0 failed;
- staging deploy: success;
- normalized read source: verified;
- individual entity live test: create 2474 -> patch 2475 -> note 2476 -> stale 2475 rejected -> cleanup 2477;
- Phase 5 frontend-style batch live test: create rowVersion 2478 -> patch 2479 -> stale 2478 rejected with current 2479 -> cleanup revision 2480 -> normalized parity verified;
- full dual-write parity then passed at revisions 2481/2482;
- final canonical legacy hash = normalized hash;
- final counts returned to leads 7, quotes 7, orders 3, payments 8, notes 2, team 3, catalog 149, Telegram bindings 8.

Permanent deploy gates now cover normalized reads, individual entity optimistic locking, frontend-style entity batches and legacy/normalized dual-write parity.

Important rollback/security state:
- legacy compatibility blob is still maintained by dual-write;
- legacy whole-state endpoint is still present but is no longer the default browser persistence path;
- staging is still configured with `AUTO_SALE_PUBLIC_DEMO_WRITE=true`; entity/browser authorization must be hardened before real production use.

Next step: Phase 6 compatibility retirement and authorization hardening. Disable public whole-state writes, introduce real staff/client authorization boundaries, observe zero legacy frontend writes, archive the final compatibility snapshot, then stop dual-writing the blob after the rollback window.

### Phase 4 — COMPLETE

Optimistic entity mutation API is live on Yandex staging.

New API-key protected command surface:
- `GET /api/auto-sale/leads/:id`
- `POST /api/auto-sale/leads`
- `PATCH /api/auto-sale/leads/:id`
- `DELETE /api/auto-sale/leads/:id` when no quote/order dependencies exist
- `POST /api/auto-sale/leads/:id/notes`
- equivalent `GET/POST/PATCH` entity endpoints for quotes, orders, catalog and team
- `POST /api/auto-sale/orders/:id/payments`
- `DELETE /api/auto-sale/catalog/:id`

Concurrency model:
- callers no longer submit the global state revision for entity commands;
- update/delete commands require `baseRowVersion`;
- stale aggregate versions return `409 entity_conflict`;
- unrelated global state writes are retried internally and do not surface as entity conflicts;
- payments advance the parent order `row_version`;
- notes advance the parent lead `row_version`.

Transitional transaction model:
1. entity command reads current compatibility state and aggregate row version;
2. business rules are validated through the existing server rule engine;
3. the compatibility blob is updated;
4. normalized diff updates only affected rows;
5. notification intents are inserted into the outbox;
6. all writes share the existing serializable YDB transaction;
7. the response returns the new aggregate `rowVersion`.

This keeps rollback compatibility while exposing entity-level concurrency semantics before the legacy blob is retired.

Telegram binding hardening:
- `/telegram/link-client` no longer calls global `replaceState` directly;
- `/telegram/register-manager` no longer calls global `replaceState` directly;
- both use the entity command path and aggregate row versions;
- Telegram bindings continue to be mirrored into `auto_sale_telegram_bindings`.

Security:
- Phase 4 entity endpoints are API-key protected even while the legacy demo whole-state endpoint remains public-demo;
- public frontend migration/auth is intentionally deferred to Phase 5.

Final verification:
- quality gate: 220 passed, 0 failed;
- normalized reads remain enabled;
- live entity create: rowVersion 2468;
- live entity patch: rowVersion 2469;
- stale patch using 2468 was rejected with `409 entity_conflict` and currentRowVersion 2469;
- live note append advanced the lead aggregate to rowVersion 2470;
- cleanup delete committed at revision 2471;
- normalized read parity after cleanup: verified;
- legacy/normalized dual-write verification then passed at revisions 2472/2473;
- final canonical hash returned to the baseline;
- final data counts remain leads 7, quotes 7, orders 3, payments 8, notes 2, team 3, catalog 149, Telegram bindings 8.

A permanent deploy gate now runs `scripts/test-ydb-entity-api-live.mjs` on every staging deployment.

Next step: Phase 5 frontend cutover. Replace browser-first full-state persistence and `Storage.prototype.setItem` interception with server-primary entity commands, while retaining a temporary compatibility fallback.

### Phase 3 — COMPLETE

Normalized reads are enabled on Yandex staging with verified legacy fallback.

Runtime configuration:
- `AUTO_SALE_YDB_DUAL_WRITE=true`;
- `AUTO_SALE_YDB_READ_MODE=normalized`.

Read path:
1. one YDB multi-result query reads the legacy compatibility row, migration meta and all normalized tables in one request;
2. normalized rows are reconstructed into the exact legacy API response shape;
3. empty legacy note buckets are preserved for response compatibility;
4. source revision must match normalized `source_revision`;
5. canonical legacy and normalized hashes must match;
6. only then is the normalized snapshot returned;
7. any query error, revision mismatch or parity mismatch falls back to the legacy blob.

Cold-start hardening completed during this phase:
- runtime containers no longer execute DDL;
- schema creation/migrations run once in the deploy workflow via `prepare:ydb-runtime`;
- normalized reader does not repeat schema initialization;
- legacy mode does not initialize the normalized reader at all.

The first Phase 3 live rollout was rejected by the deployment gate because the original normalized read path made too many YDB round trips and could hit the 60s container timeout. Staging was returned to legacy reads, the read path was redesigned, and the optimized rollout was repeated successfully.

Final live verification:
- quality gate: 213 passed, 0 failed;
- deploy-time schema preparation: passed;
- health: `ydbStateReadMode=normalized`;
- protected read diagnostic: `source=normalized`, `fallback=false`, `shadowVerified=true`;
- temporary lead create: revision 2466, parity 100%;
- temporary lead delete: revision 2467, parity 100%;
- final hash returned to the baseline canonical hash;
- final counts: leads 7, quotes 7, orders 3, payments 8, notes 2, team 3, catalog 149, Telegram bindings 8.

The legacy blob remains maintained by dual-write and is the immediate read fallback. The frontend contract has not changed.

Next step: Phase 4 entity mutation API with per-aggregate optimistic locking. Keep the compatibility `PUT /api/auto-sale/state` during the rollback window, then move frontend actions from browser-first full-state persistence to server-primary entity commands.

### Phase 2 — COMPLETE

Transactional dual-write is enabled on Yandex staging behind `AUTO_SALE_YDB_DUAL_WRITE=true`.

Current write path:
1. read legacy `auto_sale_state` inside a serializable YDB transaction;
2. enforce legacy optimistic revision;
3. write the new legacy blob;
4. if shadow `source_revision` is stale, catch it up inside the same transaction;
5. compute entity-level normalized diff;
6. apply only changed normalized rows/deletes;
7. enqueue notification outbox rows;
8. commit once.

This means legacy state, normalized shadow and notification intents share one transaction boundary.

Live verification:
- quality gate: 208 passed, 0 failed;
- health: `ydbDomainDualWrite = enabled`;
- temporary lead create: revision 2459;
- normalized diff on create: leads +1 only;
- legacy/normalized parity after create: 100%;
- temporary lead delete: revision 2460;
- normalized diff on delete: leads -1 only;
- legacy/normalized parity after cleanup: 100%;
- final legacy hash restored to the Phase 1 canonical hash;
- catalog remained 149 rows;
- no Telegram notification was sent during the verification.

A permanent deploy gate now runs `scripts/test-ydb-dual-write-live.mjs` after every Yandex staging deployment. Deployment is not considered successful unless live create/delete parity succeeds.

Important:
- legacy `GET /api/auto-sale/state` is still the read source;
- global revision still exists for the compatibility endpoint;
- normalized tables are now continuously maintained, but the frontend has not been switched to entity APIs yet;
- rollback remains immediate: disable `AUTO_SALE_YDB_DUAL_WRITE` and legacy behavior continues unchanged.

Next step: Phase 3 normalized shadow reads / parity-read mode, while keeping the public response contract and a feature-flag fallback to legacy reads.

### Phase 1 — COMPLETE

Live backfill result:
- source revision: `2458`;
- schema version: `1`;
- migration status: `backfilled`;
- canonical legacy hash = normalized hash;
- ID parity: passed;
- diff paths: none;
- source revision stayed stable during copy and parity verification.

Backfilled shadow counts:
- leads: 7;
- quotes: 7;
- orders: 3;
- payments: 8;
- notes: 2;
- team: 3;
- catalog: 149;
- Telegram bindings: 8.

A first strict parity attempt identified only legacy empty note buckets such as `notes[leadId] = []`. Canonical parity now treats an absent empty note bucket and an explicit empty array as equivalent; non-empty notes still compare field-for-field. After that normalization, parity is 100%.

Important:
- normalized tables are now a shadow copy only;
- `auto_sale_state` remains the production source of truth;
- no production endpoint has been switched;
- no dual-write is active yet;
- no legacy data was deleted or modified by the migration.

Next step: Phase 2 transactional dual-write behind a feature flag, with the legacy blob still serving reads and remaining the immediate rollback path.

### Phase 0 — COMPLETE

Implemented:
- normalized YDB schema v1;
- idempotent schema version table `auto_sale_schema_meta`;
- `server/ydb-domain-store.mjs`;
- legacy → normalized → legacy mapping/parity helpers;
- explicit `sort_order` preservation for collection/payment/note order;
- Telegram identity extraction model;
- schema preparation script;
- parity/round-trip tests.

Live YDB preparation result:
- schema version: `1`;
- normalized domain tables created successfully;
- all normalized domain tables are currently empty;
- no backfill has been executed;
- `auto_sale_state` remains the production source of truth;
- current outbox and all runtime endpoints remain unchanged.

Quality gate:
- lint: passed;
- typecheck: passed;
- build: passed;
- tests: 202 passed, 0 failed.

Next step: Phase 1 idempotent backfill + live parity report. Do not change read/write source yet.

Date: 2026-09-28
Branch: `prototype/auto-sale-usa`

## Current implementation

### YDB
`server/ydb-state.mjs` currently creates only:
- `auto_sale_state`: one row, `id=1`, global `revision`, whole application payload as JSON;
- `auto_sale_notification_outbox`: durable Telegram notification queue.

The state payload contains `leads`, `quotes`, `orders`, `notes`, `team`, and `catalog`. Every state mutation reads the whole row, validates the whole submitted snapshot, and replaces the whole row under one global optimistic revision.

### Browser sync
`public/auto-sale-bootstrap.mjs` patches `Storage.prototype.setItem`. Any tracked localStorage mutation schedules a full `PUT /api/auto-sale/state`. The payload always includes all domain collections. Conflicts are handled by client-side record rebase and retry.

`public/auto-sale-app-v3.mjs` uses `saveAll()` after domain actions. The server is therefore not yet the primary mutation API: browser state is mutated first, then synchronized.

### Telegram identity
`/api/auto-sale/telegram/link-client` and `/api/auto-sale/telegram/register-manager` both load the whole state and call `replaceState`, so a Telegram identity change increments the same global revision and can conflict with unrelated CRM/catalog writes.

### Outbox
The outbox is structurally correct:
- state + notification intents are committed in the same serializable YDB transaction;
- statuses: `pending -> processing -> sent/retry/dead`;
- retry backoff and expired-processing reclaim exist;
- request response is not blocked on Telegram delivery.

Weak points:
- event IDs depend on the global state revision;
- processing lease has no lease token/owner, so a stale worker can still mark a row after it has been reclaimed;
- sent/dead rows have no retention policy;
- notification generation is derived by diffing whole previous/next state;
- the Cloudflare inbound webhook relay currently has no Telegram `secret_token` validation.

## Main finding

The core architectural problem is the global mutable state row, not YDB itself and not the outbox pattern.

The current system creates unnecessary contention because unrelated operations share one revision:
- lead update vs catalog edit;
- Telegram binding vs quote save;
- order stage vs team update;
- different leads edited by different users.

Client-side merge/retry logic and save-fix modules are compensating for this design.

## Existing reusable work

The repository already contains a normalized D1/Postgres model:
- leads;
- quotes;
- orders;
- payments;
- notes;
- team;
- state meta.

Relevant files:
- `src/auto-sale/storage.ts`
- `migrations/0005_auto_sale_crm.sql`
- `migrations/0009_auto_sale_team.sql`
- `yandex/postgres/001_init.sql`

This model should be used as the starting point, not copied verbatim. It lacks catalog, Telegram bindings, normalized outbox metadata, and robust delete semantics.

## Target YDB schema

### auto_sale_leads
Primary key: `id`
Columns: `row_version`, `status`, `manager`, `source`, `client_created`, `payload`, `updated_at`.

### auto_sale_quotes
Primary key: `id`
Columns: `row_version`, `lead_id`, `status`, `quote_version`, `payload`, `updated_at`.

### auto_sale_orders
Primary key: `id`
Columns: `row_version`, `lead_id`, `stage`, `manager`, `risk_type`, `payload`, `updated_at`.

### auto_sale_payments
Primary key: `(order_id,id)`
Columns: `amount`, `payment_date`, `method`, `payload`, `created_at`.

### auto_sale_notes
Primary key: `(lead_id,id)`
Columns: `text`, `payload`, `created_at`.

### auto_sale_team
Primary key: `id`
Columns: `row_version`, `name`, `role`, `active`, `payload`, `updated_at`.

### auto_sale_catalog
Primary key: `id`
Columns: `row_version`, `origin`, `active`, `auction_date`, `payload`, `updated_at`.

### auto_sale_telegram_bindings
Primary key: `(subject_type,subject_id)`
Columns: `telegram_user_id`, `username`, `first_name`, `last_name`, `linked_at`, `updated_at`.

### auto_sale_notification_outbox
Keep the current table and evolve it additively with:
`event_type`, `aggregate_type`, `aggregate_id`, `target`, `chat_id`, `dedupe_key`, `lease_id`, `lease_until`.

### auto_sale_state_meta
Temporary compatibility metadata only:
- `compat_revision`;
- `schema_version`;
- migration/backfill status.

The global revision must not remain the primary concurrency mechanism after cutover.

## Zero-downtime rollout

### Phase 0 — additive schema
No runtime behavior change.
1. Add normalized tables with `CREATE TABLE IF NOT EXISTS`.
2. Add an idempotent schema migration/version mechanism.
3. Add `server/ydb-domain-store.mjs`.
4. Keep current blob state and outbox as the production source of truth.

Rollback: deploy previous revision. No data migration is destructive.

### Phase 1 — idempotent backfill
1. Read `auto_sale_state(id=1)`.
2. Backfill leads/quotes/orders/payments/notes/team/catalog.
3. Extract Telegram identities into `auto_sale_telegram_bindings`.
4. Preserve payload JSON exactly.
5. Store source global revision used by the backfill.
6. Build a parity checker that reconstructs a compatibility snapshot from normalized tables and compares IDs/counts/canonical hashes against the blob.

Do not delete or stop updating the blob.

Rollback: ignore normalized tables.

### Phase 2 — shadow + transactional dual-write
Keep the current browser/API unchanged.

Change the legacy `PUT /api/auto-sale/state` implementation so one YDB transaction:
1. validates the same business rules;
2. computes entity-level differences;
3. updates only changed normalized rows;
4. updates the compatibility blob;
5. inserts outbox records;
6. increments `compat_revision`.

The blob remains the read source initially.

Purpose: prove normalized data stays in exact parity under real traffic without changing UX.

Rollback: feature flag back to blob-only writes.

### Phase 3 — normalized reads
Switch `GET /api/auto-sale/state` to assemble the same legacy response shape from normalized tables.

Keep:
- the same JSON contract;
- the compatibility revision;
- a feature-flag fallback to blob reads.

Run shadow comparisons for every read during the first rollout.

Rollback: switch read-source flag back to blob.

### Phase 4 — entity mutation API
Introduce server-primary commands with per-row optimistic locking:
- `POST /api/auto-sale/leads`
- `PATCH /api/auto-sale/leads/:id`
- `POST /api/auto-sale/leads/:id/notes`
- `POST /api/auto-sale/quotes`
- `PATCH /api/auto-sale/quotes/:id`
- `POST /api/auto-sale/orders`
- `PATCH /api/auto-sale/orders/:id`
- `POST /api/auto-sale/orders/:id/payments`
- `POST/PATCH/DELETE /api/auto-sale/catalog/:id`
- `PATCH /api/auto-sale/team/:id`
- Telegram link/register endpoints update only `auto_sale_telegram_bindings`.

Each command transaction:
1. reads only required rows;
2. validates transition/business rules;
3. compares `row_version` for changed aggregate;
4. writes affected rows;
5. inserts notification outbox events in the same transaction;
6. optionally keeps the compatibility blob updated during the rollback window.

Notification templates should be refactored from whole-state diffing into command/event builders.

Rollback: old full-state endpoint remains available during the compatibility window.

### Phase 5 — frontend cutover
Replace browser-first whole-state synchronization:
- remove `Storage.prototype.setItem` interception;
- remove automatic full-state `PUT`;
- remove `saveAll()` as a persistence mechanism;
- localStorage becomes cache only;
- form actions await the entity API and update the local row from the server response;
- replace global client rebase with per-entity 409 handling.

This removes the current class of global revision conflicts and save/re-render loops.

### Phase 6 — retire global state writes
After the new UI is stable and legacy `PUT /state` traffic has stopped:
1. disable public legacy state writes;
2. stop dual-writing the compatibility blob;
3. keep `GET /state` only as a temporary compatibility snapshot if still needed;
4. archive/export the final blob snapshot;
5. later remove the blob table only after a retention period.

## Outbox hardening during the migration

1. Keep entity mutation + outbox enqueue atomic.
2. Replace revision-derived event IDs with operation-derived deterministic IDs:
   `<operationId>:<event>:<target>:<chatId>`.
3. Claim with a random `lease_id` and `lease_until`.
4. Mark sent/retry only when `id + lease_id + processing` still match.
5. Add retention/cleanup for old `sent` rows.
6. Add dead-letter retry tooling.
7. Keep Cloudflare as the stateless Telegram transport adapter.
8. Configure Telegram webhook `secret_token` and verify it at the relay/upstream boundary.

## Security prerequisite for real operation

Current Yandex demo uses `AUTO_SALE_PUBLIC_DEMO_WRITE`. With that flag enabled, the whole state read/write endpoint is public and CORS is `*`. The role switch is UI state, not staff authorization.

Before real client/manager production use:
- authenticate staff;
- authorize entity endpoints by role;
- expose client-scoped data only to the authenticated Telegram user;
- disable public whole-state writes;
- do not send the full CRM state to client sessions.

This should be done during Phase 4/5, not postponed until after the normalized cutover.

## Acceptance gates

Do not remove the compatibility blob until all are green:
1. backfill parity = 100%;
2. shadow dual-write parity = 100%;
3. no lost/deleted entities in migration tests;
4. concurrent edits to different leads do not conflict;
5. concurrent edits to the same lead produce a per-row conflict;
6. Telegram binding no longer increments an unrelated lead/catalog revision;
7. outbox event and business mutation commit atomically;
8. notification retries survive container restarts;
9. stale outbox worker cannot overwrite a newer lease;
10. complete lifecycle E2E passes on normalized API;
11. legacy state endpoint rollback works during the compatibility window;
12. no legacy full-state writes observed before final retirement.
