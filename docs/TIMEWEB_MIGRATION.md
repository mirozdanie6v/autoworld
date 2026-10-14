# AWG → Timeweb staging

Tracked in [VII-163](https://linear.app/viiversion/issue/VII-163).

Source baseline: `603e41617e66ad5233b0751f651622e16fe691b2` in `mirozdanie6v/autoworld`.
The existing Yandex deployment remains the default. PostgreSQL is selected only with `AUTO_SALE_PERSISTENCE=postgres`; S3 is selected with `AUTO_SALE_MEDIA_PROVIDER=s3`.

## 1. Inspect and provision Timeweb

Add `TIMEWEB_CLOUD_TOKEN` through the repository's Actions secrets UI. Do not send it in chat or commit it. The token needs to inspect/create cloud servers, read tariffs and OS images. `AWG_TIMEWEB_SSH_PUBLIC_KEY` is a repository variable containing a deployment Ed25519 public key; keep its private counterpart outside the repository.

Run **Prepare AWG Timeweb staging** with `create_server=false` first. It reads the live account, selects a Russian 1 CPU / 2 GB / 30 GB preset and reports its base price. The price cap is 1,940 RUB/month (base server only), excluding IPv4, storage and backups. It fails instead of silently choosing a higher tariff.

With `create_server=true`, it creates at most one server named `awg-timeweb-staging`, in `spb-3`, using Ubuntu 24.04 and Docker. The setup changes no production DNS and no production webhooks. A rerun reuses the owned staging instance; an uncertain creation response must be inspected before retrying.

## 2. Recover YDB data before switching traffic

Use the AWG production database, not the historical demo. `scripts/export-awg-recovery.mjs` opens a read-only YDB snapshot transaction and captures normalized entity rows, aggregate versions, manager/admin Telegram bindings and the full notification outbox. It does not create or alter source tables.

Required environment:

- `YDB_CONNECTION_STRING`: the AWG production connection.
- `YDB_ACCESS_TOKEN_CREDENTIALS`: a valid short-lived IAM access token.
- `AWG_BACKUP_ENCRYPTION_KEY`: a base64-encoded 32-byte random key, kept separately from the export.

```bash
node scripts/export-awg-recovery.mjs /secure/awg-recovery.enc
```

Exports use AES-256-GCM and a complete-body SHA-256 checksum. Files are created with mode 0600. No customer data or plaintext backup should be attached to a public GitHub issue, PR, artifact or log. Keep the encrypted export in private storage and a second copy outside the primary provider. The source export has not yet been obtained; its existence and freshness must be verified. If YDB is inaccessible, do not run this recovery flow. Use the separate fresh-install path in [AWG_TIMEWEB_FRESH_INSTALL.md](AWG_TIMEWEB_FRESH_INSTALL.md); historic leads cannot be recovered from a blank database.

## 3. Copy referenced media

Create a Timeweb S3 bucket with public reads for catalog photos, private credentials for writes and no anonymous listing. Configure `AUTO_SALE_S3_ENDPOINT`, `AUTO_SALE_S3_REGION`, `AUTO_SALE_S3_ACCESS_KEY`, `AUTO_SALE_S3_SECRET_KEY`, `AUTO_SALE_MEDIA_BUCKET` and, optionally, `AUTO_SALE_MEDIA_PUBLIC_BASE_URL`.

```bash
node scripts/copy-awg-recovery-media.mjs /secure/awg-recovery.enc
node scripts/copy-awg-recovery-media.mjs /secure/awg-recovery.enc /secure/awg-timeweb.enc --apply
```

The first command is read only. The second copies referenced objects from the AWG Yandex media bucket, checks the uploaded bytes through S3 and public access, and creates a new encrypted backup with updated media URLs. Source objects remain intact. Failure to read or verify any referenced object stops the migration. Entity IDs, aggregate versions and manager ownership remain unchanged.

## 4. Restore isolated staging

Build the portable image from `Dockerfile.timeweb` and transfer it, the `dist/` directory and `infra/timeweb/` files to `/opt/awg/staging/` using SSH with a verified host key. Set the separate staging hostname, image and PostgreSQL password in `.env`:

```dotenv
AWG_STAGING_HOST=timeweb-staging.viiversion.com
AWG_RUNTIME_IMAGE=autoworld-timeweb:<exact-source-sha>
AWG_POSTGRES_PASSWORD=<random-base64url-password>
```

Use `infra/timeweb/runtime.env.example` to prepare `runtime.env`, with a new private API key, actual S3 settings and source SHA. Keep the notification pump disabled and physical bot/group tokens empty for the first restore. The database and app are reachable only on the Docker network; only Caddy publishes 80/443. Point only the separate staging hostname at this server and ensure its certificate can be issued.

Place the migrated encrypted export at `recovery.enc`, provide its decryption key in the shell environment, and run `scripts/deploy-awg-timeweb-staging.sh` on the server. The script refuses production aliases, missing backups, enabled physical messaging and non-empty restore targets. It restores data before starting the public app and checks state hash, bindings, outbox count and health. On rerun, a populated database causes an explicit failure rather than overwriting live state.

## 5. Runtime and cutover gates

Still required on the actual Timeweb server:

1. Compare imported counts, state hash, row versions, manager identity bindings and outbox statuses against the verified export.
2. Verify frontend, catalog galleries, mobile forms, client isolation, manager roles, status ownership changes, notes and payments.
3. Test actual Telegram/VK authentication and delivery with an isolated test bot/group or an explicitly coordinated production-channel test. Preserve the production webhook during staging. Restored pending notifications must not run alongside the source sender.
4. Verify VK web login on the registered staging callback origin, and confirm the VK login widget stays hidden inside Telegram/VK Mini Apps.
5. Verify the HTTPS staging address from at least two Russian networks, including one mobile operator, with source location, time and result recorded. A local or GitHub Actions test does not prove availability from Russia.
6. Perform a final read-only export while source writes are paused, account for any staging test records, and ensure no writes occurred after the export.
7. Only after all gates pass: switch `awgcars.ru`, its required aliases and webhook destination, enable a single notification sender, validate production and resume catalog sync. Do not re-register the Telegram bot or VK app. Retain the old deployment and export for recovery.

Post-cutover recovery cannot simply point DNS back at stale YDB if new PostgreSQL writes have occurred. Those writes must first be preserved and replayed into the selected recovery target. No automated production switch is included in this preparation branch.

## Validation

`npm run check` runs existing regressions plus backup corruption/encryption, PostgreSQL persistence/concurrency/outbox and S3 validation checks. Local PostgreSQL SQL tests use PGlite; GitHub CI uses a real PostgreSQL 16 service through `AWG_TEST_DATABASE_URL`. CI builds both the existing Yandex image and the portable image. Real cloud deployment, source recovery, physical messenger delivery and Russian network checks are separate evidence.

Official references: [Timeweb server creation](https://timeweb.cloud/docs/cloud-servers/manage-servers/create-server), [Timeweb API](https://timeweb.cloud/tools/api-docs), [Timeweb S3 examples](https://github.com/timeweb-cloud/s3-examples), [node-postgres transactions](https://node-postgres.com/features/transactions).
