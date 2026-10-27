'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const mod=require('./pbcinema-agent-registry-readonly-v1.cjs');

function baseResponse() {
  return {ok:true,projects:{
    cfpark_front_prod:{name:'cfpark_front_prod',root:'/home/cfpark/domains/cfpark.ir/public_html'},
    cfpark_admin_prod:{name:'cfpark_admin_prod',root:'/home/cfpark/domains/dashboard.cfpark.ir/public_html'}
  }};
}
function evidence() {
  const permissions=Object.fromEntries(Object.keys(mod.PROJECTS).map(id=>[id,
    Object.fromEntries(mod.WRITE_CAPABILITIES.map(cap=>[cap,false]))]));
  const roots=Object.fromEntries(Object.entries(mod.PROJECTS).map(([id,rec])=>
    [id,{exists:true,isDirectory:true,isSymlink:false,realpath:rec.root}]));
  const vhosts=Object.fromEntries(Object.entries(mod.PROJECTS).map(([id,rec])=>
    [id,{domain:rec.domain,resolvedRoot:rec.root}]));
  return {permissions,roots,vhosts,writeAllowlistAudit:'DENY_ALL_PBCINEMA'};
}
function plan(response=baseResponse(),attestation=evidence(),sha=mod.sha256(
  Buffer.from(JSON.stringify(response)))) {
  return mod.prepareCandidate({response,expectedResponseSha256:sha,evidence:attestation});
}
test('only projected list changes; original executable registry remains untouched',()=>{
  const original=baseResponse(),before=JSON.stringify(original);
  const r=plan(original);
  assert.equal(JSON.stringify(original),before);
  assert.equal(Object.keys(original.projects).length,2);
  assert.equal(Object.keys(r.projectedResponse.projects).length,4);
  assert.deepEqual(r.projectIds.sort(),['pbcinema_admin_prod','pbcinema_front_prod']);
  assert.equal(r.state,'source_only_not_installed');
  assert.equal(r.writesEnabled,false);
  assert.equal(r.requiresConsumedSignedL4,true);
  assert.equal(r.requiresExistingAtomicInstaller,true);
  for(const id of r.projectIds) {
    assert.equal(r.projectedResponse.projects[id].metadataOnly,true);
    assert.equal(r.projectedResponse.projects[id].discoveryOnly,true);
    assert.equal(r.projectedResponse.projects[id].writeEnabled,false);
    assert.equal(r.projectedResponse.projects[id].deploymentEnabled,false);
  }
});
test('response preimage SHA mismatch fails closed',()=>{
  assert.throws(()=>plan(baseResponse(),evidence(),'a'.repeat(64)),/response_sha_drift/);
  assert.throws(()=>plan(baseResponse(),evidence(),''),/response_sha_drift/);
});
test('live paths and vhosts must match both historical target roots',()=>{
  for(const id of Object.keys(mod.PROJECTS)) {
    const a=evidence();
    a.roots[id].isSymlink=true;
    assert.throws(()=>plan(baseResponse(),a),/live_root_or_vhost_mismatch/);
    const b=evidence();
    b.vhosts[id].resolvedRoot='/tmp/other';
    assert.throws(()=>plan(baseResponse(),b),/live_root_or_vhost_mismatch/);
  }
});
test('all write authorizations must be independently denied',()=>{
  for(const id of Object.keys(mod.PROJECTS)) for(const k of mod.WRITE_CAPABILITIES) {
    const e=evidence();
    e.permissions[id][k]=true;
    assert.throws(()=>plan(baseResponse(),e),/write_denial_unverified/);
  }
  const e=evidence();
  e.writeAllowlistAudit='NOT_VERIFIED';
  assert.throws(()=>plan(baseResponse(),e),/preflight_missing/);
});
test('duplicate aliases and malformed original response rejected',()=>{
  const r=baseResponse();
  r.projects.pbcinema_front_prod={name:'pbcinema_front_prod'};
  assert.throws(()=>plan(r),/executable_or_duplicate_alias/);
  assert.throws(()=>plan({ok:false,projects:{}}),/response_contract_invalid/);
});
test('no executable registry patch or installation function exposed',()=>{
  assert.deepEqual(Object.keys(mod).sort(),[
    'ACTION','PROJECTS','WRITE_CAPABILITIES','sha256',
    'verifyEvidence','projectResponseOverlay','prepareCandidate'
  ].sort());
  assert.equal(Object.isFrozen(mod),true);
  assert.equal(Object.isFrozen(mod.PROJECTS),true);
  assert.equal('install' in mod,false);
  assert.equal('patchRegistry' in mod,false);
});
