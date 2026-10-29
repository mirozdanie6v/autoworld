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
