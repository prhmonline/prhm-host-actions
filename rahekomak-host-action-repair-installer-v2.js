'use strict';

/*
 * Git-first, development-only installer candidate for RahKomak Host Action v2.
 * Its only user-facing CLI mode prints its contract. An independent, approved,
 * SHA-bound host-action bootstrap must call applyApproved() from a distinct
 * transient unit after one-time Level-4 authorization. Never invoke directly.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const vm=require('node:vm');

const ACTION='rahekomak_host_action_repair_v2';
const REPO='prhmonline/prhm-host-actions';
const EXECUTOR='/opt/prhm-agent-selfmaint-exec/server.js';
const WORKER_TARGET='/opt/prhm-agent-selfmaint-exec/actions/rahekomak-production-deploy-worker-v2.js';
const WORKER_SOURCE=path.join(__dirname,'rahekomak-production-deploy-worker-v2.js');
const PATCH_SOURCE=path.join(__dirname,'rahekomak-host-action-executor-patch-v2.js');
const EXECUTOR_PREIMAGE_SHA256='410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0';
const WORKER_GIT_BLOB='6b8df4e4d5e2d7c057251e58717c5b00d5307287';
const PATCH_GIT_BLOB='255f350ad4a5f29192156fe9c4565ba8cedead3a';
const BACKUP_ROOT='/var/backups/prhm-rahekomak-host-action-repair-v2';
const EXECUTOR_SERVICE='prhm-agent-selfmaint-exec.service';
const RELEASE_HEAD='7f2ea82b0865bb64c8adbc3192e8547fe4f43c25';

function fail(reason){throw new Error(reason)}
function sha256(b){return crypto.createHash('sha256').update(b).digest('hex')}
function gitBlob(b){return crypto.createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex')}
function verifyRegular(file){
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(file)!==file)fail('nonregular_or_symlink:'+file);
  return st;
}
function checkedSource(file,pinned){
  verifyRegular(file);
  const b=fs.readFileSync(file);
  if(gitBlob(b)!==pinned)fail('source_blob_drift:'+path.basename(file));
  return b;
}
function buildCandidate(executorSource){
  if(sha256(Buffer.from(executorSource))!==EXECUTOR_PREIMAGE_SHA256)fail('executor_preimage_drift');
  const patch=require(PATCH_SOURCE);
  const candidate=patch.patchExecutor(executorSource);
  new vm.Script(candidate,{filename:'server.js'});
  if(candidate===executorSource)fail('empty_candidate');
  if(!candidate.includes('RAHEKOMAK_DEPLOY_WORKER_GIT_BLOB'))fail('candidate_missing_worker_binding');
  if(!candidate.includes(RELEASE_HEAD))fail('candidate_wrong_release');
  return candidate;
}
function manifest(){
  return Object.freeze({action:ACTION,repository:REPO,release_head:RELEASE_HEAD,
    executor_preimage_sha256:EXECUTOR_PREIMAGE_SHA256,worker_git_blob:WORKER_GIT_BLOB,
    patch_git_blob:PATCH_GIT_BLOB,production_mutation:'approved_apply_only',
    preflight_mutation:false,
    source_git_commit_required:true,level:4,one_time_approval_required:true,
    separate_activation_required:true,
    no_arbitrary_command:true,no_arbitrary_path:true,rollback_required:true,
    installer_status:'candidate_only'});
}
function preflight(){
  const executorStat=verifyRegular(EXECUTOR);
  const original=fs.readFileSync(EXECUTOR);
  checkedSource(WORKER_SOURCE,WORKER_GIT_BLOB);
  checkedSource(PATCH_SOURCE,PATCH_GIT_BLOB);
  if(fs.existsSync(WORKER_TARGET)){
    verifyRegular(WORKER_TARGET);
    if(gitBlob(fs.readFileSync(WORKER_TARGET))!==WORKER_GIT_BLOB)fail('existing_worker_drift');
  }
  const candidate=buildCandidate(original.toString('utf8'));
  const stat=cp.spawnSync('/usr/bin/systemctl',['show',EXECUTOR_SERVICE,'-p','ProtectHome','--value'],
    {encoding:'utf8',timeout:15000,maxBuffer:10000});
  if(stat.error||stat.status!==0||String(stat.stdout||'').trim()!=='yes')fail('resident_protecthome_not_yes');
  return {ok:true,preflight_only:true,source_sha256:sha256(original),
    candidate_sha256:sha256(Buffer.from(candidate)),executor_mode:executorStat.mode&0o777,
    worker_preexisting:fs.existsSync(WORKER_TARGET),target:EXECUTOR,production_mutation:false};
}
function atomic(file,b,mode){
  const temp=file+'.rahekomak-repair-'+process.pid+'.tmp';
  fs.writeFileSync(temp,b,{flag:'wx',mode});
  fs.chmodSync(temp,mode);
  fs.renameSync(temp,file);
}
function systemctl(...args){
  const r=cp.spawnSync('/usr/bin/systemctl',args,{encoding:'utf8',timeout:90000,maxBuffer:100000});
  if(r.error||r.status!==0)fail('systemctl_'+args[0]+'_failed');
  return String(r.stdout||'').trim();
}
function applyApproved(){
  // The trusted typed Host Action must authenticate and authorize this call.
  // This function deliberately accepts no path, command, SHA or token inputs.
  const pre=preflight();
  const original=fs.readFileSync(EXECUTOR);
  const worker=fs.readFileSync(WORKER_SOURCE);
  const candidate=Buffer.from(buildCandidate(original.toString('utf8')),'utf8');
  if(sha256(original)!==pre.source_sha256||sha256(candidate)!==pre.candidate_sha256)
    fail('time_of_check_drift');
  const workerExisted=fs.existsSync(WORKER_TARGET);
  const originalWorker=workerExisted?fs.readFileSync(WORKER_TARGET):null;
  const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14);
  const backup=path.join(BACKUP_ROOT,stamp+'-'+process.pid);
  fs.mkdirSync(BACKUP_ROOT,{recursive:true,mode:0o700});
  fs.mkdirSync(backup,{recursive:false,mode:0o700});
  fs.writeFileSync(path.join(backup,'executor.before'),original,{mode:0o600,flag:'wx'});
  if(workerExisted)fs.writeFileSync(path.join(backup,'worker.before'),originalWorker,{mode:0o600,flag:'wx'});
  let changed=false;
  try{
    atomic(WORKER_TARGET,worker,0o750);
    atomic(EXECUTOR,candidate,pre.executor_mode);
    changed=true;
    if(sha256(fs.readFileSync(EXECUTOR))!==pre.candidate_sha256)fail('postwrite_executor_sha_mismatch');
    if(gitBlob(fs.readFileSync(WORKER_TARGET))!==WORKER_GIT_BLOB)fail('postwrite_worker_sha_mismatch');
    // Do NOT restart the Host Actions service from inside its own active request.
    // Activation must be independently authorized and can occur only after the
    // original request has returned and a controlled poststate verifier is ready.
    if(systemctl('is-active',EXECUTOR_SERVICE)!=='active')fail('executor_not_active');
    return {ok:true,action:ACTION,source_sha256:pre.source_sha256,
      installed_sha256:pre.candidate_sha256,release_head:RELEASE_HEAD,
      timestamp:new Date().toISOString(),target:EXECUTOR,backup,
      installation_state:'staged_pending_activation',
      production_code_written:true,production_runtime_restarted:false,
      rollback_performed:false,requires_separate_activation_approval:true,
      requires_fresh_deploy_approval:true};
  }catch(err){
    if(changed||fs.existsSync(backup)){
      let rollbackFailed=null;
      try{
        atomic(EXECUTOR,original,pre.executor_mode);
        if(workerExisted)atomic(WORKER_TARGET,originalWorker,0o750);
        else if(fs.existsSync(WORKER_TARGET))fs.unlinkSync(WORKER_TARGET);
        // Activation has not been attempted. Restore files without restarting
        // the service processing the approval transaction.
        if(systemctl('is-active',EXECUTOR_SERVICE)!=='active')fail('rollback_executor_not_active');
        if(sha256(fs.readFileSync(EXECUTOR))!==EXECUTOR_PREIMAGE_SHA256)fail('rollback_sha_mismatch');
      }catch(r){rollbackFailed=String(r.message||r)}
      if(rollbackFailed)fail('install_failed_and_rollback_failed:'+rollbackFailed);
    }
    fail('install_failed_rolled_back:'+String(err.message||err));
  }
}
module.exports={ACTION,REPO,EXECUTOR,WORKER_TARGET,EXECUTOR_PREIMAGE_SHA256,
  WORKER_GIT_BLOB,PATCH_GIT_BLOB,RELEASE_HEAD,manifest,gitBlob,buildCandidate,
  preflight,applyApproved};
if(require.main===module)process.stdout.write(JSON.stringify(manifest())+'\n');
