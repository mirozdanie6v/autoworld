#!/usr/bin/env bash
set -euo pipefail
# Guarded VK ID browser release. Runtime and YDB identities are verified BEFORE mutation.
test "$YC_FOLDER_ID" = b1g8u8vqkgehvtbj8n13
test "$CONTAINER_NAME" = autoworld-awg-prod
test "$GATEWAY_NAME" = autoworld-awg-prod
test "$STATIC_BUCKET" = viiversion-autoworld-awg-static-b1g8u8vqkgehvtbj8n13
test "$TARGET_IMAGE" = cr.yandex/crptu0l7jn0iui8b8laa/autoworld-awg:vk-web-candidate-201d760d62d3e065e27119ea18091db76f30ed1d
test -n "$YC_IAM_TOKEN"
yc config set endpoint api.cloud.yandex.net:443 >/dev/null
yc config set token "$YC_IAM_TOKEN" >/dev/null
yc config set folder-id "$YC_FOLDER_ID" >/dev/null
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
container=$(yc serverless container get --name "$CONTAINER_NAME" --folder-id "$YC_FOLDER_ID" --format json)
id=$(printf '%s' "$container" | jq -r '.id')
test "$id" = bba691o7au7epjqvs77b
yc serverless container revision list --container-id "$id" --folder-id "$YC_FOLDER_ID" --format json > "$work/revisions.json"
old_id=$(jq -er '(if type=="array" then . else .revisions end) | sort_by(.created_at // .createdAt) | last | .id' "$work/revisions.json")
test "$old_id" = bbavmcegb6m6s1kvjqto || { echo "::error::Production revision changed; abort and re-audit."; exit 1; }
yc serverless container revision get "$old_id" --folder-id "$YC_FOLDER_ID" --format json > "$work/revision.json"
rev="$work/revision.json"
jq -e '
  .container_id=="bba691o7au7epjqvs77b" and .status=="ACTIVE" and
  .service_account_id=="aje8o9ric0d20k11521r" and
  .resources.memory=="536870912" and .resources.cores=="1" and
  .resources.core_fraction=="100" and
  .image.environment.AUTO_SALE_VK_ENABLED=="true" and
  (.image.environment.YDB_CONNECTION_STRING|endswith("/etn00ojk5iv1u7dgpdar")) and
  .image.environment.AUTO_SALE_PUBLIC_DEMO_WRITE=="false" and
  .image.environment.AUTO_SALE_YDB_READ_MODE=="normalized" and
  .image.environment.AUTO_SALE_YDB_DUAL_WRITE=="false" and
  .image.environment.AUTO_SALE_LEGACY_STATE_WRITE=="false" and
  (.image.environment.AUTO_SALE_TELEGRAM_BOT_TOKEN|length)>15 and
  (.image.environment.AUTO_SALE_VK_APP_SECRET|length)>15 and
  (.image.environment.AUTO_SALE_VK_COMMUNITY_TOKEN|length)>15 and
  (.image.environment.AUTO_SALE_API_KEY|length)>15 and
  (.secrets|length)==0
' "$rev" >/dev/null
test "$(jq -r '.image.image_url' "$rev")" = cr.yandex/crptu0l7jn0iui8b8laa/autoworld-awg:d7ab181874e62feae1891abdd34b2e225b925de6
echo "Production revision and YDB strict guards passed; existing Telegram and VK Mini App enabled."

# Do not read or log the key payload. The deployment SA must have metadata access
# and the production runtime SA must have lockbox.payloadViewer on this secret.
yc lockbox secret get --id "$LOCKBOX_ID" --format json > "$work/secret.json"
jq -e '.name=="autoworld-vk-web-session" and (.status=="ACTIVE" or .status=="Active")' "$work/secret.json" >/dev/null
yc lockbox secret list-versions --id "$LOCKBOX_ID" --format json > "$work/versions.json"
jq -e --arg version "$LOCKBOX_VERSION" 'any(.[]; .id==$version and (.status=="ACTIVE" or .status=="Active"))' "$work/versions.json" >/dev/null
echo "Lockbox secret and pinned active version metadata confirmed."

yc serverless api-gateway get-spec --name "$GATEWAY_NAME" --folder-id "$YC_FOLDER_ID" > "$work/gateway.yaml"
grep -q 'container_id: bba691o7au7epjqvs77b' "$work/gateway.yaml"
grep -q "bucket: $STATIC_BUCKET" "$work/gateway.yaml"
yc storage s3api head-object --bucket "$STATIC_BUCKET" --key index.html >/dev/null
yc storage s3api head-object --bucket "$STATIC_BUCKET" --key auto-sale-bootstrap.mjs >/dev/null
echo "Current gateway and static storage safe; production API routes unchanged."

