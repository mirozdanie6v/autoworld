import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('production Telegram workflows share one bot secret and configurable primary URL',async()=>{
  const deploy=await readFile(new URL('../.github/workflows/deploy-awg-production.yml',import.meta.url),'utf8');
  const configure=await readFile(new URL('../.github/workflows/configure-autoworld-telegram-bot.yml',import.meta.url),'utf8');
  const relay=await readFile(new URL('../.github/workflows/deploy-telegram-relay.yml',import.meta.url),'utf8');

  assert.match(deploy,/vars\.AWG_PRIMARY_APP_URL/);
  assert.match(configure,/vars\.AWG_PRIMARY_APP_URL/);
  assert.match(deploy,/https:\/\/awgcars\.ru\//);
  assert.match(configure,/https:\/\/awgcars\.ru\//);
  assert.match(deploy,/secrets\.AWG_TELEGRAM_BOT_TOKEN/);
  assert.match(configure,/secrets\.AWG_TELEGRAM_BOT_TOKEN/);
  assert.match(relay,/secrets\.AWG_TELEGRAM_BOT_TOKEN/);
  assert.doesNotMatch(configure,/secrets\.AUTO_SALE_TELEGRAM_BOT_TOKEN/);
  assert.doesNotMatch(relay,/secrets\.AUTO_SALE_TELEGRAM_BOT_TOKEN/);
  assert.match(relay,/secrets\.AWG_RELAY_SECRET/);
  assert.match(relay,/wrangler secret put AUTOWORLD_RELAY_SECRET/);
  assert.match(configure,/AUTO_SALE_TELEGRAM_WEBHOOK_BASE_URL: https:\/\/awgcars\.ru\//);
  assert.match(deploy,/telegramNotifications == "enabled"/);
  assert.match(deploy,/telegramRoutingReady/);
  assert.match(deploy,/telegramRoutableManagers/);
});


test('Yandex runtime image contains shared manager directory used by server',async()=>{
  const docker=await readFile(new URL('../Dockerfile.yandex',import.meta.url),'utf8');
  const server=await readFile(new URL('../server/yandex-server.mjs',import.meta.url),'utf8');
  const build=await readFile(new URL('../scripts/build-autoworld.mjs',import.meta.url),'utf8');
  assert.match(docker,/COPY shared \.\/shared/);
  assert.match(server,/\.\.\/shared\/auto-sale-manager-directory\.mjs/);
  assert.doesNotMatch(server,/\.\.\/public\/auto-sale-manager-directory\.mjs/);
  assert.match(build,/shared[^\n]+auto-sale-manager-directory\.mjs/);
});


test('production deploy seeds canonical managers before runtime deployment',async()=>{
  const deploy=await readFile(new URL('../.github/workflows/deploy-awg-production.yml',import.meta.url),'utf8');
  const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  const script=await readFile(new URL('../scripts/ensure-auto-sale-production-team.mjs',import.meta.url),'utf8');
  assert.equal(pkg.scripts['ensure:production-team'],'node scripts/ensure-auto-sale-production-team.mjs');
  assert.match(deploy,/npm run ensure:production-team/);
  assert.match(script,/canonicalAutoSaleTeam/);
  assert.match(script,/current\.length/);
  assert.match(script,/mutateAutoSaleEntityBatch/);
});


test('production Telegram cutover waits for the exact deployed source SHA',async()=>{
  const server=await readFile(new URL('../server/yandex-server.mjs',import.meta.url),'utf8');
  const deploy=await readFile(new URL('../.github/workflows/deploy-awg-production.yml',import.meta.url),'utf8');
  assert.match(server,/buildSha:String\(process\.env\.AUTO_SALE_BUILD_SHA\|\|''\)/);
  assert.match(deploy,/AUTO_SALE_BUILD_SHA=\$GITHUB_SHA/);
  assert.match(deploy,/\.buildSha == env\.GITHUB_SHA/);
});


test('Telegram webhook ingress uses authenticated relay endpoint',async()=>{
  const deploy=await readFile(new URL('../.github/workflows/deploy-awg-production.yml',import.meta.url),'utf8');
  const configure=await readFile(new URL('../scripts/configure-autoworld-telegram-bot.mjs',import.meta.url),'utf8');
  const relay=await readFile(new URL('../cloudflare/telegram-relay/src/index.js',import.meta.url),'utf8');
  assert.match(deploy,/AUTO_SALE_TELEGRAM_WEBHOOK_URL: https:\/\/integration-telegram\.viiversion\.com\/telegram\/webhook/);
  assert.match(configure,/secret_token:webhookSecretToken/);
  assert.match(configure,/x-telegram-bot-api-secret-token/);
  assert.match(relay,/invalid_telegram_webhook_secret/);
  assert.match(relay,/AUTOWORLD_YANDEX_WEBHOOK_URL/);
});
