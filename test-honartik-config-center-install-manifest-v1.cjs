'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),crypto=require('node:crypto');
const manifest=require('./honartik-config-center-install-manifest-v1.json');
const reg=require('./honartik-config-center-registration-candidate-v1.cjs');
const {CONTRACT}=require('./honartik-config-center-enrollment-action-v1.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
test('every installer source byte pinned and target path is fixed',()=>{
 assert.equal(manifest.mode,'git_first_reviewed_install_manifest');
 assert.equal(manifest.installation_status,'NOT_INSTALLED');
 assert.equal(manifest.assets.length,5);
 const targets=new Set();
 for(const entry of manifest.assets){
  assert.equal(hash(fs.readFileSync(entry.source)),entry.sha256,entry.source);
  assert.equal(entry.target,'/opt/prhm-agent-selfmaint-exec/actions/'+entry.source.split('/').at(-1));
  assert.equal(targets.has(entry.target),false);
  targets.add(entry.target);
 }
});
test('manifest references exact reviewed tenant, release and L4 controls',()=>{
 assert.equal(manifest.action,CONTRACT.action);
 assert.equal(manifest.scope.tenant,'honartik');
 assert.equal(manifest.scope.revision,1);
 assert.deepEqual(manifest.scope.capabilities,['config:read']);
 assert.equal(manifest.scope.backend_sha,CONTRACT.backendSha);
 assert.equal(manifest.scope.config_center_release,CONTRACT.configCenterRelease);
 assert.equal(manifest.approval.level,4);
 assert.equal(manifest.approval.requires_fresh_signed_one_time_confirmation,true);
 assert.equal(manifest.approval.replay_permitted,false);
});
test('all four runtime original owner preimages match approved registration candidate',()=>{
 for(const [k,v] of Object.entries(reg.LIVE)){
  assert.deepEqual(manifest.control_plane_preimages[k],v);
 }
 assert.equal(Object.keys(manifest.control_plane_preimages).length,4);
});
test('required remote postconditions exclude privilege escalation or service switch',()=>{
 const a=manifest.acceptance;
 assert.equal(a.unrelated_production_configs_modified,false);
 assert.equal(a.requires_signed_l4_registration,true);
 assert.equal(a.requires_atomic_preimage_backup,true);
 assert.equal(a.requires_atomic_restore_and_service_recovery,true);
 assert.equal(a.credential_file_mode,'0600');
 assert.equal(a.credential_owner,'honartik');
 assert.equal(a.remote_config_http,200);
 assert.equal(a.remote_secrets_http,403);
});
