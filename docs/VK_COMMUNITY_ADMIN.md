# VK Community: administrator-only final setup

**Target:** https://vk.com/club242103542 (group ID 242103542)
**Working branch:** `feat/vk-community-branding-20261008`

## Published and already live
- Official community description (verified through VK API)
- Static cover 1920x768 (VK API returned enabled: true)
- Welcome post: https://vk.com/wall-242103542_1
- Two explanatory posts: https://vk.com/wall-242103542_2 and https://vk.com/wall-242103542_3

## Remaining administrator-only actions
1. Pin welcome post #1.
2. Add community link `https://www.awgcars.ru/` with label `Каталог автомобилей`.
3. Edit community menu and action button in VK native UI as needed. Do not link the VK Mini App until launch is verified for an ordinary VK user.

VK methods `wall.pin` and `groups.addLink` need a **user** token. Existing `AWG_VK_COMMUNITY_TOKEN` does **not** suffice; trying to pin with it returned error 27.

## Safest finish: authenticated Work browser
Use ChatGPT Work's Cloud Browser, open the community in a signed-in administrator session, and apply these two changes through VK UI. This avoids generating a broad user access token.

## Alternative: one-off GitHub Actions automation
1. Obtain an **official** VK user OAuth token for an account with administrator rights in this community and permission to access `groups` and `wall`. Use an application you control (a separate VK ID Web app is preferable). VK ID supports OAuth 2.1 Authorization Code + PKCE; availability of legacy VK API permissions depends on the application and may need VK approval. Never use third-party token generators or transfer VK passwords/cookies.
2. Add that user access token directly to GitHub repository **Settings → Secrets and variables → Actions → New repository secret** as `AWG_VK_ADMIN_TOKEN`. Do NOT paste the token in the chat, issues, commits or screenshots. Revoke the token/delete the secret after the one-off run.
3. Ask the assistant to activate `apply(vk-admin)` on the isolated branch. The workflow is limited to the fixed group and these two operations; tests and a dry-run preflight run first. Check the logs and the VK community afterward.

Automation code: `scripts/vk-community-admin.mjs` and `.github/workflows/vk-community-admin.yml`.

The script fails closed if the token is not a user token, the account isn't group admin, the expected welcome post is missing, or the group ID differs. It checks existing links and pin before writing, then reads back verification. It does not deploy site, backend, or VK Mini App.
