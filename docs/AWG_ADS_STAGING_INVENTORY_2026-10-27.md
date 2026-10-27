# AWG Ads managed staging — verified state, 27 October 2026

Status: PARTIAL. Read-only SQL has recovered; historical compilation-timeout root cause remains unconfirmed. Full managed acceptance is blocked separately by an invalid constant-query deny assertion; see follow-up investigation below.
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

The workflow verifies exact repo/ref/SA/OIDC claims and actual names/IDs/status of both approved databases before any schema/data operation. Ads schema was provisioned once; subsequent runs are inspect-only and require an independent SELECT inspection, then test real normalized CRM commits, two campaigns, idempotent receipts, durable leases, controlled reconciliation/retention, and bridge feature-off/on rollback. It deliberately does not claim physical Telegram/VK delivery or deployment rollback. It shares the maintenance concurrency group.

Managed cloud attempts:
- https://github.com/mirozdanie6v/autoworld/actions/runs/40521583051 — two failed attempts.
  First failure: read-only schema SELECT after DDL; server YDB 400090 TIMEOUT, Query compilation timed out.
  Retry: CREATE TABLE IF NOT EXISTS in ensureAdsAttributionSchema; same server error.
- https://github.com/mirozdanie6v/autoworld/actions/runs/40522783176 — after acceptance fixture ID correction; same schema-stage failure.
Do not claim managed acceptance PASS. Do not repeatedly rerun compilation timeouts without new evidence or provider recovery.

Current workflow/code at 92d9fb6b0ce074c1701d287f526d50377f6f41f2:
- Stage B regression SUCCESS https://github.com/mirozdanie6v/autoworld/actions/runs/40525340314
- AutoWorld regression SUCCESS https://github.com/mirozdanie6v/autoworld/actions/runs/40525340324
- Managed script syntax, workflow YAML, shell and OIDC JavaScript syntax checked.
Code CI does not prove cloud runtime success.

## Independent Cloud Console query diagnosis
- SELECT 1 AS staging_health completed and returned 1.
- SELECT * FROM awg_ads_campaigns LIMIT 1 failed with GRpc error (4): Deadline Exceeded.
- Both were executed only on ads staging etnseoqfsf7ojn52813t using the signed-in cloud owner session.
- Therefore table access failure is reproduced independently of the GitHub runner and its staging SA. The exact service/metadata/shard root cause is still unknown; do not claim a global YDB outage.
- No query is left running. Console screenshot and nine-table list were captured.

## Bounded ads-only recovery attempt
- Stopped and started only awg-ads-stage-b-staging / etnseoqfsf7ojn52813t. Verified Stopped -> Starting -> Running in Cloud Browser.
- No database was deleted, no IAM scope/limits were widened, and all nine tables survived.
- Immediately after Running, both Cloud Console and managed inspect run 40525334539 attempt 1 saw Discovery/ListEndpoints NOT_FOUND. This transient discovery failure cleared in the console on one retry.
- Repeating the exact table SELECT after discovery recovered still failed with gRPC Deadline Exceeded. Stop/Start did not resolve table access.
- Managed workflow was changed in commit 92d9fb6 to remove repeated ads DDL; it now inspects the already provisioned schema. Attempt 2 was the bounded read-only recheck after endpoint discovery recovered: job 122267015794 failed with YDBError 400090 TIMEOUT / Query compilation timed out on SELECT inspection. Both approved database inventory checks and OIDC HTTP 200 succeeded; all managed transactions/jobs were skipped. Run: https://github.com/mirozdanie6v/autoworld/actions/runs/40525334539 .
- Final console read-back: ads database Running, throttling 10 RU/s, max size 1 GB, provisioned capacity 0, deletion protection Yes. No console query or acceptance job is left running.

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
2. Re-run inspect-only managed acceptance after query service is responsive; all nine ads tables already exist. Do not repeat schema DDL to diagnose a SELECT timeout.
3. Run managed acceptance and inspect persistent job audit; retain the exact run evidence.
4. Configure separate test integrations/staging runtime, perform real Telegram/VK signed launch + notification paths.
5. Exercise staging revision rollback, verify flags off and ordinary CRM/Telegram/VK paths.
6. Keep production and real advertising disabled pending full acceptance.

## Follow-up root-cause investigation — 27 October 2026, 16:30 UTC

Current status supersedes the earlier persistent-query-failure statement: the read-only SQL path is now working. The internal cause of the historical compilation timeout is NOT confirmed.

