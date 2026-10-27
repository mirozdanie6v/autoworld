# AWG Telegram Ads — Stage B integration workstream

## Status and safety

Stage B began on 2026-10-27 on
`feature/awg-ads-stage-b-integration`, a branch **created from current
`main`**. It imports the 15 independently verified Stage A artifacts from
`feature/awg-ads-attribution`, without merging that stale branch into main.

**No release, advertising, migrations, cloud creation or production traffic.**
The feature flag is off by default. No real users are contacted. Production
Telegram, VK, CRM handlers and existing YDB remain untouched until reviewed
deployment approval.

## First implemented slice

1. The server bootstrap `server/ads-stage-b-runtime.mjs` creates a YDB
   connection **only** when `AWG_ADS_STAGE_B_ENABLED=true` and
   `AWG_ADS_STAGE_B_MODE=isolated-staging`. Requires a dedicated
   `AWG_ADS_STAGE_B_YDB_CONNECTION_STRING` different from the application's
   primary `YDB_CONNECTION_STRING` and a scoped
   `AWG_ADS_STAGE_B_SUBJECT_SECRET` of at least 32 characters. If any guard
   is not met, initialization refuses to start. Existing server startup
   with the flag off does not connect to an ads database or create tables.
   **These flags are for an approved, physically verified staging setup only**.
2. The production server code is *prepared* to inject
   `adsStartRecorder` into the existing `createTelegramService`.
   The recorder runs after webhook secret verification. In staging strict
   mode, an attribution write failure propagates as HTTP 503, inviting
   Telegram webhook redelivery; the default production mode remains
   unchanged.
3. `server/auto-sale-access.mjs` continues to strip any client-supplied
   campaign fields. After `sanitizeClientOperations` and successful
   server-side Telegram `initData` authentication, the isolated bridge
   reads the pseudonymous first/last-touch attribution from the ads store.
   For a **client Telegram lead create only**, the server attaches the
   trusted `adsAttribution` snapshot before the existing CRM batch mutation.
   VK, Web, manager and public operations are unaffected.
4. Only after the CRM mutation succeeds does the server try to create an
   idempotent `lead_submit` event keyed by a SHA-256 digest of the lead ID.
   Attribution events aren't sent for rolled-back or rejected CRM writes.
   If the separate YDB or observability sink fails, the CRM lead must still
   save. Failures are marked pending; the saved lead snapshot is the primary
   source for later reconciliation.
5. New `tests/awg-ads-stage-b.test.mjs` verify default-off behaviour,
   config isolation, real client sanitizer rejecting forged attribution,
   verified Telegram vs VK/admin separation, idempotence, strict webhook
   failure/503, and the CRM fail-open behaviour.

## Implemented second slice (27 October 2026)

- `server/ads-attribution-core.mjs`: a new server-only
  `recordTrustedSnapshotEvent` method writes verified CRM conversions
  using the **immutable campaign snapshot stored at lead creation**. Later
  /start touches must not rewrite a prior lead's campaign.
- `server/ads-attribution-stage-b.mjs`: `reconcilePersistedLead` replays
  canonical lead IDs from persisted CRM and derives `manager_contact`
  **only** from the server-owned `firstManagerActionAt` timestamp.
- `server/ads-stage-b-reconciliation.mjs`: bounded, restartable,
  idempotent keyset-paginated reconciliation from the authoritative CRM
  state. Bad batches emit alerts and incomplete work is retried.
  `AWG_ADS_STAGE_B_RECONCILE_ENABLED=true` additionally starts a 15-minute
  internal replay loop **only if the isolated Stage B feature is also ON**.
  Both settings default off. Audit is currently console-level, not
  independently confirmed persistent telemetry.
- `/api/auto-sale/ads/event`: staging-only POST, signed Telegram
  `initData` and verified server identity required. The frontend sends
  `miniapp_open` and `vehicle_view` with a catalogue vehicle ID,
  **never a campaign ID**. The backend checks the active server catalogue;
  duplicate user/event/car/day receipts are idempotent. VK is excluded.
  Client tracking is loaded only when the authenticated state explicitly
  returns `_adsTrackingEnabled`.
- `/api/auto-sale/ads/director-report`: staging-only GET, requiring
  existing pinned admin Telegram identity **and a separate, explicit
  `AWG_ADS_DIRECTOR_TELEGRAM_IDS` allowlist**. API-key users, VK clients,
  ordinary clients and unpinned staff are denied. New gated UI panel
  renders campaign counters safely using text nodes, never untrusted HTML.
  Paid clicks/spend and CPL are unavailable without independent platform
  evidence and are displayed as null/—.
- New reconciliation, access-control, viewer and real-YDB tests verify
  locked campaign assignments, trusted event collection, idempotent
  replay, and director-only report access.

## Remaining Stage B work

- **Managed staging E2E**: provision/verify a physically isolated
  Yandex Cloud staging YDB with restricted IAM, apply the reviewed schema,
  and test the actual server CRM transaction + separate ads receipt.
  The current real-YDB tests use the official disposable local YDB;
  the synthetic CRM commit is not an actual transaction in managed staging.
- Guarantee recovery of historical campaign attribution if the separate
  ads database is unavailable *at the moment a CRM lead is saved*.
  Presently, the lead is preserved and a metrics warning emitted but its
  initial attribution snapshot might be missing. Backfilling it from the
  user's **current** campaign is unsafe.
- Production-grade scheduler leader election, persistent metrics/audit,
  monitoring, IAM policy, tested rollback and retention/erasure jobs.
  The current 15-minute timer is staging-only and per-process,
  not a distributed scheduler.
- Validate actual director user IDs/roles, signed Telegram Mini App
  callback, failed/successful CRM commits, Telegram message routing and VK
  regression against a controlled staging environment.
- Ad reseller/platform click, impression, spend and compliance evidence.
  Never count bot /start as a paid click or create fabricated CPL.

## Pre-deployment blockers

- Physically verify isolated Yandex staging YDB and credentials. Code-level
  different-connection-string checking is **not** proof of isolation.
  Stage A SQL initializer must never target production.
- Approve legal basis, 30/90-day data lifetimes, suppression-tombstone
  retention, audit-log retention and identity reconfirmation.
- Resolve/accept outstanding Telegram lifecycle risks VII-172 and VII-182,
  compare against the then-current main, test a guarded rollback and secure
  distinct director-role authorization.
- Capture ad-platform/reseller spending evidence separately; bot starts
  are not equivalent to paid advertising clicks. No payment authorization
  or campaign launch is implied by this branch.

## Verification

CI: `.github/workflows/verify-awg-ads-stage-b.yml` runs the Stage A and B
unit tests together, full AutoWorld/Relay regression, syntax checks and
strict changed-path isolation. The workflow has `contents: read` only,
no Yandex Cloud secrets, no deployment tasks and no migrations.

A draft PR is for review only; never enable auto-merge or production
deployment until the above gates and the user's release approval are met.
