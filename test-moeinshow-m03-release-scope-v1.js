'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const scope = require('./moeinshow-m03-release-scope-v1.js');

function clone(value){ return JSON.parse(JSON.stringify(value)); }
test('manifest stays at exactly the seven reviewed UI paths with exact Git blobs', () => {
  assert.equal(scope.validateManifest(scope.manifest), true);
  assert.equal(scope.ALLOWED_PATHS.length, 7);
  assert.deepEqual(scope.manifest.files.map(f => f.path), scope.ALLOWED_PATHS);
  const s=scope.deriveCandidate();
  assert.equal(s.action,'moeinshow_m03_scoped_delivery_v1');
  assert.equal(s.policy_level,4);
  assert.equal(s.file_count,7);
  assert.match(s.manifest_sha256,/^[a-f0-9]{64}$/);
  assert.equal(s.production_base_sha,'87c9cfbe0117ab5c102ba21e7a30fa83e9761d0d');
  assert.equal(s.source_commit,'b9b03e6036703a3cb12fd83d895efa53b9b4faf4');
});
test('rejects production identity, branch or source SHA drift', () => {
  for (const patch of [
    m=>m.production.project='honartik_front_prod',
    m=>m.production.root='/home/other',
    m=>m.production.expected_branch='feature',
    m=>m.production.expected_head='e'.repeat(40),
    m=>m.source.commit='a'.repeat(40)
  ]){const x=clone(scope.manifest);patch(x);assert.throws(()=>scope.validateManifest(x));}
});
test('rejects unrelated file, duplicate and object drift', () => {
  for (const patch of [
    m=>m.files[0].path='src/app/seat-selection/[id]/page.tsx',
    m=>m.files[1].path=m.files[0].path,
    m=>m.files=m.files.slice(1),
    m=>m.files[2].baseline_blob='f'.repeat(40),
    m=>m.files[3].source_blob='e'.repeat(40),
    m=>m.files[1].baseline_blob='1'.repeat(40),
    m=>m.files[1].change_kind='modify',
    m=>m.files[0].requires_semantic_rebase=false
  ]){const x=clone(scope.manifest);patch(x);assert.throws(()=>scope.validateManifest(x));}
});
test('rejects weakening signed approval, rollback and live QA gates', () => {
  for (const patch of [
    m=>m.release_policy.signed_single_use_level4_required=false,
    m=>m.release_policy.max_age_seconds=600,
    m=>m.release_policy.release_authorized=true,
    m=>m.release_policy.allow_full_feature_merge=true,
    m=>m.release_policy.allow_direct_source_copy=true,
    m=>m.release_policy.database_mutation=true,
    m=>m.release_policy.rollback_required=false,
    m=>m.checks.visual_widths=[1440],
    m=>m.checks.verify_goftino_hidden_on_home=false
  ]){const x=clone(scope.manifest);patch(x);assert.throws(()=>scope.validateManifest(x));}
});
test('candidate is not a host action and never claims production authorization', () => {
  const a=scope.deriveCandidate();
  assert.equal(a.root_install_registered,false);
  assert.equal(a.approval_issued,false);
  assert.equal(a.production_release_authorized,false);
  assert.equal(a.production_mutation,false);
  assert.throws(()=>scope.apply(),/m03_root_action_not_installed/);
  const source=fs.readFileSync(path.join(__dirname,'moeinshow-m03-release-scope-v1.js'),'utf8');
  for(const blocked of ['child_process','systemctl','systemd-run','writeFileSync','chmodSync','execSync','spawnSync','git checkout','git merge','bash -lc','process.env.']) {
    assert.equal(source.includes(blocked),false,blocked);
  }
});
