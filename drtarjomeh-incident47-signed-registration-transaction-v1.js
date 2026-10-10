'use strict';
// P0 incident #47: transaction core for a future signed Level-4 host installer.
// This module has NO CLI or production adapter. Caller MUST be an authenticated,
// replay-consumed Host Actions v2 bootstrap; merely passing an object is not auth.
const crypto=require('node:crypto');
const registry=require('./drtarjomeh-incident47-runtime-registration-v1.js');
const pins=require('./drtarjomeh-incident47-l4-registration-candidate-v1.js');

const ACTION=registry.ACTION;
const ORDER=Object.freeze(['base','executor','policy','mcp','runner']);
const TARGETS=Object.freeze({
  base:pins.LIVE.base.path,
  executor:pins.LIVE.executor.path,
  policy:pins.LIVE.policy.path,
  mcp:pins.LIVE.mcp.path,
  runner:registry.RUNNER_TARGET,
});
function fail(code){throw new Error(code);}
function sha(v){return crypto.createHash('sha256').update(v).digest('hex');}
function getPlan(adapter){
  if(!adapter||typeof adapter.readOwner!=='function'||typeof adapter.readRunner!=='function')
    fail('read_adapter_required');
  if(typeof adapter.hostMainSha!=='function'||adapter.hostMainSha()!==registry.HOST_BASE)
    fail('host_main_baseline_mismatch');
  const candidates=registry.buildCandidates({readOwner:adapter.readOwner,
    readRunner:adapter.readRunner,hostMainSha:registry.HOST_BASE});
  const runnerBytes=adapter.readRunner('drtarjomeh-incident47-reviewed-host-runner-v1.js');
  if(!Buffer.isBuffer(runnerBytes)||pins.gitBlob(runnerBytes)!==registry.RUNNER_GIT_BLOB)
    fail('runner_git_blob_mismatch');
  if(typeof adapter.targetState!=='function')fail('target_metadata_required');
  const plans={};
  for(const kind of ORDER){
    const state=adapter.targetState(TARGETS[kind]);
    if(!state||typeof state!=='object')fail('target_state_missing:'+kind);
    if(kind==='runner'){
      if(state.exists!==false)fail('runner_target_not_absent');
    }else{
      if(state.exists!==true||state.isFile!==true||state.isSymlink===true||
        state.sha256!==pins.LIVE[kind].sha256)fail('owner_preimage_drift:'+kind);
    }
    const bytes=kind==='runner'?runnerBytes:Buffer.from(candidates.candidate_sources[kind],'utf8');
    const perms=kind==='runner'?0o700:state.mode;
    if(!Number.isInteger(perms)||perms<0o400||perms>0o755)fail('owner_mode_unsafe:'+kind);
    plans[kind]=Object.freeze({kind,path:TARGETS[kind],before_sha256:kind==='runner'?null:state.sha256,
      after_sha256:sha(bytes),bytes,mode:perms,uid:kind==='runner'?0:state.uid,gid:kind==='runner'?0:state.gid});
    if(!Number.isInteger(plans[kind].uid)||!Number.isInteger(plans[kind].gid))
      fail('owner_identity_unknown:'+kind);
  }
  return Object.freeze({schema:'prhm.drtarjomeh.incident47.registration-install-plan.v1',
    action:ACTION,operation:pins.OPERATION,app_sha:pins.SOURCE_COMMIT,
    baseline_sha:registry.HOST_BASE,steps:ORDER.map(k=>plans[k]),
    installation_authorized:false,requires_signed_level4:true,production_mutation:false});
}
async function applyPrepared(plan,adapter){
  // Internal transaction primitive. NOT publicly routed and NOT a way to
  // check approval. Only the already signed+consumed Host Action may call it.
  if(!plan||plan.schema!=='prhm.drtarjomeh.incident47.registration-install-plan.v1'||
    plan.action!==ACTION||plan.baseline_sha!==registry.HOST_BASE||
    plan.app_sha!==pins.SOURCE_COMMIT)fail('plan_identity_invalid');
  if(plan.steps?.length!==5||plan.steps.some((s,i)=>s.kind!==ORDER[i]||
    s.path!==TARGETS[ORDER[i]]||s.after_sha256!==sha(s.bytes)))
    fail('plan_step_invalid');
  for(const name of ['lock','snapshot','backup','writeExact','verify','reloadAndHealth','restore','record']){
    if(typeof adapter?.[name]!=='function')fail('adapter_missing:'+name);
  }
  const unlock=await adapter.lock(ACTION);
  if(typeof unlock!=='function')fail('lock_acquisition_invalid');
  let backed=false;const changed=[];
  try{
    const current=getPlan(adapter);
    if(current.steps.some((s,i)=>s.after_sha256!==plan.steps[i].after_sha256))
      fail('plan_changed_before_install');
    const copies=await adapter.snapshot(plan.steps);
    if(!copies||copies.length!==plan.steps.length)fail('snapshot_incomplete');
    await adapter.backup(copies); // immutable root-owned backup MUST precede writes
    backed=true;
    for(const step of plan.steps){
      // Mark before write so a partial write is also rolled back.
      changed.push(step.kind);
      await adapter.writeExact(step);
      await adapter.verify(step);
    }
    await adapter.reloadAndHealth('candidate');
    const result={ok:true,action:ACTION,source_commit:plan.baseline_sha,
      app_sha:plan.app_sha,targets:[...ORDER],rollback_performed:false,
      authorization_attested_by_transaction:false,production_application_mutation:false,
      database_mutation:false,credential_values_returned:false};
    await adapter.record(result);
    return Object.freeze(result);
  }catch(error){
    if(backed){
      let rollbackError=null;
      try{
        for(const kind of [...changed].reverse())
          await adapter.restore(TARGETS[kind],kind);
        await adapter.reloadAndHealth('baseline');
      }catch(e){rollbackError=e;}
      const result={ok:false,action:ACTION,
        rollback_performed:rollbackError===null,rollback_incomplete:rollbackError!==null,
        error_code:rollbackError?'ROLLBACK_FAILED':'APPLY_FAILED'};
      try{await adapter.record(result);}catch(_){}
      if(rollbackError)throw new Error('registration_rollback_incomplete');
      throw new Error('registration_failed_rollback_complete');
    }
    throw error;
  }finally{
    await unlock();
  }
}
module.exports=Object.freeze({ACTION,ORDER,TARGETS,getPlan,applyPrepared,sha});
if(require.main===module){
  process.stderr.write('No installer CLI. Signed one-time Level-4 dispatcher required.\n');
  process.exitCode=64;
}
