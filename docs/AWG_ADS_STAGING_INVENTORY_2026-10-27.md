# AWG Ads managed staging — verified state, 27 October 2026

Status: PARTIAL / BLOCKED at managed YDB query execution.
Production deployment, real customer records, production Telegram/VK configuration and paid advertising were not modified by this workstream.

## Completed and independently verified
- Cloud b1ggsmuiq7tb2d27f89q; actual folder b1g8u8vqkgehvtbj8n13. Corrected inventory workflows that previously used cloud ID as folderId.
- Dedicated SA awg-ads-staging-ci / aje3j5aat66lel86cd5r.
- Dedicated federation awg-github-ads-staging / ajebuniclp0pmef8echj.
- Federated credential binding ajeg2utlgppho45e93ul: exact subject repo:mirozdanie6v@49186663/autoworld@1398349654:environment:awg-ads-staging.
- Issuer https://token.actions.githubusercontent.com ; AUD https://github.com/mirozdanie6v ; JWKS https://token.actions.githubusercontent.com/.well-known/jwks .
- GitHub environment awg-ads-staging: AWG_ADS_STAGING_SA_ID=aje3j5aat66lel86cd5r read back; deployment restricted to exactly feature/awg-ads-stage-b-integration (1 branch, 0 tags).
- User explicitly confirmed the new binding, scoped roles and second CRM staging resource before application.
- Actual short-lived OIDC -> IAM exchange HTTP 200 and read-only database inventory SUCCESS:
  https://github.com/mirozdanie6v/autoworld/actions/runs/40510964315
  Latest successful inventory job: 122248517595.
- No static service-account keys created or IAM tokens logged/stored permanently.

## Physical staging databases

| Purpose | Name | ID | Database path |
|---|---|---|---|
| Ads | awg-ads-stage-b-staging | etnseoqfsf7ojn52813t | /ru-central1/b1ggsmuiq7tb2d27f89q/etnseoqfsf7ojn52813t |
| Synthetic CRM | awg-ads-crm-stage-b-staging | etnvd9hmimkt74vpuqa6 | /ru-central1/b1ggsmuiq7tb2d27f89q/etnvd9hmimkt74vpuqa6 |

Both Running, Serverless OLTP, throttling 10 RU/s, storage ceiling 1 GB, provisioned capacity 0, deletion protection YES.
Endpoint prefix: grpcs://ydb.serverless.yandexcloud.net:2135/?database=
Budget alert is still NOT configured; 0 provisioned capacity is not a zero-cost guarantee.

Excluded databases, never approved write targets:
- auto-sale-db etnr90ntl17oucsncg1k;
- production etn00ojk5iv1u7dgpdar;
- existing VK test etnhujtu1t6f89tdtohs.

## IAM read-back
Cloud Browser ACL tables verified:
- ydb.auditor at folder b1g8u8vqkgehvtbj8n13 only (database metadata, no customer data grant).
- ydb.editor directly on ads etnseoqfsf7ojn52813t only.
- ydb.editor directly on CRM staging etnvd9hmimkt74vpuqa6 only.
No folder/cloud-wide editor/admin role added.
This is ACL evidence. The managed negative production SELECT 1 probe has NOT yet executed because schema preflight failed earlier.

## Schema and acceptance
The console root directory independently shows all nine ads tables owned by awg-ads-staging-ci:
awg_ads_campaigns, awg_ads_erasure_blocks, awg_ads_events,
awg_ads_events_by_subject, awg_ads_events_by_time, awg_ads_job_audit,
awg_ads_job_leases, awg_ads_subjects, awg_ads_touches_by_subject_time.

Files:
- .github/workflows/verify-awg-ads-managed-staging.yml
- scripts/test-awg-ads-managed-staging.mjs

The workflow verifies exact repo/ref/SA/OIDC claims and actual names/IDs/status of both approved databases before any schema/data operation. It prepares ads schema, requires an independent SELECT inspection, then tests real normalized CRM commits, two campaigns, idempotent receipts, durable leases, controlled reconciliation/retention, and bridge feature-off/on rollback. It deliberately does not claim physical Telegram/VK delivery or deployment rollback. It shares the maintenance concurrency group.

Managed cloud attempts:
- https://github.com/mirozdanie6v/autoworld/actions/runs/40521583051 — two failed attempts.
  First failure: read-only schema SELECT after DDL; server YDB 400090 TIMEOUT, Query compilation timed out.
  Retry: CREATE TABLE IF NOT EXISTS in ensureAdsAttributionSchema; same server error.
- https://github.com/mirozdanie6v/autoworld/actions/runs/40522783176 — after acceptance fixture ID correction; same schema-stage failure.
Do not claim managed acceptance PASS. Do not repeatedly rerun compilation timeouts without new evidence or provider recovery.

Current code at 2787c487012284f36d6accb175b8b945d47b3f22:
- Stage B regression SUCCESS https://github.com/mirozdanie6v/autoworld/actions/runs/40522791523
- AutoWorld regression SUCCESS https://github.com/mirozdanie6v/autoworld/actions/runs/40522791617
- Managed script syntax, workflow YAML, shell and OIDC JavaScript syntax checked.
Code CI does not prove cloud runtime success.

## Independent Cloud Console query diagnosis
- SELECT 1 AS staging_health completed and returned 1.
- SELECT * FROM awg_ads_campaigns LIMIT 1 failed with GRpc error (4): Deadline Exceeded.
- Both were executed only on ads staging etnseoqfsf7ojn52813t using the signed-in cloud owner session.
- Therefore table access failure is reproduced independently of the GitHub runner and its staging SA. The exact service/metadata/shard root cause is still unknown; do not claim a global YDB outage.
- No query is left running. Console screenshot and nine-table list were captured.

## Not completed
- Independent managed schema SELECT acceptance; managed CRM schema/fixture transactions.
- Production data-plane deny probe.
- Controlled reconciliation/retention execution and audit read-back.
- Continuous scheduler, persistent alert delivery and budget alert.
- Physical Telegram/VK Mini App and message lifecycle E2E.
- Staging deployment rollback; only a bridge feature-flag smoke is prepared, not yet reached.

All live maintenance flags remain disabled. No active cron was enabled and no production branch merge/deploy was performed.

## Physical integration blocker
GitHub environment has no secrets. Repository secret metadata lists general AWG_TELEGRAM_BOT_TOKEN, AWG_VK_APP_SECRET, AWG_VK_COMMUNITY_TOKEN and relay/infrastructure secrets; no distinct ads-staging integration credentials were found.
The inspected legacy .github/workflows/test-awg-vk-dmitry-production-e2e.yml explicitly reads the production container and writes production YDB; it was NOT run.
A separate test Telegram bot and VK test app/community configuration, explicit test recipients and a staging runtime are required before physical acceptance. Do not silently substitute production integration settings or real customer records.

## Safe continuation
1. Diagnose/recover query execution on the two new staging YDBs; keep current IAM scope and resource ceilings.
2. Re-run inspect/apply/inspect with bounded, idempotent staging operations only after query service is responsive.
3. Run managed acceptance and inspect persistent job audit; retain the exact run evidence.
4. Configure separate test integrations/staging runtime, perform real Telegram/VK signed launch + notification paths.
5. Exercise staging revision rollback, verify flags off and ordinary CRM/Telegram/VK paths.
6. Keep production and real advertising disabled pending full acceptance.
