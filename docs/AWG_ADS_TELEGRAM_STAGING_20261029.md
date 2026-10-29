# Dedicated Telegram staging continuation — 29 October 2026

## Verified now
- User supplied the dedicated test bot @auto_sale_usa_bot.
- Token persisted as repository secret AWG_ADS_STAGING_TELEGRAM_BOT_TOKEN; no token value appears here.
- getMe verified exact bot ID 8824530254 and username; getWebhookInfo reports no webhook and 0 pending updates.
- Read-only preflight SUCCESS: https://github.com/mirozdanie6v/autoworld/actions/runs/40915959102 (job123596114925, commit d91c03d851ff88e202f4cf36457081680a0dba20).
- Dedicated staging OIDC exchange succeeds; container and registry inventory return HTTP403 under SA aje3j5aat66lel86cd5r. Its YDB permissions do not provide deployment permissions.
- Owner Cloud Shell created container autoworld-ads-telegram-staging, ID bba5hanjiq9ngu77i8p9, URL https://bba5hanjiq9ngu77i8p9.containers.yandexcloud.net/ .
- Owner Cloud Shell created separate registry autoworld-ads-staging, ID crpkirscqc5gt6dgeujr.
- No revision is deployed, no bot webhook is configured, no IAM bindings changed and no production resources/data modified.

## Concrete pending access changes — not executed
Subject: serviceAccount:aje3j5aat66lel86cd5r (existing staging identity only).
1. container-registry.images.pusher on registry crpkirscqc5gt6dgeujr only (includes image pull; does not grant access to production registry crptu0l7jn0iui8b8laa).
2. serverless-containers.editor on container bba5hanjiq9ngu77i8p9 only.
3. iam.serviceAccounts.user on service account aje3j5aat66lel86cd5r itself only, allowing the revision to run under the existing database-isolated identity.
4. serverless-containers.containerInvoker for system:allUsers on container bba5hanjiq9ngu77i8p9 only, so Telegram can call its HTTPS webhook. Application-level Telegram webhook secret and signed Mini App authentication stay required. Public demo write remains false.
No folder/cloud editor grant, production principal, production registry or production database grants are proposed.
Per browser access-control confirmation rules, obtain explicit action-time confirmation before applying these new permissions/public invocation.

## Deployment constraints
Use locked Dockerfile.timeweb and reviewed integrated source. Publish only to cr.yandex/crpkirscqc5gt6dgeujr/autoworld-ads-staging with immutable commit tag/digest.
CRM: etnvd9hmimkt74vpuqa6; Ads: etnseoqfsf7ojn52813t.
Retain stable private subject HMAC; no per-process random key. Dedicated token maps to AUTO_SALE_TELEGRAM_BOT_TOKEN. No production relay secret/config inheritance.
Create baseline with Ads OFF, verify runtime health and isolation; enable candidate with explicit isolated-staging flags. Verify exact bot identity again before registering its webhook; derive webhook path/secret using createTelegramService.
Physical user E2E and revision rollback remain unverified.

## Cloud Shell fallback
Sources cloned to /tmp/awg-ads-staging-20261029, exact commit d91c03d851ff88e202f4cf36457081680a0dba20. Home filesystem rejected git chmod.
Docker is absent. Attempted apt install was blocked by a pre-existing interrupted dpkg state; configuration progressed but Docker install still reports unmet dependencies. No Docker daemon/image build was claimed. Prefer GitHub runner deployment after scoped access approval rather than repairing unrelated Cloud Shell packages.

## 30 October 2026 — approved IAM applied; image published
User explicitly approved the four staged grants. Owner Cloud Shell applied and read back exactly:
- container bba5hanjiq9ngu77i8p9: serverless-containers.editor to serviceAccount:aje3j5aat66lel86cd5r, containerInvoker to system:allUsers.
- registry crpkirscqc5gt6dgeujr: container-registry.images.pusher to serviceAccount:aje3j5aat66lel86cd5r.
- service account aje3j5aat66lel86cd5r itself: iam.serviceAccounts.user to the same serviceAccount.
No folder/cloud-level grants or production principal changed.

Image workflow PASS: https://github.com/mirozdanie6v/autoworld/actions/runs/40936554651 , job123668504337.
Dedicated bot reverified; exact staging container and registry API reads now HTTP200.
Locked Dockerfile.timeweb build and runtime module/default-OFF check passed.
Published image:
cr.yandex/crpkirscqc5gt6dgeujr/autoworld-ads-staging@sha256:2dae11b0b6e4dfeeca7bf1afde2fc955363ce7bc1299838370c8b8695fa004aa
Source commit: 2f052672dd3787c718ca9741083f21aee111a98d.

Guarded deploy script: scripts/deploy-awg-ads-telegram-staging.mjs, syntax checked; NOT EXECUTED.
It requires explicit deployment marker, exact repo/ref/image registry, dedicated Telegram identity, stable HMAC secret and dedicated API key. It deploys baseline Ads OFF, then verifies health, unsigned webhook denial, anonymous write denial, static app and exact webhook readback before reporting connected. It does not claim a physical Telegram user E2E.

Automatic approval review REJECTED generating/submitting AWG_ADS_STAGE_B_SUBJECT_SECRET to GitHub because the IAM/deployment approval did not explicitly authorize that new persistent sensitive secret storage. No workaround was attempted. Runtime also requires a separate AUTO_SALE_API_KEY when public demo writes are false; no reuse of production or bot credentials is proposed.
Pending explicit user approval: generate two independent private random keys, store as repository secrets AWG_ADS_STAGE_B_SUBJECT_SECRET and AWG_ADS_STAGING_API_KEY, and pass them only into this isolated Yandex revision. Neither secret has been submitted. No app revision or bot webhook was deployed.
