# AutoWorld Ads B — staging / operations / acceptance log

## Staff self-service attribution correction — 31 October 2026

Root cause: the entities/batch endpoint used the authenticated staff/admin role for a customer-form create. sanitizeAdminOperations intentionally stripped attribution but did not bind the submitting Telegram identity; the Ads bridge correctly excluded admin mutations. Existing physical QA rows with clientCreated=true consequently had neither verified identity nor campaign.

Correction:
- Added server-only clientSubmissionAccess: only an authenticated signed Telegram admin submitting exactly one self-service lead (clientCreated=true) plus notes bound to that same lead is scoped to client validation for this command batch.
- Normal employee-created leads (clientCreated=false), mixed/staff mutations, API keys, VK and anonymous access are unchanged.
- sanitizeClientOperations now supplies the submitting identity/server timestamp; existing Ads lookup/immutable receipt logic uses that same effective client access. Campaign IDs and identity from browser fields remain untrusted.
- No old user lead was backfilled: records without saved identity are insufficient evidence for historical attribution.

Validation:
- Four targeted regression tests PASS, including recorded-campaign attribution/receipt and no-campaign/no-touch behavior.
- Exact source `f31c27314d93bb6b74dbe5dd7f8c513abcee16cd`: Verify AutoWorld41104625794 SUCCESS; isolated StageB41104625673 and41104611798 SUCCESS.
- [Staging deploy and managed acceptance41104611945](https://github.com/mirozdanie6v/autoworld/actions/runs/41104611945), job124230712136 SUCCESS; active revision `bbamdv0bejfmljnv4b2r`, separate CRM/Ads persistence and counters PASS. The managed acceptance remains signed synthetic, not a completed physical staff customer-form submission.
- Telegram preflight verified the dedicated bot identity and webhook pending_update_count=0. Cloud Console Ads table contained no QA-TELEGRAM physical campaign event before the new retest; do not claim the old user flow recorded a campaign.
- A fresh registered QA start link is available from this acceptance for a controlled user retest. Close the previous Mini App, open the exact QA link, press Start, then submit one new test request.
- Production, advertising links, paused status and zero budgets are unchanged. Physical director authorization/rollback and8 production link registrations remain separate.


## Physical submission investigation — 31 October 2026

User reported that a submitted test request was followed by a generic save-failed notice.

Verified independently through the owner Cloud Console (dedicated CRM staging table) and authenticated read-only HTTP state:
- Two user-created test requests are durably present, status New, created30Oct17:42:40.984Z and17:45:49.425Z. An additional generic test request exists at17:44:43.137Z.
- These three records do not contain Telegram identity binding or adsAttribution. They resemble the staff/admin create path; this is evidence of missing acceptance, not a proved explanation for the UI error.
- Two isolated synthetic lead+note HTTP batch probes each returned200 and persisted successfully. The timed repeat returned ok=true in714ms. Only the probes were removed afterwards using their exact IDs/current row versions; user test requests were retained.
- The original user-visible failure was not reproduced. No save-error fix is claimed. Capture the exact on-form error or browser diagnostics before choosing a frontend/backend correction.
- The prior managed acceptance deliberately did not test HTTP client lead submission. This observed user request is not accepted as a successful advertising-attribution E2E.
- Added privacy-filtered read-only staging diagnostic workflow. GitHub Actions run41101243136 was queued with no runner while investigation used Cloud Console instead. No production data/configuration changed.


## Current runtime acceptance — 31 October 2026, Asia/Saigon

Supersedes older statements below that the dedicated bot/runtime are missing.

- Dedicated test bot `@auto_sale_usa_bot` connected to container `bba5hanjiq9ngu77i8p9`; no production bot/webhook or real customer data changed.
- Candidate commit `1858f02c0ed5cc0bd4270fb521d611bda1cb947e`, active revision `bbafeqkdoka73701vrng`, digest `sha256:d640dd71bcc24790f31361b1f2a0d31ce148cfb524032f8d22e7c5178672e113`.
- [Deployment and managed acceptance41099063901](https://github.com/mirozdanie6v/autoworld/actions/runs/41099063901) SUCCESS. Full app593 PASS /1 skipped, Relay10 PASS, isolated Ads tests PASS.
- Cloud Console independently confirms ACTIVE. Separate CRM `etnvd9hmimkt74vpuqa6` and Ads `etnseoqfsf7ojn52813t`; publicDemoWrite=false, normalized mode.
- Verified by signed synthetic HTTP + actual managed database readback: miniapp_open and vehicle_detail_click, duplicate suppression, denied unsigned/malformed signatures, normalized CRM lead commit with immutable campaign, separate Ads receipt, client-hidden attribution, report aggregate counters; client/API-key access to director report denied. Current synthetic lead was cleaned through normal row-version checks.
- The synthetic /start handler and CRM lead commit in this acceptance are invoked in-process against managed persistence. They are **not** proof of an actual Telegram user /start, HTTP client lead submission, or positive authorization of a real director.
- Fixed malformed SHA256 acceptance caused by Buffer.from(hex) truncation; regression433f428, validation5bfa536, reviewed isolation allowlistf371d35.
- Raw test start URL is deliberately omitted from this public document. A registered staging QA link is available from the acceptance result for the authorized operator; do not use it in actual ads.

### Still unverified

Physical user Telegram/Mini App flow, HTTP client lead POST, positive director HTTP report, two-campaign physical comparison, actual baseline/candidate/revision rollback. Direct t.me access in this browser returned Site Unavailable on31Oct after one reload; this does not prove Telegram or the bot is down.

Eight real advertisements remain paused at0 EUR and use the production bot's temporary base URL. Production runtime registration for all8 combinations is a separate gate. The precise batch and expected receipt are in PR106 `docs/ads/telegram-ads-provisioning-request.v1.json`. Never substitute staging URLs for working production ad links.



## Integrated staging release candidate — 29 October 2026

User scope: combine Ads with current AutoWorld and prepare release; prioritize Telegram and create a separate test bot. Existing VK may be used as a test integration. Production/main, existing production Telegram webhook and real lead writes remain outside this release preparation.

- Main baseline: 6ece88ced344b6789921f3a3a120a3c641ae36d2.
- Ads source: 4c978df33701496da3ec6ee52f7a28344af6e4b7.
- Integration commit: 8d58c9b1962d80e225ba52816f1db5e0c1ac0535, exact two parents above.
- Release branch: release/awg-ads-staging-20261029; [draft PR107](https://github.com/mirozdanie6v/autoworld/pull/107).
- Original feature branch was fast-forwarded to the integrated source; no history rewrite and no main update. Both branches retain all current-main work.
- verify-awg-ads-release.yml builds the lockfile-based Dockerfile.timeweb portable image, verifies Ads server/frontend modules and default-OFF, then saves the image archive + SHA256 + source manifest as a GitHub Actions artifact for 7 days. It has contents:read only; no credentials, registry push, IAM token or deployment step.
- Existing Yandex/portable image builds and full current-main regressions are checked separately by Verify AutoWorld. Managed dual-YDB acceptance is repeated from the already authorized feature environment; no IAM/branch access expansion.

### Telegram staging configuration and acceptance

Create a separate bot via BotFather: display name AutoWorld QA, candidate username AutoWorld_Ads_QA_bot (availability not established). No bot has been created yet. Telegram Web access was rejected by automatic security review because opening it can expose a personal session/private chats; explicit permission for that personal-account login is still required. Do not bypass this gate.

Persist its token only in a dedicated secret, e.g. AWG_ADS_STAGING_TELEGRAM_BOT_TOKEN. Map it to runtime AUTO_SALE_TELEGRAM_BOT_TOKEN. Never reuse AWG_TELEGRAM_BOT_TOKEN or commit token values. Runtime webhook verification is already derived from the bot token by createTelegramService; do not invent a second incompatible verification mechanism.

The new Ads staging runtime must use:
- YDB_CONNECTION_STRING: CRM etnvd9hmimkt74vpuqa6.
- AWG_ADS_STAGE_B_YDB_CONNECTION_STRING: Ads etnseoqfsf7ojn52813t.
- AWG_ADS_STAGE_B_MODE=isolated-staging and explicitly enabled AWG_ADS_STAGE_B_ENABLED for the candidate only.
- A persistent dedicated AWG_ADS_STAGE_B_SUBJECT_SECRET, at least32 characters; never a new per-process/per-run key for durable runtime data.
- AUTO_SALE_YDB_READ_MODE=normalized; AUTO_SALE_YDB_DUAL_WRITE=false; AUTO_SALE_LEGACY_STATE_WRITE=false.
- AUTO_SALE_PUBLIC_DEMO_WRITE=false, explicit verified test staff identities and a separate AWG_ADS_DIRECTOR_TELEGRAM_IDS allowlist.
- AUTO_SALE_TELEGRAM_APP_URL must be the verified Ads staging origin, not awgcars.ru. Test manager destinations only. Do not silently inherit production relay/routing/config.

Register a webhook only for the new bot after runtime target, schema, health and recipients are verified. Test two campaign tokens, signed /start and Mini App initData, real lead commit + manager action, director-only report, retries and secondary Ads failure. Advertising account preparation happens in another workstream; campaign registry/link contracts must be shared via GitHub/Linear.

### Existing VK — user-approved as test integration, live routing still to verify

Existing repository workflows identify:
- container autoworld-vk-web-staging / bbag75c5g7vup8sfbmop;
- separate VK staging database etnhujtu1t6f89tdtohs;
- origin https://vk-test.awgcars.ru.
These are source configuration evidence, not a fresh live-revision read-back. Before any VK write, verify the active revision still points to that staging DB and approved test recipients. User approval to treat VK as test does not redirect Telegram production or authorize production CRM writes.

### Concrete staged rollback sequence — prepared, NOT executed

1. Capture exact current staging revision, image digest, gateway routing and secret references in the release record without printing secret values.
2. For a newly created Ads runtime, first establish a verified baseline revision with Ads OFF and the same staging CRM/test bot. No prior Ads revision currently exists.
3. Deploy the candidate image by immutable identity; only this candidate enables Ads. Record its revision, manifest SHA and baseline revision before testing.
4. Roll back by redeploying the recorded baseline image/config/secret references and switching only the staging route. A new revision ID is expected; image/config must match the recorded baseline.
5. Verify health, test-bot /start, ordinary CRM submit, VK isolation, director-report denial when Ads is OFF and absence of new Ads writes. Retain additive tables/data for audit; no DROP/reset/schema rollback or production route change.
6. Re-enable the candidate only after baseline recovery and test data checks pass.

Release package creation is not production readiness. Physical E2E, actual deployment rollback, sustained scheduler/alerts and cloud cross-store erasure remain separate acceptance gates.


## Current verified state — 29 October 2026; supersedes historical status below

Managed dual-YDB data-plane acceptance PASS: [run40857056369](https://github.com/mirozdanie6v/autoworld/actions/runs/40857056369), job123390546864. OIDC/IAM, production table-read deny, synthetic CRM commit + Ads attribution, immutable campaign, idempotent receipts, reconciliation replay, retention, durable success audits, lease exclusion/release and feature-off/on smoke passed. No production writes or grants changed.

CRM SQL now works in native TableService, QueryService and owner Cloud Console. The historical compilation timeout is no longer reproducible; its internal cause is not proven. Existing CRM schema, IAM and database settings were unchanged before recovery. Do not attribute recovery to an unproven fix.

Fixed two acceptance-harness bugs: inconsistent replay command/input IDs (e318d3c) and old persistent QA fixtures replayed under a new per-run HMAC key (5c88a50). Only strictly identified synthetic CRM fixtures are removed before new acceptance. Collision protections remain enabled. Two diagnostic canary tables exist only in CRM staging.

Physical Telegram/VK E2E and deployment rollback remain NOT VERIFIED. Dedicated Ads test integration/runtime is still missing; personal Telegram sign-in has not been authorized. No support request was sent; user requested resolution without contacting Yandex. Continuous schedules remain disabled and PR #83 remains draft.

Code regression CI for5c88a50: Stage B40857066775 and AutoWorld40857066583 SUCCESS.
Authoritative inventory, exact IDs, evidence and historical investigation:
[Managed staging inventory](AWG_ADS_STAGING_INVENTORY_2026-10-27.md).

## Historical implementation and pre-recovery findings

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

## 27.10.2026 — Managed YDB schema compilation timeout eliminated (staging)

- Code: `scripts/awg-ads-schema-inspection.mjs` uses YDB SchemeService `listDirectory` and checks the nine expected TABLE metadata entries. No per-table `SELECT * ... LIMIT 1` SQL compilation or row reads; incorrect type or missing table causes hard failure.
- Script: `scripts/prepare-awg-ads-stage-b-staging.mjs` keeps its existing exact staging-database ID, explicit apply approval, and production-deny guards. `inspect` is metadata-only.
- SDK dependencies and fail-closed unit tests are locked; [Stage B CI](https://github.com/mirozdanie6v/autoworld/actions/runs/40538442768) passed and [cloud acceptance attempt](https://github.com/mirozdanie6v/autoworld/actions/runs/40538834473) returned `AWG_ADS_MANAGED_STAGING_SCHEMA_OK {"mode":"inspect","databaseId":"etnseoqfsf7ojn52813t","tables":9}`.
- **Current next blocker:** the subsequent protected E2E test halted at `staging SA must have no production data-plane access`. Its probe uses `SELECT 1`, which is a constant expression and **does not demonstrate actual protected-table access**; this failure must be investigated with a zero-row, authorization-enforcing, schema-aware read probe or explicit IAM policy evidence. Never relax the production-isolation acceptance gate on the basis of this result.
- No production deployment or IAM permissions were changed by this timeout fix; production lead/CRM data was not read by the metadata inspection.
