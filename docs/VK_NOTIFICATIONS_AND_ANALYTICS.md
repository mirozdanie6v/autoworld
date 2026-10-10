# VK notifications and channel analytics

VK clients can open a specific lead, quote or order from a community message. The inline keyboard uses `open_app` for app 54810434 and the configured community. The fragment contains an opaque entity ID, selects only from authenticated viewer-filtered state, and cannot authorize access. Unavailable and draft quotes are not opened. A rejected keyboard (VK error 911) falls back once to text with the same `random_id`; permission denial (901) remains permanent.

Telegram and VK notification channels are selected independently. The existing transactional outbox, event IDs and retry limits are retained. Manager alerts still go to Telegram; VK clients receive VK messages even when Telegram delivery is disabled. Disabling VK does not queue undeliverable VK notifications.

The privileged `x-auto-sale-skip-notifications: 1` header suppresses all notification channels during internal fixtures and checks. Its legacy alias, `x-auto-sale-skip-telegram: 1`, retains the same suppression behavior. Both require the API key. Ordinary staff cannot silently suppress notifications with either header.

Declining community-message permission does not block request creation. The request and order screens show a notice and an explicit retry button. Permission state is scoped to community and user, survives a session reload, and restores without another prompt. Concurrent attempts share one permission request.

Channel analytics identifies VK and Telegram from authenticated provider identity, including historical leads whose legacy source was `Mini App`. New client submissions receive server-owned `acquisitionChannel` and `clientSubmittedAt`. The first verified manager status transition records `firstManagerActionAt`; later transitions or manager handovers preserve it. Existing YDB JSON payloads store these additive fields without a schema migration.

The report shows average time to the first status transition, the number of measured requests, historical requests without reliable timestamps, new requests awaiting a manager and requests waiting longer than 30 minutes. This is manager-reaction time, not the timestamp of a human reply in the VK inbox. Inbox ingestion is a separate feature. Order conversion is associated through the originating lead so legacy order-source labels do not merge channels.

Verification: `npm run check`, including transport, permission-denial, authenticated navigation, channel attribution and timestamp regression cases. Real community keyboard behavior and physical delivery require VK acceptance verification. Automated checks do not message real clients.
