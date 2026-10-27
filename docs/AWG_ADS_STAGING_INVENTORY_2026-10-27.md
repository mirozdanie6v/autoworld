# AWG Ads managed staging inventory — 27 October 2026

Status: PARTIAL. No production writes, deploy, bot-webhook changes or real CRM mutations performed by this workstream.

## Verified in Cloud Browser
- Cloud: b1ggsmuiq7tb2d27f89q.
- Actual folder: b1g8u8vqkgehvtbj8n13. The old inventory workflows incorrectly passed the cloud ID as folderId; this is fixed.
- Existing databases (read-only list): auto-sale-db etnr90ntl17oucsncg1k, production etn00ojk5iv1u7dgpdar, VK test etnhujtu1t6f89tdtohs. None is an approved ads CRM target.
- CREATED ads YDB: awg-ads-stage-b-staging / etnseoqfsf7ojn52813t.
- Path: /ru-central1/b1ggsmuiq7tb2d27f89q/etnseoqfsf7ojn52813t.
- Connection: grpcs://ydb.serverless.yandexcloud.net:2135/?database=/ru-central1/b1ggsmuiq7tb2d27f89q/etnseoqfsf7ojn52813t.
- Running, Serverless OLTP; enabled throttling 10 RU/s, 1 GB storage ceiling, provisioned RCU 0, deletion protection YES. Budget alert not yet configured. No schema or data initialized.
- CREATED dedicated service account: awg-ads-staging-ci / aje3j5aat66lel86cd5r, no folder roles or keys assigned by this workstream.
- CREATED dedicated federation: awg-github-ads-staging / ajebuniclp0pmef8echj. Issuer https://token.actions.githubusercontent.com ; AUD https://github.com/mirozdanie6v ; JWKS https://token.actions.githubusercontent.com/.well-known/jwks .
- Federation-to-SA binding is prepared in the UI but NOT submitted; cloud-access grant requires action-time confirmation under the Cloud Browser policy.

## Actual GitHub OIDC evidence
https://github.com/mirozdanie6v/autoworld/actions/runs/40510964315
Job 122212444811 obtained a JWT and verified the exact claims:
- iss: https://token.actions.githubusercontent.com
- sub: repo:mirozdanie6v@49186663/autoworld@1398349654:environment:awg-ads-staging
- aud: https://github.com/mirozdanie6v

The run correctly stopped before cloud exchange because AWG_ADS_STAGING_SA_ID was absent. This is not proof that IAM exchange succeeds.
Both read-only workflow guards now require the immutable subject and verified folder, forbid legacy deploy SA fallback, and emit only non-secret claims. Earlier same-day notes containing the plain repo:owner/name subject are superseded.

CI on 16c8cffaa14853a593f9b4f714698b80b09a6ec0:
- Stage B SUCCESS: https://github.com/mirozdanie6v/autoworld/actions/runs/40510969009
- AutoWorld SUCCESS: https://github.com/mirozdanie6v/autoworld/actions/runs/40510968995

## Pending confirmation and work
1. Confirm exact federation binding above to aje3j5aat66lel86cd5r; no wildcard subjects or production SA.
2. Confirm ydb.auditor metadata-only inventory permission on folder b1g8u8vqkgehvtbj8n13, and database-scoped ydb.editor only on explicitly approved staging databases. Never grant folder-wide ydb.editor.
3. Create separate awg-ads-crm-stage-b-staging with the same 10 RU/s, 1 GB, provisioned 0, deletion-protection configuration. Automatic approval review REJECTED the submit because it considered the second CRM resource outside explicit advertising DB scope and a cost side effect. No retry or alternate API was used.
4. COMPLETED: GitHub environment variable AWG_ADS_STAGING_SA_ID=aje3j5aat66lel86cd5r saved and visually read back. Deployment branch rule saved and verified: only feature/awg-ads-stage-b-integration, 1 branch and 0 tags. Cloud binding remains unapplied.
5. Re-run read-only inventory, require HTTP 200 IAM exchange; prove absence of production data access without reading production customer records.
6. Apply reviewed schemas only after both actual staging IDs and their access are verified; inspect/apply/inspect.
7. Set IAM_VERIFIED and MAINTENANCE_ENABLED only after evidence; then run bounded reconciliation/retention against disposable staging fixtures and inspect durable leases/audit.
8. Physical Telegram/VK E2E requires a staging runtime and separate test integrations. Do not reuse/replace production webhook or write into existing real CRM.
9. Test staging rollback: disable job runner, disable ads flags, switch only staging runtime to previous known revision; verify basic CRM path, no new ads receipts and no production changes. Not yet executed.

Managed jobs, physical Telegram/VK E2E, data-plane isolation acceptance and rollback remain NOT_VERIFIED.
