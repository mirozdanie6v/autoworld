# AutoWorld Ads B — staging / operations / acceptance log (27.10.2026)

## Decision
**PARTIAL technical PASS / NO-GO managed staging and production.**
All code changes stay in draft PR #83 on `feature/awg-ads-stage-b-integration`.
Do not merge, deploy to production, switch Telegram webhook, touch main/YDB
production, grant broad project IAM, or spend advertising budget.

## Yandex Cloud inventory — observed evidence

- Two read-only inventory workflows were run in the isolated feature branch:
  `.github/workflows/audit-awg-ads-yandex-staging-readonly.yml` and
  `.github/workflows/audit-awg-ads-managed-staging.yml`.
- GitHub OIDC token was issued; Yandex OIDC -> IAM exchange failed HTTP **401**
  (example Actions run 40490868274). Therefore **no verified inventory**,
  no cloud ads DB creation, schema migration, IAM binding or resource quota test.
- This 401 does not prove whether the account ID, federated subject restriction,
  audience, or service account binding is responsible. Inspect federation
  rules and IAM with an authorized Yandex administrator; do **not** broaden the
  existing production deployment principal to accept feature branches.
- A dedicated *staging-only* workload identity should bind the exact GitHub
  repository/ref to a service account with folder-scoped permissions. Use a
  separate database-scoped runtime account where YDB roles permit.
- Existing production database `etn00ojk5iv1u7dgpdar` and VK staging database
  `etnhujtu1t6f89tdtohs` are hard-denied in the new schema preflight.

## Managed staging provisioning acceptance gate

1. Obtain a **read-only** list/get of YDB resources with authenticated staging
   identity and record database ID, folder ID, lifecycle status, deployment
   account, database endpoint. Confirm the advertising DB is distinct from
   primary CRM, existing VK staging, and any other live data.
2. If none exists, create a separate **serverless, OLTP** YDB for Ads B,
   with deletion protection, no provisioned hourly RCUs,
   modest RU/s throttling, a small storage cap and a budget alert.
   Establish billing/resource expectations BEFORE resource creation.
3. Record actual read-only IAM bindings and effective inherited grants.
   Reject broad production-level admin access by the Ads runtime principal.
4. Obtain short-lived Yandex credentials in a staging-trusted workflow.
   Do not store static access tokens in GitHub or write IAM tokens to logs.
5. Run `scripts/prepare-awg-ads-stage-b-staging.mjs` first with default
   `AWG_ADS_STAGE_B_SCHEMA_ACTION=inspect`. It MUST fail if tables are absent.
   Only after explicit dedicated DB ID validation, set
   `AWG_ADS_STAGE_B_SCHEMA_ACTION=apply` and
   `AWG_ADS_STAGE_B_SCHEMA_APPROVED=isolated-ads-only`. Never use the
   production or VK staging YDB for this migration.
6. Re-run read-only schema check, confirm all Ads attribution and managed
   operations tables, isolated IAM, cost ceilings, and tested schema rollback.

## Staged operation workers (code present; cloud scheduler NOT deployed)

- `server/ads-stage-b-scheduled-jobs.mjs`: purpose-built
  `awg_ads_job_leases` and `awg_ads_job_audit` tables. Serializable
  acquire/release prevents overlapping `reconciliation` / `retention` work.
  The job runner requires an independently authenticated principal and
  observability/alert callbacks. No public routes or in-process cron are
  registered by this module.
- Local YDB verifies durable lease, overlapping executor rejection, wrong
  release owner rejection and audit persistence:
  https://github.com/mirozdanie6v/autoworld/actions/runs/40491847237
- Production-grade external scheduler remains **not configured**. Any
  trigger must authenticate, be access-controlled, bounded with a timeout
  shorter than the lease, and report skipped/failed/incomplete outcomes.
- Real persistent audit sink, alert delivery and retention policies still
  require cloud setup. Console logging is not an approved durable sink.

## Cross-store deletion and legal boundary

- `server/ads-stage-b-cross-store-erasure.mjs` coordinates verified-user
  advertising data erasure across Ads YDB (tombstones first) and CRM.
  CRM updates must be CAS-protected and **only** clear advertising metadata;
  actual leads, quotes, orders, payments and unrelated VK users remain intact.
- The function is not public and needs an explicitly authorized server-side
  caller, a privileged CRM CAS callback, an audited durable retry request, and
  a read-back confirmation before production activation.
- Standalone tests check authorization, VK isolation, retries, idempotence and
  failure alarms. **No cloud erasure has occurred.** Retention of backups,
  tombstones, consent and the 30/90-day settings require legal approval.

## Release test matrix (not yet performed on managed staging)

