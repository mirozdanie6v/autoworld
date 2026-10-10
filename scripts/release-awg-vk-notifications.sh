#!/usr/bin/env bash
set -euo pipefail
umask 077
test "$YC_FOLDER_ID" = b1g8u8vqkgehvtbj8n13
test "$TARGET_SHA" = 26901f48217bfa5e118a2ee8972fda8c4a277858
test "$EXPECTED_PRODUCTION_REVISION" = bbafo3l4q6tpag0uhopr
test -n "$YC_IAM_TOKEN"
prod_id=bba691o7au7epjqvs77b
stage_id=bbag75c5g7vup8sfbmop
bucket=viiversion-autoworld-awg-static-b1g8u8vqkgehvtbj8n13
work="$RUNNER_TEMP/vk-notifications-private"
backup="$RUNNER_TEMP/vk-notifications-public-backup"
mkdir -p "$work" "$backup"
yc config set endpoint api.cloud.yandex.net:443 >/dev/null
yc config set token "$YC_IAM_TOKEN" >/dev/null
yc config set folder-id "$YC_FOLDER_ID" >/dev/null
assets=(auto-sale-channel-analytics.mjs auto-sale-notification-links.mjs
  auto-sale-vk-notification-navigation.mjs auto-sale-core.mjs auto-sale-vk.mjs
  auto-sale-telegram.mjs auto-sale-client-quote.mjs auto-sale-app-v3.mjs
  auto-sale-bootstrap.mjs index.html)
: > "$work/original-assets"
: > "$work/published-assets"
stage_touched=false stage_done=false prod_touched=false release_done=false
stage_old=''

mime_for(){ case "$1" in *.html) echo 'text/html; charset=utf-8';; *) echo 'text/javascript; charset=utf-8';; esac; }
publish_asset(){
  local name="$1" file="$2" restoring="${3:-false}" cache mime
  cache='public, max-age=300';mime=$(mime_for "$name")
  [ "$name" != index.html ] || cache='no-cache, no-store, must-revalidate'
  if [ "$restoring" = true ]; then
    cache=$(jq -r --arg fallback "$cache" '.CacheControl // .cache_control // .cacheControl // $fallback' "$backup/$name.metadata.json")
    mime=$(jq -r --arg fallback "$mime" '.ContentType // .content_type // .contentType // $fallback' "$backup/$name.metadata.json")
  fi
  yc storage s3 cp "$file" "s3://$bucket/$name" --cache-control "$cache" --content-type "$mime" --only-show-errors >/dev/null
}
rollback(){
  local code=$? failed=false name
  if [ "$prod_touched" = true ] && [ "$release_done" != true ]; then
    echo '::warning::Release verification failed; restoring previous frontend and runtime.'
    while IFS= read -r name; do
      if grep -Fxq "$name" "$work/original-assets"; then
        publish_asset "$name" "$backup/$name" true || failed=true
      else
        yc storage s3 rm "s3://$bucket/$name" --only-show-errors >/dev/null || failed=true
      fi
    done < "$work/published-assets"
    yc serverless container rollback --id "$prod_id" --revision-id "$EXPECTED_PRODUCTION_REVISION" --folder-id "$YC_FOLDER_ID" > "$work/rollback.json" 2> "$work/rollback-error" || failed=true
  fi
  if [ "$stage_touched" = true ] && [ "$stage_done" != true ]; then
    yc serverless container rollback --id "$stage_id" --revision-id "$stage_old" --folder-id "$YC_FOLDER_ID" > "$work/stage-rollback.json" 2> "$work/stage-rollback-error" || failed=true
  fi
  rm -rf "$work"
  if [ "$failed" = true ]; then echo '::error::Rollback failed; review the deployment before continuing.';exit 1;fi
  exit "$code"
}
trap rollback EXIT
latest_revision(){
  yc serverless container revision list --container-id "$1" --folder-id "$YC_FOLDER_ID" --format json > "$work/list.json"
  jq -er '(if type=="array" then . else .revisions end) | sort_by(.created_at // .createdAt) | last | .id' "$work/list.json"
}
get_revision(){
  curl --fail --silent --show-error --connect-timeout 10 --max-time 45 \
    -H "Authorization: Bearer $YC_IAM_TOKEN" \
    "https://serverless-containers.api.cloud.yandex.net/containers/v1/revisions/$1" -o "$2"
}
prepare_request(){
  node scripts/auto-sale-vk-release-config.mjs build "$work/$1.json" "$1" "$2" "$TARGET_SHA" > "$work/$1-request.json"
}
deploy_request(){
  local environment="$1" operation_id done=false new_id
  curl --fail --silent --show-error --connect-timeout 10 --max-time 45 \
    -H "Authorization: Bearer $YC_IAM_TOKEN" -H 'Content-Type: application/json' \
    --data-binary "@$work/$environment-request.json" \
    https://serverless-containers.api.cloud.yandex.net/containers/v1/revisions:deploy \
    -o "$work/$environment-operation.json"
  operation_id=$(jq -er '.id' "$work/$environment-operation.json")
  for attempt in $(seq 1 40); do
    yc operation get "$operation_id" --format json > "$work/$environment-operation.json" 2> "$work/operation-error"
    if jq -e '.done==true' "$work/$environment-operation.json" >/dev/null; then done=true;break;fi
    sleep 3
  done
  [ "$done" = true ] && jq -e '(.error // null)==null' "$work/$environment-operation.json" >/dev/null
  new_id=$(jq -er '.response.id // .response.value.id // .metadata.revision_id // .metadata.revisionId' "$work/$environment-operation.json")
  get_revision "$new_id" "$work/$environment-current.json"
  node scripts/auto-sale-vk-release-config.mjs verify "$work/$environment.json" "$environment" \
    "$(jq -r '.id' "$work/$environment.json")" "$TARGET_SHA" "$work/$environment-current.json"
  echo "$environment runtime ready: revision=$new_id"
}
http_get(){
  local code
  code=$(curl --silent --show-error --connect-timeout 10 --max-time 35 -o "$2" -w '%{http_code}' "$1" || true)
  [ "$code" = "${3:-200}" ]
}
health_check(){
  local origin="$1" environment="$2" ok=false
  for attempt in $(seq 1 12); do
    if http_get "$origin/api/health" "$work/health.json" &&
      jq -e --arg sha "$TARGET_SHA" '.ok==true and .buildSha==$sha' "$work/health.json" >/dev/null &&
      http_get "$origin/api/auto-sale/vk/web/config" "$work/config.json" &&
      jq -e '.enabled==true and .authenticated==false' "$work/config.json" >/dev/null &&
      http_get "$origin/api/auto-sale/vk/web/profile" "$work/profile.json" 401; then
      if [ "$environment" != production ] || jq -e '.vkAuth=="enabled" and .vkMessaging=="enabled" and .telegramRoutableManagers>=2' "$work/health.json" >/dev/null; then ok=true;break;fi
    fi
    sleep 5
  done
  [ "$ok" = true ] || { echo "::error::$environment health verification failed";return 1; }
  echo "$environment HTTP health, anonymous access and VK web configuration passed."
}
verify_assets(){
  local origin="$1" name ok
  for name in "${assets[@]}"; do
    ok=false
    for attempt in $(seq 1 3); do
      if http_get "$origin/$name?v=20261011-vk-notifications-v1" "$work/asset" && cmp -s "dist/$name" "$work/asset"; then ok=true;break;fi
      sleep 3
    done
    [ "$ok" = true ] || { echo "::error::$name does not match the validated build";return 1; }
  done
}