Verified through Cloud Browser:
- Opening the existing awg_ads_campaigns row table returns its columns and an empty result.
- Explain of a primary-key query completes with TablePointLookup.
- The primary-key SELECT completes with an empty result.
- The original SELECT * FROM awg_ads_campaigns LIMIT 1 completes without changing the table or SQL semantics; a subsequent commented variation also completes.

Independent GitHub-only read-only workflow:
https://github.com/mirozdanie6v/autoworld/actions/runs/40541435270
job 122320564008, commit 6d5d52125b7ef72f4a07e221e28695bafac2e4dc.
Uses the same dedicated SA, same approved databases, locked dependencies and snapshotReadOnly isolation; no production connections or writes.
| Probe | Result | Client elapsed |
|---|---|---|
| Ads discovery | PASS | 1096 ms |
| Ads constant query | PASS | 1293 ms |
| Ads SchemeService inventory | PASS | 197 ms |
| Original ads SELECT * LIMIT 1 | PASS | 251 ms |
| Ads primary-key SELECT | PASS | 197 ms |
| CRM staging discovery | PASS | 706 ms |
| CRM staging constant query | PASS | 1074 ms |

Completion: failures=0, productionConnections=0, writes=0. No IAM, quota, schema or resource changes were made in this follow-up diagnosis.

Interpretation: a permanent SQL syntax/schema incompatibility is not supported by the successful identical query. The earlier 400090 response was generated by server-side query compilation. A transient server-side condition is plausible, but queueing, schema resolution, node recovery and RU limits have NOT been distinguished. No proof of an SDK bug, corrupt table or a specific platform incident was found.

Official Cloud Center statusboard, https://center.yandex.cloud/statusboard , updated 27 October 19:32 MSK, lists Managed Service for YDB with restrictions: access restored for most existing clusters and limited creation of new clusters. This is platform context, NOT a confirmed causal link to this database timeout.

### Separate current acceptance-test defect

The newer managed run https://github.com/mirozdanie6v/autoworld/actions/runs/40538834473
job 122311346525 passed metadata schema inspection, then failed at scripts/test-awg-ads-managed-staging.mjs:70:
AssertionError: staging SA must have no production data-plane access.
The test executes SELECT 1 without a FROM clause against the production endpoint and incorrectly treats successful constant evaluation as proof of customer-table access. It reads no customer table. The ydb.auditor role explicitly permits database connections and schema metadata access; official reference: https://yandex.cloud/en/docs/ydb/security/ .
This assertion does not establish a production data permission leak. Actual production row-level deny remains NOT VERIFIED. Do not remove the isolation gate or label acceptance PASS just to bypass this failure. This follow-up read-only workflow never connects to production.

### Prepared provider diagnostic request — NOT SENT

Subject: Historical Query compilation timed out on a new serverless YDB; identical query now succeeds

Please identify the internal cause of server-side compilation timeouts for database etnseoqfsf7ojn52813t, folder b1g8u8vqkgehvtbj8n13, cloud b1ggsmuiq7tb2d27f89q, on 27 October 2026.

At 15:00:01.865 UTC, SELECT * FROM awg_ads_campaigns LIMIT 1 using snapshotReadOnly failed with YDBError 400090 TIMEOUT / Query compilation timed out. GitHub job 122267015794 in run40525334539 provides timing and error evidence. Earlier table SELECT failed independently in Cloud Console under the cloud owner with gRPC Deadline Exceeded; SELECT 1 and schema listing worked. A bounded Stop/Start of only this database preserved all nine tables and restored Running, but the timeout persisted at that time.

At 16:29:59.091 UTC the same table query, same SA aje3j5aat66lel86cd5r and same snapshotReadOnly isolation succeeded in 251 ms. A primary-key SELECT succeeded in 197 ms, schema listing in 197 ms. No schema, grants, RU ceiling (10 RU/s), provisioned capacity (0) or storage cap (1 GB) were changed during this diagnostic comparison. The table is empty.

Please correlate the failed query with server-side KQP compilation traces and determine whether the wait occurred in compiler queue/admission, schema resolution/cache, metadata service availability, node recovery or another subsystem. Please confirm whether the restoration restrictions shown on the statusboard affected this database. We need the responsible component and corrective action, rather than a timeout increase.

No IAM token, GitHub JWT, credentials, customer records or production data are included. This request is prepared for review only; it has not been submitted to support.
