'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const G=require('./prhm-action-registry-v2-mcp-discovery-v1.cjs');
const {SERVICES,TARGET,createCallbacks}=G;
function env(kind='absent'){
 const calls=[];
 const probeWorker=async service=>{
  calls.push(service);
  const tools=kind==='both_present'?[TARGET,'selfmaint_health']:
   kind==='split'&&service===SERVICES[0]?[TARGET]:['selfmaint_health'];
  if(kind==='unreachable'&&service===SERVICES[1])throw Error('live_mcp_timeout');
  return {service,ok:true,tools,observed_at_ms:Date.now()};
 };
 return {calls,probeWorker};
}
test('both live blue and green absent permit negative discovery for durable rollback',async()=>{
 const f=env(),g=createCallbacks(f);
 assert.equal(await g.verifyTargetAbsent(TARGET),true);
 assert.equal(await g.getToolDiscovery(TARGET),false);
 assert.deepEqual(f.calls,[...SERVICES,...SERVICES]);
});
test('both workers present permit installer postcondition, never negative rollback',async()=>{
 const f=env('both_present'),g=createCallbacks(f);
 assert.equal(await g.getToolDiscovery(TARGET),true);
 assert.equal(await g.verifyTargetAbsent(TARGET),false);
 assert.deepEqual(f.calls,[...SERVICES,...SERVICES]);
});
test('split-blue/green registry cannot falsely signal either success or rollback',async()=>{
 const f=env('split'),g=createCallbacks(f);
 await assert.rejects(g.getToolDiscovery(TARGET),/blue_green_registry_inconsistent/);
 await assert.rejects(g.verifyTargetAbsent(TARGET),/blue_green_registry_inconsistent/);
});
test('unreachable second worker is fail-closed even if first says absent',async()=>{
 const f=env('unreachable'),g=createCallbacks(f);
 await assert.rejects(g.verifyTargetAbsent(TARGET),/live_mcp_timeout/);
 assert.equal(f.calls.length,2);
});
test('stale or future-dated worker result is not acceptable',async()=>{
 for(const age of [-10000,10000]){
  const c=createCallbacks({probeWorker:async service=>({
   service,ok:true,tools:[],observed_at_ms:Date.now()+age
  })});
  await assert.rejects(c.verifyTargetAbsent(TARGET),/unhealthy_or_stale_worker/);
 }
});
test('invalid tool list, identity, duplicated names, untrusted results rejected',async()=>{
 const invalid=[
  service=>({service,ok:true,observed_at_ms:Date.now(),tools:[TARGET,TARGET]}),
  service=>({service,ok:true,observed_at_ms:Date.now(),tools:['../../secret']}),
  service=>({service:'other.service',ok:true,observed_at_ms:Date.now(),tools:[]}),
  service=>({service,ok:false,observed_at_ms:Date.now(),tools:[]}),
  service=>({service,ok:true,observed_at_ms:Date.now(),tools:[],extra:'injected'})
 ];
 for(const probeWorker of invalid){
  const c=createCallbacks({probeWorker});
  await assert.rejects(c.getToolDiscovery(TARGET),/registry_v2_discovery_/);
 }
});
test('unknown actions, absent root transport and unsafe capability names prohibited',async()=>{
 assert.throws(()=>createCallbacks({}),/trusted_live_probe_missing/);
 const c=createCallbacks({probeWorker:async service=>({
  service,ok:true,tools:[],observed_at_ms:Date.now()
 })});
 await assert.rejects(c.getToolDiscovery('other_action'),/target_not_allowlisted/);
 for(const key of ['exec','shell','register','approve','readSecret','write','reset'])
  assert.equal(Object.hasOwn(c,key),false);
 assert.deepEqual(Object.keys(c).sort(),['getToolDiscovery','verifyTargetAbsent']);
});
