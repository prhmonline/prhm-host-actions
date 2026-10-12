'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const m = require('./rahekomak-production-deploy-worker-v2.js');

test('worker is locked to the reviewed RahKomak release, never caller-supplied paths', () => {
  assert.equal(m.HEAD, '7f2ea82b0865bb64c8adbc3192e8547fe4f43c25');
  assert.equal(m.HELPER_SHA256, 'd61140507300b4e2fc6650f2fc5e4b769543d9937dd2ff58574827af9c40696f');
  assert.equal(m.ROOT, '/home/prhm/projects/generated/rahekomak');
  assert.equal(m.HELPER, m.ROOT + '/infra/docker/production-deploy-v1.cjs');
  assert.equal(m.ACTION, 'rahekomak_production_deploy_v1');
  const s = fs.readFileSync(path.join(__dirname, 'rahekomak-production-deploy-worker-v2.js'), 'utf8');
  assert.match(s, /preflightIdentity\(\)/);
  assert.match(s, /helper_not_regular_exact/);
  assert.match(s, /release_worktree_dirty/);
  assert.match(s, /RAHEKOMAK_EXPECTED_HEAD: HEAD/);
  assert.doesNotMatch(s, /shell\s*:\s*true|execSync\(|\/bin\/sh|\/bin\/bash/);
});

test('only nonce-derived fixed report paths are accepted', () => {
  assert.equal(m.reportPath('--apply', 'a'.repeat(32)),
    '/var/lib/prhm-agent-selfmaint-exec/rahekomak-v2-' + 'a'.repeat(32) + '-apply.json');
  for (const invalid of ['../../tmp', 'A'.repeat(32), 'x'.repeat(32), 'a'.repeat(31), 'a'.repeat(33), '']) {
    assert.throws(() => m.reportPath('--preflight', invalid), /invalid_nonce/);
  }
});

test('preflight response must match the fixed HEAD and verified action', () => {
  const r = { ok:true, action:m.ACTION,
    schema_version:'prhm.rahekomak-production-deploy-result.v1',
    preflight_only:true, expected_head:m.HEAD };
  assert.equal(m.validateResult(r, '--preflight'), r);
  assert.throws(() => m.validateResult({...r, expected_head:'0'.repeat(40)}, '--preflight'), /deploy_preflight_invalid/);
});

test('apply response must include exact release and three green smoke checks', () => {
  const good = { ok:true, action:m.ACTION,
    schema_version:'prhm.rahekomak-production-deploy-result.v1',
    deployed_head:m.HEAD, rollback_performed:false, public_dns_mutation:false, edge_tls_mutation:false,
    local_smoke:{public:200, admin:200, api:200} };
  assert.equal(m.validateResult(good, '--apply'), good);
  assert.throws(() => m.validateResult({...good, deployed_head:'0'.repeat(40)}, '--apply'), /postcondition/);
  assert.throws(() => m.validateResult({...good, rollback_performed:true}, '--apply'), /postcondition/);
  assert.throws(() => m.validateResult({...good, local_smoke:{...good.local_smoke,api:500}}, '--apply'), /smoke/);
  assert.throws(() => m.validateResult({...good,ok:false}, '--apply'), /result_invalid/);
});

test('worker executes nothing when directly invoked without the fixed mode and nonce', () => {
  const src = fs.readFileSync(path.join(__dirname, 'rahekomak-production-deploy-worker-v2.js'), 'utf8');
  assert.match(src, /process\.argv\.length !== 4/);
  assert.match(src, /mode === '--apply'/);
  assert.match(src, /--preflight/);
  assert.match(src, /\{ mode: 0o600, flag: 'wx' \}/);
});
