'use strict';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {CAPABILITY,RELEASE_SHA,SOURCE_COMMIT,assertReadOnly,buildAdapter,runPilot} from './solo-company-agent2-readonly-uat-v1.mjs';
const metadata={selfmaint_health:{annotations:{readOnlyHint:true},inputSchema:{type:'object'}}};
function fake(){
  const called=[];
  const client={
    discover:async()=>({service_ok:true,capabilities:{selfmaint_health:{input_schema_fingerprint:'a'.repeat(64)}}}),
    invoke:async(name,args)=>{called.push({name,args});return {ok:true,service:'prhm-agent-selfmaint-exec',version:'test'};}
  };
  return {client,called};
}
class TestEngineeringAgent{
  constructor({adapter}){this.adapter=adapter;}
  async run(wo){
    const plan=await this.adapter.plan(wo);
    const execution=await this.adapter.execute(wo,plan);
    const verification=await this.adapter.verify(wo,execution);
    if(!verification.results.every(x=>x.pass===true))throw Error('test_verification_failed');
    return {...wo,status:'succeeded',attempts:1,evidence:[execution,verification],
      history:[{to:'planning'},{to:'ready'},{to:'executing'},{to:'verifying'},{to:'succeeded'}]};
  }
}
const createWorkOrder=wo=>({...wo});
const closureReport=wo=>({work_order_id:wo.id,final_status:wo.status,attempts:wo.attempts,
  evidence_count:wo.evidence.length,requires_attention:false});
test('immutable read-only scope, exact release and capability',()=>{
  assert.equal(CAPABILITY,'selfmaint_health');
  assert.match(RELEASE_SHA,/^[a-f0-9]{40}$/);
  assert.match(SOURCE_COMMIT,/^[a-f0-9]{40}$/);
  assert.throws(()=>assertReadOnly({selfmaint_health:{annotations:{readOnlyHint:false},inputSchema:{type:'object'}}}),/read_only_capability_not_verified/);
  assert.throws(()=>assertReadOnly({}),/read_only_capability_not_verified/);
});
test('read-only first EngineeringAgent work order makes exactly two inspected calls',async()=>{
  const {client,called}=fake();
  const res=await runPilot({client,metadata,EngineeringAgent:TestEngineeringAgent,createWorkOrder,closureReport});
  assert.equal(res.status,'succeeded');
  assert.equal(res.attention,false);
  assert.equal(res.evidence_count,2);
  assert.equal(res.mutating_capabilities,0);
  assert.equal(res.production_work_order_persisted,false);
  assert.deepEqual(res.phases,['planning','ready','executing','verifying','succeeded']);
  assert.deepEqual(called,[{name:CAPABILITY,args:{}},{name:CAPABILITY,args:{}}]);
});
test('risk escalation and out of scope tools fail closed',async()=>{
  const {client}=fake();const adapter=buildAdapter({client,metadata});
  await assert.rejects(()=>adapter.plan({skill:'agent2_health_readonly',risk_level:3,production_mutation:true}),/work_order_out_of_scope/);
  await assert.rejects(()=>adapter.plan({skill:'any_other',risk_level:0,production_mutation:false}),/work_order_out_of_scope/);
  await assert.rejects(()=>adapter.execute({}, {capability:'host_action_v2_apply',production_mutation:false}),/unsafe_agent_plan/);
  await assert.rejects(()=>adapter.rollback(),/readonly_no_rollback_needed/);
});
test('no unattended executable without explicit read-only CLI switch',()=>{
  const r=spawnSync(process.execPath,['solo-company-agent2-readonly-uat-v1.mjs'],{encoding:'utf8',timeout:8000});
  assert.equal(r.status,2);
  assert.match(r.stderr,/READONLY_UAT_FAILED=readonly_mode_required/);
});
