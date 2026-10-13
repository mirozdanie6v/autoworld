#!/usr/bin/env bash
set -euo pipefail
umask 077

# Run on the newly provisioned staging server. This script has no DNS or webhook mutations.
cd /opt/awg/staging
for file in compose.yaml Caddyfile .env runtime.env recovery.enc; do
  test -s "$file" || { printf 'Missing staging input: %s\n' "$file" >&2; exit 1; }
done
test -n "${AWG_BACKUP_ENCRYPTION_KEY:-}" || { echo 'Missing backup decryption key' >&2; exit 1; }
stage_host=$(sed -n 's/^AWG_STAGING_HOST=//p' .env)
if [[ ! "$stage_host" =~ ^[a-z0-9][a-z0-9.-]+\.viiversion\.com$ ]] || [[ "$stage_host" =~ ^(autoworld|awg|auto-sale-demo)\. ]]; then
  echo 'A separate staging hostname under viiversion.com is required' >&2
  exit 1
fi
if ! grep -qx 'AUTO_SALE_NOTIFICATION_PUMP_ENABLED=false' runtime.env; then
  echo 'The restored production outbox must remain paused on staging' >&2
  exit 1
fi
if grep -Eq '^AUTO_SALE_TELEGRAM_BOT_TOKEN=.+|^AUTO_SALE_VK_COMMUNITY_TOKEN=.+' runtime.env; then
  echo 'Initial recovery must have physical messaging credentials disabled' >&2
  exit 1
fi
docker compose -f compose.yaml up -d postgres
# Restore must finish on an empty database before the app gets public traffic.
docker compose -f compose.yaml run --rm -T --no-deps \
  -e AWG_BACKUP_ENCRYPTION_KEY -e AWG_RESTORE_TARGET=timeweb-staging \
  -v "$PWD/recovery.enc:/run/awg/recovery.enc:ro" \
  app node scripts/restore-awg-recovery.mjs /run/awg/recovery.enc > restore-report.json
docker compose -f compose.yaml up -d app caddy
curl --fail --silent --show-error --retry 10 --retry-delay 3 \
  --connect-timeout 5 --max-time 15 "https://$stage_host/api/health" > runtime-health.json
docker compose -f compose.yaml exec -T app node -e '
const fs=require("node:fs");
const h=JSON.parse(fs.readFileSync(0,"utf8"));
if(!h.ok||h.persistence!=="postgresql"||!h.normalizedAuthoritative||h.publicDemoWrite||h.legacyStateWrite!=="retired")process.exit(1);
console.log(JSON.stringify({ok:true,persistence:h.persistence,buildSha:h.buildSha,linkedAdminAccounts:h.linkedAdminAccounts}));' < runtime-health.json
echo 'Initial staging recovery verified. Telegram/VK delivery and Russian-network checks remain separate gates.'
