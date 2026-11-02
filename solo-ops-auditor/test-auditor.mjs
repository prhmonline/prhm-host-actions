import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableAuditQueue,makeBucketId,SCHEMA} from './queue.mjs';
import {makeAuditorAdapter,runOnce,AUDITOR_ROLE} from './auditor.mjs';

const fakeMetadata={selfmaint_health:{annotations:{readOnlyHint:true},inputSchema:{type:'object'}}};
function fakeAgent(){
 const called=[];
 const client={
  discover:async()=>({service_ok:true,
    capabilities:{selfmaint_health:{input_schema_fingerprint:'a'.repeat(64)}}}),
  invoke:async(name,args)=>{called.push({name,args});return {ok:true,service:'prhm-agent-selfmaint-exec'};}
 };
 class Agent{
  constructor({adapter}){this.adapter=adapter}
  async run(wo){
   const p=await this.adapter.plan(wo);
   const x=await this.adapter.execute(wo,p);
   const v=await this.adapter.verify(wo,x);
   const pass=v.results.every(r=>r.pass);
   return {...wo,status:pass?'succeeded':'failed',attempts:1,evidence:[x,v]};
  }
 }
 const workOrder=x=>x;
 const closureReport=x=>({final_status:x.status,evidence_count:x.evidence.length});
 return {called,client,Agent,workOrder,closureReport};
}
async function fixture(fn){
 const dir=await mkdtemp(join(tmpdir(),'solo-ops-qa-'));
 try{
   const ctx={file:join(dir,'queue.json'),stopFile:join(dir,'STOP')};
   return await fn(ctx);
 }finally{await rm(dir,{recursive:true,force:true})}
}
test('fixed role is low risk and has no mutation/schedules',()=>{
 assert.equal(AUDITOR_ROLE.capability,'selfmaint_health');
 assert.equal(AUDITOR_ROLE.risk_level,0);
 assert.deepEqual(AUDITOR_ROLE.allow_mutations,[]);
 assert.equal(makeBucketId(1800000000000),makeBucketId(1800000000001));
});
test('real file persistence and idempotency across fresh process objects',async()=>fixture(async ({file,stopFile})=>{
 const a=new DurableAuditQueue({file,stopFile,now:()=>1000});
 assert.deepEqual(await a.schedule('ops-health-1'),{enqueued:true});
 const b=new DurableAuditQueue({file,stopFile,now:()=>1001});
 assert.deepEqual(await b.schedule('ops-health-1'),{duplicate:true});
 assert.equal((await b.snapshot()).jobs.length,1);
 assert.equal((await b.claim()).attempts,1);
 await b.complete('ops-health-1',{status:'succeeded',summary:'verified'});
 const c=new DurableAuditQueue({file,stopFile,now:()=>1002});
 assert.equal((await c.snapshot()).jobs[0].status,'succeeded');
 assert.equal((await c.snapshot()).schema,SCHEMA);
 assert.equal((await c.claim()),null);
}));
test('crash lease is reclaimed after timeout, bounded to 2 attempts',async()=>fixture(async ({file,stopFile})=>{
 let now=100;
 const q=new DurableAuditQueue({file,stopFile,now:()=>now});
 await q.schedule('ops-health-5');
 assert.equal((await q.claim({leaseMs:20})).attempts,1);
 now=130;
 assert.equal((await new DurableAuditQueue({file,stopFile,now:()=>now}).claim({leaseMs:20})).attempts,2);
 now=160;
 assert.equal(await q.claim({leaseMs:20}),null);
 const end=(await q.snapshot()).jobs[0];
 assert.equal(end.status,'failed');
 assert.equal(end.error_code,'lease_expired_recovered');
}));
test('STOP sentinel prevents enqueue, claim and any remote invocation',async()=>fixture(async ({file,stopFile})=>{
 const q=new DurableAuditQueue({file,stopFile});
 await writeFile(stopFile,'');
 assert.deepEqual(await q.schedule('ops-health-1'),{stopped:true});
 assert.equal(await q.claim(),null);
 const f=fakeAgent();
 const result=await runOnce({queue:q,client:f.client,metadata:fakeMetadata,
   EngineeringAgent:f.Agent,createWorkOrder:f.workOrder,closureReport:f.closureReport});
 assert.equal(result.status,'stopped');assert.equal(f.called.length,0);
}));
test('end-to-end WorkOrder persists final evidence, exactly 2 read-only tools',async()=>fixture(async ({file,stopFile})=>{
 const q=new DurableAuditQueue({file,stopFile,now:()=>1800000000000});
 const f=fakeAgent();
 const r=await runOnce({queue:q,client:f.client,metadata:fakeMetadata,
  EngineeringAgent:f.Agent,createWorkOrder:f.workOrder,closureReport:f.closureReport,
  now:1800000000000});
 assert.equal(r.status,'succeeded');
 assert.equal(r.evidence_count,2);
 assert.equal(r.mutation_count,0);
 assert.deepEqual(f.called,[{name:'selfmaint_health',args:{}},{name:'selfmaint_health',args:{}}]);
 assert.equal((await q.snapshot()).jobs[0].status,'succeeded');
 const another=await runOnce({queue:q,client:f.client,metadata:fakeMetadata,
  EngineeringAgent:f.Agent,createWorkOrder:f.workOrder,closureReport:f.closureReport,
  now:1800000000000});
 assert.equal(another.status,'idle');
 assert.equal(f.called.length,2);
 const persisted=await readFile(file,'utf8');
 assert.doesNotMatch(persisted,/Bearer |credential|token=/i);
}));
test('capability annotation/risk violations fail closed',async()=>{
 const f=fakeAgent();
 assert.throws(()=>makeAuditorAdapter({client:f.client,metadata:{}}),/readonly_discovery/);
 const a=makeAuditorAdapter({client:f.client,metadata:fakeMetadata});
 await assert.rejects(()=>a.plan({skill:'ops_agent2_health_audit',risk_level:3,production_mutation:true}),/out_of_scope/);
 await assert.rejects(()=>a.execute({}, {capability:'host_action_v2_apply',production_mutation:false}),/plan_invalid/);
});
test('corrupted storage fails closed and is never overwritten',async()=>fixture(async ({file,stopFile})=>{
 await writeFile(file,'UNTRUSTED_JSON');
 const q=new DurableAuditQueue({file,stopFile});
 await assert.rejects(()=>q.schedule('ops-health-1'));
 assert.equal(await readFile(file,'utf8'),'UNTRUSTED_JSON');
}));
