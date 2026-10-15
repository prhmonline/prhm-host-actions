'use strict';
// Public CI proof of fail-closed PRE-AUTHORIZATION behavior only.
// No private issuer policy/dispatcher/approval token or production filesystem.
// This intentionally does NOT claim to validate a successful Level-4 cutover.
const test=require('node:test');
const assert=require('node:assert/strict');
const tx=require('./deploy-control-l4-privileged-transaction-v1.cjs');

function harness({trusted=true,discovered=false,throwDiscovery=false}={}){
 const calls=[];
 const host=Object.fromEntries(tx.CAPABILITIES.map(name=>[name,async (...args)=>{
   calls.push(name);
   if(name==='assertTrustedRootExecutor')return trusted;
   if(name==='getFixedToolDiscovery'){
     assert.equal(args[0],tx.ACTION);
     if(throwDiscovery)throw Error('registry_unreachable');
     return discovered;
   }
   throw Error('UNEXPECTED_POSTGATE_CAPABILITY:'+name);
 }]));
 return {host,calls};
}
const EARLY=['assertTrustedRootExecutor','getFixedToolDiscovery'];
test('missing independent registration refuses before release bytes, freeze, journal, one-time approval or writes',async()=>{
 const h=harness();
 await assert.rejects(tx.preflight(h.host,null),
   /fixed_l4_action_not_registered_before_approval/);
 assert.deepEqual(h.calls,EARLY);
 h.calls.length=0;
 await assert.rejects(tx.applyFixedCutover({host:h.host,assets:null}),
   /DENIED_OR_ROLLED_BACK/);
 assert.deepEqual(h.calls,EARLY);
 for(const prohibited of [
  'freezeAllDeployEntrypoints','createDurableRecoveryJournal',
  'consumeSignedExactLevel4Authorization','atomicWriteRootFile',
  'removeExactLegacySudoers','reloadApprovalCenter'
 ])assert.equal(h.calls.includes(prohibited),false,prohibited);
});
test('untrusted root is rejected without even querying discovery',async()=>{
 const h=harness({trusted:false,discovered:true});
 await assert.rejects(tx.preflight(h.host,null),/trusted_root_not_attested/);
 assert.deepEqual(h.calls,['assertTrustedRootExecutor']);
});
test('registry connection errors are not interpreted as authorization',async()=>{
 const h=harness({throwDiscovery:true});
 await assert.rejects(tx.applyFixedCutover({host:h.host,assets:null}),
   /DENIED_OR_ROLLED_BACK/);
 assert.deepEqual(h.calls,EARLY);
});
test('registered tool alone NEVER authorizes missing private release artifacts',async()=>{
 const h=harness({discovered:true});
 await assert.rejects(tx.preflight(h.host,null),/untrusted_asset_set/);
 assert.deepEqual(h.calls,EARLY);
});
test('missing trusted host capability fails closed before touching anything',async()=>{
 const h=harness();
 delete h.host.assertTrustedRootExecutor;
 await assert.rejects(tx.applyFixedCutover({host:h.host,assets:null}),
   /missing_trusted_executor_capabilities/);
 assert.deepEqual(h.calls,[]);
});
test('no caller-controlled arbitrary command or approval bypass is exported',()=>{
 assert.equal(typeof tx.exec,'undefined');
 assert.equal(typeof tx.shell,'undefined');
 assert.equal(typeof tx.install,'undefined');
 assert.equal(typeof tx.issueApproval,'undefined');
 assert.equal(tx.OPERATION,'host_action.deploy_control_cutover_install_v1');
});
