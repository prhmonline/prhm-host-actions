'use strict';

/*
 * Fixed RahKomak Host Action v2 activation transaction.
 * IMPORTANT: Only execute from a separately approved Level-4 transient systemd
 * unit, after the initial staged-install approval response has completed.
 * No caller-controlled paths, commands, revisions, or service names.
 */
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const http=require('node:http');

const ACTION='rahekomak_host_action_repair_activate_v2';
const SERVICE='prhm-agent-selfmaint-exec.service';
const SOCKET='/run/prhm-agent-selfmaint-exec/exec.sock';
const EXECUTOR='/opt/prhm-agent-selfmaint-exec/server.js';
const WORKER='/opt/prhm-agent-selfmaint-exec/actions/rahekomak-production-deploy-worker-v2.js';
const STATE_ROOT='/var/lib/prhm-agent-selfmaint-exec/rahekomak-host-action-repair-v2';
const STAGE=path.join(STATE_ROOT,'stage.json');
const RESULT=path.join(STATE_ROOT,'activation-result.json');
const BACKUP_ROOT='/var/backups/prhm-rahekomak-host-action-repair-v2';
const OLD_SHA='410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0';
const WORKER_BLOB='6b8df4e4d5e2d7c057251e58717c5b00d5307287';
const RELEASE_HEAD='7f2ea82b0865bb64c8adbc3192e8547fe4f43c25';

