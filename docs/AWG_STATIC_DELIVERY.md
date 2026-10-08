# AWG direct static delivery

The backend remains on the recovered production revision `d7ab181874e62feae1891abdd34b2e225b925de6` with VK authentication and messaging enabled. Static delivery is changed independently; this workflow never deploys a container, changes a webhook, or writes customer data.

`Deploy AWG Direct Static Assets` publishes the current frontend into `releases/<commit>/` in the dedicated frontend bucket. The bucket permits anonymous object reads and read-only CORS; listing and configuration reads remain private. Its immutable JS/CSS are referenced from the entry HTML using absolute HTTPS URLs. The document remains on `awgcars.ru`, so existing relative API requests, Telegram/VK launch parameters, and browser storage retain their original origin.

Before publishing `index.html`, the workflow checks JS/CSS MIME, CORS and immutable cache headers, and uses Chrome through Playwright to test desktop/mobile rendering of the candidate HTML under the actual app origin. After publication it repeats the live browser checks and verifies the unchanged backend SHA, enabled VK features and anonymous state boundaries. On failure it restores the preceding index from a local backup. A durable copy is retained at `rollbacks/<commit>/index.html`.

Run the workflow manually or update `.production/awg-direct-static-release` on `main` after verification. Use the canonical `awg-yandex-production-writer` concurrency group for every production writer.

## Remaining HTML migration

The intermediate change bypasses API Gateway for critical JS/CSS while the HTML request still uses the gateway. `infra/yandex/awg-cdn-plan.json` describes the final Yandex CDN configuration: Object Storage website for static content, a separate origin group for `/api`, no API cache, original gateway host/SNI, full API HTTP methods, and the existing managed certificate covering `awgcars.ru` and `www.awgcars.ru`. Replace the two resource-ID placeholders only after provisioning.

After the user added roles, CDN creation and updates became available through the existing OIDC service account `auto-sale-github` (`aje775bcl6hgp40eu8of`). DNS zone listing became available, but reading records of zone `dnsblnbac98i1bk1n392` still returns `403 Permission denied` through both CLI and fresh REST credentials. Confirm `dns.editor` is assigned to this exact service account on folder `auto-sale` (`b1g8u8vqkgehvtbj8n13`). Folder access-binding inspection is also denied; the workflow cannot independently inspect or grant those IAM bindings.

Do not switch public DNS until the CDN configuration and certificate propagate and both static delivery and uncached API GET/OPTIONS/authenticated requests pass with the intended Host header. Yandex documents a 5-second CDN origin-response limit, so API origin responsiveness must be verified from CDN before cutover. Preserve the current gateway domains and DNS values for rollback. Inspect the actual apex DNS records before selecting the record type; Yandex warns that ANAME defeats geolocation-based CDN routing. Configure bucket website index as `index.html` before using the website origin.

CDN resource `bc8rp2vwj26zt3hg2ewz` was provisioned with provider CNAME `749be10645ce3d3e.topology.gslb.yccdn.ru`. The existing certificate is attached and the CDN API reports `READY`. Static bucket website hosting is configured. The CDN root rewrite points to the immutable candidate release instead of changing the production Gateway's index pointer. The API origin group is `291867020645281612`; its currently permitted client methods are GET/HEAD/OPTIONS. HTML rule ID is `55403`, API rule ID is `55405`.

The provider rejected enabling POST with operation code 9: `method "POST" management is unavailable for resource "bc8rp2vwj26zt3hg2ewz"`. This is an account/resource entitlement gate, separate from the `cdn.editor` IAM role. Do not cut over DNS while lead creation, editing, deletion or webhook POST requests cannot reach the backend.

Request to Yandex support:

