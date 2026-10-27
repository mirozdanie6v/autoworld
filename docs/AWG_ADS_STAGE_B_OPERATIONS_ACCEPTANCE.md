# AWG Ads Stage B — staging operations acceptance, 27 Oct 2026

## Current status

Operational implementation in draft PR #88 targets the Stage B feature branch (PR #83). Main, production YDB, Telegram/VK webhooks, real customer leads, and advertising budgets are untouched.

**Yandex Cloud inventory blocked:** two independent read-only GitHub Action jobs failed at the GitHub OIDC → Yandex IAM token exchange with HTTP 401:
- https://github.com/mirozdanie6v/autoworld/actions/runs/40491157017
- https://github.com/mirozdanie6v/autoworld/actions/runs/40490868274

No dedicated managed Ads YDB, managed staging CRM, per-database quotas, or IAM grants were independently confirmed. Do not claim these resources exist or attempt migration against the production DB.

## Implemented, staging-only

1. Transactional YDB job leases and run history (two new ops tables); a stale worker cannot complete another worker's run.
2. External scheduler runner: reconciliation every 15 minutes, retention at 03:00 UTC, one worker at a time, 10-minute runtime limit, three retries, metrics and alerts.
3. Runnable staging job entry point, guarded by explicit verified Ads and CRM staging database IDs, denylisting the known production DB ID, dedicated IAM service account, and two feature gates. It never auto-migrates schemas.
4. Cross-store advertising erasure library: authorized HMAC erasure block in Ads YDB, then optimistic-CAS removal of advertising fields from matching Telegram client leads in CRM, preserving prices, status and other clients. Incomplete erasure fails and alerts. This library is not yet a live erasure API or cloud job.
5. Retention removes historical bot-touch index entries in the same YDB transaction as advertising events. Local YDB confirmed retention and explicit erasure.
6. Opt-in degraded ads connection allows CRM startup without Ads YDB. An unavailable ads write on Telegram /start still raises an error to allow Telegram redelivery; CRM saves a recovery marker. Reconnect backoff and strict retry are exercised by tests.
7. Two synthetic signed Telegram Mini App campaigns, manager-first-action and director role, VK isolation and flag-off rollback have automated regression coverage. This is not a physical Telegram/VK test.

## Verified local CI

- https://github.com/mirozdanie6v/autoworld/actions/runs/40492968315 — 73 isolated ads tests, 514 app tests, 10 Relay tests, all PASS.
- Same run's disposable real local YDB: persistent lease contention/stale lease, historical touch retention purge and subject-erasure suppression PASS.
- The Stage B parent PR also contains genuine normalized **local** CRM YDB commit and historical CAS recovery tests. These do not substitute for managed Yandex Cloud staging.

## Cloud gates before provisioning

1. Resolve OIDC exchange 401 with a *dedicated staging service account* and exact GitHub OIDC issuer/audience/subject trust. Do not broaden production deployment federation trust.
2. Read-only list YDB instances and identities. Confirm physically distinct Ads staging and CRM staging database IDs and record the production ID separately.
3. Approve and record storage ceilings, RCU throttling, quota alerts, IAM roles, backups and maximum accepted expenses; values are not yet known.
4. Apply reviewed staging-only schema migration for seven attribution tables and two job tables, with an exact target-ID assertion and least-privilege credentials. Never auto-run schema DDL during normal app startup.
5. Deploy two Yandex-managed cron jobs using a dedicated IAM identity. Verify Cloud Logging, Monitoring, retry, duplicate suppression, lease expiration, retention and alert delivery.

## Final two-campaign cloud acceptance

- Two valid opaque campaign tokens, independent verified Telegram bot /start events and signed Mini App sessions.
- Two real commits to the isolated **cloud staging CRM**, including client and vehicle data, without browser-supplied campaign identity.
- Paid ad YDB unavailable before one lead creation: CRM still saves, then correct historical campaign is CAS-recovered after service recovery; later campaign must not rewrite earlier lead.
- Verified manager status action counts as first_manager_action, not verified customer contact. Manager notifications checked without messaging unrelated users.
- Director pin/allowlist allows read-only reporting; normal clients, API-key users and VK cannot access Telegram Ads report; paid clicks/spend/CPL remain unknown.
- VK staging request, notification, retries and no advertising contamination. Two parallel scheduler invocations cannot both execute. Event retention and authorized multi-store erasure verified, including suppression after erasure.
- Production-off rollback flag test, unchanged normal CRM and Telegram/VK behavior, then fresh branch rebase and tests.

## Hard blockers

- P0: Yandex Cloud IAM token exchange 401; no cloud provisioning or separate managed-YDB inspection.
- P0: Managed jobs not yet created in Yandex Cloud; staging entrypoint only.
- P0: No cloud physical Telegram/VK E2E, cloud CRM transactions or rollback.
- P1: Legal approval for retention, data-subject erasure including backups, suppression tombstones, and campaign consent.
- P1: Reconcile PR #83 with current main changes and pass all tests before any deployment.

Verdict: operational code readiness in isolated branch; production and full Stage B acceptance are NO-GO.