# Production preflight runs before staging and repeats immediately before cutover.
test "$(latest_revision "$prod_id")" = "$EXPECTED_PRODUCTION_REVISION"
get_revision "$EXPECTED_PRODUCTION_REVISION" "$work/production.json"
prepare_request production "$EXPECTED_PRODUCTION_REVISION"
yc serverless api-gateway get-spec --name autoworld-awg-prod --folder-id "$YC_FOLDER_ID" > "$work/gateway.yaml"
grep -q "container_id: $prod_id" "$work/gateway.yaml"
grep -q "bucket: $bucket" "$work/gateway.yaml"
for name in "${assets[@]}"; do
  test -s "dist/$name"
  if yc storage s3api head-object --bucket "$bucket" --key "$name" --format json > "$backup/$name.metadata.json" 2> "$work/head-error"; then
    yc storage s3 cp "s3://$bucket/$name" "$backup/$name" --only-show-errors >/dev/null
    echo "$name" >> "$work/original-assets"
  else
    case "$name" in auto-sale-channel-analytics.mjs|auto-sale-notification-links.mjs|auto-sale-vk-notification-navigation.mjs)
      grep -Eiq '404|NoSuchKey|NotFound|not found' "$work/head-error" || { echo '::error::Static storage backup unavailable';exit 1; };;
      *) echo "::error::Existing asset $name could not be backed up";exit 1;;
    esac
    rm -f "$backup/$name.metadata.json"
  fi
done
index_etag=$(jq -er '.ETag // .etag // .e_tag // .eTag' "$backup/index.html.metadata.json")
echo 'Production config and public frontend rollback snapshot ready.'
stage_old=$(latest_revision "$stage_id")
get_revision "$stage_old" "$work/staging.json"
prepare_request staging "$stage_old"
stage_touched=true
deploy_request staging
health_check https://vk-test.awgcars.ru staging
verify_assets https://vk-test.awgcars.ru
stage_done=true
echo 'Isolated staging verified; no customer messages or application-data writes used.'

test "$(latest_revision "$prod_id")" = "$EXPECTED_PRODUCTION_REVISION" || { echo '::error::Production changed; stop and repeat preflight';exit 1; }
yc storage s3api head-object --bucket "$bucket" --key index.html --format json > "$work/index-current.json"
test "$(jq -er '.ETag // .etag // .e_tag // .eTag' "$work/index-current.json")" = "$index_etag" || { echo '::error::Production frontend changed; stop and repeat preflight';exit 1; }
prod_touched=true
deploy_request production
health_check https://awgcars.ru production
# Dependencies first, bootstrap and HTML last. No gateway, IAM or database changes.
for name in "${assets[@]}"; do
  echo "$name" >> "$work/published-assets"
  publish_asset "$name" "dist/$name"
done
verify_assets https://awgcars.ru
http_get https://awgcars.ru/api/auto-sale/state "$work/public-state.json"
jq -e '(.leads|length)==0 and (.quotes|length)==0 and (.orders|length)==0 and (.catalog|type)=="array"' "$work/public-state.json" >/dev/null
health_check https://awgcars.ru production
release_done=true
echo 'RELEASED_AWG_VK_NOTIFICATIONS_AND_ANALYTICS'
echo '### VK request notifications and channel analytics released' >> "$GITHUB_STEP_SUMMARY"
echo 'Staging and production passed HTTP, access and exact frontend artifact checks. Existing runtime configuration and pinned secret bindings preserved. No schema migration or customer test messages.' >> "$GITHUB_STEP_SUMMARY"
echo 'Native VK keyboard acceptance and physical delivery remain an authenticated acceptance check.' >> "$GITHUB_STEP_SUMMARY"
