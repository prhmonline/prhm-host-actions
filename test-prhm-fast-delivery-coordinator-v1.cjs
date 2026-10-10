'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const core=require('./prhm-fast-delivery-coordinator-v1.cjs');
const gate=require('./prhm-fast-delivery-gate-v1.cjs');
const PROJECT='rahekomak',SHA='c89241e415a093f9c07782ce156b51c7019368c5';
const profile=gate.PROFILES[PROJECT];
const REG_SHA='f'.repeat(40),BASE_SHA='b'.repeat(64);
function setup(options={}){
 const steps=[],logs=[];
 const adapter={
  project:PROJECT,root:profile.root,profile_adapter:profile.adapter,
  action:'rahekomak_web_only_release_v1',registration_sha:REG_SHA,
  approval_level:'L4',
  async preflight(){steps.push('preflight');if(options.fail==='preflight')throw Error('preflight_failed');return {ok:true,baseline_sha256:BASE_SHA};},
  async test(){steps.push('test');if(options.fail==='test')throw Error('test_failed');},
  async build(){steps.push('build');if(options.fail==='build')throw Error('build_failed');},
  async deploy(){steps.push('deploy');if(options.fail==='deploy')throw Error('deploy_failed');return {ok:true,deployed_sha:SHA};},
  async smoke(){steps.push('smoke');if(options.fail==='smoke')throw Error('smoke_failed');return {ok:true,home:200,bundle:200};},
  async rollback(){steps.push('rollback');if(options.fail==='rollback')throw Error('rollback_failed');return options.badRollback?{ok:true,restored_baseline_sha256:'0'.repeat(64),health:{ok:true}}:{ok:true,restored_baseline_sha256:BASE_SHA,health:{ok:true}};}
 };
 const inspectProject=()=>{
  steps.push('inspect');
  return {project:PROJECT,head:options.head||SHA,
   root:profile.root,branch:profile.branch,adapter:profile.adapter,
   ready:options.dirty!==true,changed_files:options.dirty?1:0,
   blockers:options.dirty?['dirty_git']:[]};
 };
 const approvalCenter={async consumeExact(p){
  steps.push('approval');
  if(options.fail==='approval')throw Error('approval_rejected');
  return {ok:true,project:p.project,sha:options.wrongApproval?'0'.repeat(40):p.sha,
   action:p.action,target:p.root,registration_sha:p.registration_sha,
   approval_level:p.approval_level,single_use_consumed:true,
   signature_verified:true,decision:'approved',expires_at:'2099-01-01T00:00:00Z'};
 }};
 const logger={async append(x){
  steps.push('log:'+x.status);
  if(options.fail==='log_start'&&x.status==='deploy_starting')throw Error('logger_down');
  if(options.fail==='log_success'&&x.status==='deployed')throw Error('logger_down');
  if(options.fail==='log_failed'&&x.status==='failed')throw Error('logger_down');
  logs.push(x);
  return {ok:true,durable:true};
 }};
 return {steps,logs,adapter,request:{project:PROJECT,sha:SHA,
  registry:{[PROJECT]:adapter},approvalCenter,logger,inspectProject,
  now:()=> '2026-10-10T12:00:00.000Z'}};
}
test('refuse arbitrary project ids, wrong SHA and production CLI apply',()=>{
 assert.throws(()=>core.cli(['--apply',PROJECT,'--sha',SHA]),/no --apply/);
 assert.throws(()=>core.plan('../etc/passwd',SHA),/allowlisted/);
 assert.throws(()=>core.plan(PROJECT,'main'),/40_hex/);
});
test('one-argument plan uses fixed profile and never authorizes production',()=>{
 const r=core.plan(PROJECT,SHA);
 assert.equal(r.execution_enabled,false);assert.equal(r.root,profile.root);
 assert.equal(r.read_only,true);assert.ok(r.required_phases.includes('health'));
});
test('missing trusted native adapter or approval center fails before mutation',async()=>{
 const s=setup();s.request.registry={};
 await assert.rejects(()=>core.coordinate(s.request),/trusted_adapter_missing/);
 assert.deepEqual(s.steps,[]);
 const t=setup();t.request.approvalCenter=null;
 await assert.rejects(()=>core.coordinate(t.request),/trusted_dependencies_required/);
 assert.deepEqual(t.steps,[]);
});
test('misbound action identity or registration SHA cannot run',async()=>{
 const s=setup();s.adapter.registration_sha='main';
 await assert.rejects(()=>core.coordinate(s.request),/trusted_adapter_contract_invalid/);
 assert.deepEqual(s.steps,[]);
});
test('dirty git and changed SHA reject before tests or approval',async()=>{
 const s=setup({dirty:true});
 await assert.rejects(()=>core.coordinate(s.request),/git_preflight_failed/);
 assert.deepEqual(s.steps,['inspect']);
 const t=setup({head:'a'.repeat(40)});
 await assert.rejects(()=>core.coordinate(t.request),/git_preflight_failed/);
 assert.deepEqual(t.steps,['inspect']);
});
test('validated run orders all phases and emits durable receipt',async()=>{
 const s=setup();const result=await core.coordinate(s.request);
 assert.equal(result.status,'deployed');
 assert.deepEqual(s.steps,['inspect','preflight','test','build','approval','inspect',
  'log:deploy_starting','deploy','smoke','log:deployed']);
 assert.equal(s.logs.length,2);
 assert.equal(s.logs[0].registration_sha,REG_SHA);
 assert.equal(s.logs[1].health.home,200);
 assert.equal(s.logs[1].sha,SHA);
});
for(const phase of ['preflight','test','build','approval']){
 test('failure in '+phase+' never touches production',async()=>{
  const s=setup({fail:phase});
  await assert.rejects(()=>core.coordinate(s.request),/release_failed/);
  assert.ok(!s.steps.includes('deploy'));assert.ok(!s.steps.includes('rollback'));
  assert.equal(s.logs.at(-1).status,'failed');
 });
}
test('forged or misbound approval proof blocks deployment',async()=>{
 const s=setup({wrongApproval:true});
 await assert.rejects(()=>core.coordinate(s.request),/approval_binding_invalid/);
 assert.ok(!s.steps.includes('deploy'));
});
for(const phase of ['deploy','smoke','log_success']){
 test('failure in '+phase+' automatically rolls back',async()=>{
  const s=setup({fail:phase});
  await assert.rejects(()=>core.coordinate(s.request),/release_failed/);
  assert.ok(s.steps.includes('rollback'));
  assert.equal(s.logs.at(-1).status,'failed');
  assert.equal(s.logs.at(-1).rollback,'verified');
 });
}
test('rollback failure is not misreported as a successful release',async()=>{
 const s=setup({fail:'rollback'});
 s.adapter.smoke=async()=>{s.steps.push('smoke');throw Error('injected_smoke_failed');};
 await assert.rejects(()=>core.coordinate(s.request),/rollback=failed/);
 assert.equal(s.logs.at(-1).status,'failed_rollback_unverified');
});
test('logger failure before deploy prevents any production mutation',async()=>{
 const s=setup({fail:'log_start'});
 await assert.rejects(()=>core.coordinate(s.request),/release_failed/);
 assert.ok(!s.steps.includes('deploy'));
});
test('logger failure after cutover triggers rollback, and missing final logging fails closed',async()=>{
 const s=setup({fail:'log_success'});
 await assert.rejects(()=>core.coordinate(s.request),/release_failed/);
 assert.ok(s.steps.includes('rollback'));
 const t=setup({fail:'log_failed'});
 t.adapter.test=async()=>{t.steps.push('test');throw Error('test_failed');};
 await assert.rejects(()=>core.coordinate(t.request),/receipt_write_failed/);
});

