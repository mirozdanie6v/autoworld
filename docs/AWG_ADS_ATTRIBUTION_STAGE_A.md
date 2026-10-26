# AutoWorld — Telegram Ads attribution / Stage A (isolated)

## Scope and current status (2026-10-26)
Independent server-side attribution domain in branch `feature/awg-ads-attribution`, linked to Linear VII-184.
No edits to `server/telegram-bot.mjs`, `server/yandex-server.mjs`,
`public/auto-sale-app-v3.mjs`, director CRM, request/quote handlers, or main.
No changes to production YDB or Telegram setup. No advertising purchases.

The current Mini App/Telegram/VK bugfix pipeline remains authoritative. Do not
merge, deploy or enable attribution until Stage B approval and reconciliation
with the current `main` branch.

## Architecture

1. Internal admin campaign provisioning: generate an unpredictable 192-bit
   Telegram-safe `start` token (32 base64url characters) with
   `issueCampaign({campaignId,adId,creativeId})`. Return it only to the
   provisioner; persist only SHA-256 of the random token. Example target link:
   `https://t.me/<approved_bot_username>?start=<token>`.
   Link placeholder values must be replaced with the actual verified bot username.
2. Only the *authenticated Telegram webhook path*, after Telegram secret
   validation and verification of Telegram's user ID and update ID, may call
   `recordBotStart({telegramUserId,startPayload,updateId})`.
   Do not accept user-supplied Telegram IDs or `initDataUnsafe`.
3. Support explicit suspension and reactivation by token hash via internal-only
   `setCampaignTokenActive`. No public/admin HTTP route has been exposed.
   Reject malformed, unknown or disabled tokens; do not attribute ordinary
   organic `/start` traffic. Atomic dedupe by Telegram `update_id`.
4. Use HMAC-SHA256 with a stable private `subjectSecret` (>=32 characters)
   to pseudonymize Telegram user IDs. Keep the secret in secret management;
   do not log it, include it in deep links or store raw IDs in attribution
   tables. Secret rotation requires a migration plan.
5. Persist first and last verified touches, keyed by hashed subject, and
   immutable *event receipts* with idempotency keys. The default eligibility
   window is 30 days after last verified touch; expired attribution yields
   `null` in service reads, not an optimistic or guessed campaign.
6. Only server-verified user activity may later call
   `recordTrustedEvent(...)` with a globally stable event ID:
   `miniapp_open`, `vehicle_view`, `lead_submit`, `manager_contact`.
   These calls are **not wired up during Stage A**.
7. At Stage B, copy an immutable attribution snapshot into a newly created
   lead *inside its authenticated write transaction*. Never retroactively
   rewrite earlier quotes, prices, historical leads or source channels.

Telegram Ads ad impressions and ad clicks are **not** observable through a
Telegram bot `/start` webhook. Bot starts are measurable; real paid clicks,
spend and impressions require verified reporting data from the advertiser/
reseller or its supported API. Do not label a bot start as an ad click or
calculate CPL without actual spend and deduplicated lead counts.

## Read-only campaign reporting

`server/ads-attribution-report.mjs` groups only verified server receipts
into campaign-level bot starts, unique bot users, Mini App opens, vehicle views,
submitted leads and manager contacts. It deduplicates by receipt ID. `summarizeAdsCampaignsFromRepository`
loads bounded keyset-paginated event pages from the adapter before reporting,
refusing to silently return a partial report if pages are malformed or the
maximum page count is exceeded. The aggregation is not a transactional
cross-page snapshot; concurrent traffic can produce temporary differences.
Paid clicks
and ad impressions are explicitly `null` until separately verified data is
ingested. Verified external spend can be supplied with currency, and CPL is
calculated only when both spend and distinct lead events are present.
This module does not read CRM or advertising accounts directly, and is not
connected to the director dashboard yet.

## Isolated YDB model

`server/ads-attribution-ydb.mjs` provides six new independent tables:

| Table | Primary key | Purpose |
| --- | --- | --- |
| `awg_ads_campaigns` | `token_hash` | Allowed campaigns, ad/creative references, enabled status |
| `awg_ads_subjects` | `subject_key` | First and last verified touch |
| `awg_ads_events` | `event_id` | Idempotent server-origin events |
| `awg_ads_events_by_subject` | `subject_key,event_id` | Transactional subject-key access for bounded erasure |
| `awg_ads_events_by_time` | `occurred_at,event_id` | Transactional timestamp-key access for retention |
| `awg_ads_erasure_blocks` | `subject_key` | Persistent suppression after user erasure |

The adapter includes serializable campaign suspension, collision detection
and paginated read-out of verified receipts. Its SQL contract is covered by mocked and real local YDB tests,
including persistence after database restart. Managed Yandex Cloud staging has
not been tested.

The adapter accepts an explicit existing YDB query tag. It does **not** create
a Driver, load credentials or run DDL when imported. The schema initializer
requires `{target:'isolated-test-database'}`; this flag is a *guardrail*, not
proof that the YDB endpoint is isolated. Operators must independently verify
that the credentials and connection string point to a physically separate
test database before calling it. **Never** run the schema initializer against
the production YDB database.

