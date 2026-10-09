'use strict';

/**
 * RahKomak web-only Host Action registry, atomic installer candidate.
 * No standalone apply command. Execution must originate in a separately
 * authenticated, single-use Level-4 control-plane host action.
 */
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const registry=require('./rahekomak-web-only-host-action-registry-candidate-v1.js');

const ACTION='rahekomak_web_only_registry_install_v1';
const BACKUP_ROOT='/var/backups/prhm-rahekomak-web-only-registry-v1';
const PATHS=Object.freeze({
 base:'/opt/prhm-agent-selfmaint/server.js',
 executor:'/opt/prhm-agent-selfmaint-exec/server.js',
 mcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
 policy:'/opt/prhm-company-control-plane/config/approval-policy.json'
});
const SERVICES=Object.freeze([
 'prhm-agent-selfmaint.service',
 'prhm-agent-selfmaint-exec.service',
 'prhm-agent-mcp-blue.service',
 'prhm-agent-mcp-green.service'
]);
const KEYS=Object.freeze(['base','executor','mcp','policy']);

function fail(error){throw new Error(error)}
function sha(bytes){return crypto.createHash('sha256').update(bytes).digest('hex')}
function checkStagedApproval(proof){
 if(!proof||proof.action!==ACTION||proof.level!==4||proof.risk!=='critical'||
    proof.verified_by_trusted_mediator!==true||proof.one_time_token_consumed!==true||
    proof.second_confirmation_valid!==true||
    proof.pinned_application_sha!==registry.SHA)fail('trusted_level4_mediator_approval_required');
 return true;
}
function validatePath(file,st,real){
 if(!st||!st.isFile()||st.isSymbolicLink()||real!==file)fail('source_path_invalid:'+file);
 if((st.mode&0o002)!==0)fail('world_writable_source:'+file);
}
function readPreimages(io=fs){
 const sources={},files={};
 for(const key of KEYS){
  const filename=PATHS[key];
  const st=io.lstatSync(filename);validatePath(filename,st,io.realpathSync(filename));
  const buf=io.readFileSync(filename);
  if(sha(buf)!==registry.PINNED[key])fail('current_preimage_sha_mismatch:'+key);
  sources[key]=buf.toString('utf8');
  files[key]={path:filename,mode:st.mode&0o777,uid:st.uid,gid:st.gid,sha256:sha(buf),bytes:buf};
 }
 return {sources,files};
}
function planRegistration(snapshot){
 const builder=registry.buildCandidates(snapshot.sources);
 for(const key of KEYS){
  if(builder.preimage_sha256[key]!==snapshot.files[key].sha256)fail('preflight_sha_drift:'+key);
  if(typeof builder.candidates[key]!=='string'||!builder.candidates[key].length)fail('empty_candidate:'+key);
 }
 return {action:ACTION,application_sha:registry.SHA,
  helper_sha256:registry.HELPER_SHA,candidate_sha256:builder.candidate_sha256,
  inputs:snapshot.files,candidates:builder.candidates};
}
function checkCurrent(plan,io=fs){
 for(const key of KEYS){
  const f=plan.inputs[key],filename=PATHS[key],st=io.lstatSync(filename);
  validatePath(filename,st,io.realpathSync(filename));
  if(st.uid!==f.uid||st.gid!==f.gid||(st.mode&0o777)!==f.mode)fail('owner_or_mode_drift:'+key);
  if(sha(io.readFileSync(filename))!==f.sha256)fail('concurrent_drift:'+key);
 }
}
function atomicReplace(filename,bytes,owner,io=fs){
 const tmp=path.join(path.dirname(filename),'.'+path.basename(filename)+'.rahkomak-'+process.pid+'-'+Date.now()+'.tmp');
 let created=false;
 try{
  io.writeFileSync(tmp,bytes,{mode:owner.mode,flag:'wx'});created=true;
  io.chownSync(tmp,owner.uid,owner.gid);
  io.chmodSync(tmp,owner.mode);
  io.renameSync(tmp,filename);created=false;
 }finally{
  if(created)try{io.unlinkSync(tmp)}catch{}
 }
}
function executeTransaction(plan,{io=fs,restart,health,approval,backupDir}={}){
 // This function has NO CLI entrypoint. Only a separate authenticated
 // typed Host Action mediator may pass its verified Level-4 approval context.
 checkStagedApproval(approval);
 if(typeof restart!=='function'||typeof health!=='function')fail('verified_restart_and_health_required');
 if(!backupDir||path.dirname(path.resolve(backupDir))!==BACKUP_ROOT||
    !/^[a-zA-Z0-9-]{8,120}$/.test(path.basename(backupDir)))
   fail('backup_root_not_allowlisted');
 checkCurrent(plan,io);
 io.mkdirSync(BACKUP_ROOT,{recursive:true,mode:0o700});
 io.mkdirSync(backupDir,{recursive:false,mode:0o700});
 const written=[];
 let didRollback=false,rollbackErrors=[];
 try{
  // Durable exact byte copies of ALL files are persisted before first edit.
  for(const key of KEYS){
   const file=plan.inputs[key];
   io.writeFileSync(path.join(backupDir,key+'.bak'),file.bytes,{mode:0o600,flag:'wx'});
  }
  for(const key of KEYS){
   const file=plan.inputs[key];
   atomicReplace(file.path,Buffer.from(plan.candidates[key],'utf8'),file,io);
   written.push(key);
   if(sha(io.readFileSync(file.path))!==plan.candidate_sha256[key])
     fail('candidate_postwrite_sha_mismatch:'+key);
  }
  for(const service of SERVICES){restart(service);health(service)}
  const result={ok:true,action:ACTION,application_sha:registry.SHA,
   status:'registered',registered_in:KEYS,services_checked:SERVICES,
   database_changed:false,production_site_changed:false,
   backup_dir:backupDir,rollback_performed:false,candidate_sha256:plan.candidate_sha256};
  io.writeFileSync(path.join(backupDir,'result.json'),JSON.stringify(result,null,2),{mode:0o600,flag:'wx'});
  return result;
 }catch(error){
  // Roll back every possibly-modified file; keep all backups for audit.
  for(const key of [...written].reverse()){
   const file=plan.inputs[key];
   try{
    const backup=io.readFileSync(path.join(backupDir,key+'.bak'));
    if(sha(backup)!==file.sha256)fail('rollback_backup_sha_mismatch:'+key);
    atomicReplace(file.path,backup,file,io);
    if(sha(io.readFileSync(file.path))!==file.sha256)fail('rollback_postwrite_sha_mismatch:'+key);
   }catch(e){rollbackErrors.push(key+':'+String(e.message))}
  }
  if(written.length>0)try{
   for(const service of SERVICES){restart(service);health(service)}
  }catch(e){rollbackErrors.push('restart:'+String(e.message))}
  didRollback=written.length>0&&rollbackErrors.length===0;
  const failed={ok:false,action:ACTION,status:'failed',error:String(error.message),
   backup_dir:backupDir,rollback_performed:didRollback,rollback_errors:rollbackErrors};
  try{io.writeFileSync(path.join(backupDir,'result.json'),JSON.stringify(failed,null,2),{mode:0o600,flag:'wx'})}catch(e){
   rollbackErrors.push('result_persist:'+String(e.message));
  }
  fail('registration_failed:'+error.message+(rollbackErrors.length?':ROLLBACK_INCOMPLETE:'+rollbackErrors.join('|'):':ROLLED_BACK'));
 }
}
function preflightSummary(io=fs){
 const snapshot=readPreimages(io);
 const p=planRegistration(snapshot);
 return {ok:true,action:ACTION,application_sha:p.application_sha,
  helper_sha256:p.helper_sha256,mode:'read_only_preflight',
  existing_sha256:Object.fromEntries(KEYS.map(k=>[k,p.inputs[k].sha256])),
  candidate_sha256:p.candidate_sha256,installed:false,
  database_changed:false,production_site_changed:false};
}
function main(){
 const mode=process.argv[2];
 if(process.argv.length!==3||!['--contract','--preflight'].includes(mode))
  fail('no_standalone_apply_approval_mediator_required');
 if(mode==='--contract')return {ok:true,action:ACTION,approval_level:4,
  mode:'candidate_only',live_apply_available:false,mutates_production:false,
  target_paths:PATHS,services:SERVICES,helper_sha256:registry.HELPER_SHA,
  application_sha:registry.SHA};
 return preflightSummary();
}
if(require.main===module){
 try{process.stdout.write(JSON.stringify(main())+'\n')}
 catch(e){process.stderr.write('REGISTRATION_CANDIDATE_FAIL_CLOSED:'+e.message+'\n');process.exitCode=78}
}
module.exports={ACTION,BACKUP_ROOT,PATHS,SERVICES,KEYS,sha,
 checkStagedApproval,validatePath,readPreimages,planRegistration,
 checkCurrent,atomicReplace,executeTransaction,preflightSummary,main};
