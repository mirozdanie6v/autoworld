# AWG visitor behavior analytics — isolated rollout

Status: **implementation branch only**. The feature is **disabled by default**. Never deploy from this document automatically.

## Scope

* Captures anonymous app sessions, catalog opens, car-detail opens, photo switches, filter changes, request opens/attempts/success/failure.
* Shows a read-only 7-day report within **Manager → Work** and **Director → Overview**.
* Server derives the channel from validated Telegram/VK credentials. It does **not** treat incoming campaign identifiers as trusted.
* Session IDs are generated per page load; they are **not** stable person IDs. Counts represent sessions, not unique humans.
* Data model allows only event code, anonymous session/event IDs, car ID, date and verified platform. It never persists Telegram IDs, names, email, phone, form content, cookies, tokens, IP addresses or exact search queries.
* Aggregate submissions are UI-confirmed events. Reconcile real successful leads separately from the business entities table.

## Safe activation prerequisites

1. Deploy **only** to a distinct staging Serverless Container with staging Telegram/VK launch credentials. Do not point a live production bot or ad to staging.
2. Provision a **separate empty YDB database** with scoped staging service-account permissions. Use a different connection string from `YDB_CONNECTION_STRING`.
3. In staging only, set:
   * `AUTO_SALE_VISITOR_ANALYTICS_ENABLED=1`
   * `AUTO_SALE_VISITOR_ANALYTICS_YDB_CONNECTION_STRING=<separate-staging-YDB-connection>`
4. The new event table `auto_sale_visitor_events_v1` is created lazily and has a YDB automatic **30-day TTL**.
5. Review and publish the user-facing usage analytics/privacy notice before any real visitor data is collected.
6. Confirm a staging authentication context for both Telegram and VK; keep test users and real customers separate.
7. Only after E2E, security review, non-regression and rollback rehearsals, consider a production decision separately.

If the feature flag is off or the analytics connection is absent/equal to the operational YDB connection, the feature remains disabled and does not create a table.

## HTTP contract (staging)

* `GET /api/auto-sale/visitor-analytics/config`: feature config, no visitor data.
* `POST /api/auto-sale/visitor-analytics/events`: signed client only, at most 20 whitelisted events per batch, 48 KB maximum, bounded per-session event rate. Returns 202 for successful ingestion; failure is never blocking for customer submissions.
* `GET /api/auto-sale/visitor-analytics/report?days=7` (also 30): authorized manager/admin only. Returns an anonymous summary and recent per-session timelines. Max 10k source records; saturated reports are marked partial.
* No event or report route reads or modifies lead/order/payment/catalog business entities beyond existing authorization checks.

## Staging acceptance checklist

- [ ] Existing `npm run check` passes on the PR.
- [ ] Analytics disabled: config says `enabled:false`; events/report are 503; customer submits, filters and gallery remain unchanged.
- [ ] Signed TG and VK test sessions create independent events; anonymous sessions and admin event writes are denied.
- [ ] An incoming fake event type, excessive batch, malicious car ID and duplicate ID are rejected.
- [ ] No tokens, launch params, contact, user ID, note text or freeform search terms appear in the analytics table or report.
- [ ] Tested: open app, open catalog, open car, switch photos, use filters, open request, submit a test request, see report.
- [ ] Actual successful lead is saved by the existing business API; analytics failure does **not** prevent or retry/duplicate the lead.
- [ ] Report denied for non-admin; no cross-session identities exposed.
- [ ] Observe query latency, error rates and YDB quota; verify the TTL configuration on table.
- [ ] Verify no jobs/workflows deploy the feature branch automatically to production.
- [ ] Rollback test: unset `AUTO_SALE_VISITOR_ANALYTICS_ENABLED` and verify events stop immediately; restore the preceding container image if necessary.

**Known limitation:** This initial read-only panel has platform-level sources only. Advertising attribution and cross-session profiles are out of scope and must not be reported as reliable until verified independently.

## 2026-11-02 staging access diagnostic

A read-only GitHub Actions probe was executed from
`feature/awg-visitor-analytics-safe-20261102`. It verified GitHub's signed,
non-secret OIDC issuer/audience/subject claims before calling Yandex.

- OIDC `iss`: `https://token.actions.githubusercontent.com`
- OIDC `aud`: `https://github.com/mirozdanie6v`
- OIDC `sub`: `repo:mirozdanie6v@49186663/autoworld@1398349654:ref:refs/heads/feature/awg-visitor-analytics-safe-20261102`
- Staging verify service account: `aje0hvomk86tu5lbs5rk` (read-only probe)
- Yandex token exchange: **HTTP 401**. Metadata GET was **not attempted**.
- No YDB changes, deployment, production reads or real visitor ingestion occurred.

**Blocker:** staging federation does not authorize this exact branch identity.
Review existing IAM federation and its issuer/audience/subject binding in
Yandex Cloud. Prefer a dedicated least-privilege analytics staging principal.
Do not expand trust to production branches/accounts or grant folder-wide roles
by default. Confirm a separate empty analytics database before enabling.

## CI result

Unit tests for event validation, privacy redaction, disabled tracking, signed
client capture, and rendering have passed on the development branch. The
last branch commit must still pass all current PR checks; checks are not a
substitute for physical Telegram/VK staging E2E.

## One-time least-privilege OIDC repair (operator-approved cloud session)

This is **not** run by the GitHub preflight: when Yandex returns HTTP 401 the GitHub
job has no IAM permissions to repair its own federation. A Yandex Cloud
identity with the relevant federation-editor roles is required.

A verified, fail-closed script is included:

