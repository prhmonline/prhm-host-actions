#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');

const ACTION='leadops_control_plane_repair_v1';
const PATHS=Object.freeze({
  language:'/opt/prhm-agent-selfmaint-exec/actions/leadops-language-gate-v1.js',
  executor:'/opt/prhm-agent-selfmaint-exec/server.js',
  dropin:'/etc/systemd/system/prhm-p0-shadow-worker.service.d/runtime-directory.conf',
  result:'/var/lib/prhm-agent-selfmaint-exec/leadops-control-plane-repair-v1/latest.json',
  backupRoot:'/var/backups/prhm-leadops-control-plane-repair-v1'
});
const EXPECTED=Object.freeze({
  language:'94885041de12b4276bb4c8af1eb8cc6f4d41bdbeb5db9f2aa02341126f1cca71',
  executor:'1faccf7f9616cab326000f05845e7d09ccc0c81228c1175a39dcbdea87186be2'
});
const DROPIN='[Service]\nRuntimeDirectory=prhm-p0-shadow-worker\nRuntimeDirectoryMode=0750\n';

function shaBuffer(b){return crypto.createHash('sha256').update(b).digest('hex');}
function shaFile(f){return shaBuffer(fs.readFileSync(f));}
function fail(m){throw new Error(m);}
function countOf(text,needle){return text.split(needle).length-1;}
function replaceOnce(text,needle,replacement,label){const n=countOf(text,needle);if(n!==1)fail('patch_anchor_mismatch:'+label+':'+n);return text.replace(needle,replacement);}

function patchLanguageHelper(src){
  let out=src;
  out=replaceOnce(out,
    "function atomicReplace(file,text){const st=fs.statSync(file);const tmp=file+'.language-gate-'+process.pid+'-'+Date.now()+'.tmp';fs.writeFileSync(tmp,text,{mode:st.mode&0o777});fs.chownSync(tmp,st.uid,st.gid);fs.renameSync(tmp,file);}\nfunction main(){",
    "function atomicReplace(file,text){const st=fs.statSync(file);const tmp=file+'.language-gate-'+process.pid+'-'+Date.now()+'.tmp';fs.writeFileSync(tmp,text,{mode:st.mode&0o777});fs.chownSync(tmp,st.uid,st.gid);fs.renameSync(tmp,file);}\nfunction restoreParscodersTimer(wasActive){\n  if(wasActive){systemctl(['start','leadops-parscoders-v3.timer'],{timeout:15000});if(!waitActive('leadops-parscoders-v3.timer'))throw Error('parscoders_timer_restore_active_failed');return;}\n  systemctl(['stop','leadops-parscoders-v3.timer'],{allowFailure:true,timeout:15000});\n  const r=systemctl(['is-active','leadops-parscoders-v3.timer'],{allowFailure:true,timeout:10000});\n  if(String(r.stdout||'').trim()==='active')throw Error('parscoders_timer_restore_inactive_failed');\n}\nfunction main(){",
    'timer_restore_helper');
  out=replaceOnce(out,
    '  let backup=null,patched=false,agentRestarted=false;',
    '  let backup=null,patched=false,agentRestarted=false,timerWasActive=false,timerStateCaptured=false;',
    'timer_state_vars');
  out=replaceOnce(out,
    "    const svc=systemctl(['is-active','leadops-parscoders-v3.service'],{allowFailure:true,timeout:10000});if(String(svc.stdout||'').trim()==='active')throw Error('parscoders_v3_service_active_retry_later');\n    const pf=preflight();",
    "    const svc=systemctl(['is-active','leadops-parscoders-v3.service'],{allowFailure:true,timeout:10000});if(String(svc.stdout||'').trim()==='active')throw Error('parscoders_v3_service_active_retry_later');\n    const timerState=systemctl(['is-active','leadops-parscoders-v3.timer'],{allowFailure:true,timeout:10000});timerWasActive=String(timerState.stdout||'').trim()==='active';timerStateCaptured=true;\n    const pf=preflight();",
    'timer_state_capture');
  out=replaceOnce(out,
    "    if(!waitActive('prhm-agent-api.service'))throw Error('agent_api_not_active_after_scorer_v4');\n    if(!waitActive('leadops-parscoders-v3.timer'))throw Error('parscoders_timer_not_active_after_scorer_v4');\n    const migration=parseLastJson(psql(migrationSql()));",
    "    if(!waitActive('prhm-agent-api.service'))throw Error('agent_api_not_active_after_scorer_v4');\n    const migration=parseLastJson(psql(migrationSql()));",
    'remove_early_timer_reactivation');
  out=replaceOnce(out,
    "    if(Number(finalCheck.missing)!==0)throw Error('language_gate_postcheck_missing:'+finalCheck.missing);\n    const result={schema_version:'prhm.host-action-result.v1',ok:true,action:ACTION,finished_at:new Date().toISOString(),scorer_before_sha256:EXPECTED_V3_SHA,scorer_after_sha256:shaFile(SCORER),scoring_model:'rules-v4-parscoders',language_codes:'ISO-639-1 lowercase',migration,remaining_waiting_missing_language:0,timer:'leadops-parscoders-v3.timer',timer_active:true,p0_live:false,proposal_send:false,bid_send:false,backup_path:backup,rollback_performed:false,preflight:pf.targets};",
    "    if(Number(finalCheck.missing)!==0)throw Error('language_gate_postcheck_missing:'+finalCheck.missing);\n    restoreParscodersTimer(timerWasActive);\n    const result={schema_version:'prhm.host-action-result.v1',ok:true,action:ACTION,finished_at:new Date().toISOString(),scorer_before_sha256:EXPECTED_V3_SHA,scorer_after_sha256:shaFile(SCORER),scoring_model:'rules-v4-parscoders',language_codes:'ISO-639-1 lowercase',migration,remaining_waiting_missing_language:0,timer:'leadops-parscoders-v3.timer',timer_active:timerWasActive,p0_live:false,proposal_send:false,bid_send:false,backup_path:backup,rollback_performed:false,preflight:pf.targets};",
    'success_timer_restore');
  out=replaceOnce(out,
    "    try{systemctl(['restart','prhm-agent-api.service'],{timeout:30000});if(!waitActive('prhm-agent-api.service'))throw Error('agent_api_not_active')}catch(e){rollbackErrors.push('agent_api:'+e.message)}\n    if(rollbackErrors.length)",
    "    try{systemctl(['restart','prhm-agent-api.service'],{timeout:30000});if(!waitActive('prhm-agent-api.service'))throw Error('agent_api_not_active')}catch(e){rollbackErrors.push('agent_api:'+e.message)}\n    if(timerStateCaptured){try{restoreParscodersTimer(timerWasActive)}catch(e){rollbackErrors.push('timer:'+e.message)}}\n    if(rollbackErrors.length)",
    'rollback_timer_restore');
  if(!out.includes('SELECT CASE WHEN count(*)<=${MAX_TARGETS} THEN 1 ELSE 1/0 END'))fail('target_limit_assertion_lost');
  return out;
}

