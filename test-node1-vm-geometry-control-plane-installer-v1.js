'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const m=require('./node1-vm-geometry-control-plane-installer-v1');
const pre=require('./node1-vm-geometry-deploy-preflight-v1');
const bundle=require('./node1-vm-geometry-attested-bundle-v1');
const ref=require('./node1-vm-geometry-registration-plan-v1');
const SHA='4a516a879aa1dc98e6ed190c36dc18f47893c9ca';
function intent(){return {action:m.ACTION,operation:m.OPERATION,repo:'prhmonline/prhm-host-actions',
 commitSha:SHA,level:4,target:'agent3-primary/node1-readonly',
 requestId:'01234567-89ab-4cde-8f01-23456789abcd'};}
function fixture(options={}){
 const calls=[],sources={};let snapshot;
 const p={
  calls,
  async verifyTrustedAuthorization(x){calls.push('authorize');return options.auth||{
    trusted:true,oneTime:true,requestId:x.requestId,commitSha:x.commitSha,action:m.ACTION,level:4}},
  async verifyCurrentOwners(){calls.push('owners');return Object.fromEntries(pre.OWNERS.map(x=>[x.key,{
    path:x.path,sha256:options.drift?'0'.repeat(64):x.sha256,isFile:true,isSymlink:false,
    writableByGroup:false,writableByOther:false,size:2048}]))},
  async verifySourceArtifacts(_files,sha){calls.push('source');return {
    exactBlobMatch:!options.badSource,sourceRevision:bundle.SOURCE_REVISION,commitSha:sha}},
  async verifyFixedTransport(x){calls.push('transport');return {
    approved:!options.noTransport,fixedOnly:true,host:x.host,operation:x.operation,
    readOnly:true,signedReceipts:true,pinnedTrustRoot:true,persistentAntiReplay:true}},
  async begin(x){calls.push('begin');sources.request=x},
  async audit(entry){calls.push('audit:'+entry.event);if(options.badAudit&&entry.event==='verified')throw Error('journal_fail')},
  async snapshot(s){calls.push('snapshot');snapshot={verified:!options.badSnapshot,services:s,rollbackAvailable:true};return snapshot},
  async stage(x){calls.push('stage');sources.stage=x;if(options.badStage)throw Error('stage_failure')},
  async bind(x){calls.push('bind');sources.bind=x;if(options.badBind)throw Error('bind_failure')},
  async reload(x){calls.push('reload');sources.reload=x;if(options.badReload)throw Error('service_failure')},
  async health(x){calls.push('health');return {api:true,mcp:true,fixedToolVisible:true,exactSchema:!options.badHealth,probeMutation:false}},
  async commit(x){calls.push('commit');sources.commit=x},
  async restore(x){calls.push('restore');if(options.rollbackThrows)throw Error('rollback_failure')},
  async verifyRollback(){calls.push('verifyRollback');return {restored:!options.badRecovery,servicesHealthy:!options.badRecovery}}
 };
 return {p,calls,sources};
}
test('static candidate remains unregistered and cannot run as CLI',()=>{
 const x=m.staticPlan();
 assert.equal(x.level,4);assert.equal(x.installed,false);assert.equal(x.request_created,false);
 assert.equal(x.ready_for_production,false);
 assert.equal(x.services.length,2);
 assert.equal(x.registrations.length,2);
 assert.equal(x.requires_verified_transport,true);
});
test('exact typed scope blocks arbitrary host, level, operation and file selection',()=>{
 const invalid=[
  {level:3},{target:'other-host'},{action:'destroy_vm'},
  {operation:'host_action.execute_command'},{commitSha:'latest'},
  {repo:'attacker/repo'},{other:'extra'}
 ];
 for(const change of invalid)assert.throws(()=>m.validateReleaseIntent({...intent(),...change}));
 assert.equal(m.validateReleaseIntent(intent()).level,4);
});
test('no independently trusted Level4 proof means no staging or rollback',async()=>{
 const x=fixture({auth:{trusted:false}});await assert.rejects(()=>m.activate({intent:intent(),ports:x.p}),/trusted_level4_authorization_missing/);
 assert.deepEqual(x.calls,['authorize']);
});
test('current Agent3 owner SHA mismatch prevents all mutations',async()=>{
 const x=fixture({drift:true});
 await assert.rejects(()=>m.activate({intent:intent(),ports:x.p}),/installed_owner_sha_drift/);
 assert.deepEqual(x.calls,['authorize','owners']);
});
test('source blob failure blocks staging',async()=>{
 const x=fixture({badSource:true});
 await assert.rejects(()=>m.activate({intent:intent(),ports:x.p}),/source_commit_or_blob_mismatch/);
 assert(!x.calls.includes('begin'));
});
test('missing signed fixed transport blocks BEFORE any write',async()=>{
 const x=fixture({noTransport:true});
 await assert.rejects(()=>m.activate({intent:intent(),ports:x.p}),/trusted_fixed_node1_transport_missing/);
 assert.deepEqual(x.calls,['authorize','owners','source','transport']);
});
test('healthy approved scenario calls exactly two registration targets and health gates',async()=>{
 const x=fixture();
 const result=await m.activate({intent:intent(),ports:x.p});
 assert.deepEqual(x.calls,['authorize','owners','source','transport','begin','audit:begin','snapshot','stage',
   'bind','reload','health','audit:verified','commit']);
 assert.equal(result.ok,true);
 assert.equal(result.activated,true);
 assert.equal(result.rollbackPerformed,false);
 assert.equal(result.probesPerformed,false);
 assert.equal(result.sourceSha,SHA);
 assert.deepEqual(x.sources.bind,m.FIXED_REGISTRATIONS);
 assert.equal(x.sources.stage.files,bundle.FILES);
 assert.equal(x.sources.request.commitSha,SHA);
});
test('failed registration performs rollback and verifies both services',async()=>{
 const x=fixture({badBind:true});
 await assert.rejects(()=>m.activate({intent:intent(),ports:x.p}),/activation_failed_rolled_back:bind_failure/);
 assert(x.calls.includes('restore'));assert(x.calls.includes('verifyRollback'));
 assert(x.calls.includes('audit:failed'));assert(!x.calls.includes('commit'));
});
test('failed health check triggers rollback, does not commit and preserves code history',async()=>{
 const x=fixture({badHealth:true});
 await assert.rejects(()=>m.activate({intent:intent(),ports:x.p}),/activation_failed_rolled_back:post_activation_health_failed/);
 assert.equal(x.calls.at(-1),'audit:failed');
 assert(!x.calls.includes('commit'));
 assert.equal(m.staticPlan().source_commits_must_not_be_reverted_on_failure,true);
});
test('journal failure after service reload does not silently succeed',async()=>{
 const x=fixture({badAudit:true});
 await assert.rejects(()=>m.activate({intent:intent(),ports:x.p}),/activation_failed_rolled_back:journal_fail/);
 assert(x.calls.includes('restore'));
 assert(!x.calls.includes('commit'));
});
test('rollback failure takes precedence and leaves outcome explicitly unknown',async()=>{
 for(const opts of [{rollbackThrows:true},{badRecovery:true}]){
  const x=fixture({...opts,badStage:true});
  await assert.rejects(()=>m.activate({intent:intent(),ports:x.p}),/activation_failed_rollback_unverified/);
  assert(x.calls.includes('audit:failed'));
 }
});
test('invalid snapshot cannot be misclassified as verified activation',async()=>{
 const x=fixture({badSnapshot:true});
 await assert.rejects(()=>m.activate({intent:intent(),ports:x.p}),/activation_failed_rolled_back:baseline_snapshot_unverified/);
 assert(x.calls.includes('restore'));assert(!x.calls.includes('commit'));
});
test('no arbitrary shell operations are present in candidate activation engine',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const s=fs.readFileSync(path.join(__dirname,'node1-vm-geometry-control-plane-installer-v1.js'),'utf8');
 assert.doesNotMatch(s,/\bspawnSync\b|\bexecSync\b|\bssh\b|shell\s*:\s*true|systemctl.*restart|fs\.writeFileSync/);
});