assets=(index.html auto-sale-bootstrap.mjs auto-sale-app-v3.mjs
  auto-sale-vk-web.mjs auto-sale-vk-web-profile.mjs
  auto-sale-vk-status-widget.mjs auto-sale-vk-status-widget.css
  auto-sale-request-submit-feedback.mjs auto-sale-submit-bridge.mjs
  auto-sale-required-fields.mjs auto-sale-ui-business-guard.mjs)
mkdir -p "$work/backup"
: > "$work/original-assets"
: > "$work/published-assets"
for asset in "${assets[@]}"; do
  test -s "dist/$asset" || { echo "::error::Missing expected build asset $asset"; exit 1; }
  if yc storage s3api head-object --bucket "$STATIC_BUCKET" --key "$asset" >/dev/null 2>&1; then
    yc storage s3 cp "s3://$STATIC_BUCKET/$asset" "$work/backup/$asset" --only-show-errors >/dev/null
    test -s "$work/backup/$asset"
    echo "$asset" >> "$work/original-assets"
  fi
done
grep -q '20261010-vk-prod-v1' dist/index.html
grep -q 'auto-sale-vk-status-widget.mjs' dist/auto-sale-bootstrap.mjs
grep -q 'awgcars.ru' dist/auto-sale-vk-status-widget.mjs
echo "Static rollback snapshot secured before any writes."

old_image=$(jq -er '.image.image_url' "$rev")
orig_env=() new_env=()
while IFS= read -r key; do
  val=$(jq -r --arg k "$key" '.image.environment[$k]' "$rev")
  [[ "$key" =~ ^[A-Z0-9_]+$ ]] || exit 1
  [[ "$val" != *$'\n'* && "$val" != *$'\r'* ]] || exit 1
  orig_env+=(--environment "$key=$val")
  case "$key" in
    AUTO_SALE_VK_WEB_ENABLED|AUTO_SALE_VK_WEB_CLIENT_ID|AUTO_SALE_VK_WEB_ORIGIN|AUTO_SALE_BUILD_SHA) ;;
    AUTO_SALE_VK_WEB_COOKIE_KEY) echo "::error::Unexpected plaintext session key in production"; exit 1 ;;
    *) new_env+=(--environment "$key=$val") ;;
  esac
done < <(jq -r '.image.environment | keys[]' "$rev")
new_env+=(--environment AUTO_SALE_VK_WEB_ENABLED=true)
new_env+=(--environment AUTO_SALE_VK_WEB_CLIENT_ID=54811927)
new_env+=(--environment AUTO_SALE_VK_WEB_ORIGIN=https://awgcars.ru)
new_env+=(--environment AUTO_SALE_BUILD_SHA=201d760d62d3e065e27119ea18091db76f30ed1d)
common=(yc serverless container revision deploy
  --container-id "$id" --folder-id "$YC_FOLDER_ID"
  --cores 1 --core-fraction 100 --memory 512MB
  --execution-timeout 60s --concurrency 1
  --service-account-id aje8o9ric0d20k11521r
  --runtime http)
production_released=false
rollback_needed=false
mime_for() {
  case "$1" in
    *.html) echo 'text/html; charset=utf-8' ;;
    *.css) echo 'text/css; charset=utf-8' ;;
    *.mjs|*.js) echo 'text/javascript; charset=utf-8' ;;
    *) echo 'application/octet-stream' ;;
  esac
}
publish_asset() {
  local name="$1" file="$2"
  local cache='public, max-age=300, stale-while-revalidate=86400'
  [ "$name" = index.html ] && cache='no-cache, no-store, must-revalidate'
  yc storage s3 cp "$file" "s3://$STATIC_BUCKET/$name" --cache-control "$cache" --content-type "$(mime_for "$name")" --only-show-errors >/dev/null
}
rollback() {
  if [ "$rollback_needed" = true ] && [ "$production_released" != true ]; then
    echo "::warning::Rolling back AWG VK production release."
    while IFS= read -r name; do
      [ -n "$name" ] || continue
      if grep -Fxq "$name" "$work/original-assets"; then
        publish_asset "$name" "$work/backup/$name" || echo "::error::Static rollback failed for $name"
      else
        yc storage s3 rm "s3://$STATIC_BUCKET/$name" --only-show-errors || echo "::error::New static asset cleanup failed $name"
      fi
    done < "$work/published-assets"
    "${common[@]}" --image "$old_image" --description 'Rollback AWG VK Web production release' "${orig_env[@]}" || echo "::error::Production runtime rollback failed; manual restore required"
    echo 'Review production site and manually restore if any rollback error was logged.' >> "$GITHUB_STEP_SUMMARY"
  fi
}
trap rollback EXIT
echo 'Rolling out candidate backend. Static files unchanged at this phase.'
"${common[@]}" --image "$TARGET_IMAGE" --description 'AWG VK ID Web enabled; preserve Telegram and VK Mini App'   --secret "environment-variable=AUTO_SALE_VK_WEB_COOKIE_KEY,id=$LOCKBOX_ID,version-id=$LOCKBOX_VERSION,key=cookie-key"   "${new_env[@]}"
rollback_needed=true

