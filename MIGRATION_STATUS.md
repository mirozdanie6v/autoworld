# Migration status

Source snapshot: `f9c87829591ff97d4f5e4223c875a96a7329a51a`

## Included

- current AutoWorld UI and branding assets;
- Yandex/YDB backend and normalized entity storage;
- Telegram bot, notification outbox, Cloudflare relay and lifecycle tooling;
- fixed three-admin access control;
- manager Telegram autofill;
- lead/application cascade deletion flow;
- AutoWorld catalog source data and maintenance scripts;
- AutoWorld/YDB/Telegram regression tests;
- Yandex infrastructure and Docker runtime;
- legacy Cloudflare/D1 Worker compatibility config required by regression tests.

## Canonical workflows

Current AutoWorld workflows in this repository:

- `verify-autoworld.yml` — regression suite, critical syntax checks and Docker image build;
- `deploy-awg-production.yml` — canonical AWG production deployment contract;
- `configure-autoworld-telegram-bot.yml` — manual bot/menu/webhook configuration for `https://awgcars.ru/`;
- `deploy-telegram-relay.yml` — manual Cloudflare Telegram relay deployment;
- `responsive-audit.yml` — manual live responsive audit.

The legacy `auto-sale-demo.viiversion.com` contour remains controlled by `mirozdanie6v/uniq-smart-rent` and must not be changed from this repository.

## Intentionally excluded

- UNIQ Smart Rent UI/backend/domain code;
- UNIQ motorcycle fleet media;
- PET NIKA / True Surf / unrelated workflows;
- historical preview screenshots;
- one-off hidden trigger marker files;
- obsolete setup/diagnostic/inspection workflows tied to the old mixed repository;
- old catalog import/refresh workflows that still write through retired whole-state `PUT /api/auto-sale/state`.

The catalog datasets and import/scrape scripts are retained, but live catalog maintenance must be moved to the normalized entity API before its workflow is re-enabled.

## Production cutover status

AWG production is live and verified through the isolated contour:

- YDB: `autoworld-awg-prod` / `etn00ojk5iv1u7dgpdar`;
- YDB endpoint: `grpcs://ydb.serverless.yandexcloud.net:2135/?database=/ru-central1/b1ggsmuiq7tb2d27f89q/etn00ojk5iv1u7dgpdar`;
- Serverless Container: `autoworld-awg-prod` / `bba691o7au7epjqvs77b`;
- API Gateway: `autoworld-awg-prod` / `d5dbgio6limv03usvipl`;
- Object Storage: `viiversion-autoworld-awg-media`;
- canonical public domain: `https://awgcars.ru` (Yandex API Gateway custom domain);
- aliases retained: `https://www.awgcars.ru`, `https://awg.viiversion.com` and existing `.com` aliases;
- Telegram Mini App menu: `https://awgcars.ru/`.

Public domain verification passed for both `/` and `/api/health`; the runtime reports YDB Serverless persistence and uses the isolated AWG database and media bucket.

Yandex workload-identity federation currently trusts the bootstrap executor in `mirozdanie6v/uniq-smart-rent` branch `prototype/auto-sale-usa`. Until federation is extended to `mirozdanie6v/autoworld`, that trusted branch is the deployment executor but checks out canonical source from `mirozdanie6v/autoworld`. After this cutover is merged, the executor must track `autoworld/main`.

The API Gateway currently uses deploy service account `aje775bcl6hgp40eu8of` for private-container invocation. A later least-privilege hardening step is to grant runtime service account `aje8o9ric0d20k11521r` the container-invoker role and switch the Gateway integration back to that runtime account.

The legacy `mirozdanie6v/uniq-smart-rent` AutoWorld demo remains separate and unchanged for three-person testing.


## AWG production contour

- Repository: `mirozdanie6v/autoworld`
- Production domain: `https://awgcars.ru`
- Production workflow: `.github/workflows/deploy-awg-production.yml`
- Required resource namespace: `AWG_*`
- Required isolation: separate Yandex Serverless Container, separate YDB connection/database, separate Object Storage bucket.
- The legacy demo remains on `mirozdanie6v/uniq-smart-rent` / `https://auto-sale-demo.viiversion.com` for temporary three-person testing.
- No AWG workflow may clear, repoint, or deploy the legacy demo.
