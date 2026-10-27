'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const P=require('./honartik-universal-installer-registration-review-pack-v1.cjs');
const G=require('./honartik-universal-installer-native-approval-gate-v1.cjs');
function live(){
 return {schema_version:'prhm.approval-policy.v1',
  version:'2026-10-02.1-control-plane-current-owner-bootstrap-repair-v1',
  default_deny:true,one_time_use:true,issuer:'prhm-company-approval',
  levels:{'4':{human_approval:true,second_confirmation_required:true,
    max_ttl_seconds:180}},
  operations:{'host_action.old':{level:3,one_time_use:true}},
  typed_scopes:[{tool:'host_action_v2_apply',action:'old',operation:'host_action.old',
    principals:[{principal_id:'mohammad',roles:['mcp-operator']}]}],
  // Git main contains a different deployment_integrity field. Here
  // review builder must NOT insert it or modify active unrelated scopes.
  scope_freeze:true,clock_skew_seconds:0};
}
test('all four owner paths are exactly user-observed live SHA pins',()=>{
 assert.deepEqual(Object.keys(P.TARGETS),['base','executor','mcp','policy']);
 assert.equal(P.TARGETS.base.sha256,
  '4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406');
 assert.equal(P.TARGETS.executor.sha256,
  '410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0');
 assert.equal(P.TARGETS.mcp.sha256,
  'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166');
 assert.equal(P.TARGETS.policy.sha256,
  '148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174');
});
test('git preimage closure matches byte-exact source modules on pinned base SHA',()=>{
 const read=(name,sha)=>{
  assert.equal(sha,P.SOURCE_SHA);
  return fs.readFileSync(path.join(__dirname,name));
 };
 const meta=P.verifyArtifactClosure(read);
 assert.equal(Object.keys(meta).length,Object.keys(P.ARTIFACTS).length);
 for(const [name,value] of Object.entries(meta)){
  assert.equal(value.git_blob,P.ARTIFACTS[name]);
  assert.equal(value.from_commit,P.SOURCE_SHA);
 }
});
test('wrong Git source blob is refused prior to producing registration metadata',()=>{
 assert.throws(()=>P.verifyArtifactClosure((name,sha)=>
  name==='honartik-universal-installer-l4-v1.cjs'?
   Buffer.from('mutated source'):fs.readFileSync(path.join(__dirname,name))),
 /source_git_blob_drift/);
});
test('unreadable root artifact refused; no empty or generated payload admitted',()=>{
 assert.throws(()=>P.verifyArtifactClosure(()=>Buffer.alloc(0)),/source_bytes_invalid/);
});
test('owner preimage bytes must match exact 4 source fingerprints',()=>{
 assert.throws(()=>P.verifyOwnerPreimages(()=>Buffer.from('unreviewed')),
  /live_owner_preimage_drift:base/);
 assert.throws(()=>P.verifyOwnerPreimages(()=>null),
  /owner_bytes_unavailable:base/);
});
test('review policy overlay adds one L4 op/scope and no other semantic changes',()=>{
 const old=live(),frozen=JSON.stringify(old);
 const fresh=P.overlayPolicyObject(old);
 assert.equal(JSON.stringify(old),frozen);
 assert.deepEqual(Object.keys(fresh.operations),['host_action.old',P.OP]);
 assert.equal(fresh.typed_scopes.length,2);
 assert.deepEqual(fresh.typed_scopes[0],old.typed_scopes[0]);
 assert.equal(fresh.typed_scopes[1].action,P.ACTION);
 assert.equal(fresh.typed_scopes[1].principals[0].principal_id,'mohammad');
 assert.equal(fresh.operations[P.OP].level,4);
 assert.equal(fresh.operations[P.OP].one_time_use,true);
 assert.equal(fresh.operations[P.OP].expires_seconds,180);
 assert.equal(fresh.version,P.VERSION);
 assert.equal(Object.hasOwn(fresh,'deployment_integrity'),false);
 assert.equal(fresh.scope_freeze,true);
});
test('policy overlay deterministic, rejects duplicate action',()=>{
 const a=P.overlayPolicyObject(live());
 const b=P.overlayPolicyObject(live());
 assert.equal(JSON.stringify(a),JSON.stringify(b));
 assert.throws(()=>P.overlayPolicyObject(a),/live_policy_version_drift/);
});
test('policy overlay refuses changed live policy version or weakened Level4',()=>{
 const a=live();a.version='wrong';
 assert.throws(()=>P.overlayPolicyObject(a),/live_policy_version_drift/);
 const b=live();b.levels['4'].second_confirmation_required=false;
 assert.throws(()=>P.overlayPolicyObject(b),/live_l4_requirements_drift/);
 const c=live();c.default_deny=false;
 assert.throws(()=>P.overlayPolicyObject(c),/live_policy_structure_invalid/);
 const d=live();d.typed_scopes[0].action=P.ACTION;
 assert.throws(()=>P.overlayPolicyObject(d),/action_already_present/);
});
test('production policy source can NOT be faked with Git-main candidate',()=>{
 const synthetic=Buffer.from(JSON.stringify(live(),null,2)+'\n');
 assert.throws(()=>P.proposeLivePolicyReview(synthetic),
  /policy_preimage_sha_drift/);
 assert.notEqual(G.PINNED_POLICY_SHA,P.TARGETS.policy.sha256);
});
test('no module CLI, signed token issuer, installation or Production mutator',()=>{
 for(const method of ['apply','install','register','write','issueApproval',
  'consumeApproval','deploy','merge'])assert.equal(P[method],undefined);
 assert.equal(P.SOURCE_SHA.length,40);
 assert.equal(Object.isFrozen(P.TARGETS),true);
});

test('machine-readable package manifest matches reviewed source and live four-SHA pins',()=>{
 const pkg=JSON.parse(fs.readFileSync(path.join(__dirname,
  'manifests/honartik-universal-installer-native-registration-review-v1.json')));
 assert.equal(pkg.action,P.ACTION);
 assert.equal(pkg.pinned_source_commit,P.SOURCE_SHA);
 assert.deepEqual(pkg.owner_live_preimages,P.TARGETS);
 assert.deepEqual(pkg.root_artifacts_git_blobs,P.ARTIFACTS);
 assert.equal(pkg.candidate_policy_sha256,null);
 assert.equal(pkg.root_of_trust_registration_verified,false);
 assert.equal(pkg.signed_level4_consumed,false);
 assert.equal(pkg.installer_upgrade_executed,false);
 assert.equal(pkg.honartik_backend_deployed,false);
});
