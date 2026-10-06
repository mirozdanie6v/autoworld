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
