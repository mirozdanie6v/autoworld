# AWG operation feedback release

## Scope
Single frontend-only package: server-acknowledged save states for leads, quotes, orders, payments, catalog and team; blocking progress for order creation, lifecycle advance, payment entry and deletion; real completed-photo counters. Background refresh displays «Данные обновлены» without implying a form save.

No database, backend, payment arithmetic or lifecycle rule modifications.

## Release
1. Merge PR after green Verify AutoWorld checks.
2. Update .production/awg-direct-static-release to trigger deploy-awg-direct-statics.yml on main.
3. The deployment publishes immutable release assets in releases/<SHA>, backs up previous index.html to rollbacks/<SHA>/index.html, runs browser/API smoke and then swaps the root index.html.
4. On a failed post-switch smoke test, the deployment script restores the old index.html automatically.

## Rapid manual rollback
GitHub Actions > Rollback AWG Static UI > Run workflow.
Input release_sha = the 40-character commit SHA of the deployment to undo.
The workflow restores the saved previous index.html from rollbacks/<release_sha>/index.html and validates the public site and API health.
It also backs up the currently active index.html under manual-rollbacks/<GitHub-run-id>/index.html before the swap.
Rollback changes no YDB state, customer leads, quotes, payments, order stages, catalogs or backend containers.

## Acceptance
- Both Telegram and VK launch normally.
- Lead and quote saves show pending and server-confirmed success only.
- Creating orders, progressing lifecycle and registering payments display blocking feedback.
- Rejected operations show error and do not report success.
- Photo uploads report completed-file counts rather than guessed percentages.
- Public API health and VK authentication/messaging remain enabled.
