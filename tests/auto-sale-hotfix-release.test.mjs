import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const script=readFileSync(new URL('../scripts/deploy-awg-telegram-notification-hotfix.sh',import.meta.url),'utf8');
const workflow=readFileSync(new URL('../.github/workflows/release-awg-telegram-notification-hotfix.yml',import.meta.url),'utf8');

test('the one-time notification hotfix script has valid Bash syntax',()=>{
  assert.doesNotThrow(()=>execFileSync('bash',['-n','scripts/deploy-awg-telegram-notification-hotfix.sh']));
});

test('the release is marker-gated and does not reset Telegram webhook or rotate admin credentials',()=>{
  assert.match(workflow,/\.production\/awg-telegram-notification-hotfix/);
  assert.match(workflow,/awg-yandex-production-writer/);
  assert.match(script,/GITHUB_RUN_ATTEMPT/);
  assert.match(script,/intent=telegram-navigation-no-drafts-20261015/);
  assert.doesNotMatch(script,/bot\$\{BOT_TOKEN\}\/(?:setWebhook|deleteWebhook)/);
  assert.doesNotMatch(script,/api\/auto-sale\/(?:state|leads|quotes|orders)(?:[\/?]|["'])/);
  assert.doesNotMatch(script,/openssl rand/);
  assert.match(script,/\.image\.environment \| to_entries/);
  assert.match(script,/OLD_IMAGE/);
  assert.match(script,/if deploy_revision "\$OLD_IMAGE"/);
  assert.match(script,/\.image\.environment\.AUTO_SALE_VK_ENABLED == "true"/);
  assert.match(script,/\.image\.environment\.AUTO_SALE_VK_WEB_ENABLED == "true"/);
  assert.match(script,/WEBHOOK_URL=https:\/\/integration-telegram\.viiversion\.com\/telegram\/webhook/);
  assert.match(script,/assert_webhook_unchanged/);
  assert.match(script,/yc storage s3 cp dist\/index\.html/);
});
