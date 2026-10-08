# AWG direct static delivery

The backend remains on the recovered production revision `d7ab181874e62feae1891abdd34b2e225b925de6` with VK authentication and messaging enabled. Static delivery is changed independently; this workflow never deploys a container, changes a webhook, or writes customer data.

`Deploy AWG Direct Static Assets` publishes the current frontend into `releases/<commit>/` in the dedicated frontend bucket. The bucket permits anonymous object reads and read-only CORS; listing and configuration reads remain private. Its immutable JS/CSS are referenced from the entry HTML using absolute HTTPS URLs. The document remains on `awgcars.ru`, so existing relative API requests, Telegram/VK launch parameters, and browser storage retain their original origin.

Before publishing `index.html`, the workflow checks JS/CSS MIME, CORS and immutable cache headers, and uses Chrome through Playwright to test desktop/mobile rendering of the candidate HTML under the actual app origin. After publication it repeats the live browser checks and verifies the unchanged backend SHA, enabled VK features and anonymous state boundaries. On failure it restores the preceding index from a local backup. A durable copy is retained at `rollbacks/<commit>/index.html`.

Run the workflow manually or update `.production/awg-direct-static-release` on `main` after verification. Use the canonical `awg-yandex-production-writer` concurrency group for every production writer.

## Remaining HTML migration

The intermediate change bypasses API Gateway for critical JS/CSS while the HTML request still uses the gateway. `infra/yandex/awg-cdn-plan.json` describes the final Yandex CDN configuration: Object Storage website for static content, a separate origin group for `/api`, no API cache, original gateway host/SNI, full API HTTP methods, and the existing managed certificate covering `awgcars.ru` and `www.awgcars.ru`. Replace the two resource-ID placeholders only after provisioning.

The infrastructure inspection on 2026-10-08 confirmed that deploy service account `auto-sale-github` (`aje775bcl6hgp40eu8of`) lacks DNS/CDN permissions. Assign `cdn.editor` and `dns.editor` on folder `auto-sale` (`b1g8u8vqkgehvtbj8n13`) before continuing. Existing OIDC authentication can be reused.

Do not switch public DNS until the CDN configuration and certificate propagate and both static delivery and uncached API GET/OPTIONS/authenticated requests pass with the intended Host header. Yandex documents a 5-second CDN origin-response limit, so API origin responsiveness must be verified from CDN before cutover. Preserve the current gateway domains and DNS values for rollback. Inspect the actual apex DNS records before selecting the record type; Yandex warns that ANAME defeats geolocation-based CDN routing. Configure bucket website index as `index.html` before using the website origin.

The CDN manifest is prepared, not deployed or runtime verified. Do not report the entire static migration complete while production HTML is still on API Gateway.

## Verification on 2026-10-08

Workflow run `37771909278` for release `e98fa766421f9fe97211d6aa3a8795114a38bf73` passed all 297 application tests and 5 relay tests. Direct Object Storage probes passed MIME, CORS and immutable cache checks; JS/CSS TTFB was 784–825 ms from the GitHub runner.

Real Chrome candidate-HTML staging passed at desktop and mobile viewports. UI appeared in 2572 ms and 2040 ms respectively, with 16 direct static resources and zero gateway JS/CSS requests. The production entry HTML was not switched: the subsequent live `/api/health` gate timed out three times at 30 seconds each. Independent route probes also timed out at the custom domain, default gateway domain and direct container URL; this does not establish availability from every client network.

Active container metadata still points to revision `bbavmcegb6m6s1kvjqto` and image `cr.yandex/crptu0l7jn0iui8b8laa/autoworld-awg:d7ab181874e62feae1891abdd34b2e225b925de6`. No container revision or customer data was changed by this migration work. Final domain cutover and production verification remain pending DNS/CDN access and a healthy API origin.
