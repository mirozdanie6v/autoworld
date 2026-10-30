# Dedicated Telegram staging — current verified result

## Connected baseline
- Bot: @auto_sale_usa_bot, ID 8824530254.
- Application: https://bba5hanjiq9ngu77i8p9.containers.yandexcloud.net/
- Successful deployment: https://github.com/mirozdanie6v/autoworld/actions/runs/41095731832
- Source commit: 4a02f1fd0c6e39ee0ce751bbc99c0f9e23ad5d1e.
- Active revision: bban3uubfh8kk81ujtkf.
- Image digest: sha256:68960021ad25c853a127f297aeaafd60af8bd8e6c43a789a416615fc8bf807b0.
- Runtime health, exact build SHA, static page and Telegram service passed.
- Unsigned webhook returned 401; signed empty update returned 200 without sending a message.
- Anonymous batch write was denied.
- Telegram setWebhook succeeded and getWebhookInfo confirmed the exact derived staging URL.
- Default bot menu is “Тестовый каталог” and opens the staging application.
- Ads attribution remains OFF. Physical Telegram user /start and Mini App E2E remain NOT VERIFIED.

## Approved isolated configuration
User explicitly authorized the four scoped IAM grants and two independent persistent random private keys. All were applied/saved. Secret values are absent from source and this document.
GitHub repository secrets: AWG_ADS_STAGING_TELEGRAM_BOT_TOKEN, AWG_ADS_STAGE_B_SUBJECT_SECRET, AWG_ADS_STAGING_API_KEY.
Subject identity: aje3j5aat66lel86cd5r.
Registry crpkirscqc5gt6dgeujr: container-registry.images.pusher only.
Container bba5hanjiq9ngu77i8p9: serverless-containers.editor to that identity and containerInvoker to system:allUsers.
Service account: iam.serviceAccounts.user on itself only.
CRM DB etnvd9hmimkt74vpuqa6; Ads DB etnseoqfsf7ojn52813t.
Public demo writes, legacy state writes, dual writes, VK auth, production relay and periodic notification/reconciliation pumps are disabled.
No production deployment, production bot or production database was changed.

## Failure resolved and remaining validation
Previous run 40948591513 stopped publishing with registry HTTP 503 before deployment. Bounded retries for 502/503/504 were added; run 41095731832 completed successfully.
Verify AutoWorld run 41095742169 passed. Stage A/B tests and full regressions in run 41095731136 passed, but its final changed-path guard rejected the newly authorized dedicated staging workflow absent from the older allowlist. This check is still red; do not report all CI green.
Browser visual verification was blocked by automatic approval review usage limit. Server checks above ran independently through the authorized GitHub workflow.
Earlier image-only evidence: run 40936554651. It is superseded for runtime connection by run 41095731832.
