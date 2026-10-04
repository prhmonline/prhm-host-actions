'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mod = require('./waha-student-bridge-install-v1.js');

test('pins exact WAHA GOWS image and localhost port', () => {
  assert.equal(mod.SPEC.image, 'devlikeapro/waha:gows-2026.9.2@sha256:b4a6d545b069b642cc3743d91801c0e98c9dcd6247b029a275bfb3b295ed9e4d');
  assert.equal(mod.SPEC.host, '127.0.0.1');
  assert.equal(mod.SPEC.port, 3105);
  assert.equal(mod.SPEC.session, 'student-outreach');
});

test('compose is one-service, localhost-only and persistent', () => {
  const yml = mod.buildCompose();
  assert.match(yml, /127\.0\.0\.1:3105:3000/);
  assert.match(yml, /\.\/sessions:\/app\/\.sessions/);
  assert.match(yml, /container_name: prhm-whatsapp-student-bridge/);
  assert.doesNotMatch(yml, /0\.0\.0\.0/);
  assert.doesNotMatch(yml, /postgres|redis|evolution/i);
  assert.equal((yml.match(/^  waha:/gm) || []).length, 1);
});

test('runtime env stores only API key hash and disables admin surfaces', () => {
  const env = mod.buildEnv('a'.repeat(128));
  assert.match(env, /^WAHA_API_KEY=sha512:a{128}$/m);
  assert.match(env, /^WAHA_DASHBOARD_ENABLED=false$/m);
  assert.match(env, /^WHATSAPP_SWAGGER_ENABLED=false$/m);
  assert.match(env, /^WHATSAPP_DEFAULT_ENGINE=GOWS$/m);
  assert.match(env, /^WAHA_API_KEY_EXCLUDE_PATH=health,ping,api\/sessions\/student-outreach$/m);
  assert.doesNotMatch(env, /989351344400|\+989351344400/);
});

test('installer source contains no target phone number and no bulk behavior', () => {
  const src = fs.readFileSync(path.join(__dirname, 'waha-student-bridge-install-v1.js'), 'utf8');
  assert.doesNotMatch(src, /989351344400|\+989351344400/);
  assert.doesNotMatch(src, /bulk|campaign|broadcast/i);
});

test('CLI only accepts fixed modes', () => {
  assert.deepEqual(mod.ALLOWED_MODES, ['--preflight-only', '--apply', '--status', '--rollback']);
});