test('rollback requires exact restored baseline and healthy service evidence',async()=>{
 const s=setup({badRollback:true});
 s.adapter.smoke=async()=>{s.steps.push('smoke');throw Error('smoke_failed');};
 await assert.rejects(()=>core.coordinate(s.request),/rollback=failed/);
 assert.equal(s.logs.at(-1).status,'failed_rollback_unverified');
});
test('stale or unverifiable approval never starts production',async()=>{
 const s=setup();
 s.request.approvalCenter.consumeExact=async p=>({
  ok:true,project:p.project,sha:p.sha,action:p.action,target:p.root,
  approval_level:p.approval_level,registration_sha:p.registration_sha,
  single_use_consumed:true,signature_verified:true,decision:'approved',
  expires_at:'2020-01-01T00:00:00Z'});
 await assert.rejects(()=>core.coordinate(s.request),/approval_binding_invalid/);
 assert.ok(!s.steps.includes('deploy'));
});
test('deployed commit proof is mandatory; missing proof rolls back',async()=>{
 const s=setup();
 s.adapter.deploy=async()=>{s.steps.push('deploy');return {ok:true,deployed_sha:'a'.repeat(40)};};
 await assert.rejects(()=>core.coordinate(s.request),/deployed_sha_evidence_invalid/);
 assert.ok(s.steps.includes('rollback'));
});