function fail(code){throw new Error(code)}
function sha256(b){return crypto.createHash('sha256').update(b).digest('hex')}
function gitBlob(b){return crypto.createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex')}
function fileBytes(file){
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(file)!==file)fail('invalid_regular_file');
  return fs.readFileSync(file);
}
function atomic(file,bytes,mode=0o600){
  const tmp=file+'.txn-'+process.pid+'-'+Date.now();
  fs.writeFileSync(tmp,bytes,{flag:'wx',mode});
  fs.renameSync(tmp,file);
}
function persistJson(file,object){atomic(file,Buffer.from(JSON.stringify(object)+'\n'))}
function command(...args){
  const out=cp.spawnSync('/usr/bin/systemctl',args,{encoding:'utf8',timeout:90000,maxBuffer:20000});
  if(out.error||out.status!==0)fail('systemctl_failed:'+args[0]);
  return String(out.stdout||'').trim();
}
function verifyServiceGuard(){
  if(command('show',SERVICE,'-p','ProtectHome','--value')!=='yes')fail('resident_protecthome_drift');
  if(command('is-active',SERVICE)!=='active')fail('executor_inactive_before_activation');
}
function validateStageContract(stage){
  if(!stage||stage.action!=='rahekomak_host_action_repair_v2'
    ||stage.status!=='staged_pending_activation'
    ||stage.original_sha256!==OLD_SHA||stage.release_head!==RELEASE_HEAD
    ||stage.worker_git_blob!==WORKER_BLOB
    ||typeof stage.candidate_sha256!=='string'||!/^[a-f0-9]{64}$/.test(stage.candidate_sha256))
      fail('stage_contract_invalid');
  if(typeof stage.backup!=='string'||!new RegExp('^'+BACKUP_ROOT+'/[0-9]{14}-[0-9]+$').test(stage.backup))
      fail('stage_backup_scope_invalid');
  if(typeof stage.worker_preexisting!=='boolean')fail('stage_worker_presence_invalid');
  if(stage.worker_preexisting&&(!Number.isInteger(stage.worker_original_mode)||
      stage.worker_original_mode<0||stage.worker_original_mode>0o777))fail('stage_worker_mode_invalid');
  return stage;
}
function verifyStage(stage){
  validateStageContract(stage);
  if(sha256(fileBytes(path.join(stage.backup,'executor.before')))!==OLD_SHA)
      fail('stage_backup_sha_invalid');
  if(sha256(fileBytes(EXECUTOR))!==stage.candidate_sha256)
      fail('staged_executor_sha_drift');
  if(gitBlob(fileBytes(WORKER))!==WORKER_BLOB)fail('staged_worker_blob_drift');
  return stage;
}
function restoreOriginal(stage){
  // Only restore exact recorded candidate; never overwrite an unrelated change.
  if(sha256(fileBytes(EXECUTOR))!==stage.candidate_sha256)fail('rollback_live_drift');
  const original=fileBytes(path.join(stage.backup,'executor.before'));
  atomic(EXECUTOR,original,0o755);
  if(stage.worker_preexisting===true){
    const originalWorker=fileBytes(path.join(stage.backup,'worker.before'));
    atomic(WORKER,originalWorker,stage.worker_original_mode);
  }else{
    if(gitBlob(fileBytes(WORKER))!==WORKER_BLOB)fail('rollback_worker_drift');
    fs.unlinkSync(WORKER);
  }
  if(sha256(fileBytes(EXECUTOR))!==OLD_SHA)fail('rollback_executor_sha_failed');
}
function readStage(){
  if(fs.existsSync(RESULT))fail('activation_already_recorded');
  return verifyStage(JSON.parse(fileBytes(STAGE).toString('utf8')));
}
function probeHealth(){
  return new Promise((resolve,reject)=>{
    const req=http.get({socketPath:SOCKET,path:'/health',timeout:5000},res=>{
      const chunks=[];
      res.on('data',b=>chunks.push(b));
      res.on('end',()=>{
        if(res.statusCode!==200)return reject(new Error('health_status_not_200'));
        try{
          const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if(value.ok!==true||value.service!=='prhm-agent-selfmaint-exec')throw Error('health_contract_mismatch');
          resolve(value);
        }catch(e){reject(e)}
      });
    });
    req.on('timeout',()=>req.destroy(new Error('health_timeout')));
    req.on('error',reject);
  });
}
async function waitHealth(){
  let error;
  for(let i=0;i<8;i++){
    try{if(command('is-active',SERVICE)==='active')return await probeHealth()}catch(e){error=e}
    await new Promise(resolve=>setTimeout(resolve,750));
  }
  throw error||new Error('health_probe_failed');
}
async function activateApproved(){
  // This method cannot itself grant any approval. The registration bridge must
  // permit it only with a fresh signed and consumed Level-4 authorization.
  verifyServiceGuard();
  const stage=readStage();
  let attempted=false;
  try{
    attempted=true;
    command('restart',SERVICE);
    const health=await waitHealth();
    if(sha256(fileBytes(EXECUTOR))!==stage.candidate_sha256)fail('postactivation_sha_mismatch');
    const record={ok:true,action:ACTION,status:'activated',release_head:RELEASE_HEAD,
      source_sha256:OLD_SHA,installed_sha256:stage.candidate_sha256,
      target:EXECUTOR,service:SERVICE,health_ok:health.ok===true,
      time:new Date().toISOString(),rollback_performed:false};
    persistJson(RESULT,record);
    return record;
  }catch(err){
    let rollbackError=null;
    if(attempted){
      try{
        restoreOriginal(stage);
        command('restart',SERVICE);
        await waitHealth();
      }catch(e){rollbackError=String(e.message||e)}
    }
    const record={ok:false,action:ACTION,status:rollbackError?'rollback_failed':'rolled_back',
      release_head:RELEASE_HEAD,target:EXECUTOR,time:new Date().toISOString(),
      reason:String(err.message||err).slice(0,360),
      rollback_performed:attempted&&!rollbackError,rollback_failed:!!rollbackError,
      rollback_error:rollbackError};
    persistJson(RESULT,record);
    fail(rollbackError?'activation_failed_rollback_failed':'activation_failed_rolled_back');
  }
}
function manifest(){
  return Object.freeze({action:ACTION,level:4,risk:'critical',
    staged_installer_required:true,one_time_confirmation_required:true,
    fixed_service:SERVICE,live_file_preimage:OLD_SHA,
    release_head:RELEASE_HEAD,worker_git_blob:WORKER_BLOB,
    activation_policy:'separate_deferred_transient_unit_only',
    rollback_required:true,installer_status:'development_only'});
}
module.exports={ACTION,SERVICE,EXECUTOR,WORKER,STATE_ROOT,STAGE,RESULT,
  OLD_SHA,WORKER_BLOB,RELEASE_HEAD,sha256,gitBlob,validateStageContract,verifyStage,
  manifest,activateApproved};
if(require.main===module){
  if(process.argv.length===2){
    process.stdout.write(JSON.stringify(manifest())+'\n');
  }else if(process.argv.length===3&&process.argv[2]==='--activate'){
    activateApproved().then(r=>process.stdout.write(JSON.stringify(r)+'\n')).catch(e=>{
      process.stderr.write(String(e.message||e)+'\n');
      process.exitCode=1;
    });
  }else{
    process.stderr.write('invalid_activation_mode\n');
    process.exitCode=1;
  }
}