Idempotency depends on serializable YDB transactions, and a caller must
handle retryable serialization failures. No production retention job has been deployed. The scheduler-neutral entry
point, monitoring contract and authorization boundary are implemented in the
isolated branch. Production IAM, alerts and retention scheduling must be bound
and audited during Stage B; legal approval is required before collecting data.

## Local verification (no paid services)

```sh
node --check server/ads-attribution-core.mjs
node --check server/ads-attribution-ydb.mjs
node --check server/ads-attribution-report.mjs
node --test tests/ads-attribution*.test.mjs
```

Unit and SQL-contract checks now cover replay suppression, batch deletion of
1,011 receipts, authorization, audit sinks, retention scheduling contract and
monitoring. Refer to the linked GitHub Actions run for the current passing count. The workflow
also validates that the branch diff only touches these isolated files.

The dedicated GitHub Actions gate only runs Node unit tests from this branch.
It has `contents: read`, no cloud authentication, no remote database and no
deployment steps. Existing deployment workflows must remain main-only.

## Privacy, access control and retention lifecycle

`server/ads-attribution-privacy.mjs` implements the technical (not yet legally
approved) proposal:

- Attribution eligibility: 30 days from the most recent valid touch.
- Events and pseudonymous subject histories: 90-day retention default.
  `runRetentionCycle({principal})` performs bounded transactional sweeps,
  repeats until complete and reports `status:complete/incomplete`. A partial
  cycle is never accepted as successful maintenance.
- Verified identity deletion: `eraseVerifiedTelegramUser({telegramUserId,principal})`
  HMAC-derives the current and previous subject keys. The YDB adapter writes
  a suppression tombstone before removing subject data/events **in the same
  serializable transaction**, and deletes indexed event receipts in batches
  of 50 until complete. There is no hard total limit of 1,000 events.
  An interrupted call returns an explicit incomplete result; retrying with
  the same verified identity resumes safely.
- Old/replayed Telegram updates and new events for a previously erased
  pseudonym are blocked by `awg_ads_erasure_blocks`. The blocked subject
  key is a **retained minimal pseudonymous suppression record**, not complete
  elimination of all user-linked information. A legally reviewed path for
  renewed consent/reactivation and tombstone lifecycle is required before
  collecting real personal data.
- `authorizeOperation({permission,principal})` must be supplied by the
  authenticated host. The permissions are `ads:erase` and
  `ads:retention`; the old `authorized:true` bypass is removed.
  `principal` must be a verified server-side actor supplied by the host,
  never accepted directly from the browser or Telegram client.
- `onAudit` is mandatory. Successful, failed and incomplete erasure/retention
  operations emit structured outcome, actor ID, counts and timestamp **without
  raw Telegram ID, key or token**. Deployments must use a durable, restricted
  audit sink; the test environment uses no-op or in-memory listeners.
- `server/ads-attribution-maintenance.mjs` wraps a complete sweep and
  emits counters, duration, success/failure and high-severity alerts on an
  incomplete run. `registerAdsDailyRetention` exposes a 03:00 UTC
  non-overlapping scheduler registration contract. **It has not been bound
  to a production scheduler**; only the isolated code/tests are present.
- Scoped secrets are required. Rotation supports up to two old HMAC keys
  during a controlled overlap. Removing any old key before its retention
  and erasure window closes can orphan pseudonymous records.
- CRM lead personal data remains subject to a **separate** data lifecycle
  and cannot be deleted through this standalone ads-only service.

Legal/privacy review before live use must approve the lawful basis,
privacy notice, tombstone retention, deletion and renewed-consent semantics,
processor roles, backup expiry, and any jurisdiction-specific obligations.

## Independent YDB proof

GitHub Actions executes `Verify AWG Ads (real local YDB, isolated)` with
the official Docker `ydbplatform/local-ydb` server on
`grpc://localhost:2136/local` and anonymous local credentials.
The test script hard-refuses any inherited production YDB credentials or
cloud connection string. It checks schema DDL, two campaigns, start receipts,
deduplication, transactions, concurrent writes, paginated reads,
deactivation, and persistence after a fresh application process connects
to the same running database. A further privacy phase verifies erasure
and retention against this real local server. An additional
`Verify AWG Ads YDB persistent restart (isolated)` workflow runs a
**disk-backed** local YDB with mounted volumes, performs the same writes,
restarts the Docker container itself and checks that attribution data
survives and erasure/retention still work.

