# AWG Ads Stage B — isolated cloud release gate (27 October 2026)

## Measured state (evidence, not assumptions)
- Working Yandex Cloud federation exists **only as historical evidence on main**:
  VK staging full-cycle GitHub Action 39749975626, 22 October 2026, PASS,
  including a successful OIDC exchange for existing VK staging.
- Feature branch Stage B inventory Actions 40491157017 and 40490868274
  failed on Yandex token exchange HTTP 401 (branch identity not trusted by
  the existing service account or federation).
- Branch-specific OIDC claims confirmed by Actions 40494930637,
  40497406694:
  - issuer: `https://token.actions.githubusercontent.com`
  - audience: `https://github.com/mirozdanie6v`
  - **exact subject**:
    `repo:mirozdanie6v@49186663/autoworld@1398349654:ref:refs/heads/feature/awg-ads-stage-b-ops-acceptance`
- Independent staging-only IAM audit Action 40497406694 failed **before**
  token exchange: GitHub Actions repository variable `AWG_ADS_STAGING_SA_ID`
  is unset. Production SA fallback deliberately prohibited.
- Read-only physical Stage B staging HTTP Action 40498045495 failed before
  any HTTP request: `AWG_ADS_STAGING_URL` and
  `AWG_ADS_STAGING_APPROVED_HOST` are unset.
- No dedicated managed Ads YDB, IAM ACL, schema, cloud scheduler,
  physical Telegram/VK traffic, or production release has been verified.

## Yandex IAM binding (requires authorized cloud operator)
1. Choose or create a **new staging-only Yandex Cloud service account**,
   separate from the existing AWG production deploy identity.
   Store its ID in the repo Actions **variable** `AWG_ADS_STAGING_SA_ID`.
   No long-lived key or production SA may be copied into this branch.
2. Confirm a Workload Identity Federation with issuer, audience and JWKS:
   `https://token.actions.githubusercontent.com`,
   `https://github.com/mirozdanie6v`,
   `https://token.actions.githubusercontent.com/.well-known/jwks`.
3. Create federated credentials for the exact **numeric-ID GitHub OIDC
   sub** above, scoped to that staging SA. Do not replace this custom
   subject with a generic `repo:owner/repo:ref:...` example. GitHub
   prints the actual custom subject.
4. Required permissions to configure the binding include
   `iam.serviceAccounts.federatedCredentialEditor` on the SA and
   `iam.workloadIdentityFederations.user` for the federation folder.
5. Grant only the needed YDB permissions **on explicitly approved isolated
   staging resources**, not on the general production folder:
   `ydb.viewer` for initial read-only inventory; writes/schema need a
   separately scoped staging writer. `ydb.editor` includes powerful
   database-management privileges: do not grant it at broad cloud/folder
   scope. Human review of IAM ACL and resource boundary is mandatory.
6. Rerun the read-only diagnostic workflow
   `.github/workflows/audit-awg-ads-stage-b-staging-federation.yml`.
   Must show an actual successful IAM exchange and limited YDB inventory
   before any schema or job operations.

Official guide: https://yandex.cloud/ru/docs/iam/operations/wlif/setup-wlif

## Database and scheduler gates
- Inventory and explicitly approve **two different** isolated YDB database
  IDs: Ads staging and CRM staging. Neither may match the production AWG YDB
  ID or connection string. Explicitly confirm quotas, RCU throttling,
  reserved capacity, retention and billing before any provisioning.
- Apply only the reviewed Ads schema + job-lease schema to the separately
  identified Ads staging DB. Never run schema initializer against production.
- External job entry point:
  `scripts/run-awg-ads-staging-managed-job.mjs`.
  Jobs are `awg-ads-reconcile` and `awg-ads-retention`. This entry point
  requires `AWG_ADS_STAGE_B_ENABLED=true`,
  `AWG_ADS_MANAGED_JOBS_ENABLED=true`, `isolated-staging`,
  `AWG_ADS_STAGING_RESOURCES_VERIFIED=true`, approved DB IDs and
  dedicated principal. Production DB ID is explicitly denied.
- Native Yandex cloud scheduled container may use a dedicated metadata IAM
  identity. A GitHub-runner job may instead use short-lived OIDC exchange,
  `AWG_ADS_STAGING_CI_OIDC=true` and `YDB_ACCESS_TOKEN_CREDENTIALS`.
  The staging SA ID must match the verified CI principal and differ
  from the production deploy SA.
- Record YDB lease ownership, completion/failure, metric sink and alerts.
  Prove duplicate/concurrent invocations cannot overlap, failed/incomplete
  jobs alert and retry, and retention removes indexed touch history.
- Cross-store user erasure requires a separately authorized principal and
  a verified user; `server/ads-stage-b-crm-privacy.mjs` must CAS-scrub
  only advertising metadata in staging CRM, preserving business records
  and failing on partial deletion. CRM and YDB deletion are not a single
  distributed transaction; retry and auditing are required.

## Physical Telegram/VK and rollback gate
1. Configure `AWG_ADS_STAGING_URL` as an **actual dedicated Stage B
   staging server** and `AWG_ADS_STAGING_APPROVED_HOST` as its hostname.
   Live hostnames are denied by the read-only probe.
2. Run `.github/workflows/probe-awg-ads-staging-http.yml`. It checks
   physical HTTP health, anonymous client advertising-data isolation,
   and director access denial without creating a lead or sending a message.
3. Configure approved dedicated *test* Telegram bot/user identities,
   manager and director, VK test identities and deterministic staged car
   fixture, all excluded from live advertising and customer traffic.
4. Run physical, separately identified tests: two campaigns, signed
   `/start`, Mini App initData validation, catalogue view/click, actual
   normalized CRM commit, server-generated campaign snapshot and secondary
   Ads receipt, duplicate replay, attribution DB outage and recovery,
   manager first status action, director-only report, VK unaffected.
   Confirm notification delivery only via **test messaging accounts**.
5. Cleanup test CRM leads and campaign events in staging, verify no
   orphan metadata. No test may target production webhook or real customers.
6. Disable `AWG_ADS_STAGE_B_ENABLED` and
   `AWG_ADS_MANAGED_JOBS_ENABLED` **in staging**, redeploy and show that
   core Telegram/VK booking and manager paths remain available and existing
   CRM data are not lost. Re-enable only following review.
7. Resolve relevant Telegram/manager Linear issues before production GO.
   **Do not merge production, buy ads, create paid resources or enable
   schedules based solely on local CI success.**

Official YDB IAM guidance:
https://yandex.cloud/ru/docs/ydb/security/

## Automated evidence before any cloud access
- Isolated unit and full AutoWorld regressions:
  `.github/workflows/verify-awg-ads-stage-b-ops.yml`.
- Real disposable localhost YDB lease, retention, suppression and
  normalized CRM privacy-CAS tests:
  `scripts/test-awg-ads-ops-local-ydb.mjs`.
- Two signed synthetic Telegram campaigns, director, manager, VK and
  disabled-flag rollback in `tests/awg-ads-stage-b-acceptance.test.mjs`.
- None of those tests substitutes for actual managed-Yandex or physical
  Telegram/VK evidence.
