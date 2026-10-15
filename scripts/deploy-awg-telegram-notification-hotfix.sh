#!/usr/bin/env bash
# Scoped AWG hotfix. Never sets Telegram webhooks, rotates API keys, changes
# YDB, reconfigures API Gateway, or sends live customer messages.
set -euo pipefail
umask 077
: "${YC_FOLDER_ID:?}"
: "${YC_RUNTIME_SA_ID:?}"
: "${YC_REGISTRY_ID:?}"
: "${AWG_STATIC_BUCKET:?}"
: "${GITHUB_SHA:?}"
: "${RUNNER_TEMP:?}"
: "${YC_IAM_TOKEN:?}"
test "$GITHUB_RUN_ATTEMPT" = 1
grep -Fx 'intent=telegram-navigation-no-drafts-20261015' .production/awg-telegram-notification-hotfix >/dev/null
test "$YC_FOLDER_ID" = b1g8u8vqkgehvtbj8n13
test "$YC_RUNTIME_SA_ID" = aje8o9ric0d20k11521r
test "$YC_REGISTRY_ID" = crptu0l7jn0iui8b8laa
test "$AWG_STATIC_BUCKET" = viiversion-autoworld-awg-static-b1g8u8vqkgehvtbj8n13
test -f dist/index.html
grep -F '20261015-tg-deeplinks-v1' dist/index.html >/dev/null
grep -F 'resolveManagerNotificationTarget' dist/auto-sale-vk-notification-navigation.mjs >/dev/null
grep -F 'telegramNotificationUrl' server/telegram-bot.mjs >/dev/null
test -s dist/auto-sale-notification-links.mjs