```sh
# Requires the yc CLI already authenticated as the authorized staging IAM operator.
# Read-only inspection; lists matching OIDC federations and existing bindings:
node scripts/awg-visitor-staging-iam.mjs

# If the inspected federation ID is unique and explicitly accepted:
node scripts/awg-visitor-staging-iam.mjs \
  --federation-id <VERIFIED_STAGING_FEDERATION_ID> \
  --apply
```

The `--apply` mode creates **only** the federated-credential association between
service account `aje0hvomk86tu5lbs5rk`, the verified OIDC federation and
the exact feature-branch subject. The script refuses ambiguous federations and
conflicting subjects; it does not create IAM roles, credentials, databases,
containers or production links. No permanent token should be added to GitHub.

After an authorized execution, re-run the dedicated GitHub preflight from its
feature branch and require HTTP 200 plus verified staging YDB metadata before
planning a telemetry database. The existing staging business YDB
`etnhujtu1t6f89tdtohs` **must never** be used as the new telemetry store.

See Yandex Cloud's official CLI docs for federated-credential creation and
listing. The authenticated cloud identity requires narrowly scoped IAM rights.

## 2026-11-02 disposable YDB integration results

A separate branch-only GitHub Actions workflow,
`.github/workflows/awg-visitor-analytics-local-ydb.yml`, starts the official
YDB Docker image with a **127.0.0.1-only gRPC listener**, runs a synthetic
YDB persistence check, and stops the disposable container even on failure.

The first physical database smoke [Actions run 41434834674](https://github.com/mirozdanie6v/autoworld/actions/runs/41434834674)
finished **success**. It verified real YQL table creation with TTL syntax,
event INSERT/SELECT behavior, read-only dashboard aggregation and the exclusion
of sample PII from stored event records. A follow-up includes an idempotency
replay (same event IDs must not create duplicate rows).

This test is **not** a Yandex Cloud staging deployment. An actual 30-day
background TTL deletion cannot be demonstrated in a short test; that requires
an isolated deployment and retention monitoring.

The `tests/awg-visitor-staging-iam.test.mjs` unit suite is now included in
`npm test`, so subsequent default GitHub regression runs enforce federation
selection and exact subject safeguards.

## Separate Yandex Serverless Container — isolation gate (02 Nov 2026)

Cloud resources created by the user (verified in Yandex Cloud screenshots):

* **New telemetry database**: `awg-visitor-analytics-staging`, ID `etnbvdb8fdv4qea3c5ap`, path `/ru-central1/b1ggsmuiq7tb2d27f89q/etnbvdb8fdv4qea3c5ap`; Serverless, 10 RU/s, 1 GB, 0 reserved RU/s.
* **Dedicated runtime identity**: `awg-visitor-analytics-staging-sa`; direct `ydb.editor` access **on the telemetry database only** (shown with inherited roles hidden).
* **Dedicated empty container**: `awg-visitor-analytics-staging`. Its Yandex UI is currently at the **Create revision editor**. **Do not create a revision with an unrelated AWG runtime image.**

An independent staging runtime is provided by
`server/awg-visitor-telemetry-server.mjs` and
`Dockerfile.visitor-analytics`. It imports neither the business state store
nor business entity mutations. It enforces the **exact** telemetry YDB target,
signed launch credentials and an explicit numeric admin ID allowlist; on a
cold start the feature is off. The Docker image is **not yet pushed** to Yandex
Container Registry. The current frontend/API integration in
`server/yandex-server.mjs` is a separate previous prototype and **must
remain off**. A future authenticated private-container proxy is required
before the full staging UI can send events.

Proposed new-container revision settings **only after a verified image exists**:

| Setting | Value |
|---|---|
| Mode | HTTP server |
| Runtime identity | `awg-visitor-analytics-staging-sa` |
| vCPU | 1 |
| Memory | 512 MB for YDB client + Node; tune after measurement |
| Timeout | 30 seconds |
| Prepared instances | 0 |
| Image | Only the vetted digest of `Dockerfile.visitor-analytics` built on the feature branch in Yandex Container Registry |
| Enabled | `AWG_VISITOR_ANALYTICS_ENABLED=0` (first smoke revision); do not collect real visits |
| Database | `AWG_VISITOR_YDB_CONNECTION_STRING=grpcs://ydb.serverless.yandexcloud.net:2135/?database=/ru-central1/b1ggsmuiq7tb2d27f89q/etnbvdb8fdv4qea3c5ap` |
| Admin access | `AWG_VISITOR_ADMIN_TELEGRAM_IDS` / `AWG_VISITOR_ADMIN_VK_IDS` verified numeric test admin IDs only, optional until admin acceptance |
| Browser origins | `AWG_VISITOR_ALLOWED_ORIGINS` explicit approved HTTPS staging origins only; empty means reject cross-origin |
| Bot and VK credentials | Staging credentials via Yandex Lockbox only, never write tokens in GitHub or console screenshots |
| Public invocation | **Disabled**; grant `serverless-containers.containerInvoker` only to a vetted staging proxy principal at the new container |

For a **private** Container Registry image, the revision's runtime
service account additionally needs `container-registry.images.puller` at
the **specific registry or repository**, not at the whole cloud by default.
The user creating a revision also needs permission to use that service
account. Grant this only after identifying the correct registry and image.

All subsequent steps require: (1) CI tests and isolated Docker build passing,
(2) publication of an immutable image digest to a dedicated registry,
(3) first feature-off revision and private health smoke, (4) a verified
staging-only invocation/proxy path, (5) staging signed TG/VK E2E and
rollback. **No production revision changes or user-data collection before
explicit approval.**
