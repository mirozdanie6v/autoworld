# AWG Ads managed staging — verified state, 28 October 2026

Status: PARTIAL. Production table-read denial and one-time retention are verified. CRM staging SQL compilation blocks synthetic lead commits and reconciliation. Physical E2E/deployment rollback remain blocked; see 28 October acceptance evidence below.
Production deployment, real customer records, production Telegram/VK configuration and paid advertising were not modified by this workstream.

## Current acceptance summary
| Check | Verified outcome |
|---|---|
| Dedicated SA production data boundary | Explicit native table-read denial PASS |
| Ads schema / CRM staging schema | 9 Ads + 13 CRM tables verified |
| Ads subject/event persistence | Synthetic old/current fixtures written and read back |
| Application CRM lead commits / attribution across two DBs | BLOCKED before commit by CRM SQL compilation timeout |
| One-time retention | PASS; expired fixture removed, fresh fixture preserved, audit read back |
| One-time reconciliation | Invoked, FAILED on CRM reads; failure audit read back |
| Worker lease cleanup | PASS; no remaining leases |
| Physical Telegram/VK E2E | Not performed; dedicated test configuration/runtime missing and Telegram sign-in blocked by auto-review |
| Deployment rollback | Not performed; no isolated Ads runtime revision deployed |


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
The initial SELECT 1 negative probe was invalid and has been replaced. Native TableService StreamReadTable of only auto_sale_state.id now receives explicit denial under the dedicated staging SA; see 28 October evidence. No production payload/customer columns or production writes are performed.

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

## 28 October 2026 — executed acceptance and remaining blockers

### Isolation — PASS
- Replaced the invalid constant-query deny assertion in scripts/test-awg-ads-managed-staging.mjs.
- Dedicated SA can evaluate SELECT 1; this is deliberately not considered evidence of row-data access.
- Direct TableService StreamReadTable requests only auto_sale_state.id, rowLimit=1. It must return YDB UNAUTHORIZED (400020) or explicit gRPC PERMISSION_DENIED (7); any successful response, timeout, syntax error or unknown failure fails closed.
- Multiple managed executions printed AWG_STAGING_ISOLATION_VERIFIED: productionTableReadDenied=true, productionWrites=0, customerColumnsRequested=0.
- Evidence run https://github.com/mirozdanie6v/autoworld/actions/runs/40658827263 , job122716426336. No production roles were expanded; no static credentials created.

### CRM staging schema — PASS; application writes — BLOCKED
- Native TableService created only missing tables and independently described all 13 CRM staging tables, verifying exact columns, primitive/optional types and primary keys against existing application declarations.
- Target fixed to etnvd9hmimkt74vpuqa6; no existing schema is dropped, altered or recreated.
- Native StreamReadTable on auto_sale_state.id succeeds (AWG_CRM_STAGING_NATIVE_READ_OK).
- TableService ExecuteDataQuery fails during compilation; ordinary application loadState retries 3 x 7 s and fails. No managed synthetic CRM lead commit has succeeded.
- Read-only matrix https://github.com/mirozdanie6v/autoworld/actions/runs/40659308802 , job122718030356:
  - Ads original SELECT: 205 ms PASS; Ads point SELECT: 198 ms PASS.
  - CRM connection and constant query: PASS.
  - CRM TableService onlineReadOnly / snapshotReadOnly, each with relative and fully qualified table path: all FAIL, status400090, Request timeout 10000ms exceeded; Cancelling after 10000ms during compilation.
  - CRM QueryService snapshotReadOnly: client timeout after 20 s.
- This rules out table-path qualification and read-isolation choice as sufficient fixes. Metadata and native row access work while SQL compilation fails. The exact internal compiler/service cause is still unconfirmed; do not claim an IAM leak, corrupt data or a proven global outage.

### One-time jobs — physically invoked; retention PASS, reconciliation FAILED
New isolated workflow .github/workflows/verify-awg-ads-maintenance-staging.yml and script scripts/test-awg-ads-maintenance-staging.mjs.
Run https://github.com/mirozdanie6v/autoworld/actions/runs/40658475594 , job122715249693.
- Persisted expired (120 days) and current synthetic Ads subject/event fixtures in Ads staging.
- Invoked reconciliation once: exit1 due to CRM reads; durable audit status failed.
- Invoked retention once: exit0, job_complete status ok.
- Read back that expired subject and event were deleted, current subject and event were preserved.
- Durable current-run audit confirmed retention=ok and reconciliation=failed.
- Read back awg_ads_job_leases: empty; both workers released their leases.
- No production connection in this independent maintenance run, no production writes, no Telegram/VK messages.
- Cloud Console independently displays both audit records: retention at 2026-10-28T08:41:12.612Z, reconciliation at 2026-10-28T08:41:07.256Z.
- The workflow remains red intentionally because reconciliation failed; retention success is not misreported as full acceptance.
- Continuous schedules/maintenance flags are not enabled.

