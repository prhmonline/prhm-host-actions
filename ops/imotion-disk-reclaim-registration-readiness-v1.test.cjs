'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const G=require('./imotion-disk-reclaim-registration-readiness-v1.cjs');
const GOOD_SHA='a'.repeat(64),SOURCE='1'.repeat(40),MANIFEST='2'.repeat(40);
function valid(){
 return {
  schema:G.SCHEMA,project:G.PROJECT,action:G.ACTION,
  trusted_source:'root_owned_readonly_agent3',
  registrar:{action:G.REGISTRAR,installed:true,live_discoverable:true,
   typed_five_field_route:true,root_launcher_attested:true},
  release:{source_commit:SOURCE,manifest_commit:MANIFEST,manifest_sha256:GOOD_SHA,
   git_attested:true,asset_bytes_verified:true},
  owners:G.OWNERS.map(path=>({path,sha256:GOOD_SHA,
   root_owned:true,mode_safe:true,matches_reviewed_preimage:true})),
  services:G.SERVICES.map(name=>({name,healthy:true})),
  rollback:{restored_bytes_verified:true,root_lock_safe:true,crash_recovery_tested:true},
  approval:{ed25519_verified:true,one_time_ledger:true,ttl_seconds:180,
   arguments_sha256_bound:true,policy_scope_registered:true},
  discovery:{blue_authenticated:true,green_authenticated:true,action_visible:true},
  inventory:{complete:true,bounded:true,sha256:GOOD_SHA,read_only:true}
 };
}
function denied(mutate,expected){
 const data=valid();mutate(data);
 const out=G.check(data);
 assert.equal(out.status,'NO_GO');
 assert(out.blockers.includes(expected),JSON.stringify(out.blockers));
 assert.equal(out.registration_authorized,false);
 assert.equal(out.activation_authorized,false);
 assert.equal(out.production_mutation,false);
}
test('even complete SHAPE evidence never grants registration authority',()=>{
 const out=G.check(valid());
 assert.equal(out.status,'ATTESTATIONS_COMPLETE');
 assert.equal(out.registration_authorized,false);
 assert.equal(out.activation_authorized,false);
 assert.equal(out.read_only,true);
 assert.match(out.evidence_sha256,/^[a-f0-9]{64}$/);
});
test('installed registrar, signed scope and dual-worker discovery are mandatory',()=>{
 denied(x=>x.registrar.installed=false,'SHARED_REGISTRAR_NOT_INSTALLED');
 denied(x=>x.registrar.typed_five_field_route=false,'SHARED_REGISTRAR_NOT_INSTALLED');
 denied(x=>x.registrar.root_launcher_attested=false,'SHARED_REGISTRAR_NOT_INSTALLED');
 denied(x=>x.approval.ed25519_verified=false,'TYPED_APPROVAL_UNVERIFIED');
 denied(x=>x.approval.one_time_ledger=false,'TYPED_APPROVAL_UNVERIFIED');
 denied(x=>x.approval.ttl_seconds=999,'TYPED_APPROVAL_UNVERIFIED');
 denied(x=>x.discovery.green_authenticated=false,'DUAL_MCP_DISCOVERY_UNVERIFIED');
 denied(x=>x.discovery.action_visible=false,'DUAL_MCP_DISCOVERY_UNVERIFIED');
});
test('all four owner SHAs, exact rollback checks and service identities must match',()=>{
 denied(x=>x.owners.pop(),'FOUR_OWNER_SHA_OR_MODE_DRIFT');
 denied(x=>x.owners[2].mode_safe=false,'FOUR_OWNER_SHA_OR_MODE_DRIFT');
 denied(x=>x.owners[2].path='/tmp/fake','FOUR_OWNER_SHA_OR_MODE_DRIFT');
 denied(x=>x.services[1].healthy=false,'CONTROL_PLANE_HEALTH_UNPROVEN');
 denied(x=>x.rollback.crash_recovery_tested=false,'ROLLBACK_NOT_VERIFIED');
});
test('release must attest a two-commit SHA-bound immutable closure',()=>{
 denied(x=>x.release.manifest_commit=SOURCE,'PINNED_RELEASE_UNVERIFIED');
 denied(x=>x.release.git_attested=false,'PINNED_RELEASE_UNVERIFIED');
 denied(x=>x.release.asset_bytes_verified=false,'PINNED_RELEASE_UNVERIFIED');
 denied(x=>x.release.manifest_sha256='not-a-digest','PINNED_RELEASE_UNVERIFIED');
});
test('complete bounded read-only inventory is mandatory',()=>{
 denied(x=>x.inventory.complete=false,'BOUNDED_INVENTORY_UNVERIFIED');
 denied(x=>x.inventory.bounded=false,'BOUNDED_INVENTORY_UNVERIFIED');
 denied(x=>x.inventory.read_only=false,'BOUNDED_INVENTORY_UNVERIFIED');
});
test('untrusted caller, alternate action and added shell token always fail closed',()=>{
 denied(x=>x.trusted_source='UI','TRUSTED_SOURCE_UNPROVEN');
 denied(x=>x.project='honartik_admin_prod','ACTION_SCOPE_INVALID');
 denied(x=>x.action='harden_agent_api_v1','ACTION_SCOPE_INVALID');
 denied(x=>x.command='rm -rf /','EVIDENCE_SCHEMA_INVALID');
 assert.equal(G.check(null).status,'NO_GO');
});
