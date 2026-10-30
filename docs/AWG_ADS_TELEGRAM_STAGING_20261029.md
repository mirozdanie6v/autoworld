# Dedicated Telegram staging — attribution candidate verified

## Current result
- Bot: @auto_sale_usa_bot, ID 8824530254.
- Application: https://bba5hanjiq9ngu77i8p9.containers.yandexcloud.net/
- Ads attribution is ON only in this dedicated staging container.
- Deployment and synthetic server acceptance PASS: https://github.com/mirozdanie6v/autoworld/actions/runs/41099063901
- Source commit: 1858f02c0ed5cc0bd4270fb521d611bda1cb947e.
- Active revision: bbafeqkdoka73701vrng.
- Image digest: sha256:d640dd71bcc24790f31361b1f2a0d31ce148cfb524032f8d22e7c5178672e113.
- CI PASS: push Stage B 41099063895, PR Stage B 41099071470, Verify AutoWorld 41099071464.
- Deployment gate passed 77 isolated tests, 593 AutoWorld tests (1 explicitly skipped), 10 relay tests.
- Runtime health, exact build, static application, unsigned webhook rejection, anonymous write denial and Telegram webhook readback passed.
- Synthetic signed HTTP events miniapp_open and vehicle_detail_click passed; unsigned/invalidly encoded signatures were rejected.
- Duplicate bot starts, Mini App events and lead conversion did not increase counters.
- Real managed CRM transaction stored immutable campaign/car binding; Ads YDB stored one conversion receipt.
- Client HTTP state hid internal attribution; director report denied client and API-key access.
- Repository report counters each equal 1 for synthetic bot start, open, vehicle detail click and lead submission; paid spend/CPL remain null.
- No Telegram message was sent by the synthetic acceptance. Its own temporary CRM lead was removed.
- Empty staging catalog was populated with one clearly marked synthetic QA car, using the application's hosted image. No production catalog was copied.
- Physical Telegram user /start, signed real Mini App launch and HTTP client lead submission remain NOT VERIFIED.

## Next physical client test
Use a client Telegram identity such as flyer_kg; configured admin usernames receive admin access and are excluded from client attribution.
Test campaign link:
https://t.me/auto_sale_usa_bot?start=LVGt2P9Knkf7dOjGyruu48OehMsZL-qH
Open the link, press Start, open the catalog using the bot's button, open the test car and submit a request named “Тест рекламы”.
This public opaque campaign token is an attribution link, not a bot/API/HMAC credential.
Director allowlist, physical VK regression, deployed rollback and continuous scheduled operations remain separate acceptance gates.

## Isolated configuration
User approved the scoped IAM grants and independent stable keys. Values are never stored in source or this document.
Secrets: AWG_ADS_STAGING_TELEGRAM_BOT_TOKEN, AWG_ADS_STAGE_B_SUBJECT_SECRET, AWG_ADS_STAGING_API_KEY.
Identity: aje3j5aat66lel86cd5r.
Registry crpkirscqc5gt6dgeujr: images.pusher.
Container bba5hanjiq9ngu77i8p9: editor for that identity; containerInvoker for system:allUsers.
Service account user role is scoped to itself.
CRM DB: etnvd9hmimkt74vpuqa6. Ads DB: etnseoqfsf7ojn52813t.
Public demo writes, legacy state writes, dual writes, VK auth, production relay and periodic notification/reconciliation pumps remain disabled.
No production deployment, production bot or production database was changed.

## Repairs and historical evidence
- CI now compares the source head against reviewed integrated main baseline 6ece88ced344b6789921f3a3a120a3c641ae36d2, with ancestry checks. Synthetic PR merge changes from newer main are excluded; production-sensitive source differences are still rejected.
- Live negative testing found that Buffer.from(hex) silently truncated malformed signature suffixes. Strict complete SHA256 validation and regression tests now cover Mini App hashes and webhook secrets.
- The first candidate acceptance stopped before its CRM test because the synthetic catalog fixture lacked the required image; this fixture was corrected. Successful run 41099063901 supersedes failed runs 41098026795/41098557793/41098667149.
- Feature-off baseline: revision bban3uubfh8kk81ujtkf, source 4a02f1fd0c6e39ee0ce751bbc99c0f9e23ad5d1e, image sha256:68960021ad25c853a127f297aeaafd60af8bd8e6c43a789a416615fc8bf807b0, deployment run 41095731832.
- Earlier registry HTTP503 was addressed with bounded gateway retries.
- A deployed rollback is not claimed. Browser visual verification remains unavailable from the earlier automatic approval usage-limit rejection.
