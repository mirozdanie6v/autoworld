#!/usr/bin/env bash
set -euo pipefail
# Strict static-only release; no container, gateway, webhook, YDB, or bot writes.
test "${YC_FOLDER_ID:-}" = "b1g8u8vqkgehvtbj8n13"
test "${STATIC_BUCKET:-}" = "viiversion-autoworld-awg-static-b1g8u8vqkgehvtbj8n13"
test -n "${YC_IAM_TOKEN:-}"
for file in index.html auto-sale-bootstrap.mjs auto-sale-calc-scroll-performance.mjs auto-sale-calc-scroll-performance.css; do
  test -s "dist/$file"
done
grep -q 'auto-sale-bootstrap.mjs?v=20261010-scroll-v1' dist/index.html
grep -q 'auto-sale-calc-cta-v25.css' dist/index.html
grep -q 'auto-sale-calc-scroll-performance.css?v=20261010-scroll-v1' dist/index.html
grep -q 'auto-sale-calc-scroll-performance.mjs?v=20261010-scroll-v1' dist/auto-sale-bootstrap.mjs
grep -q 'auto-sale-vk-status-widget.mjs?v=20261010-web-only-v2' dist/auto-sale-bootstrap.mjs
grep -q 'animation-play-state:paused!important' dist/auto-sale-calc-scroll-performance.css
grep -q 'animation-play-state:running!important' dist/auto-sale-calc-scroll-performance.css

yc config set endpoint api.cloud.yandex.net:443 >/dev/null
yc config set token "$YC_IAM_TOKEN" >/dev/null
yc config set folder-id "$YC_FOLDER_ID" >/dev/null
BUCKET="$STATIC_BUCKET"
WORK="$(mktemp -d)"
rollback_needed=false
declare -a published=()
declare -a original=()
publish(){
  local key="$1" file="$2" mime="$3" cache="$4"
  yc storage s3 cp "$file" "s3://$BUCKET/$key" \
    --content-type "$mime" --cache-control "$cache" --only-show-errors >/dev/null
}
restore(){
  if [ "$rollback_needed" = true ]; then
    echo "::warning::Rolling back catalog scroll optimization static files"
    for asset in "${published[@]}"; do
      if printf '%s\n' "${original[@]}" | grep -Fxq "$asset"; then
        case "$asset" in
          index.html) publish "$asset" "$WORK/$asset" 'text/html; charset=utf-8' 'no-cache, no-store, must-revalidate' ;;
          *.css) publish "$asset" "$WORK/$asset" 'text/css; charset=utf-8' 'public, max-age=300, stale-while-revalidate=86400' ;;
          *) publish "$asset" "$WORK/$asset" 'text/javascript; charset=utf-8' 'public, max-age=300, stale-while-revalidate=86400' ;;
        esac || echo "::error::Could not restore $asset"
      else
        yc storage s3 rm "s3://$BUCKET/$asset" --only-show-errors >/dev/null || echo "::error::Could not clean up new static asset $asset"
      fi
    done
  fi
  rm -rf "$WORK"
}
trap restore EXIT

CID="$(yc serverless container get --name autoworld-awg-prod --format json | jq -er '.id')"
test "$CID" = bba691o7au7epjqvs77b
gethealth(){
 curl --fail -sS --connect-timeout 12 --max-time 35 https://awgcars.ru/api/health
}
HEALTH="$(gethealth)"
jq -e '.ok==true and .vkAuth=="enabled" and .vkMessaging=="enabled" and .telegramNotifications=="enabled"' <<<"$HEALTH" >/dev/null
test "$(jq -er '.buildSha' <<<"$HEALTH")" = 201d760d62d3e065e27119ea18091db76f30ed1d
mkdir -p "$WORK"
for asset in index.html auto-sale-bootstrap.mjs auto-sale-calc-scroll-performance.mjs auto-sale-calc-scroll-performance.css; do
  if yc storage s3api head-object --bucket "$BUCKET" --key "$asset" >/dev/null 2>&1; then
    yc storage s3 cp "s3://$BUCKET/$asset" "$WORK/$asset" --only-show-errors >/dev/null
    test -s "$WORK/$asset"
    original+=("$asset")
  fi
