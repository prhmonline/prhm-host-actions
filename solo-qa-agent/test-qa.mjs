import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableAuditQueue,makeBucketId,SCHEMA} from './queue.mjs';
import {QA_ROLE,assertQaCapabilities,qaAdapter,runOnce} from './qa.mjs';

const meta={
 cfpark_readonly_audit:{annotations:{readOnlyHint:true},inputSchema:{type:'object',properties:{}}},
 source_mapping_git_status_readonly:{annotations:{readOnlyHint:true},
  inputSchema:{type:'object',properties:{target:{type:'string',enum:['cfpark_front_prod','cfpark_admin_prod','gisheh360']}},required:['target']}}
};
function fixture(){
 const invoked=[];
 const client={
  discover:async()=>({service_ok:true,capabilities:{
    cfpark_readonly_audit:{input_schema_fingerprint:'a'.repeat(64)},
    source_mapping_git_status_readonly:{input_schema_fingerprint:'b'.repeat(64)}
  }}),
  invoke:async(n,args)=>{
   invoked.push([n,args]);
   if(n==='cfpark_readonly_audit')return {ok:true,backend:{verified:true},
     places:{status_code:200,record_count:2}};
   if(n==='source_mapping_git_status_readonly')
     return {ok:true,read_only:true,target:'cfpark_front_prod',clean:true,branch:'main',head:'a'.repeat(40)};
   throw Error('UNEXPECTED_CAPABILITY');
  }
 };
 class Agent{
  constructor({adapter}){this.adapter=adapter;}
  async run(wo){
   const plan=await this.adapter.plan(wo);
   const ex=await this.adapter.execute(wo,plan);
   const verification=await this.adapter.verify(wo,ex);
   return {...wo,status:verification.results.every(x=>x.pass)?'succeeded':'failed',
     evidence:[ex,verification],attempts:1};
  }
 }
 return {client,invoked,Agent,workOrder:x=>x,
   closureReport:res=>({final_status:res.status,evidence_count:res.evidence.length}),
   fetchImpl:async(url,opts)=>{
    assert.ok(url==='https://cfpark.ir/'||url==='https://dashboard.cfpark.ir/');
    assert.equal(opts.redirect,'manual');return {status:200};
   }};
}
async function sandbox(fn){
 const dir=await mkdtemp(join(tmpdir(),'prhm-qa-tests-'));
 try{return await fn({dir,file:join(dir,'queue.json'),stopFile:join(dir,'STOP')})}
 finally{await rm(dir,{recursive:true,force:true})}
}
test('QA role has zero production mutations and only exact fixed read-only scopes',()=>{
 assert.equal(QA_ROLE.project,'cfpark');
 assert.equal(QA_ROLE.risk_level,0);
 assert.deepEqual(QA_ROLE.allowed_mutations,[]);
 assert.deepEqual(QA_ROLE.capabilities,['cfpark_readonly_audit','source_mapping_git_status_readonly']);
 assertQaCapabilities(meta);
 assert.throws(()=>assertQaCapabilities({}),/qa_readonly_capability_missing/);
 assert.throws(()=>assertQaCapabilities({...meta,cfpark_readonly_audit:{annotations:{readOnlyHint:false},inputSchema:{}}}),/qa_readonly_capability_missing/);
});
test('persistent QA work order invokes exactly three fixed read-only tools plus two fixed HTTP routes',async()=>sandbox(async ({file,stopFile})=>{
 const q=new DurableAuditQueue({file,stopFile,now:()=>1800000000000});
 const f=fixture();
 const args={queue:q,client:f.client,metadata:meta,EngineeringAgent:f.Agent,
  createWorkOrder:f.workOrder,closureReport:f.closureReport,
  fetchImpl:f.fetchImpl,now:1800000000000};
 const one=await runOnce(args);
 assert.equal(one.status,'succeeded');assert.equal(one.severity,'none');
 assert.equal(one.checks.length,10);assert.equal(one.evidence_count,2);
 assert.deepEqual(f.invoked,[['cfpark_readonly_audit',{}],
   ['source_mapping_git_status_readonly',{target:'cfpark_front_prod'}],
   ['cfpark_readonly_audit',{}]]);
 assert.equal((await q.snapshot()).jobs[0].status,'succeeded');
 assert.equal((await q.snapshot()).jobs[0].checks.length,10);
 assert.equal((await runOnce(args)).status,'idle');
 assert.equal(f.invoked.length,3);
 const stored=await readFile(file,'utf8');
 assert.doesNotMatch(stored,/Bearer |token=|password=|secret_key/i);
}));
test('API failure is a persisted critical finding (not a claimed success)',async()=>sandbox(async ({file,stopFile})=>{
 const q=new DurableAuditQueue({file,stopFile});
 const f=fixture();
 f.client.invoke=async(n)=>n==='cfpark_readonly_audit'?
  {ok:true,backend:{verified:true},places:{status_code:503,record_count:0}}:
  {ok:true,read_only:true,target:'cfpark_front_prod',clean:true,branch:'main',head:'b'.repeat(40)};
 const r=await runOnce({queue:q,client:f.client,metadata:meta,EngineeringAgent:f.Agent,
  createWorkOrder:f.workOrder,closureReport:f.closureReport,fetchImpl:f.fetchImpl});
 assert.equal(r.status,'failed');
 assert.equal(r.severity,'critical');
 assert.equal((await q.snapshot()).jobs[0].status,'failed');
 assert.ok((await q.snapshot()).jobs[0].checks.some(x=>x.id==='place_api_http'&&x.result==='fail'));
}));
test('Git unclean produces warning rather than mutating or failing public API QA',async()=>sandbox(async ({file,stopFile})=>{
 const f=fixture(),original=f.client.invoke;
 f.client.invoke=async(n,args)=>{
  const x=await original(n,args);
  return n==='source_mapping_git_status_readonly'?{...x,clean:false}:x;
 };
 const q=new DurableAuditQueue({file,stopFile});
 const r=await runOnce({queue:q,client:f.client,metadata:meta,EngineeringAgent:f.Agent,
  createWorkOrder:f.workOrder,closureReport:f.closureReport,fetchImpl:f.fetchImpl});
 assert.equal(r.status,'succeeded');assert.equal(r.severity,'warning');
 assert.equal((await q.snapshot()).jobs[0].severity,'warning');
}));
test('STOP gate preempts network and tool calls',async()=>sandbox(async ({file,stopFile})=>{
 const f=fixture(),q=new DurableAuditQueue({file,stopFile});
 await writeFile(stopFile,'',{mode:0o600});
 const r=await runOnce({queue:q,client:f.client,metadata:meta,EngineeringAgent:f.Agent,
  createWorkOrder:f.workOrder,closureReport:f.closureReport,fetchImpl:f.fetchImpl});
 assert.equal(r.status,'stopped');assert.equal(f.invoked.length,0);
 assert.equal((await q.snapshot()).jobs.length,0);
}));
test('lease crash recovered with max two attempts and sanitized bad state',async()=>sandbox(async ({file,stopFile})=>{
 let now=300;
 const q=new DurableAuditQueue({file,stopFile,now:()=>now});
 await q.schedule('qa-cfpark-0');
 assert.equal((await q.claim({leaseMs:15})).attempts,1);
 now=320;assert.equal((await q.claim({leaseMs:15})).attempts,2);
 now=340;assert.equal(await q.claim({leaseMs:15}),null);
 assert.equal((await q.snapshot()).jobs[0].status,'failed');
 await writeFile(file,'malformed');
 await assert.rejects(()=>q.schedule('qa-cfpark-9'));
 assert.equal(await readFile(file,'utf8'),'malformed');
}));
test('time buckets are 30 minutes and retry is idempotent',()=>{
 assert.equal(makeBucketId(1800000000000),makeBucketId(1800000010000));
 assert.notEqual(makeBucketId(1800000000000),makeBucketId(1800001800000));
});
