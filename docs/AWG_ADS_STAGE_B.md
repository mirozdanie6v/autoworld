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

## Next code slices (not yet completed)

- Design a **durable transactional conversion reconciliation mechanism**
  from the authoritative CRM lead to ads receipts, including user ID
  pseudonym handling, canonical lead ID, retry/backoff, and a hard rule that
  the original immutable campaign snapshot prevails over future touches.
  Current staging prototype reports pending failures but lacks durable
  automated reconciliation.
- Integrate server-trusted `miniapp_open` and `vehicle_view` events.
  Vehicle ID must be checked against the server catalogue; only verified
  Telegram identity may contribute. Never accept a campaign token directly
  from an untrusted client.
- Design `manager_contact` as a derived, auditable state event, not as a
  client-reported metric.
- Add **director-only** YDB-backed read endpoint and UI by campaign,
  including source/campaign/ad, starts, opens, vehicle views, unique leads,
  manager contact, and valid CPL only where verified spend is supplied.
  Existing `source` channel reports must continue to work unchanged.
- Bind a trusted staging scheduler, durable audit log, telemetry alerts
  and tightly scoped IAM, with isolated schema initialization, retention
  and erasure in the tested YDB. No production scheduler deployed.
- Test real Telegram webhook, signed Mini App sessions, successful/failed
  CRM commits, lost acknowledgments, duplicates, outage/recovery,
  key rotation, full cycle and VK regressions against a separate staging
  instance. Avoid actual advertisements and customer notifications.

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
