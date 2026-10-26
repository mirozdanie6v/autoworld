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

`server/ads-attribution-ydb.mjs` provides three new independent tables:

| Table | Primary key | Purpose |
| --- | --- | --- |
| `awg_ads_campaigns` | `token_hash` | Allowed campaigns, ad/creative references, enabled status |
| `awg_ads_subjects` | `subject_key` | First and last verified touch |
| `awg_ads_events` | `event_id` | Idempotent server-origin events |

The adapter includes serializable campaign suspension, collision detection
and paginated read-out of verified receipts. Its SQL contract is covered by a
mocked transaction-driver test. **No real YDB server integration test has
been run**; passing a mock does not establish live compatibility.

The adapter accepts an explicit existing YDB query tag. It does **not** create
a Driver, load credentials or run DDL when imported. The schema initializer
requires `{target:'isolated-test-database'}`; this flag is a *guardrail*, not
proof that the YDB endpoint is isolated. Operators must independently verify
that the credentials and connection string point to a physically separate
test database before calling it. **Never** run the schema initializer against
the production YDB database.

Idempotency depends on serializable YDB transactions, and a caller must
handle retryable serialization failures. No append-only/event retention job
has been deployed. A retention, deletion, access-control and consent policy
must be approved before real user traffic is collected.

## Local verification (no paid services)

```sh
node --check server/ads-attribution-core.mjs
node --check server/ads-attribution-ydb.mjs
node --check server/ads-attribution-report.mjs
node --test tests/ads-attribution*.test.mjs
```

On 2026-10-26 the last verified run passed **24/24 tests** (including
mocked YDB SQL transaction contract, campaign suspension, idempotency,
corrupted timestamps, event pagination and campaign metrics). The workflow
also validates that the branch diff only touches these isolated files.

The dedicated GitHub Actions gate only runs Node unit tests from this branch.
It has `contents: read`, no cloud authentication, no remote database and no
deployment steps. Existing deployment workflows must remain main-only.

## Remaining Stage A readiness gates (not complete)

- [x] Cryptographic one-time campaign deep-link tokens and hash-only registry
- [x] Active/inactive token management as an internal repository operation
- [x] First/last bot-start attribution, strict input validation, 30-day eligibility
- [x] Pseudonymized subject keys and idempotent event receipts
- [x] YDB schema and transactional write/read adapter implemented
- [x] Bounded paged campaign event reporting and unit/SQL-mock tests
- [x] Main-vs-feature Git diff allowlist in CI; no production handlers edited
- [ ] **Real isolated YDB** schema migration + transaction + restart / pagination / concurrency integration tests; no test YDB was provisioned
- [ ] Approve data retention, deletion/erasure, incident logging and key rotation before collecting real user data
- [ ] Verify eventual external spend provenance, ad-platform metrics contracts and director-only API authentication during Stage B

Stage A code implementation is prepared, but operational readiness for connecting
to a real YDB instance remains **conditional** on the outstanding isolation test
and data-handling requirements. No deployment, schema migration or test fixture
write has been performed against live YDB.

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

No additional external paid tool is required for these Stage A code tests.
An isolated YDB test database, if newly provisioned, may have cloud usage
costs; it has not been provisioned or billed by this change.