# Ensure old production services continue functioning before touching static files.
backend_ok=false
for attempt in $(seq 1 14); do
  health=$(curl -sS --connect-timeout 10 --max-time 35 -o "$work/health.json" -w '%{http_code}' https://awgcars.ru/api/health || true)
  conf=$(curl -sS --connect-timeout 10 --max-time 30 -o "$work/config.json" -w '%{http_code}' https://awgcars.ru/api/auto-sale/vk/web/config || true)
  profile=$(curl -sS --connect-timeout 10 --max-time 25 -o "$work/profile.json" -w '%{http_code}' https://awgcars.ru/api/auto-sale/vk/web/profile || true)
  login=$(curl -sS --connect-timeout 10 --max-time 25 -D "$work/start.headers" -o /dev/null -w '%{http_code}' https://awgcars.ru/api/auto-sale/vk/web/start || true)
  echo "Backend smoke $attempt: health=$health config=$conf profile=$profile login=$login"
  if [ "$health" = 200 ] && [ "$conf" = 200 ] && [ "$profile" = 401 ] && [ "$login" = 302 ] &&
     jq -e '.ok==true and .vkAuth=="enabled" and .vkMessaging=="enabled" and .telegramRoutableManagers>=2' "$work/health.json" >/dev/null &&
     jq -e '.enabled==true and .authenticated==false' "$work/config.json" >/dev/null &&
     grep -Eiq '^location: https://id.vk.ru/authorize\?' "$work/start.headers" &&
     grep -q 'redirect_uri=https%3A%2F%2Fawgcars.ru%2Fapi%2Fauto-sale%2Fvk%2Fweb%2Fcallback' "$work/start.headers"; then
     backend_ok=true;break
  fi
  sleep 8
done
[ "$backend_ok" = true ] || { echo "::error::VK backend or existing channels failed smoke"; exit 1; }
echo 'Backend VK ID enabled, existing Telegram and VK Mini App still active.'

# Atomic-ish frontend cutover: upload all dependent modules, index last.
for name in "${assets[@]}"; do
  [ "$name" = index.html ] && continue
  echo "$name" >> "$work/published-assets"
  publish_asset "$name" "dist/$name"
done
echo index.html >> "$work/published-assets"
publish_asset index.html dist/index.html

front_ok=false
for attempt in $(seq 1 12); do
  idx=$(curl -sS --connect-timeout 10 --max-time 35 -o "$work/index.html" -w '%{http_code}' https://awgcars.ru/ || true)
  js=$(curl -sS --connect-timeout 10 --max-time 35 -o "$work/bootstrap.mjs" -w '%{http_code}' https://awgcars.ru/auto-sale-bootstrap.mjs || true)
  widget=$(curl -sS --connect-timeout 10 --max-time 35 -o "$work/widget.mjs" -w '%{http_code}' https://awgcars.ru/auto-sale-vk-status-widget.mjs || true)
  state=$(curl -sS --connect-timeout 10 --max-time 35 -o "$work/state.json" -w '%{http_code}' https://awgcars.ru/api/auto-sale/state || true)
  echo "Frontend smoke $attempt: index=$idx bootstrap=$js widget=$widget state=$state"
  if [ "$idx" = 200 ] && [ "$js" = 200 ] && [ "$widget" = 200 ] && [ "$state" = 200 ] &&
    grep -q '20261010-vk-prod-v1' "$work/index.html" &&
    grep -q 'auto-sale-vk-status-widget.mjs' "$work/bootstrap.mjs" &&
    grep -q 'awgcars.ru' "$work/widget.mjs" &&
    jq -e '(.leads|length)==0 and (.catalog|type)=="array"' "$work/state.json" >/dev/null; then
    front_ok=true;break
  fi
  sleep 8
done
[ "$front_ok" = true ] || { echo "::error::VK frontend production smoke failed"; exit 1; }
production_released=true
trap - EXIT
echo '### AWG VK ID Production: RELEASED' >> "$GITHUB_STEP_SUMMARY"
echo 'Production only: new backend, verified session cookie secret, public VK login badge, and preserved Telegram/VK Mini App. Initial HTTPS smoke passed.' >> "$GITHUB_STEP_SUMMARY"
echo 'Real user OAuth sign-in and Telegram/VK delivery require authenticated acceptance tests; not impersonated.' >> "$GITHUB_STEP_SUMMARY"
echo "RELEASED_AWG_VK_PRODUCTION"
