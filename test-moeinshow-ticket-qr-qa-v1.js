'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const qa = require('./moeinshow-ticket-qr-qa-v1.js');

test('pinned immutable MoeinShow PR #11 fixture passes Git blob checks', () => {
  const result = qa.verifySource();
  assert.equal(result.ok, true);
  assert.equal(result.fixture_count, 6);
  assert.equal(result.source_sha, '7e670bc6f11267d8b955f1b3671787adecc65c93');
  assert.equal(result.network_required, false);
  assert.equal(result.production_writes, false);
});
test('sandbox is network and database isolated and strictly resource capped', () => {
  const stage = '/var/cache/prhm-moeinshow-ticket-qr-qa-v1/stage-test';
  const args = qa.buildSystemdArgs(stage, stage + '/run-fixed.sh');
  for (const check of [
    '--property=PrivateNetwork=yes',
    '--property=IPAddressDeny=any',
    '--property=RestrictAddressFamilies=AF_UNIX',
    '--property=ProtectSystem=strict',
    '--property=ProtectHome=tmpfs',
    '--property=NoNewPrivileges=yes',
    '--property=CPUQuota=25%',
    '--property=MemoryMax=512M',
    '--property=TasksMax=32',
    '--property=RuntimeMaxSec=120',
    '--property=ReadWritePaths=' + stage,
  ]) {
    assert.ok(args.includes(check), 'missing sandbox gate: ' + check);
  }
  assert.ok(args.some(s => s.startsWith('--property=InaccessiblePaths=') && s.includes('mysqld')));
  assert.ok(!args.join(' ').includes('moeinshow.com/public_html'));
  assert.equal(args[args.length - 2], '/bin/bash');
  assert.equal(args[args.length - 1], stage + '/run-fixed.sh');
});
test('runner accepts only fixed approved source and no secret / production config payload', () => {
  const base = path.join(__dirname, 'qa/moeinshow-ticket-qr-qa-v1/source');
  const files = [
    'composer.json',
    'app/tests/contract/TicketQrContract.php',
    'app/views/admin-reserve/print-ticket-new.php',
    'app/views/admin-reserve/_print-ticket-mpdf.php',
    'app/modules/api/views/public/print-ticket-new.php',
    'scripts/verify-ticket-qr-offline.sh'
  ];
  const combined = files.map(s => fs.readFileSync(path.join(base, s), 'utf8')).join('\n');
  assert.ok(combined.includes('MOEINSHOW-QA-TICKET-0001'));
  assert.ok(!combined.includes('Mpdf\\QrCode\\QrCode'));
  assert.ok(combined.includes('Da\\QrCode\\QrCode'));
  assert.ok(!files.some(s => /\.env$|auth\.json|local\.php|prod\.php/.test(s)));
});
test('the action has no direct execution route and exposes an explicit approval adapter boundary', () => {
  const source = fs.readFileSync(path.join(__dirname, 'moeinshow-ticket-qr-qa-v1.js'), 'utf8');
  assert.match(source, /direct_execution_not_permitted/);
  assert.match(source, /registered_root_action_required/);
  assert.match(source, /systemd-run/);
  assert.match(source, /shell: false/);
  assert.doesNotMatch(source, /child_process\.exec\(/);
});
