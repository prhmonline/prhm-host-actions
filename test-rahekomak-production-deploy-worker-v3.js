'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const m = require('./rahekomak-production-deploy-worker-v3.js');

test('worker is locked to the reviewed RahKomak release, never caller-supplied paths', () => {
  assert.equal(m.HEAD, '88605f30f9922d504b7e4f93ff1c4da9b837aa26');
  assert.equal(m.HELPER_SHA256, '5e1abba88eaa90f3ab1140c6b39e1747cbb4000f9fbbbf3c27883c75c0c93db7');
  assert.equal(m.ROOT, '/home/prhm/projects/generated/rahekomak');
  assert.equal(m.HELPER, m.ROOT + '/infra/docker/production-deploy-v1.cjs');
  assert.equal(m.ACTION, 'rahekomak_production_deploy_v1');
  const s = fs.readFileSync(path.join(__dirname, 'rahekomak-production-deploy-worker-v3.js'), 'utf8');
  assert.match(s, /preflightIdentity\(\)/);
  assert.match(s, /helper_not_regular_exact/);
  assert.match(s, /release_worktree_dirty/);
  assert.match(s, /RAHEKOMAK_EXPECTED_HEAD: HEAD/);
  assert.doesNotMatch(s, /shell\s*:\s*true|execSync\(|\/bin\/sh|\/bin\/bash/);
});

test('only nonce-derived fixed report paths are accepted', () => {
  assert.equal(m.reportPath('--apply', 'a'.repeat(32)).replaceAll('\\', '/'),
    '/var/lib/prhm-agent-selfmaint-exec/rahekomak-v3-' + 'a'.repeat(32) + '-apply.json');
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
  const src = fs.readFileSync(path.join(__dirname, 'rahekomak-production-deploy-worker-v3.js'), 'utf8');
  assert.match(src, /process\.argv\.length !== 4/);
  assert.match(src, /mode === '--apply'/);
  assert.match(src, /--preflight/);
  assert.match(src, /\{ mode: 0o600, flag: 'wx' \}/);
});

const releaseManifest=require('./rahekomak-release-88605f30-manifest-v3.json');
test('new release candidate cannot silently reuse an old registered approval contract',()=>{
 assert.equal(releaseManifest.schema_version,'prhm.rahekomak-release-candidate.v3');
 assert.equal(releaseManifest.status,'REVIEW_ONLY_NOT_REGISTERED');
 assert.equal(releaseManifest.application.repository,'prhmonline/help');
 assert.equal(releaseManifest.application.merge_sha,m.HEAD);
 assert.equal(releaseManifest.application.helper_sha256_git_lf,m.HELPER_SHA256);
 assert.equal(releaseManifest.host_actions.worker_file,'rahekomak-production-deploy-worker-v3.js');
 assert.equal(releaseManifest.host_actions.native_registrar,'NOT_INSTALLED');
 assert.equal(releaseManifest.host_actions.level4_signed_single_use_required,true);
 assert.equal(releaseManifest.production_mutation,false);
 const legacy=require('./rahekomak-production-deploy-worker-v2.js');
 assert.equal(legacy.HEAD,'184b703729122df73c1a92da081ef09b7e418ed3');
 assert.equal(legacy.HELPER_SHA256,'30d3b1a405af7d5f2a84223e0f0b2f9c1ea364526ca83d31df298d62f3e65833');
});