- Two distinct campaigns and users. Signed Telegram /start from actual relay,
  stable update_id deduplication, original campaign retained on historical lead
  after user /start for campaign B.
- Telegram Mini App signed initData; verified vehicle click and Mini App open;
  CRM normalized transaction commits real staging lead; test failure before
  and after commit, HTTP retry, duplicate writes, and recovery after process
  restart. All generated test data must be cleaned only in staging.
- Manager updates stage; report represents `first_manager_action`, not
  unverified customer contact. Director-only report auth; other admins, clients,
  VK and API key rejected.
- Outage of independent Ads YDB never corrupts or blocks CRM; pending receipts
  replay from canonical snapshots, race-safe CAS recovery, no newer-campaign
  substitution.
- User erasure removes Ads receipts and CRM advertising fields, prevents replay;
  optional backup/retention checks are documented and tested.
- Physical Telegram notification to approved synthetic/test identities, VK
  Mini App regression; no unsolicited messages to real users.
- Rollback can disable all Ads feature flags without affecting Telegram bot
  /start, CRM status transitions, VK and the application build. Verify recovery
  from a controlled failed staging release and rerun all existing app tests.

## Verified vs missing

**Verified locally:** stage B CI, core AutoWorld, Telegram relay, actual
local YDB normalized CRM transaction, campaign replay, CAS, scheduler lease.
**Unverified in cloud:** inventory, dedicated database, IAM grants, quotas,
managed schema, scheduler, reporting/alerts, cross-store deletion and full
physical Telegram/VK end to end. Therefore **not accepted** as a production
release. Resync branch with current main immediately before release audit.


## 27.10.2026 — Gated managed job runner prepared, NOT enabled

A dedicated GitHub Actions staging workflow has been added:
`.github/workflows/run-awg-ads-staging-maintenance.yml`, with CLI
`scripts/run-awg-ads-staging-operations.mjs`. On the feature branch only
syntax is executed. Once explicitly released to the default branch, the
managed schedule is reconciliation every 15 minutes and retention daily,
but the live job stays OFF by default. A single GitHub concurrency group
and isolated Ads-YDB serializable leases prevent overlapping job runs.

Before authorizing any cloud execution, all of these must be independently
verified and configured in the `awg-ads-staging` environment:
- Dedicated GitHub OIDC federated service account
  `AWG_ADS_STAGING_SA_ID`; do not reuse the production deploy service account.
- `AWG_ADS_STAGING_YDB_CONNECTION_STRING` and
  `AWG_ADS_STAGING_CRM_YDB_CONNECTION_STRING` must point to two distinct
  *managed staging* YDB instances, never the existing production or VK test
  databases. Their exact database paths must appear in
  `AWG_ADS_STAGING_APPROVED_DATABASE_PATHS` and both must differ from
  `AWG_ADS_PRODUCTION_DB_PATH`.
- Private `AWG_ADS_STAGE_B_SUBJECT_SECRET` (at least 32 chars), approved
  scheduler principal `AWG_ADS_STAGING_SCHEDULER_PRINCIPAL`,
  `AWG_ADS_STAGING_IAM_VERIFIED=true`, then
  `AWG_ADS_STAGING_MAINTENANCE_ENABLED=true`.
- For retention, `AWG_ADS_STAGING_RETENTION_APPROVED=true` **only after**
  privacy/legal policy approval. Audit/alert monitoring and rollback must
  be observed in the managed staging runs, not inferred from the CI.
- No schema is created by the cron runner; verified isolated migration is
  separately gated by `scripts/prepare-awg-ads-stage-b-staging.mjs`.

Read-only Yandex OIDC probe failed with **401 invalid_client**:
https://github.com/mirozdanie6v/autoworld/actions/runs/40493047780 .
An isolated staging SA/federation fix is tracked in
https://linear.app/viiversion/issue/VII-191 .
Neither a managed Ads YDB nor a managed cron execution has been verified.

Code and QA evidence:
- Feature code, privacy index TTL, CAS cross-store erasure and fail-closed
  metrics: https://github.com/mirozdanie6v/autoworld/pull/83
- Local normalized CRM/Ads YDB, 2 campaigns, outage/replay, cross-store
  erasure and VK control:
  https://github.com/mirozdanie6v/autoworld/actions/runs/40492850166
- Managed workflow **syntax-only** (no Cloud API):
  https://github.com/mirozdanie6v/autoworld/actions/runs/40494088909
- CI (73 ads tests, 546 AutoWorld, 10 Relay):
  https://github.com/mirozdanie6v/autoworld/actions/runs/40494097601

**Acceptance stays NO-GO** for cloud operations, physical Telegram/VK,
production deployment, and real ad spend pending verified staging IAM,
resource constraints, physical E2E/rollback, and privacy policy.