done
test -s "$WORK/index.html"
test -s "$WORK/auto-sale-bootstrap.mjs"
grep -q 'auto-sale-bootstrap.mjs?v=20261010-web-only-v2' "$WORK/index.html"
grep -q 'auto-sale-vk-status-widget.mjs?v=20261010-web-only-v2' "$WORK/auto-sale-bootstrap.mjs"
echo 'AWG_CALC_SCROLL_PRECHECK_OK; original production UI snapshot saved'

rollback_needed=true
published+=(auto-sale-calc-scroll-performance.css)
publish auto-sale-calc-scroll-performance.css dist/auto-sale-calc-scroll-performance.css \
  'text/css; charset=utf-8' 'public, max-age=300, stale-while-revalidate=86400'
published+=(auto-sale-calc-scroll-performance.mjs)
publish auto-sale-calc-scroll-performance.mjs dist/auto-sale-calc-scroll-performance.mjs \
  'text/javascript; charset=utf-8' 'public, max-age=300, stale-while-revalidate=86400'
published+=(auto-sale-bootstrap.mjs)
publish auto-sale-bootstrap.mjs dist/auto-sale-bootstrap.mjs \
  'text/javascript; charset=utf-8' 'public, max-age=300, stale-while-revalidate=86400'
published+=(index.html)
publish index.html dist/index.html \
  'text/html; charset=utf-8' 'no-cache, no-store, must-revalidate'
echo 'AWG_CALC_SCROLL_ASSETS_PUBLISHED'

verified=false
for attempt in $(seq 1 10); do
  index="$(curl -fsS --connect-timeout 12 --max-time 35 https://awgcars.ru/ || true)"
  bootstrap="$(curl -fsS --connect-timeout 12 --max-time 35 https://awgcars.ru/auto-sale-bootstrap.mjs || true)"
  css="$(curl -fsS --connect-timeout 12 --max-time 35 https://awgcars.ru/auto-sale-calc-scroll-performance.css || true)"
  module="$(curl -fsS --connect-timeout 12 --max-time 35 https://awgcars.ru/auto-sale-calc-scroll-performance.mjs || true)"
  if grep -q 'auto-sale-bootstrap.mjs?v=20261010-scroll-v1' <<<"$index" &&
     grep -q 'auto-sale-calc-scroll-performance.css?v=20261010-scroll-v1' <<<"$index" &&
     grep -q 'auto-sale-calc-scroll-performance.mjs?v=20261010-scroll-v1' <<<"$bootstrap" &&
     grep -q 'auto-sale-vk-status-widget.mjs?v=20261010-web-only-v2' <<<"$bootstrap" &&
     grep -q 'animation-play-state:paused!important' <<<"$css" &&
     grep -q 'startAutoCalcScrollPerformance' <<<"$module"; then
    verified=true;break
  fi
  sleep 5
done
test "$verified" = true
node scripts/test-awg-calc-scroll-production-browser.mjs
AFTER="$(gethealth)"
jq -e '.ok==true and .vkAuth=="enabled" and .vkMessaging=="enabled" and .telegramNotifications=="enabled"' <<<"$AFTER" >/dev/null
test "$(jq -er '.buildSha' <<<"$AFTER")" = 201d760d62d3e065e27119ea18091db76f30ed1d
rollback_needed=false
echo 'AWG_CALC_SCROLL_PRODUCTION_RELEASE_VERIFIED'
echo 'Scoped scroll motion gate deployed: original Calculate v25 appearance intact, invisible/scrolling blur animations paused; production API, YDB, Telegram webhook unaffected.' >> "$GITHUB_STEP_SUMMARY"
