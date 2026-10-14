# AWG / Timeweb — fresh installation without YDB

Tracking: [VII-171](https://linear.app/viiversion/issue/VII-171) (subtask of VII-163).

This path is for a **brand-new, isolated PostgreSQL database** when the Yandex YDB export is not available. It intentionally does not restore historical leads, orders, payments, admin pins or notification outbox. Do not use it to initialize an existing production database. Keep the existing Yandex resources untouched for future recovery.

## Prerequisites

1. A Timeweb Linux server in Russia (planned 1 vCPU / 2 GB RAM / 30 GB NVMe, Ubuntu 24.04), with Docker + Compose, public IPv4 and SSH. This is a target, not proof of provisioned capacity. The earlier `prepare-awg-timeweb-staging.yml` workflow is **outdated**: it targets 2 CPU / 4 GB / 50 GB under a 1,080 RUB cap. Do not use its `create_server=true` setting without revising and rechecking prices.
2. A **new** Docker PostgreSQL volume, with no existing AWG data. The fresh initializer is fail-closed on any existing rows, admin bindings or notification outbox items.
3. A staging-only hostname: `timeweb-staging.viiversion.com` or `awg-timeweb-staging.viiversion.com`. It must not point at the production backend. Configure its DNS to the new host when ready for public HTTPS testing.
4. A Timeweb S3 bucket for **public catalogue photos only**, with private access keys for writes. Keep confidential backups in a separate private location.
5. Random PostgreSQL password and API key, configured as private files on the server, never committed to GitHub. Separate integration tokens are needed **later**, once staging is verified.

## Build & prepare isolated staging

On a trusted build machine with a checkout of the `autoworld` branch:

```bash
npm ci
npm run check
docker build -f Dockerfile.timeweb -t autoworld-timeweb:<exact-commit-sha> .
```

Transfer the built image securely to the Timeweb server, along with `dist/`, `infra/timeweb/compose.yaml`, `infra/timeweb/Caddyfile` and `scripts/deploy-awg-timeweb-fresh.sh`. Place the files at:

```text
/opt/awg/staging/
  compose.yaml
  Caddyfile
  .env
  runtime.env
  deploy-awg-timeweb-fresh.sh
  static/index.html
  static/assets/...
```

Copy the contents of `dist/` into `static/`. Create `.env` on the Timeweb host with mode `0600`:

```dotenv
AWG_STAGING_HOST=timeweb-staging.viiversion.com
AWG_RUNTIME_IMAGE=autoworld-timeweb:<exact-commit-sha>
AWG_POSTGRES_PASSWORD=<long-random-password>
```

Use `infra/timeweb/runtime.env.example` for `runtime.env`, also mode `0600`:

- Set `AUTO_SALE_API_KEY` to a new, private random secret.
- Configure S3 endpoint, bucket, region and access keys once the bucket exists.
- Leave `AUTO_SALE_NOTIFICATION_PUMP_ENABLED=false`, `AUTO_SALE_VK_ENABLED=false` and `AUTO_SALE_VK_WEB_ENABLED=false`.
- Leave `AUTO_SALE_TELEGRAM_BOT_TOKEN` and `AUTO_SALE_VK_COMMUNITY_TOKEN` **empty**, and do not provide YDB credentials.
- Do not enable public demo writes or use a production hostname.

On the newly prepared Timeweb host:

```bash
cd /opt/awg/staging
AWG_FRESH_CONFIRM=I_ACCEPT_EMPTY_AWG_STAGING bash ./deploy-awg-timeweb-fresh.sh
```

The script starts PostgreSQL only, creates the normalized schema and three initial managers (Дмитрий, Алексей, Иван), then starts app/Caddy. It verifies an internal `/api/health` response. It never invokes YDB backup restore, production DNS changes or physical Telegram/VK webhooks. A second run refuses to reinitialize existing data.

## Populate catalogue only after media validation

The repository includes `data/autoworld-georgia/catalog-import.json` with **149** historical catalogue entries, dated through 2026-09-25. Its **1,016** photo references point to Yandex Object Storage; the photos themselves are not embedded in that JSON. When Yandex is unreachable, directly importing these entries would create broken galleries.

1. Recover photographs from the original Telegram source and/or any verifiably accessible original objects; upload files into the new S3 bucket and check read access and bytes.
2. Rewrite catalogue photo URLs to the verified new bucket. Recheck VIN-less items by stable source post IDs and remove duplicates.
3. With staging-only import credentials, run `scripts/sync-autoworld-catalog.mjs` against `https://timeweb-staging.viiversion.com/api/auto-sale/admin/catalog-import` with a validated local `SOURCE_PATH`. Do not use the script's default production URL. Initially omit `REPLACE_SOURCE_ALL`.
4. Verify cars, counts, galleries and freshness, then re-enable incremental source synchronization for the **new** endpoint only.

## Acceptance checks before production cutover

- `/api/health`: `persistence=postgresql`, `normalizedAuthoritative=true`, `legacyStateWrite=retired`; no YDB dependency.
- HTTPS, responsive catalogue, photos and client application form work from at least two networks in Russia.
- Client role isolation, new lead, manager routing/ownership, changes of status and note/payment flows are tested with disposable records.
- Re-link real manager Telegram identities safely (the fresh database starts with usernames but no historical numeric user-ID claims).
- Configure the existing Telegram bot/VK app only after coordination, with one authoritative webhook sender, no duplicate notification pump. Confirm VK login widget only appears in the web browser.
- Verify private PostgreSQL backups and **test one restore**. Preserve the inaccessible YDB and its historical data for possible future selective import.
- Switch `awgcars.ru` and associated Telegram/VK links **only after** all checks pass. Updating DNS or webhooks is not part of this script.

## Recovery caveat

If the original YDB comes back online, do not restore its snapshot over the newly active PostgreSQL database. Historical and newly created records need a reviewed, conflict-aware merge. Never discard new leads to roll back a migration.