Verified evidence (2026-10-26, updated after the P0/P1 audit):
- **36/36 PASS** for independent unit/SQL-contract, authorization, audit,
  retention scheduler contract, replay suppression, and >1,000 event deletion:
  [GitHub Actions 40347180425](https://github.com/mirozdanie6v/autoworld/actions/runs/40347180425).
- Real local YDB ingestion, 20 simultaneous starts of one Telegram subject,
  deletion of **1,011 receipts across 21 batches**, and repeat webhook
  suppression: [GitHub Actions 40346364135](https://github.com/mirozdanie6v/autoworld/actions/runs/40346364135), success.
- Real disk-backed YDB with container restart, 24 concurrent event writes
  during erasure, **zero surviving receipts for the erased subject** and
  deletion of 1,011 receipts across 21 batches:
  [GitHub Actions 40347342480](https://github.com/mirozdanie6v/autoworld/actions/runs/40347342480), success.
- Full server restart and continued keyset data availability confirmed on the
  same disk-backed test YDB; this is not managed Yandex Cloud staging.

This is **not** a managed Yandex Cloud database acceptance test; it does
not establish production credentials, IAM or region-specific YDB settings.

CI only has `contents: read`; no deploy, app merge or production YDB write
is authorized by this workflow.

## Stage A acceptance boundary

- [x] Standalone campaign token, verified start, first/last attribution, TTL
- [x] Event dedupe, collision guards, bounded report pagination, verified spend-only CPL
- [x] SQL YDB adapter, schema and mocked transaction tests
- [x] Actual local YDB DDL, writes, reads, concurrency, process reconnect and full disk-backed YDB container restart
- [x] Authorization and audit-hook enforcement, idempotent paginated erasure, retention/key-overlap code and unit tests
- [x] Transactional subject/time lookup tables and suppression after erasure
- [x] Scheduler-neutral daily maintenance contract and monitored fail-closed runner
- [x] Explicit separation of Stage A from bot, Mini App, CRM and production
- [ ] External legal/privacy approval of technical retention proposal before real data
- [ ] Bind daily scheduler, durable logs, alerts, IAM and authenticated deletion route in staging and production (Stage B)
- [ ] Managed Yandex Cloud staging/database smoke tests with appropriate IAM (Stage B)

**Technical Stage A is implemented and independently exercised.**
Readiness for processing real personal data and publishing to production
remains contingent on Stage B integration gates and external approvals.

## Stage B integration gates — NOT authorized yet

- Resolve pending Mini App lead mapping, year/mileage/engine fields, price
  formulas and Telegram notification bugs before touching shared handlers.
- Rebase against then-current `main`, and audit `/start`, bot relay and
  signed Telegram WebApp `initData` authentication path.
- Resolve Telegram deep-link path vs Mini App launch attribution and organic
  returning-user flows; no identity stitching from untrusted clients.
- Use a single transactional lead snapshot and verified receipt IDs in the
  CRM. Confirm Web, VK and Telegram continue to behave independently.
- Test at least two campaigns, repeated starts, replayed webhook, stale
  attribution, failed/rolled-back lead save, and server restart.
- Define campaign spend ingestion, unique event/lead counting and
  director-only read authorization. No public dashboard data leaks.
- Require QA, documented production migration/rollback, separate
  user approval for merge and deployment, and Legal/Ads readiness gates
  in Linear VII-184 before publishing any advertising.

## Stage A technical acceptance — audit after remediation (2026-10-26)

**Decision: technical Stage A accepted, isolated scope only.**
Previously discovered P0 and mandatory P1 issues have been addressed
in the feature branch and the corresponding local YDB tests are successful:

| Audit item | Verified result |
| --- | --- |
| Erasure cannot be undone by replay | A permanent HMAC tombstone is written transactionally before deleting subject history, replay ignored; concurrent write-vs-erase test returns 0 surviving records |
| Removal beyond 1,000 events | 1,011 receipts removed by 21 bounded YDB batches, no cap on total records across resumable invocations |
| Retention & subject lookup performance | Writes/erases maintain two transactional auxiliary key tables; local YDB tested, managed-cloud latency remains unmeasured |
| Maintenance execution | Scheduler-neutral 03:00 UTC daily registration, fail-closed complete/incomplete runner, counts, duration, alerts and mandatory audit/authorization callbacks all unit-tested |
| Same-user concurrency | 20 parallel bot-start updates and 24 concurrent write-vs-erase calls tested on real local YDB |
| Isolation | No existing application files edited, no production YDB access, no main merge/deploy |

The following **operational gates remain outside isolated Stage A and must
be satisfied before using real personal data**: legally approve retention and
suppression-tombstone basis/lifetime; bind host-verified IAM roles, durable
audit log, metrics/alerts and daily scheduler; test cloud staging YDB;
reconcile this branch with newer main; integrate real authenticated Telegram
and signed Mini App, transactional lead writes and director-only report access.
Re-consent/unblocking policy for suppressed users requires an explicit,
legally reviewed design.

Known non-blocking Stage A follow-ups for Stage B: same-user identity
consolidation across key rotation windows, reseller spend provenance,
point-in-time consistent reporting under continuous writes, pinned Docker
YDB image digest, benchmark at expected managed-cloud campaign volume.

The repository workflow deliberately **does not schedule real production
maintenance** and cannot claim an operational SLA before a real host job,
alert receiver and IAM identity have been configured.

No additional external paid tool is required for these Stage A code tests.
An isolated YDB test database, if newly provisioned, may have cloud usage
costs; it has not been provisioned or billed by this change.
