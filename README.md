# AutoWorld Georgia

Canonical source repository for the AutoWorld Georgia Telegram Mini App and Yandex Cloud backend.

## Runtime
- Frontend: static Mini App in `public/`
- Backend: Node.js service in `server/`
- Persistence: YDB Serverless
- Media: Yandex Object Storage
- Telegram: bot/webhook integration plus optional relay
- Deployment: Yandex Serverless Containers
- Legacy compatibility: `wrangler.jsonc` preserves the former Cloudflare/D1 worker contract for regression tests; it is not the canonical production runtime.

## Access
The application supports exactly three Telegram admin accounts by default:
`@Flyer_Flyer`, `@smit44744`, `@Ivan_AWG`.

## Verification
Run:
```bash
npm ci
npm run check
```

## Migration provenance
Initial isolated snapshot was migrated from
`mirozdanie6v/uniq-smart-rent`,
branch `autosale/post-delete-cleanup`,
commit `f9c87829591ff97d4f5e4223c875a96a7329a51a`.

The old mixed repository is a historical source only for AutoWorld after cutover.