### Physical E2E and revision rollback — BLOCKED, not claimed
- GitHub repository secret metadata still contains only general bot/app/community secrets; no environment secrets or separately identified Ads staging credentials.
- Cloud inventory has 4 containers: legacy auto-sale-staging, autoworld-awg-prod, autoworld-vk-web-staging, legacy autoworld-awg. No separate Ads E2E runtime was found or changed.
- Lockbox metadata has VK staging API/session and VK web-session secrets, not an identified separate Ads test Telegram bot or VK test app/community.
- Telegram Web is at QR sign-in. Secure browserAuth QR request was rejected by automatic security review (not by the user): test integration authorization was judged insufficient to authorize access to a personal Telegram session and its private correspondence.
- No login workaround or manual-takeover bypass was attempted. A separate explicit authorization for that personal-account sign-in, or independently supplied dedicated bot/app test configuration, is required.
- Production bot/webhook/community/containers, real CRM records and paid ads were not changed.
- No physical platform E2E, deployment rollback or bridge flag smoke is counted as passed in this session.

### Code validation
Latest completed code checks at 8aec3e4: Stage B SUCCESS https://github.com/mirozdanie6v/autoworld/actions/runs/40660298940 ; AutoWorld SUCCESS https://github.com/mirozdanie6v/autoworld/actions/runs/40660298957 .
Cloud script syntax checks passed. These green regressions do not override the runtime failures above.

### Bounded CRM-only recovery
Stopped and started only etnvd9hmimkt74vpuqa6 after all probes/jobs had finished. Verified Stopped -> Running; all 13 tables survived. Endpoint discovery briefly returned NOT_FOUND, then recovered in Cloud Console. No database deletion, IAM widening or quota increase was performed.
Post-restart run https://github.com/mirozdanie6v/autoworld/actions/runs/40659110921 attempt2, job122720824550: explicit production table deny PASS, native CRM row read PASS, fully qualified CRM SQL still status400090.
One final diagnostic explicitly requested a 65 s operation/cancellation budget, keeping application runtime read limits unchanged:
https://github.com/mirozdanie6v/autoworld/actions/runs/40660292190 , job122721339216.
At 08:55:50.724 UTC native CRM row access succeeded; at 08:56:01.004 UTC SQL again failed crm_qualified_native_sql_400090. The request still failed after about 10 s; an effective 65 s server budget was not demonstrated. Increasing a requested timeout is not counted as a repair.
Both databases remain Running, no query/job remains active, all one-time maintenance leases were released, no continuous schedule was enabled.

### Updated provider request — prepared, NOT SENT
Please investigate CRM staging database etnvd9hmimkt74vpuqa6 in folder b1g8u8vqkgehvtbj8n13, cloud b1ggsmuiq7tb2d27f89q, on 28 October 2026 around 08:34–08:56 UTC.
Native SchemeService and TableService Create/Describe work, all 13 table definitions are verified, and StreamReadTable(auto_sale_state, columns=[id], rowLimit=1) succeeds under owning SA aje3j5aat66lel86cd5r.
However SELECT id FROM auto_sale_state WHERE id=1ul fails during compilation through TableService ExecuteDataQuery. Both relative and full table paths, onlineReadOnly and snapshotReadOnly produce status400090 with Request timeout 10000ms exceeded / Cancelling after 10000ms during compilation. QueryService also times out. SELECT 1 succeeds; the separate Ads staging database etnseoqfsf7ojn52813t executes table SQL in ~200 ms.
Restarting only the CRM staging DB did not resolve the issue. Throttling10 RU/s, storage1 GB, provisioned0 were unchanged.
Please identify the KQP/compiler/schema-resolution failure using server traces; explain why native row reads work while compilation waits, and whether a service-side recovery or supported configuration is needed.
Evidence: run40659308802/job122718030356, post-restart run40659110921/job122720824550, final run40660292190/job122721339216. No credentials, customer rows or private Telegram data are included.
