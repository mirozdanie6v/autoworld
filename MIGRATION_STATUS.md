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

Only current or safe operational workflows are enabled in this repository:

- `verify-autoworld.yml` — regression suite, critical syntax checks and Docker image build;
- `deploy-yandex.yml` — manual Yandex deployment with live post-deploy checks;
- `configure-autoworld-telegram-bot.yml` — manual bot/menu/webhook configuration;
- `deploy-telegram-relay.yml` — manual Cloudflare Telegram relay deployment;
- `clear-auto-sale-demo.yml` — manual CRM/outbox cleanup while preserving catalog/team/admin access;
- `responsive-audit.yml` — manual live responsive audit.

AWG production-changing workflows are manual. The production target is `https://awg.viiversion.com` and must use isolated `AWG_*` Yandex/YDB/Object Storage resources. The legacy `auto-sale-demo.viiversion.com` contour remains controlled by `mirozdanie6v/uniq-smart-rent` and must not be changed from this repository.

## Intentionally excluded

- UNIQ Smart Rent UI/backend/domain code;
- UNIQ motorcycle fleet media;
- PET NIKA / True Surf / unrelated workflows;
- historical preview screenshots;
- one-off hidden trigger marker files;
- obsolete setup/diagnostic/inspection workflows tied to the old mixed repository;
- old catalog import/refresh workflows that still write through retired whole-state `PUT /api/auto-sale/state`.

The catalog datasets and import/scrape scripts are retained, but live catalog maintenance must be moved to the normalized entity API before its workflow is re-enabled.

## Production cutover gates

Before the new repository becomes the deployment authority:

1. configure the required GitHub repository variables/secrets in `mirozdanie6v/autoworld`;
2. verify Yandex workload-identity/OIDC trust accepts the new repository;
3. run the manual Yandex deployment from `main`;
4. verify health, normalized YDB reads, three-admin RBAC, Telegram relay/webhook and lifecycle delivery;
5. verify the public Mini App/domain still points to the resulting Yandex revision.

The old `mirozdanie6v/uniq-smart-rent` repository remains historical source only for AutoWorld after cutover; it continues to exist for its UNIQ project.


## AWG production contour

- Repository: `mirozdanie6v/autoworld`
- Production domain: `https://awg.viiversion.com`
- Production workflow: `.github/workflows/deploy-awg-production.yml`
- Required resource namespace: `AWG_*`
- Required isolation: separate Yandex Serverless Container, separate YDB connection/database, separate Object Storage bucket.
- The legacy demo remains on `mirozdanie6v/uniq-smart-rent` / `https://auto-sale-demo.viiversion.com` for temporary three-person testing.
- No AWG workflow may clear, repoint, or deploy the legacy demo.