> Please enable POST, PUT, PATCH and DELETE for Yandex Cloud CDN resource bc8rp2vwj26zt3hg2ewz in folder b1g8u8vqkgehvtbj8n13. The awgcars.ru application routes /api/* to an HTTPS API Gateway origin and requires POST for lead creation/webhooks, PUT/PATCH for updates and DELETE for removal. API responses must not be cached. GET/HEAD/OPTIONS are already configured. The write-method update failed with request ID af8cd383-03f9-441c-bc6c-1a742cc003c3.

The entire static migration remains incomplete while public production HTML is still on API Gateway. `Prepare AWG CDN Routes` intentionally never changes DNS. `Inspect AWG Static Infrastructure` now also probes the provisioned CDN without mutating it. Preparation success alone is not a production verification result.

## Verification on 2026-10-08

Workflow run `37771909278` for release `e98fa766421f9fe97211d6aa3a8795114a38bf73` passed all 297 application tests and 5 relay tests. Direct Object Storage probes passed MIME, CORS and immutable cache checks; JS/CSS TTFB was 784–825 ms from the GitHub runner.

The first attempt passed real Chrome candidate-HTML staging at desktop and mobile viewports. UI appeared in 2572 ms and 2040 ms respectively, with 16 direct static resources and zero gateway JS/CSS requests. That attempt did not switch the production entry HTML: the subsequent live `/api/health` gate timed out three times at 30 seconds each. Independent route probes also timed out at the custom domain, default gateway domain and direct container URL; this does not establish availability from every client network.

Active container metadata still points to revision `bbavmcegb6m6s1kvjqto` and image `cr.yandex/crptu0l7jn0iui8b8laa/autoworld-awg:d7ab181874e62feae1891abdd34b2e225b925de6`. No container revision or customer data was changed by this migration work.

Read-only workflow `37780175065` at 12:54 UTC confirmed that API transport is responding again: public Gateway root HTTP 200 at 1475 ms TTFB and /api/health HTTP 200 at 5117 ms. CDN probes using the original awgcars.ru Host/SNI and a transport override passed certificate verification: root HTML 749 ms, versioned HTML 812 ms, VK config 837 ms, API health 1199 ms. CDN root contains the direct-static release marker. API health retained backend d7ab1818, enabled VK auth and messaging; API responses had Cache-Control: private, no-store. No public DNS was changed. Full CDN browser/privacy/write-method checks and final DNS cutover remain pending.

## Production direct-static cutover at 12:58 UTC

The rerun of [Deploy AWG Direct Static Assets](https://github.com/mirozdanie6v/autoworld/actions/runs/37771909278), job `113322008177`, completed successfully at 12:58:12 UTC. It published the previously tested frontend release `e98fa766421f9fe97211d6aa3a8795114a38bf73` after passing all 297 application tests, 5 relay tests, build checks, and the live backend health gate. The production entry HTML now references immutable JS/CSS directly in Object Storage.

Fresh production Chrome smoke tests passed at desktop and mobile viewports: UI ready in 2521 ms and 3791 ms, first contentful paint in 1684 ms and 2984 ms. Both loaded 16 direct static resources with zero gateway JS/CSS requests; catalog navigation passed with no script, MIME or CORS errors. Direct resource TTFB in Chrome was approximately 188–577 ms. These are runner measurements, not a claim about every phone or client network.

The final live gate reported `directStaticDeployment: verified`. Backend build remained `d7ab181874e62feae1891abdd34b2e225b925de6`, VK auth and messaging stayed enabled, and anonymous state exposed no leads, quotes, orders or team data. The preceding entry HTML is retained at `rollbacks/e98fa766421f9fe97211d6aa3a8795114a38bf73/index.html`; rollback was not needed.

Production HTML still travels through API Gateway. The remaining cutover gates are effective DNS record access for the deploy service account and Yandex enabling POST/PUT/PATCH/DELETE for the CDN resource. After those gates are cleared, repeat full CDN browser, API method, cache/privacy and VK launch checks before switching DNS; then repeat production checks against the public domain. Preserve the current backend revision and gateway configuration throughout.