CID=$(yc serverless container get --name autoworld-awg-prod --folder-id "$YC_FOLDER_ID" --format json | jq -er '.id')
test "$CID" = bba691o7au7epjqvs77b
yc serverless container revision list --container-id "$CID" --format json > "$RUNNER_TEMP/awg-revision-list.json"
RID=$(jq -er '(if type=="array" then . else .revisions end) |
  map(select(.status=="ACTIVE")) | sort_by(.created_at // .createdAt) | last | .id' "$RUNNER_TEMP/awg-revision-list.json")
yc serverless container revision get "$RID" --format json > "$RUNNER_TEMP/awg-revision-before.json"
PROD="$RUNNER_TEMP/awg-revision-before.json"
jq -e --arg sa "$YC_RUNTIME_SA_ID" '
    .service_account_id == $sa
    and .runtime.http != null
    and .resources.memory == "536870912"
    and .resources.cores == "1"
    and .execution_timeout == "60s"
    and .concurrency == "1"
    and (.secrets|length) == 1
    and .secrets[0].environment_variable == "AUTO_SALE_VK_WEB_COOKIE_KEY"
    and .secrets[0].key == "cookie-key"
    and (.image.image_url|startswith("cr.yandex/"))
    and (.image.environment.YDB_CONNECTION_STRING|endswith("/etn00ojk5iv1u7dgpdar"))
    and .image.environment.AUTO_SALE_PUBLIC_DEMO_WRITE == "false"
    and .image.environment.AUTO_SALE_VK_ENABLED == "true"
    and .image.environment.AUTO_SALE_VK_WEB_ENABLED == "true"
    and .image.environment.AUTO_SALE_TELEGRAM_APP_URL == "https://awgcars.ru/"
    and .image.environment.AUTO_SALE_TELEGRAM_RELAY_URL == "https://integration-telegram.viiversion.com/telegram/send"
    and (.image.environment.AUTO_SALE_VK_COMMUNITY_TOKEN|length>0)
    and (.image.environment.AUTO_SALE_TELEGRAM_BOT_TOKEN|length>0)
    and (.image.environment.AUTO_SALE_API_KEY|length>0)
  ' "$PROD" >/dev/null || {
  echo "::error::Live production configuration differs from approved baseline. Refusing hotfix."
  exit 1
}
OLD_IMAGE=$(jq -er '.image.image_url' "$PROD")
OLD_SHA=$(jq -er '.image.environment.AUTO_SALE_BUILD_SHA' "$PROD")
COOKIE_SPEC=$(jq -er '.secrets[0]|"environment-variable=\(.environment_variable),id=\(.id),version-id=\(.version_id),key=\(.key)"' "$PROD")
BOT_TOKEN=$(jq -er '.image.environment.AUTO_SALE_TELEGRAM_BOT_TOKEN' "$PROD")
API_KEY=$(jq -er '.image.environment.AUTO_SALE_API_KEY' "$PROD")
echo "::add-mask::$BOT_TOKEN"
echo "::add-mask::$API_KEY"
WEBHOOK_URL=https://integration-telegram.viiversion.com/telegram/webhook

assert_webhook_unchanged(){
  local response
  response=$(curl --fail --silent --show-error --connect-timeout 10 --max-time 30 \
    "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo")
  printf '%s' "$response" | jq -e --arg expected "$WEBHOOK_URL" \
    '.ok == true and .result.url == $expected' >/dev/null || {
    echo "::error::Telegram webhook is not the known Cloudflare ingress; stopping."
    return 1
  }
}
assert_webhook_unchanged
BEFORE_HEALTH=$(curl --fail --silent --show-error --connect-timeout 10 --max-time 30 https://awgcars.ru/api/health)
printf '%s' "$BEFORE_HEALTH" | jq -e '
  .ok==true and .persistence=="ydb-serverless" and .vkMessaging=="enabled"
  and .telegramNotifications=="enabled" and .telegramRoutableManagers==3' >/dev/null

# Preserve exact current runtime environment. No sensitive values are logged.
ENV_ARGS=()
while IFS= read -r -d '' entry; do
  key=${entry%%$'\x1f'*}
  value=${entry#*$'\x1f'}
  [[ "$key" =~ ^[A-Z0-9_]+$ ]] || { echo "Unexpected runtime environment key" >&2; exit 1; }
  ENV_ARGS+=(--environment "$key=$value")
done < <(jq -jr '.image.environment | to_entries[] | .key,"\u001f",.value,"\u0000"' "$PROD")
test "${#ENV_ARGS[@]}" -ge 36

NEW_IMAGE="cr.yandex/$YC_REGISTRY_ID/autoworld-awg:${GITHUB_SHA}-telegram-nav"
echo "AWG_HOTFIX_SOURCE_REVISION_ID=$RID"
echo "AWG_HOTFIX_EXISTING_ENV_REUSED=true"
echo "$YC_IAM_TOKEN" | docker login --username iam --password-stdin cr.yandex >/dev/null
docker build --pull=false -f Dockerfile.yandex -t "$NEW_IMAGE" .
for attempt in 1 2 3; do
  if docker push "$NEW_IMAGE"; then break; fi
  test "$attempt" -lt 3 || exit 1
  sleep $((attempt*10))
done

deploy_revision(){
  local image="$1"
  local sha="$GITHUB_SHA"
  if [ "$image" = "$OLD_IMAGE" ]; then sha="$OLD_SHA"; fi
  local args=()
  local arg
  for arg in "${ENV_ARGS[@]}"; do
    if [[ "$arg" == AUTO_SALE_BUILD_SHA=* ]]; then
      args+=("AUTO_SALE_BUILD_SHA=$sha")
    else
      args+=("$arg")
    fi
  done
  yc serverless container revision deploy \
    --container-name autoworld-awg-prod --folder-id "$YC_FOLDER_ID" \
    --image "$image" --cores 1 --memory 512MB --execution-timeout 60s \
    --service-account-id "$YC_RUNTIME_SA_ID" --secret "$COOKIE_SPEC" \
    "${args[@]}" > "$RUNNER_TEMP/awg-hotfix-deploy.out"
}
DEPLOY_ATTEMPTED=0
RELEASE_COMPLETE=0
cleanup(){
  local code=$?
  trap - EXIT
  if [ "$code" -ne 0 ] && [ "$DEPLOY_ATTEMPTED" = 1 ] && [ "$RELEASE_COMPLETE" != 1 ]; then
    echo "::warning::Hotfix failed after deploy started; attempting rollback to previous container image and environment."
    if deploy_revision "$OLD_IMAGE"; then
      echo "AWG_HOTFIX_ROLLBACK=restored_previous_image"
    else
      echo "::error::Automatic rollback failed; restore image from revision $RID."
    fi
  fi
  rm -f "$RUNNER_TEMP/awg-revision-before.json" "$RUNNER_TEMP/awg-revision-list.json" "$RUNNER_TEMP/awg-hotfix-deploy.out"
  exit "$code"
}
trap cleanup EXIT
DEPLOY_ATTEMPTED=1
deploy_revision "$NEW_IMAGE"

READY=0
for attempt in $(seq 1 24); do
  health=$(curl -sS --connect-timeout 10 --max-time 35 https://awgcars.ru/api/health 2>/dev/null || true)
  if printf '%s' "$health" | jq -e --arg sha "$GITHUB_SHA" '
    .ok==true and .buildSha==$sha and .persistence=="ydb-serverless"
    and .vkMessaging=="enabled" and .telegramNotifications=="enabled"
    and .telegramRoutableManagers==3 and .normalizedAuthoritative==true' >/dev/null 2>&1; then
    READY=1;break
  fi
  sleep 5
done
test "$READY" = 1 || { echo "::error::Hotfix failed production health check" >&2; exit 1; }
assert_webhook_unchanged

# Update only files needed by notification navigation; no other static/media.
for filename in auto-sale-notification-links.mjs auto-sale-app-v3.mjs auto-sale-vk-notification-navigation.mjs auto-sale-bootstrap.mjs; do
  yc storage s3 cp "dist/$filename" "s3://$AWG_STATIC_BUCKET/$filename" \
    --cache-control 'public, max-age=300, stale-while-revalidate=86400' \
    --content-type 'text/javascript; charset=utf-8' --only-show-errors
done
yc storage s3 cp dist/index.html "s3://$AWG_STATIC_BUCKET/index.html" \
  --cache-control 'no-cache, no-store, must-revalidate' \
  --content-type 'text/html; charset=utf-8' --only-show-errors

INDEX_OK=0
for attempt in $(seq 1 12); do
  html=$(curl -fsS --connect-timeout 10 --max-time 35 "https://awgcars.ru/?awg_hotfix_probe=$GITHUB_SHA" 2>/dev/null || true)
  if printf '%s' "$html" | grep -Fq "20261015-tg-deeplinks-v1"; then INDEX_OK=1;break;fi
  sleep 5
done
test "$INDEX_OK" = 1 || { echo "::error::Fresh frontend index not visible on public domain" >&2; exit 1; }
assert_webhook_unchanged
POST_HEALTH=$(curl --fail --silent --show-error --connect-timeout 10 --max-time 35 https://awgcars.ru/api/health)
printf '%s' "$POST_HEALTH" | jq -e --arg sha "$GITHUB_SHA" \
  '.ok==true and .buildSha==$sha and .vkMessaging=="enabled" and .telegramNotifications=="enabled" and .telegramRoutableManagers==3' >/dev/null
RELEASE_COMPLETE=1
echo "AWG_HOTFIX_COMPLETE Telegram and VK enabled; Cloudflare ingress untouched; original API key preserved; YDB unchanged."
