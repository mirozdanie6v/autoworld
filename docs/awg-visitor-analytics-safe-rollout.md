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
