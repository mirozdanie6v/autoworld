import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const deploy=read('.github/workflows/deploy-awg-production.yml');
const configure=read('scripts/configure-autoworld-telegram-bot.mjs');
const switchScript=read('scripts/switch-awg-telegram-prod-to-relay.mjs');

test('production redeploy retains verified Cloudflare Telegram webhook ingress',()=>{
 assert.match(deploy,/AUTO_SALE_TELEGRAM_WEBHOOK_URL: https:\/\/integration-telegram\.viiversion\.com\/telegram\/webhook/);
 assert.match(deploy,/Configure Telegram Mini App and webhook/);
});

test('Telegram webhook cutover validates signed upstream and never deletes pending updates',()=>{
 assert.doesNotMatch(configure,/api\('deleteWebhook'/);
 assert.match(configure,/Refusing Telegram webhook change: signed target preflight failed/);
 assert.match(configure,/drop_pending_updates:false/);
 assert.ok(configure.indexOf('const targetProbe=')<configure.indexOf("await api('setWebhook'"));
});

test('safe Cloudflare cutover accepts current exact Yandex gateway URL but rejects other URLs',()=>{
 assert.match(switchScript,/const oldYandexGateway=/);
 assert.match(switchScript,/\[production,oldYandexGateway,target\]/);
 assert.match(switchScript,/refuse_unexpected_current_webhook_URL/);
 assert.match(switchScript,/drop_pending_updates:false/);
});
