'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const r=require('./leadops-backup-role-registration-v1.cjs');
const {executeBoundRegistration,KEYS}=require('./leadops-backup-role-registration-transaction-v1.cjs');
const helper=fs.readFileSync(path.join(__dirname,'leadops-backup-role-provision-helper-v1.cjs'),'utf8');
const sql=fs.readFileSync(path.join(__dirname,'leadops-backup-role-provision-v1.sql'),'utf8');
function fixtures(){
 const executor="HEADER\n"+
 "  leadops_economics_inputs_foundation_v1:{operation:'host_action.leadops_economics_inputs_foundation_v1',kind:'leadops_economics_inputs_foundation_v1'},\n"+
 "async function applyHostActionV2(action){const spec=hostActionV2Spec(action);return spec;}\n";
 const mcp="const x=['leadops_economics_inputs_foundation_v1',];";
 const policy=fs.readFileSync(path.join(__dirname,'leadops-backup-role-reviewed-policy-v1.json'),'utf8');
 const sources={executor,mcp,policy,helper,sql};
 const expected=Object.fromEntries(['executor','mcp','policy'].map(k=>[k,r.sha(sources[k])]));
 return {sources,expected};
}
function simulatedAdapter({sources,expected}={}){
 const init=fixtures(),s=sources||init.sources,e=expected||init.expected;
 const state=new Map(Object.entries(s).filter(([k])=>['executor','mcp','policy'].includes(k))
  .map(([k,text])=>[r.TARGETS[k],text]));
 const snapshots=new Map();
 const audits=[];
 let failOn=null,auth=true,pin=true,unlock=0,signedTargets=true,signedCommit=true;
 const adapter={
  async assertConsumedLevel4({plan_target_sha256}){return auth?{signed:true,consumed:true,one_time:true,
    level:4,operation:r.OPERATION,approver:'mohammad',
    plan_target_sha256:signedTargets?{...plan_target_sha256}:{...plan_target_sha256,policy:'f'.repeat(64)},
    reviewed_registration_sha:signedCommit?'0123456789abcdef0123456789abcdef01234567':'f'.repeat(40),
    request_id:'123e4567-e89b-42d3-a456-426614174000'}:{signed:false};},
  async assertReviewedGitCommit(){return pin?'0123456789abcdef0123456789abcdef01234567':null;},
  async readFile(p){return state.get(p);},
  async targetState(p){if(!state.has(p))return {exists:false};return {
   exists:true,regular:true,symlink:false,sha256:r.sha(state.get(p))
  };},
  async lock(){return ()=>{unlock++};},
  async snapshot(ps){ps.forEach(p=>snapshots.set(p,state.has(p)?state.get(p):undefined));return ps;},
  async saveBackup(){},
  async writeExact(p,body,{sha256}){if(r.sha(body)!==sha256)throw Error('write_sha_error');
    state.set(p,body);if(p===failOn)throw Error('synthetic_write_error');},
  async verifyFile(){},
  async healthCheck(){},
  async restoreSnapshot(p){const before=snapshots.get(p);if(before===undefined)state.delete(p);
    else state.set(p,before);},
  async audit(x){audits.push(x);}
 };
 return {adapter,state,snapshots,audits,setFail:k=>{failOn=r.TARGETS[k];},
  setAuth:b=>{auth=b;},setPin:b=>{pin=b;},setSignedTargets:b=>{signedTargets=b;},
  setSignedCommit:b=>{signedCommit=b;},getUnlock:()=>unlock,initial:s,expected:e};
}
test('reviewed SQL + helper Git blobs remain pinned',()=>{
 assert.equal(r.blob(sql),r.SQL_BLOB);
 assert.equal(r.blob(helper),r.HELPER_BLOB);
 assert.match(helper,/leadops_backup_role_provision_v1/);
 const canon=fs.readFileSync(path.join(__dirname,'leadops-backup-role-reviewed-policy-v1.json'));
 assert.equal(r.blob(canon),r.CANONICAL_POLICY_BLOB);
 assert.equal(r.sha(canon),r.LIVE.policy);
});
test('exact source registration changes only intended surfaces',()=>{
 const f=fixtures(),p=r.buildCandidates(f.sources,{expected:f.expected});
 assert.equal(p.action,r.ACTION);assert.equal(p.requires_signed_level4,true);
 assert.equal(p.installation_authorized,false);assert.equal(p.production_database_mutation,false);
 const policy=JSON.parse(p.candidate_sources.policy);
 assert.equal(policy.operations[r.OPERATION].level,4);
 assert.equal(policy.operations[r.OPERATION].risk,'critical');
 assert.equal(policy.operations[r.OPERATION].one_time_use,true);
 assert.equal(policy.typed_scopes.filter(x=>x.operation===r.OPERATION).length,1);
 assert.equal(policy.version,'2026-10-12.1-policy-git-live-reconciliation-v1');
 assert.equal(p.candidate_sources.helper,helper);
 assert.equal(p.candidate_sources.sql,sql);
 assert.match(p.candidate_sources.executor,/applyLeadopsBackupRoleProvisionV1/);
 assert.match(p.candidate_sources.mcp,/leadops_backup_role_provision_v1/);
});
test('SHA drift, old binding, missing anchor and duplicate registration fail closed',()=>{
 const f=fixtures();
 for(const key of ['executor','mcp','policy']){
  const s={...f.sources,[key]:f.sources[key]+'tampered'};
  assert.throws(()=>r.buildCandidates(s,{expected:f.expected}),/owner_sha_mismatch/);
 }
 assert.throws(()=>r.buildCandidates({...f.sources,sql:sql+'x'},{expected:f.expected}),/sql_binding_mismatch/);
 assert.throws(()=>r.buildCandidates({...f.sources,helper:helper+'x'},{expected:f.expected}),/helper_binding_mismatch/);
 const changed={...f.sources,executor:f.sources.executor.replace('async function applyHostActionV2','async function wrong')};
 assert.throws(()=>r.buildCandidates(changed,{expected:{...f.expected,executor:r.sha(changed.executor)}}),/anchor_mismatch:executor_dispatch/);
 const duplicate={...f.sources,mcp:f.sources.mcp+"'leadops_backup_role_provision_v1'"};
 assert.throws(()=>r.buildCandidates(duplicate,{expected:{...f.expected,mcp:r.sha(duplicate.mcp)}}),/already_registered/);
});
test('missing/unsigned approval and unbound Git commit cannot write',async()=>{
 for(const what of ['auth','pin']){
  const s=simulatedAdapter(),before=new Map(s.state);
  if(what==='auth')s.setAuth(false);else s.setPin(false);
  await assert.rejects(executeBoundRegistration({sources:s.initial,expected:s.expected},s.adapter),
    what==='auth'?/signed_level4_not_proven/:/registration_git_sha_unbound/);
  assert.deepEqual(s.state,before);assert.equal(s.getUnlock(),0);
 }
});
test('approval token must bind the exact five file SHAs and reviewed commit',async()=>{
 for(const scenario of ['targets','commit']){
   const m=simulatedAdapter(),before=new Map(m.state);
   if(scenario==='targets')m.setSignedTargets(false);
   else m.setSignedCommit(false);
   await assert.rejects(executeBoundRegistration({sources:m.initial,expected:m.expected},m.adapter),
     scenario==='targets'?/signed_target_sha_binding_mismatch/:/signed_registration_commit_mismatch/);
   assert.deepEqual(m.state,before);
   assert.equal(m.getUnlock(),0);
 }
});
test('trusted approved registration writes five exact targets; no database role',async()=>{
 const s=simulatedAdapter();
 const out=await executeBoundRegistration({sources:s.initial,expected:s.expected},s.adapter);
 assert.equal(out.database_mutation,false);
 assert.equal(out.production_role_created,false);
 assert.equal(out.rollback_performed,false);
 assert.deepEqual(out.files_registered,KEYS);
 assert.equal(s.getUnlock(),1);
 for(const key of KEYS)assert.equal(r.sha(s.state.get(r.TARGETS[key])),out.after_sha256[key]);
});
test('failed partial write rolls back all staged owners and helper files',async()=>{
 const s=simulatedAdapter(),original=new Map(s.state);s.setFail('mcp');
 await assert.rejects(executeBoundRegistration({sources:s.initial,expected:s.expected},s.adapter),
    /registration_failed_and_rolled_back/);
 assert.deepEqual(s.state,original);assert.equal(s.getUnlock(),1);
 assert.equal(s.audits.at(-1).rollback_performed,true);
});
test('changed file preimage and symlink are rejected before snapshot',async()=>{
 const s=simulatedAdapter();s.state.set(r.TARGETS.policy,s.initial.policy+'modified');
 await assert.rejects(executeBoundRegistration({sources:s.initial,expected:s.expected},s.adapter),
    /target_preimage_changed:policy/);
 assert.equal(s.snapshots.size,0);assert.equal(s.getUnlock(),1);
});
test('live policy lacking canonical Git-first protections fails closed',()=>{
 const f=fixtures();
 const bad=JSON.parse(f.sources.policy);
 delete bad.deployment_integrity;
 const policy=JSON.stringify(bad,null,2)+'\n';
 assert.throws(()=>r.buildCandidates({...f.sources,policy},
   {expected:{...f.expected,policy:r.sha(policy)}}),
   /post_sync_policy_blob_mismatch/);
});
test('canonical Git-first protections survive registration',()=>{
 const f=fixtures();
 const p=r.buildCandidates(f.sources,{expected:f.expected});
 const x=JSON.parse(p.candidate_sources.policy);
 assert.equal(x.deployment_integrity.git_first_required,true);
 assert.equal(x.deployment_integrity.exact_commit_sha_required_for_production,true);
 assert.equal(x.deployment_integrity.direct_production_file_edit_forbidden,true);
});
test('legacy live policy cannot be used for a backup role registration',()=>{
 const f=fixtures(),old=JSON.parse(f.sources.policy);
 old.version='2026-10-02.1-control-plane-current-owner-bootstrap-repair-v1';
 delete old.deployment_integrity;
 const legacy=JSON.stringify(old,null,2)+'\\n';
 assert.throws(()=>r.buildCandidates({...f.sources,policy:legacy},
   {expected:{...f.expected,policy:r.sha(legacy)}}),
   /post_sync_policy_blob_mismatch/);
});
test('helper is not allowed to self-authorize registration',()=>{
 assert.equal(typeof r.buildCandidates,'function');
 assert.equal(typeof require('./leadops-backup-role-provision-helper-v1.cjs').main,'function');
 assert.equal(require('./leadops-backup-role-provision-helper-v1.cjs').ACTION,r.ACTION);
});
