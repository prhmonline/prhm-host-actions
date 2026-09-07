#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const ACTION='leadops_language_gate_repair_v2';
const TARGET='/opt/prhm-agent-selfmaint-exec/actions/leadops-language-gate-v1.js';
const EXPECTED_SHA='87013c001e572931ae425e54109dccfeca14612af8589aa937f40fd5d21343b1';
const BACKUP_ROOT='/var/backups/prhm-leadops-language-gate-repair-v2';
const RESULT='/var/lib/prhm-agent-selfmaint-exec/leadops-language-gate-repair-v2/latest.json';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(m){throw new Error(m)}
function once(s,a,b,l){const n=s.split(a).length-1;if(n!==1)fail('anchor_mismatch:'+l+':'+n);return s.replace(a,b)}
function patchSource(src){
 let out=src;
 out=once(out,"BEGIN;\nCREATE TEMP TABLE leadops_language_gate_targets ON COMMIT DROP AS", "BEGIN;\nLOCK TABLE automation.outbox_events IN SHARE ROW EXCLUSIVE MODE;\nLOCK TABLE marketplace.opportunities IN SHARE ROW EXCLUSIVE MODE;\nCREATE TEMP TABLE leadops_language_gate_targets ON COMMIT DROP AS",'db_locks');
 out=once(out,"SELECT CASE WHEN count(*)<=${MAX_TARGETS} THEN 1 ELSE 1/0 END FROM leadops_language_gate_targets;", "SELECT 1 / CASE WHEN count(*)<=${MAX_TARGETS} THEN 1 ELSE 0 END FROM leadops_language_gate_targets;",'target_limit_assertion');
 const zero="SELECT CASE WHEN count(*)=0 THEN 1 ELSE 1/0 END";
 if((out.split(zero).length-1)!==2)fail('zero_assertion_count');
 out=out.split(zero).join("SELECT 1 / CASE WHEN count(*)=0 THEN 1 ELSE 0 END");
 out=once(out,"    systemctl(['stop','leadops-parscoders-v3.timer'],{allowFailure:true,timeout:15000});\n", "",'no_timer_stop');
 out=once(out,"    restoreParscodersTimer(timerWasActive);\n    const result=", "    const result=",'no_success_timer_restore');
 out=once(out,"    if(timerStateCaptured){try{restoreParscodersTimer(timerWasActive)}catch(e){rollbackErrors.push('timer:'+e.message)}}\n", "",'no_rollback_timer_restore');
 if(out.includes("systemctl(['stop','leadops-parscoders-v3.timer']"))fail('timer_stop_remaining');
 if(out.includes('ELSE 1/0 END'))fail('constant_fold_assertion_remaining');
 if(!out.includes('LOCK TABLE automation.outbox_events IN SHARE ROW EXCLUSIVE MODE'))fail('outbox_lock_missing');
 if(!out.includes('LOCK TABLE marketplace.opportunities IN SHARE ROW EXCLUSIVE MODE'))fail('opportunity_lock_missing');
 return out;
}
function nodeCheck(bytes){const r=cp.spawnSync('/usr/local/bin/prhm-node',['--check','-'],{input:bytes,encoding:null,timeout:10000});if(r.error||r.status!==0)fail('syntax_invalid:'+String(r.stderr||''))}
function atomic(file,bytes,st){const tmp=file+'.leadops-v2-'+process.pid+'-'+Date.now()+'.tmp';fs.writeFileSync(tmp,bytes,{mode:st.mode&0o777,flag:'wx'});fs.chownSync(tmp,st.uid,st.gid);fs.renameSync(tmp,file)}
function preflight(){const bytes=fs.readFileSync(TARGET),cur=sha(bytes);if(cur!==EXPECTED_SHA)fail('baseline_sha_mismatch:'+cur);const next=Buffer.from(patchSource(bytes.toString('utf8')));nodeCheck(next);return{ok:true,action:ACTION,schema_version:'prhm.host-action-preflight.v1',preflight_only:true,production_mutation:false,database_mutation:false,business_mutation:false,before_sha256:cur,after_sha256:sha(next),transaction_locks:true,transient_timer_preserved:true,constant_fold_assertions_removed:true}}
function apply(){const pf=preflight(),st=fs.statSync(TARGET),old=fs.readFileSync(TARGET),next=Buffer.from(patchSource(old.toString('utf8'))),stamp=new Date().toISOString().replace(/[:.]/g,'-'),dir=path.join(BACKUP_ROOT,stamp);fs.mkdirSync(dir,{recursive:true,mode:0o700});const backup=path.join(dir,'leadops-language-gate-v1.js.bak');fs.writeFileSync(backup,old,{mode:0o600,flag:'wx'});let wrote=false;try{atomic(TARGET,next,st);wrote=true;nodeCheck(fs.readFileSync(TARGET));const final=sha(fs.readFileSync(TARGET));if(final!==pf.after_sha256)fail('post_sha_mismatch');const result={ok:true,action:ACTION,schema_version:'prhm.host-action-result.v1',installed:true,rollback_performed:false,before_sha256:pf.before_sha256,after_sha256:final,backup_path:backup,transaction_locks:true,transient_timer_preserved:true,constant_fold_assertions_removed:true,database_mutation:false,business_mutation:false};fs.mkdirSync(path.dirname(RESULT),{recursive:true,mode:0o700});fs.writeFileSync(RESULT,JSON.stringify(result)+'\n',{mode:0o600});return result}catch(e){if(wrote)atomic(TARGET,old,st);fail('repair_failed_rolled_back:'+e.message)}}
function main(){const a=process.argv.slice(2);if(a.length!==1||!['--preflight-only','--apply'].includes(a[0]))fail('unexpected_arguments');console.log(JSON.stringify(a[0]==='--preflight-only'?preflight():apply()))}
module.exports={ACTION,TARGET,EXPECTED_SHA,patchSource,preflight,apply};
if(require.main===module){try{main()}catch(e){console.error(String(e.stack||e));process.exit(1)}}
