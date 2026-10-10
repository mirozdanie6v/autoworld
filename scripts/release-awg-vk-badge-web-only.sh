#!/usr/bin/env bash
set -euo pipefail

# Web-only UI update: DO NOT deploy a container or alter API Gateway/YDB/webhooks.
test "${YC_FOLDER_ID:-}" = "b1g8u8vqkgehvtbj8n13"
test "${STATIC_BUCKET:-}" = "viiversion-autoworld-awg-static-b1g8u8vqkgehvtbj8n13"
test -n "${YC_IAM_TOKEN:-}"
test -s dist/index.html
test -s dist/auto-sale-bootstrap.mjs
test -s dist/auto-sale-vk-status-widget.mjs
grep -q 'auto-sale-bootstrap.mjs?v=20261010-web-only-v2' dist/index.html
grep -q 'auto-sale-vk-status-widget.mjs?v=20261010-web-only-v2' dist/auto-sale-bootstrap.mjs
grep -q 'isAutoSaleMiniAppLaunch' dist/auto-sale-vk-status-widget.mjs
grep -q 'tgWebApp' dist/auto-sale-vk-status-widget.mjs
grep -q 'vk_app_id' dist/auto-sale-vk-status-widget.mjs

yc config set endpoint api.cloud.yandex.net:443 >/dev/null
yc config set token "$YC_IAM_TOKEN" >/dev/null
yc config set folder-id "$YC_FOLDER_ID" >/dev/null
BUCKET="$STATIC_BUCKET"
WORK="$(mktemp -d)"
rollback_needed=false
published=()
function publish() {
  local asset="$1" from="$2" mime="$3" cache="$4"
  yc storage s3 cp "$from" "s3://$BUCKET/$asset" --content-type "$mime" --cache-control "$cache" --only-show-errors
}
function restore() {
  if [ "$rollback_needed" = true ]; then
    echo "::warning::Rolling back the web-only VK badge static patch"
    for asset in "${published[@]}"; do
      if [ "$asset" = "index.html" ]; then
        publish "$asset" "$WORK/$asset" 'text/html; charset=utf-8' 'no-cache, no-store, must-revalidate' || echo "::error::Could not restore index.html"
      else
        publish "$asset" "$WORK/$asset" 'text/javascript; charset=utf-8' 'public, max-age=300, stale-while-revalidate=86400' || echo "::error::Could not restore $asset"
      fi
    done
  fi
  rm -rf "$WORK"
}
trap restore EXIT

# Strict target; fail closed if the website changed since the audited VK release.
CID="$(yc serverless container get --name autoworld-awg-prod --format json | jq -er '.id')"
test "$CID" = bba691o7au7epjqvs77b
HEALTH=$(curl -sS --connect-timeout 10 --max-time 30 https://awgcars.ru/api/health)
echo "$HEALTH" | jq -e '.ok==true and .vkAuth=="enabled" and .vkMessaging=="enabled" and .telegramNotifications=="enabled"' >/dev/null
test "$(echo "$HEALTH" | jq -er '.buildSha')" = '201d760d62d3e065e27119ea18091db76f30ed1d'

for asset in index.html auto-sale-bootstrap.mjs auto-sale-vk-status-widget.mjs; do
  yc storage s3 cp "s3://$BUCKET/$asset" "$WORK/$asset" --only-show-errors >/dev/null
  test -s "$WORK/$asset"
done
grep -q 'auto-sale-bootstrap.mjs?v=20261010-vk-prod-v1' "$WORK/index.html"
grep -q 'auto-sale-vk-status-widget.mjs?v=20261010-prod-v1' "$WORK/auto-sale-bootstrap.mjs"
echo "AWG_WEB_ONLY_VK_PRECHECK_OK: three original static files safely backed up"

rollback_needed=true
published+=(auto-sale-vk-status-widget.mjs)
publish auto-sale-vk-status-widget.mjs dist/auto-sale-vk-status-widget.mjs 'text/javascript; charset=utf-8' 'public, max-age=300, stale-while-revalidate=86400'
published+=(auto-sale-bootstrap.mjs)
publish auto-sale-bootstrap.mjs dist/auto-sale-bootstrap.mjs 'text/javascript; charset=utf-8' 'public, max-age=300, stale-while-revalidate=86400'
published+=(index.html)
publish index.html dist/index.html 'text/html; charset=utf-8' 'no-cache, no-store, must-revalidate'
echo "AWG_WEB_ONLY_VK_STATIC_PUBLISHED"

# Confirm exact live asset contents, preserved application health and unchanged backend.
for attempt in $(seq 1 8); do
  index=$(curl -sS --connect-timeout 10 --max-time 25 https://awgcars.ru/ || true)
  bootstrap=$(curl -sS --connect-timeout 10 --max-time 25 https://awgcars.ru/auto-sale-bootstrap.mjs || true)
  widget=$(curl -sS --connect-timeout 10 --max-time 25 https://awgcars.ru/auto-sale-vk-status-widget.mjs || true)
  if grep -q '20261010-web-only-v2' <<<"$index" &&
     grep -q 'auto-sale-vk-status-widget.mjs?v=20261010-web-only-v2' <<<"$bootstrap" &&
     grep -q 'isAutoSaleMiniAppLaunch' <<<"$widget" &&
     grep -q 'tgWebApp' <<<"$widget" &&
     grep -q 'vk_app_id' <<<"$widget"; then
    echo "AWG_WEB_ONLY_VK_LIVE_STATIC_OK"
    break
  fi
  [ "$attempt" -ne 8 ] || { echo "::error::Production public static smoke failed"; exit 1; }
  sleep 6
done
CURRENT_HEALTH=$(curl -sS --connect-timeout 10 --max-time 30 https://awgcars.ru/api/health)
echo "$CURRENT_HEALTH" | jq -e '.ok==true and .vkAuth=="enabled" and .vkMessaging=="enabled" and .telegramNotifications=="enabled"' >/dev/null
test "$(echo "$CURRENT_HEALTH" | jq -er '.buildSha')" = '201d760d62d3e065e27119ea18091db76f30ed1d'
rollback_needed=false
echo 'AWG_WEB_ONLY_VK_RELEASE_SUCCESS'
echo 'Static UI: web browser shows VK badge; VK/Telegram Mini App suppress it. Server, YDB and webhook untouched.' >>"$GITHUB_STEP_SUMMARY"
