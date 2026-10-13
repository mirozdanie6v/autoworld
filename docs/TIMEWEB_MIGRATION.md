# AutoWorld / awgcars.ru — Yandex → Timeweb migration

**Status:** planning and isolated staging only (2026-10-13). **Production switch is not authorized.**

Source of truth: `mirozdanie6v/autoworld:main`; Linear project [AutoWorld — Timeweb migration](https://linear.app/viiversion/project/autoworld-timeweb-migration-dd8b52a60bbb).

## Verified baseline (repository review)

- Live deployment documented in `MIGRATION_STATUS.md`: Yandex Serverless Container and API Gateway; YDB `autoworld-awg-prod`; Object Storage bucket `viiversion-autoworld-awg-media`; domain `awgcars.ru`.
- Runtime: Node.js >=22 in `server/yandex-server.mjs`, `/api/*` and frontend assets from `dist/`.
- Primary persistence is YDB (legacy state + normalized entity tables). Additional tables include notifications outbox, admin access, Telegram bindings. See `server/ydb-state.mjs` and `server/ydb-domain-store.mjs`.
- `server/object-storage.mjs` calls Yandex IAM metadata and `storage.yandexcloud.net`, **not** generic S3 credentials.
- `server/pg-state.mjs` and `scripts/migrate-auto-sale-to-postgres.mjs` are historical components, **not** a proven full current production adapter. The script reads a different legacy state URL and doesn't cover all normalized entities and notification/access state.
- Telegram includes bot webhook and optional external Cloudflare relay. VK Mini App, VK group messages, and VK ID Web each have independent configuration; VK ID Web origin is fixed to `https://awgcars.ru` in current production config.
- `.github/workflows/sync-awg-catalog.yml` runs hourly and posts to current production URL, using GitHub OIDC catalog import. It must not write to two environments simultaneously.
- Current Yandex-oriented GitHub workflows must remain unchanged until replacement production deployment is proven.

## Proposed Timeweb topology

- **VM:** 2 vCPU, 4 GiB RAM, at least 40 GiB NVMe (initial baseline, adjust after inventory), Ubuntu 24.04 LTS, Moscow or Saint Petersburg Russian location, publicly routed IPv4. Run Node 22 (Docker image or systemd-managed process).
- **Database:** Timeweb managed PostgreSQL (same Russian region, private connectivity, TLS, backups); choose a version supported by the new adapter. Do not provision until costs/region are confirmed. Short-lived isolated tests may use PostgreSQL on the VM, but this is not a substitute for a production backup strategy.
- **Media:** a Timeweb S3 bucket dedicated to AWG, private write credentials, approved public-read policy for catalog media or mediated read access. Object checksums and URLs checked after copy.
- **HTTP:** reverse proxy on 80/443; independent static frontend caching; `/api/*` forwarded to local Node backend; TLS certificate issued for a dedicated staging host, e.g. `staging.awgcars.ru`. Never forward production traffic to staging.
- **Secrets:** Timeweb/DB/S3/VK/Telegram/API keys held in provider secret storage or GitHub Actions secrets, never in tracked `.env`, terminal output, issue comments, or PRs.
- **Deployment:** manual first, then constrained GitHub staging workflow that deploys an immutable tested commit SHA. Keep Yandex production deploy workflow unmodified.

## Sequential gates

### Gate 0 — Inventory and recoverability [VII-164]
1. Check canonical prod revision, DNS records/TTL, HTTP health, VK/Telegram webhook targets, release workflows and catalog importer.
2. Export **all** state: normalized tables, old compatibility state if active, notification outbox, admin access and Telegram bindings; take a consistent point-in-time snapshot. Capture row counts, IDs, revision and export checksums privately.
3. Inventory objects and references from current Yandex media bucket; copy without deleting originals; verify object count/size/checksums where possible.
4. Perform isolated restore drill. Preserve encrypted offline backup and data retention. Stop if data can't be restored or if authorization to read a source isn't available.

### Gate 1 — Create staging infrastructure [VII-165]
1. In [Timeweb Cloud](https://timeweb.cloud/my) create separate `AutoWorld Staging` project.
2. Cloud servers → Create → clean Ubuntu 24.04 LTS, Russian region, 2 vCPU/4 GiB/40 GiB+ NVMe, public IPv4, SSH key. Set name `awg-timeweb-staging`.
3. Limit SSH to trusted source addresses if feasible; deny unnecessary inbound ports; allow TCP 80/443. Install security updates; configure a non-root deploy user, fail2ban optional, host firewall and monitored restarts.
4. Use a staging subdomain and TLS for frontend; **do not modify** existing `awgcars.ru`, Telegram bot menu/webhook, or VK production application callback.
5. Add managed PostgreSQL in same private network/region, enable TLS and backup policy; create staging-only S3 bucket and key with minimal permissions.
6. Store IP, region, plan, SSH public-key fingerprint and resource IDs in private deployment inventory (no passwords/tokens).

### Gate 2 — Port backend & migrate data [VII-166]
1. Refactor persistence behind an adapter and implement PostgreSQL behavior matching the current normalized YDB entities and public API.
2. Cover optimistic revisions, concurrent lead claims, server-side authorization, idempotent notifications/outbox retries, admin bindings, catalog import, Telegram identity mapping.
3. Add migration scripts with export/import modes, dry run, resume markers, and rollback-safe checks.
4. Verify row counts, relational parity, stable IDs, media references and historical payments/notes. Compare representative API responses and E2E tests between source and isolated copy.
5. Verify zero **runtime** YDB dependency in the Timeweb deployment; do not permanently run the new app against the old YDB.

### Gate 3 — Port media [VII-167]
1. Implement real S3-compatible storage provider with configurable endpoint, region, bucket and SigV4 credentials; unit-test uploads and deletes against Timeweb-compatible behavior.
2. Copy every referenced image object from Yandex to Timeweb S3; hash/size checks and verify public display of catalog galleries. Handle both normalized catalog and existing historical URLs.
3. Rewrite database media URLs in the **staging copy** only. No deletes on source.

### Gate 4 — Staging acceptance [VII-168, VII-169]
- Node starts after reboot; `GET /api/health`, frontend, `GET /api/auto-sale/state`, images and `/api/*` are OK.
- New customer lead from an identity outside manager list persists **exactly once**; notifications go to all three intended managers; claim, status, client reply and error retry work.
- Telegram `/start`, WebApp initData and webhook signing verified using a separate test bot or mock; **one active webhook for production bot**.
- VK Mini App flow and VK ID Web callback validated on an authorized test app/domain; do not mutate the production callback prematurely.
- GitHub hourly catalog import, updates without VIN, uploads and no-duplicate semantics work against isolated copy.
- Server-to-Telegram API and any relay egress probes pass from Timeweb. If a relay remains on Cloudflare, document that external dependency separately.
- Browser tests: Android Chrome, Firefox/Opera plus VK and Telegram in-app browser.
- External checks from multiple Russian operators/AS and locations: DNS, TLS, HTTP response, TTFB, JS/CSS MIME, images, API read/write test.
- Staging deployment is reproducible, backup restore drills pass, error alerts and rollback are tested.

### Gate 5 — Cutover [VII-170; manual release gate only]
1. Preserve current DNS, certificate, bot webhook/menu, VK callback, deployment SHA, and consistent YDB/object backup.
2. Temporarily lower DNS TTL ahead of the window; install valid production HTTPS certificate on the new origin.
3. Announce controlled brief write freeze. Pause source importer and wait for notification outbox; perform final incremental sync and compare revisions/counts/checksums. New backend stays non-writable until source is fenced.
4. Switch origin for `awgcars.ru` and `www.awgcars.ru`; verify origin from Russian networks and prevent CDN/cache pointing to old static files.
5. Verify VK redirect allowlists, VK Mini App URL and Telegram WebApp URL. Move production Telegram webhook **once**, without two consumers.
6. Run a production real-customer smoke under explicit test IDs, then unfreeze writes only on the new database and re-enable catalog importer to the new API.
7. Monitor failures, request storage and notifications at least 24–48 hours; retain the source as rollback for an agreed interval.
8. Rollback requires recovering **new** writes back to old system before making it writable again; DNS-only rollback would lose leads. Do not delete Yandex resources on cutover day.

## Security / blocking rules

- **Never** reveal secrets or personal data in chat, commits, PRs or Linear.
- Do not use the old `auto-sale-demo` as a production data source; it's an isolated historical demo.
- No surprise live notification tests, VK mutations or Telegram webhook changes.
- Use idempotent migrations and stable entity IDs; staging notifications must be disabled or rerouted to a separate test bot by default.
- Mark a gate passed only after actual evidence (audit reports, test output, measured Russian network checks), not after writing code.

## Timeweb account actions needed first

1. Sign in: https://timeweb.cloud/my
2. Create a **Cloud server**, not shared web hosting. Proposed staging name `awg-timeweb-staging`, clean Ubuntu 24.04, 2 vCPU/4 GiB/40+ GiB, RU region and public IPv4.
3. Add SSH public key during creation. Do not share the private key or root password.
4. Save the resulting public server IP and plan/region (safe to send for guidance). **Stop before changing DNS.**
5. In later steps create the PostgreSQL instance and S3 bucket after verified source data inventory and cost confirmation.
