'use strict';
/**
 * PRHM Solo Runtime registration: exact six-file atomic transaction CORE.
 *
 * This is NOT an executor or an approval authority. It exports no CLI.
 * Only an independently authenticated, signed, replay-consumed Level-4
 * Provider installer may construct the real adapter and call applyPrepared.
 * The adapter MUST enforce root ownership, no symlinks, fsync + rename,
 * immutable backups, service/ZDT health verification, and verified restore.
 */
const crypto=require('node:crypto');
const registration=require('./solo-company-runtime-l4-registration-candidate-v1.js');
const worker=require('./solo-company-runtime-root-action-v1.js');

const ACTION='solo_company_runtime_registration_v1';
const OPERATION='host_action.'+ACTION;
const SOURCE_COMMITS=Object.freeze({
  host:'9a18f281e788d9f3738884e18df82e711de466fc',
  sshagent:'02966549a751c16b582ce17d15a1e2cf8a22f0fb'
});
const PINS=Object.freeze({
  registration_generator:'dba7eeaea842ddd48eda33c068091b005fdb60e9',
  worker_sha:'3c36ded82888e81e33132898eac2baab4b1e41f8d35ac076ba082a22b8b7906e',
  core_before:'fac8458d3a85bef0d30ba3864f1b9368e921ee66483528f4cdfb91fb4cc395b7',
  core_after:'a93abca70f158729e0e22d39717a6e10a4025b18c44bf60a774ce3bf63fa41dd'
});
const TARGETS=Object.freeze({
  approval:'/opt/prhm-agent-selfmaint/server.js',
  executor:'/opt/prhm-agent-selfmaint-exec/server.js',
  policy:'/opt/prhm-company-control-plane/config/approval-policy.json',
  mcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
  core:'/home/agent/ssh-mcp-server/src/plugins/soloCompanyRuntimeInstallCore.js',
  worker:'/opt/prhm-agent-selfmaint-exec/actions/solo-company-runtime-root-action-v1.js'
});
const ORDER=Object.freeze(['worker','core','approval','executor','policy','mcp']);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=c=>{throw new Error(c)};
function verifySources(){
  if(worker.SOURCE_SHA256!==PINS.core_after||registration.ROOT_HELPER_SHA256!==PINS.worker_sha)
    fail('root_source_sha_binding_mismatch');
  if(worker.ACTION!=='solo_company_runtime_install_v1'||registration.ACTION!==worker.ACTION)
    fail('root_action_binding_mismatch');
  if(registration.RELEASE_SHA!==worker.RELEASE_SHA)
    fail('release_binding_mismatch');
}
function verifyState(kind,entry){
  if(!entry||typeof entry!=='object')fail('target_state_required_'+kind);
  if(kind==='worker'){
    if(entry.exists!==false)fail('root_worker_target_already_exists');
    return;
  }
  if(entry.exists!==true||entry.is_file!==true||entry.is_symlink===true||
     entry.realpath!==TARGETS[kind]||!Buffer.isBuffer(entry.bytes)||
     hash(entry.bytes)!==(kind==='core'?PINS.core_before:registration.EXPECTED[kind]))
    fail('production_preimage_mismatch_'+kind);
  if(!Number.isInteger(entry.uid)||!Number.isInteger(entry.gid)||
     !Number.isInteger(entry.mode)||entry.mode<0o400||entry.mode>0o755)
    fail('target_owner_mode_invalid_'+kind);
}
function getPlan(adapter){
  verifySources();
  if(!adapter||typeof adapter.inspect!=='function'||typeof adapter.pinnedGitRead!=='function')
    fail('trusted_adapter_required');
  const states={},raw={};
  for(const kind of Object.keys(TARGETS)){
    states[kind]=adapter.inspect(TARGETS[kind]);
    verifyState(kind,states[kind]);
    if(kind!=='worker'&&kind!=='core')raw[kind]=states[kind].bytes;
  }
  const candidates=registration.buildCandidates(raw);
  const coreBytes=adapter.pinnedGitRead({
    repository:'prhmonline/sshagent',commit:SOURCE_COMMITS.sshagent,
    path:'mcp-server/src/plugins/soloCompanyRuntimeInstallCore.js'
  });
  const workerBytes=adapter.pinnedGitRead({
    repository:'prhmonline/prhm-host-actions',commit:SOURCE_COMMITS.host,
    path:'solo-company-runtime-root-action-v1.js'
  });
  if(!Buffer.isBuffer(coreBytes)||hash(coreBytes)!==PINS.core_after ||
     !Buffer.isBuffer(workerBytes)||hash(workerBytes)!==PINS.worker_sha)
    fail('pinned_git_source_mismatch');
  const result={...candidates.sources,core:coreBytes,worker:workerBytes};
  const steps=ORDER.map(kind=>{
    const current=states[kind];
    const bytes=Buffer.from(result[kind]);
    return {
      kind,path:TARGETS[kind],bytes,
      before_sha256:kind==='worker'?null:hash(current.bytes),
      after_sha256:hash(bytes),
      uid:kind==='worker'?0:current.uid,
      gid:kind==='worker'?0:current.gid,
      mode:kind==='worker'?0o700:current.mode
    };
  });
  return {schema:'prhm.solo-runtime.registration-plan.v1',action:ACTION,
    operation:OPERATION,release_sha:registration.RELEASE_SHA,
    source_commits:SOURCE_COMMITS,root_helper_sha:PINS.worker_sha,
    steps,production_mutation:false,registration_authorized:false,
    requires_signed_level4:true};
}
function verifyPlan(plan){
  if(!plan||plan.schema!=='prhm.solo-runtime.registration-plan.v1'||
     plan.action!==ACTION||plan.operation!==OPERATION||
     plan.release_sha!==registration.RELEASE_SHA||
     plan.source_commits?.host!==SOURCE_COMMITS.host||
     plan.source_commits?.sshagent!==SOURCE_COMMITS.sshagent||
     plan.root_helper_sha!==PINS.worker_sha||
     plan.steps?.length!==ORDER.length)fail('installation_plan_binding_invalid');
  for(let i=0;i<ORDER.length;i++){
    const step=plan.steps[i],kind=ORDER[i];
    if(!step||step.kind!==kind||step.path!==TARGETS[kind]||
       !Buffer.isBuffer(step.bytes)||hash(step.bytes)!==step.after_sha256||
       step.before_sha256!==(kind==='worker'?null:kind==='core'?PINS.core_before:registration.EXPECTED[kind]))
      fail('installation_plan_step_invalid_'+kind);
  }
}
async function applyPrepared(plan,adapter){
  verifyPlan(plan);
  const req=['consumeSignedL4','lock','snapshot','backup','writeExact','verifyExact',
    'reloadAndHealth','restoreExact','verifyRestore','record'];
  if(!adapter||req.some(x=>typeof adapter[x]!=='function'))fail('trusted_root_driver_missing');
  // Signed grant verification and replay consumption must happen at the
  // trusted Provider boundary; a caller-provided boolean is NOT authority.
  const grant=await adapter.consumeSignedL4({
    operation:OPERATION,release_sha:registration.RELEASE_SHA,
    source_commits:SOURCE_COMMITS,
    candidates:Object.fromEntries(plan.steps.map(s=>[s.kind,s.after_sha256])),
    level:4,risk:'critical',one_time_use:true
  });
  if(!grant||grant.verified!==true||grant.consumed!==true||
     grant.operation!==OPERATION||grant.level!==4||
     grant.risk!=='critical'||typeof grant.request_id!=='string'||
     !/^[0-9a-f-]{36}$/i.test(grant.request_id))
    fail('signed_level4_grant_unverified');
  const release=await adapter.lock(ACTION);
  if(typeof release!=='function')fail('registration_lock_failed');
  let backed=false;const attempted=[];
  try{
    // Revalidate exact preimages under the lock before ANY modification.
    const fresh=getPlan(adapter);
    if(fresh.steps.some((s,i)=>s.after_sha256!==plan.steps[i].after_sha256))
      fail('registration_plan_changed');
    const copies=await adapter.snapshot(plan.steps);
    if(!Array.isArray(copies)||copies.length!==ORDER.length)
      fail('registration_snapshot_invalid');
    await adapter.backup(copies);
    backed=true;
    for(const step of plan.steps){
      attempted.push(step.kind); // partial writes must also be restored
      await adapter.writeExact(step);
      await adapter.verifyExact(step);
    }
    const health=await adapter.reloadAndHealth('candidate');
    if(health?.approval!==true||health?.executor!==true||
       health?.mcp!==true||health?.router!==true)
      fail('control_plane_postinstall_health_failed');
    const success={ok:true,schema_version:'prhm.solo-runtime.registration-result.v1',
      action:ACTION,operation:OPERATION,release_sha:plan.release_sha,
      source_commits:SOURCE_COMMITS,registered:ORDER,
      rollback_performed:false,database_mutation:false,
      credential_values_returned:false};
    await adapter.record(success);
    return success;
  }catch(error){
    if(!backed)throw error;
    let restored=false;
    try{
      for(const kind of [...attempted].reverse()){
        await adapter.restoreExact(TARGETS[kind],kind);
        await adapter.verifyRestore(kind);
      }
      const health=await adapter.reloadAndHealth('baseline');
      restored=health?.approval===true&&health?.executor===true&&
        health?.mcp===true&&health?.router===true;
    }catch(_){}
    try{await adapter.record({ok:false,action:ACTION,
      error:'registration_transaction_failed',
      rollback_performed:restored,rollback_incomplete:!restored});}catch(_){}
    if(!restored)fail('registration_rollback_incomplete');
    fail('registration_failed_rollback_complete');
  }finally{
    await release();
  }
}
module.exports=Object.freeze({ACTION,OPERATION,SOURCE_COMMITS,PINS,TARGETS,ORDER,hash,
  verifySources,getPlan,verifyPlan,applyPrepared});
if(require.main===module){
  process.stderr.write('NO_CLI: signed replay-consumed Provider Level-4 driver required\n');
  process.exitCode=64;
}
