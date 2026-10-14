#!/usr/bin/env bash
set -euo pipefail
umask 077

# Run on a new, isolated Timeweb server. No DNS, YDB or Telegram/VK webhook writes.
cd /opt/awg/staging
for file in compose.yaml Caddyfile .env runtime.env static/index.html; do
  test -s "$file" || { echo "Missing staging input: $file" >&2; exit 1; }
done
test ! -e recovery.enc || { echo "Recovery backup found: use the recovery path instead" >&2; exit 1; }
test "$(printenv AWG_FRESH_CONFIRM 2>/dev/null || true)" = 'I_ACCEPT_EMPTY_AWG_STAGING' || {
  echo 'Set AWG_FRESH_CONFIRM=I_ACCEPT_EMPTY_AWG_STAGING for this empty staging database' >&2; exit 1;
}
stage_host=$(sed -n 's/^AWG_STAGING_HOST=//p' .env)
case "$stage_host" in
  timeweb-staging.viiversion.com|awg-timeweb-staging.viiversion.com) ;;
  *) echo "Only an isolated Timeweb staging hostname is allowed" >&2; exit 1 ;;
esac
for entry in AWG_POSTGRES_PASSWORD AWG_RUNTIME_IMAGE; do
  grep -Eq "^$entry=.+" .env || { echo "Missing $entry" >&2; exit 1; }
done
grep -qx 'AUTO_SALE_NOTIFICATION_PUMP_ENABLED=false' runtime.env || { echo 'Notification pump must stay disabled' >&2; exit 1; }
grep -qx 'AUTO_SALE_VK_ENABLED=false' runtime.env || { echo 'VK must stay disabled' >&2; exit 1; }
grep -qx 'AUTO_SALE_VK_WEB_ENABLED=false' runtime.env || { echo 'VK web login must stay disabled' >&2; exit 1; }
grep -Eq '^AUTO_SALE_API_KEY=.+' runtime.env || { echo 'Private API key is required' >&2; exit 1; }
if grep -Eq '^(AUTO_SALE_TELEGRAM_BOT_TOKEN|AUTO_SALE_VK_COMMUNITY_TOKEN|YDB_CONNECTION_STRING|YDB_ACCESS_TOKEN_CREDENTIALS)=.+' runtime.env; then
  echo 'Production credentials or YDB connection must not be present during fresh staging' >&2; exit 1
fi
if grep -Eiq '^AUTO_SALE_PUBLIC_DEMO_WRITE=(true|yes|1)$' runtime.env; then
  echo 'Anonymous public demo writes are forbidden' >&2; exit 1
fi

docker compose -f compose.yaml up -d postgres
docker compose -f compose.yaml run --rm -T --no-deps \
  -e AWG_STAGING_HOST="$stage_host" -e AWG_FRESH_CONFIRM \
  app node scripts/init-awg-timeweb-fresh.mjs
docker compose -f compose.yaml up -d app caddy
docker compose -f compose.yaml exec -T app node -e '
const h=await fetch("http://127.0.0.1:8080/api/health").then(r=>r.json());
if(!h.ok||h.persistence!=="postgresql"||!h.normalizedAuthoritative||h.publicDemoWrite||h.legacyStateWrite!=="retired")process.exit(1);
console.log(JSON.stringify({ok:true,persistence:h.persistence,linkedAdminAccounts:h.linkedAdminAccounts,telegramNotifications:h.telegramNotifications,vkAuth:h.vkAuth}));
'
echo 'AWG fresh staging installed. DNS and physical notification channels are unchanged.'
