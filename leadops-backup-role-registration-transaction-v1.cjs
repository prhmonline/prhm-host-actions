'use strict';
// An installer TRANSACTION PRIMITIVE; it is intentionally not executable.
// The trusted bootstrap layer owns signature verification, replay consumption,
// exact Git SHA binding and approval records. This module cannot grant approval.
const {ACTION,OPERATION,LIVE,TARGETS,sha,buildCandidates}=require('./leadops-backup-role-registration-v1.cjs');
const KEYS=Object.freeze(['helper','sql','executor','mcp','policy']);
const fail=code=>{throw Error(code);};
async function executeBoundRegistration(input,adapter){
  const expected=input?.expected||LIVE;
  const sources=input?.sources;
  if(!sources||typeof sources!=='object')fail('source_inputs_missing');
  for(const n of ['assertConsumedLevel4','assertReviewedGitCommit',
    'readFile','targetState','lock','snapshot','saveBackup','writeExact',
    'verifyFile','healthCheck','restoreSnapshot','audit']){
    if(typeof adapter?.[n]!=='function')fail('trusted_installer_adapter_missing:'+n);
  }
  // Verify exact owner preimages and review bundle while still in memory.
  const plan=buildCandidates(sources,{expected});
  if(plan.installation_authorized!==false||plan.requires_signed_level4!==true)
    fail('registration_plan_unsafe');
  const auth=await adapter.assertConsumedLevel4({
    operation:OPERATION,action:ACTION,level:4,
    plan_target_sha256:Object.fromEntries(
      KEYS.map(k=>[k,plan.targets[k].sha256]))
  });
  if(auth?.signed!==true||auth?.consumed!==true||
      auth?.one_time!==true||auth?.level!==4||
      auth?.operation!==OPERATION||auth?.approver!=='mohammad')
    fail('signed_level4_not_proven');
  const pin=await adapter.assertReviewedGitCommit();
  if(typeof pin!=='string'||!/^[a-f0-9]{40}$/.test(pin))
    fail('registration_git_sha_unbound');
  const release=await adapter.lock(ACTION);
  if(typeof release!=='function')fail('exclusive_lock_failed');
  let backupSaved=false;
  const changed=[];
  try{
    // Prevent TOCTOU and reject any preexisting target/symlink.
    for(const k of KEYS){
      const p=TARGETS[k],state=await adapter.targetState(p);
      if(['executor','mcp','policy'].includes(k)){
        if(state?.exists!==true||state?.regular!==true||
           state?.symlink===true||state?.sha256!==expected[k])
          fail('target_preimage_changed:'+k);
        if(sha(await adapter.readFile(p))!==expected[k])
          fail('readback_mismatch:'+k);
      }else if(state?.exists!==false){
        fail('reviewed_helper_or_sql_already_present:'+k);
      }
    }
    const originals=await adapter.snapshot(KEYS.map(k=>TARGETS[k]));
    if(!Array.isArray(originals)||originals.length!==KEYS.length)
      fail('snapshot_incomplete');
    await adapter.saveBackup(originals);
    backupSaved=true;
    for(const k of KEYS){
      changed.push(k); // record BEFORE write, includes partially written files.
      const target=TARGETS[k];
      await adapter.writeExact(target,plan.candidate_sources[k],{sha256:plan.targets[k].sha256});
      const after=await adapter.targetState(target);
      if(after?.regular!==true||after?.symlink===true||
         after?.sha256!==plan.targets[k].sha256)
        fail('postwrite_sha_mismatch:'+k);
      await adapter.verifyFile(target,plan.targets[k].sha256);
    }
    await adapter.healthCheck({
      action:ACTION,executor_registered:true,mcp_registered:true,
      level4_policy_registered:true,role_created:false
    });
    const audit={ok:true,action:ACTION,operation:OPERATION,
      approved_registration_git_sha:pin,source_commit:plan.source_commit,
      request_id:auth.request_id,files_registered:KEYS,
      after_sha256:Object.fromEntries(KEYS.map(k=>[k,plan.targets[k].sha256])),
      database_mutation:false,production_role_created:false,
      rollback_performed:false};
    await adapter.audit(audit);
    return audit;
  }catch(err){
    if(!backupSaved)throw err;
    try{
      for(const key of [...changed].reverse()){
        await adapter.restoreSnapshot(TARGETS[key]);
      }
      await adapter.healthCheck({action:ACTION,mode:'rollback'});
      await adapter.audit({ok:false,action:ACTION,request_id:auth.request_id,
        rollback_performed:true,error_code:'REGISTRATION_ROLLED_BACK'});
    }catch(rb){
      throw Error('registration_rollback_incomplete:'+rb.message);
    }
    throw Error('registration_failed_and_rolled_back:'+err.message);
  }finally{
    await release();
  }
}
module.exports={KEYS,executeBoundRegistration};