function patchExecutor(src){
  return replaceOnce(src,
    "    '--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6',\n    '--property=ReadWritePaths=/opt/prhm-p0-shadow-worker /opt/prhm-p0-fixed-executor/migrations /var/lib/prhm-agent-selfmaint-exec /run/prhm-p0-shadow-worker',",
    "    '--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6',\n    '--property=RuntimeDirectory=prhm-p0-shadow-worker',\n    '--property=RuntimeDirectoryMode=0750',\n    '--property=ReadWritePaths=/opt/prhm-p0-shadow-worker /opt/prhm-p0-fixed-executor/migrations /var/lib/prhm-agent-selfmaint-exec /run/prhm-p0-shadow-worker',",
    'economics_runtime_directory');
}

function exec(file,args,{allowFailure=false,timeout=30000}={}){const r=cp.spawnSync(file,args,{encoding:'utf8',timeout,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']});if(r.error)fail('exec_error:'+path.basename(file)+':'+r.error.message);if(!allowFailure&&r.status!==0)fail('exec_failed:'+path.basename(file)+':'+r.status+':'+String(r.stderr||r.stdout||'').slice(0,1500));return r;}
function systemctl(args,{allowFailure=false,timeout=30000}={}){return exec('/usr/bin/systemctl',args,{allowFailure,timeout});}
function atomicWrite(file,bytes,mode){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o755});const tmp=file+'.leadops-repair-'+process.pid+'-'+Date.now()+'.tmp';fs.writeFileSync(tmp,bytes,{mode,flag:'wx'});fs.fsyncSync(fs.openSync(tmp,'r'));fs.renameSync(tmp,file);fs.chmodSync(file,mode);}
function nodeCheck(bytes,label){const r=cp.spawnSync('/usr/local/bin/prhm-node',['--check','-'],{input:bytes,encoding:'utf8',timeout:15000,maxBuffer:200000});if(r.error||r.status!==0)fail('syntax_failed:'+label+':'+String(r.stderr||r.stdout||'').slice(0,1000));}
function persist(result){atomicWrite(PATHS.result,Buffer.from(JSON.stringify(result,null,2)+'\n'),0o600);}

function preflight(){
  if(shaFile(PATHS.language)!==EXPECTED.language)fail('language_baseline_drift:'+shaFile(PATHS.language));
  if(shaFile(PATHS.executor)!==EXPECTED.executor)fail('executor_baseline_drift:'+shaFile(PATHS.executor));
  if(fs.existsSync(PATHS.dropin)){const d=fs.readFileSync(PATHS.dropin,'utf8');if(d!==DROPIN)fail('runtime_dropin_conflict');}
  const language=patchLanguageHelper(fs.readFileSync(PATHS.language,'utf8'));
  const executor=patchExecutor(fs.readFileSync(PATHS.executor,'utf8'));
  nodeCheck(Buffer.from(language),'language');nodeCheck(Buffer.from(executor),'executor');
  return {ok:true,action:ACTION,schema_version:'prhm.host-action-preflight.v1',preflight_only:true,production_mutation:false,database_mutation:false,business_mutation:false,language_before_sha256:EXPECTED.language,language_after_sha256:shaBuffer(Buffer.from(language)),executor_before_sha256:EXPECTED.executor,executor_after_sha256:shaBuffer(Buffer.from(executor)),dropin_sha256:shaBuffer(Buffer.from(DROPIN)),language_target_limit_assertion_preserved:true,economics_runtime_directory:'prhm-p0-shadow-worker'};
}

function apply(){
  const pf=preflight();
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const backupDir=path.join(PATHS.backupRoot,stamp);fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
  const oldLanguage=fs.readFileSync(PATHS.language);const oldExecutor=fs.readFileSync(PATHS.executor);const dropinExisted=fs.existsSync(PATHS.dropin);const oldDropin=dropinExisted?fs.readFileSync(PATHS.dropin):null;
  fs.writeFileSync(path.join(backupDir,'language.bak'),oldLanguage,{mode:0o600,flag:'wx'});fs.writeFileSync(path.join(backupDir,'executor.bak'),oldExecutor,{mode:0o600,flag:'wx'});if(oldDropin)fs.writeFileSync(path.join(backupDir,'runtime-directory.conf.bak'),oldDropin,{mode:0o600,flag:'wx'});
  let mutated=false;
  try{
    atomicWrite(PATHS.language,Buffer.from(patchLanguageHelper(oldLanguage.toString('utf8'))),0o700);
    atomicWrite(PATHS.executor,Buffer.from(patchExecutor(oldExecutor.toString('utf8'))),0o755);
    atomicWrite(PATHS.dropin,Buffer.from(DROPIN),0o644);mutated=true;
    systemctl(['daemon-reload']);
    systemctl(['restart','prhm-agent-selfmaint-exec.service'],{timeout:60000});
    const active=systemctl(['is-active','prhm-agent-selfmaint-exec.service']);if(String(active.stdout||'').trim()!=='active')fail('executor_service_not_active');
    const show=systemctl(['show','prhm-p0-shadow-worker.service','--no-pager','--property=RuntimeDirectory']);if(!String(show.stdout||'').includes('prhm-p0-shadow-worker'))fail('runtime_directory_not_loaded');
    if(shaFile(PATHS.language)!==pf.language_after_sha256)fail('language_post_sha_mismatch');
    if(shaFile(PATHS.executor)!==pf.executor_after_sha256)fail('executor_post_sha_mismatch');
    const result={ok:true,action:ACTION,schema_version:'prhm.host-action-result.v1',finished_at:new Date().toISOString(),installed:true,rollback_performed:false,backup_dir:backupDir,language_before_sha256:EXPECTED.language,language_after_sha256:pf.language_after_sha256,executor_before_sha256:EXPECTED.executor,executor_after_sha256:pf.executor_after_sha256,dropin_sha256:pf.dropin_sha256,runtime_directory:'prhm-p0-shadow-worker',language_timer_state_preserved:true,language_target_limit_assertion_preserved:true,database_mutation:false,business_mutation:false,p0_live:false,proposal_send:false,bid_send:false};persist(result);return result;
  }catch(error){
    const rb=[];
    if(mutated){try{atomicWrite(PATHS.language,oldLanguage,0o700)}catch(e){rb.push('language:'+e.message)}try{atomicWrite(PATHS.executor,oldExecutor,0o755)}catch(e){rb.push('executor:'+e.message)}try{if(dropinExisted)atomicWrite(PATHS.dropin,oldDropin,0o644);else if(fs.existsSync(PATHS.dropin))fs.unlinkSync(PATHS.dropin)}catch(e){rb.push('dropin:'+e.message)}try{systemctl(['daemon-reload']);systemctl(['restart','prhm-agent-selfmaint-exec.service'],{timeout:60000})}catch(e){rb.push('service:'+e.message)}}
    if(rb.length)fail('leadops_control_plane_repair_failed_and_rollback_failed:'+error.message+':'+rb.join('|'));
    fail('leadops_control_plane_repair_failed_rolled_back:'+error.message);
  }
}

function main(argv=process.argv.slice(2)){if(argv.length!==1||!['--preflight-only','--apply'].includes(argv[0]))fail('unexpected_arguments');const out=argv[0]==='--preflight-only'?preflight():apply();process.stdout.write(JSON.stringify(out)+'\n');return out;}
if(require.main===module){try{main()}catch(e){process.stderr.write(String(e.stack||e)+'\n');process.exit(1)}}
module.exports={ACTION,PATHS,EXPECTED,DROPIN,patchLanguageHelper,patchExecutor,preflight,apply,main};
