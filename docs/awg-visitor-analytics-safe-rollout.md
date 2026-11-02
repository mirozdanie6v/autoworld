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
