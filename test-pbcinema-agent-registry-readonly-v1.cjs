'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const mod=require('./pbcinema-agent-registry-readonly-v1.cjs');

function baseResponse(){
  return {ok:true,projects:{
    cfpark_front_prod:{name:'cfpark_front_prod',root:'/home/cfpark/domains/cfpark.ir/public_html'},
    cfpark_admin_prod:{name:'cfpark_admin_prod',root:'/home/cfpark/domains/dashboard.cfpark.ir/public_html'}
  }};
}
function evidence(){
  const permissions=Object.fromEntries(Object.keys(mod.PROJECTS).map(id=>[
    id,Object.fromEntries(mod.WRITE_CAPABILITIES.map(cap=>[cap,false]))
  ]));
  const roots=Object.fromEntries(Object.entries(mod.PROJECTS).map(([id,rec])=>[
    id,{exists:true,isDirectory:true,isSymlink:false,realpath:rec.root}
  ]));
  const vhosts={
    pbcinema_front_prod:{domain:'pbcinema.ir',kind:'reverse_proxy',
      proxyTarget:'http://127.0.0.1:8081/'},
    pbcinema_admin_prod:{domain:'dashboard.pbcinema.ir',kind:'document_root',
      documentRoot:mod.PROJECTS.pbcinema_admin_prod.route.documentRoot}
  };
  roots.pbcinema_admin_prod_web={
    exists:true,isDirectory:true,isSymlink:false,
    realpath:mod.PROJECTS.pbcinema_admin_prod.route.documentRoot
  };
  const runtime={
    pbcinema_front_prod:{
      listenAddress:'127.0.0.1:8081',
      processCwd:mod.PROJECTS.pbcinema_front_prod.root,
      processCwdVerified:true
    }
  };
  return {permissions,roots,vhosts,runtime,writeAllowlistAudit:'DENY_ALL_PBCINEMA'};
}
function plan(response=baseResponse(),attestation=evidence(),
  sha=mod.sha256(Buffer.from(JSON.stringify(response)))){
  return mod.prepareCandidate({response,expectedResponseSha256:sha,evidence:attestation});
}
test('discovery-only overlay leaves executable registry unchanged',()=>{
  const original=baseResponse(),before=JSON.stringify(original),r=plan(original);
  assert.equal(JSON.stringify(original),before);
  assert.equal(Object.keys(original.projects).length,2);
  assert.equal(Object.keys(r.projectedResponse.projects).length,4);
  assert.deepEqual(r.projectIds.sort(),['pbcinema_admin_prod','pbcinema_front_prod']);
  assert.equal(r.state,'source_only_not_installed');
  assert.equal(r.writesEnabled,false);
  assert.equal(r.requiresConsumedSignedL4,true);
  assert.equal(r.requiresExistingAtomicInstaller,true);
  for(const id of r.projectIds){
    assert.equal(r.projectedResponse.projects[id].metadataOnly,true);
    assert.equal(r.projectedResponse.projects[id].discoveryOnly,true);
    assert.equal(r.projectedResponse.projects[id].writeEnabled,false);
    assert.equal(r.projectedResponse.projects[id].deploymentEnabled,false);
  }
});
test('wrong or absent exact source response SHA fails closed',()=>{
  assert.throws(()=>plan(baseResponse(),evidence(),'a'.repeat(64)),/response_sha_drift/);
  assert.throws(()=>plan(baseResponse(),evidence(),''),/response_sha_drift/);
});
test('frontend reverse proxy cannot be misrepresented as a DocumentRoot',()=>{
  const e=evidence();
  e.vhosts.pbcinema_front_prod={domain:'pbcinema.ir',kind:'document_root',
    documentRoot:mod.PROJECTS.pbcinema_front_prod.root};
  assert.throws(()=>plan(baseResponse(),e),/vhost_route_unverified/);
});
test('frontend proxy target must be exact and application root proven from runtime',()=>{
  for(const mutated of [
    e=>{e.vhosts.pbcinema_front_prod.proxyTarget='http://127.0.0.1:8082/';},
    e=>{e.runtime.pbcinema_front_prod.processCwd='/var/www/unverified';},
    e=>{e.runtime.pbcinema_front_prod.processCwdVerified=false;},
    e=>{delete e.runtime.pbcinema_front_prod;},
    e=>{e.roots.pbcinema_front_prod.isSymlink=true;}
  ]){
    const e=evidence();mutated(e);
    assert.throws(()=>plan(baseResponse(),e),/proxy_or_runtime_root_unverified|application_root_unverified/);
  }
});
test('admin DocumentRoot differs from application root and must be verified separately',()=>{
  assert.notEqual(mod.PROJECTS.pbcinema_admin_prod.root,
    mod.PROJECTS.pbcinema_admin_prod.route.documentRoot);
  for(const mutate of [
    e=>{e.vhosts.pbcinema_admin_prod.documentRoot=e.roots.pbcinema_admin_prod.realpath;},
    e=>{e.roots.pbcinema_admin_prod_web.realpath='/tmp/different';},
    e=>{e.roots.pbcinema_admin_prod_web.isSymlink=true;}
  ]){
    const e=evidence();mutate(e);
    assert.throws(()=>plan(baseResponse(),e),/admin_document_root_unverified/);
  }
});
test('any write authorization fails for either identity',()=>{
  for(const id of Object.keys(mod.PROJECTS))
    for(const cap of mod.WRITE_CAPABILITIES){
      const e=evidence();e.permissions[id][cap]=true;
      assert.throws(()=>plan(baseResponse(),e),/write_denial_unverified/);
    }
  const e=evidence();e.writeAllowlistAudit='UNKNOWN';
  assert.throws(()=>plan(baseResponse(),e),/preflight_missing/);
});
test('duplicates, malformed responses and missing preflight are rejected',()=>{
  const r=baseResponse();r.projects.pbcinema_front_prod={name:'pbcinema_front_prod'};
  assert.throws(()=>plan(r),/executable_or_duplicate_alias/);
  assert.throws(()=>plan({ok:false,projects:{}}),/response_contract_invalid/);
  assert.throws(()=>plan(baseResponse(),{}),/preflight_missing/);
});
test('no file-writing, registry mutation, or installer export exists',()=>{
  assert.deepEqual(Object.keys(mod).sort(),[
    'ACTION','PROJECTS','WRITE_CAPABILITIES','sha256',
    'verifyEvidence','projectResponseOverlay','prepareCandidate'
  ].sort());
  assert.equal(Object.isFrozen(mod),true);
  assert.equal(Object.isFrozen(mod.PROJECTS),true);
  assert.equal('install' in mod,false);
  assert.equal('patchRegistry' in mod,false);
});
