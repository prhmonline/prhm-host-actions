#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const ACTION='real_market_shadow_uat_historical_replay_repair_v24';
const TARGET='/opt/prhm-agent-selfmaint-exec/actions/real-market-shadow-uat-v1.js';
const EXPECTED_SHA='2fe6f9546ea6d14ab2d883433714ef5a543f643ba3685dfff1e4294a35f0733b';
const EXPECTED_AFTER_SHA='895a40fe9aebd0f2d404f73e0604e5b1844510dd18b2c4ce7ea611f6e6a1413c';
const REPLAY_NOW='2026-08-13T12:08:38.414617Z';
const BACKUP_ROOT='/var/backups/prhm-real-market-shadow-uat-v24';
const RESULT='/var/lib/prhm-agent-selfmaint-exec/real-market-shadow-uat-v24/latest.json';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(m){throw new Error(m)}
function once(s,a,b,label){const n=s.split(a).length-1;if(n!==1)fail('anchor_mismatch:'+label+':'+n);return s.replace(a,b)}
function patchSource(src){const sourceSha=sha(Buffer.from(src));let out=src;out=once(out,"const EVAL_ID='8c74a9fb-64fe-4161-a4db-0e0697912012';\n","const EVAL_ID='8c74a9fb-64fe-4161-a4db-0e0697912012';\nconst REPLAY_NOW='2026-08-13T12:08:38.414617Z';\n",'replay_constant');const tail="out=replaceOnce(out,a,b,'candidate_filter');return out}";const replacement="out=replaceOnce(out,a,b,'candidate_filter');const timeAnchor=\"  const now =\\n    new Date()\\n      .toISOString();\";const timeReplacement=\"  const now =\\n    '2026-08-13T12:08:38.414617Z';\";out=replaceOnce(out,timeAnchor,timeReplacement,'historical_replay_now');return out}";out=once(out,tail,replacement,'patch_worker_replay');out=once(out,"service_category:'EDITING',resolved_economics_count:0,expected_decision:'ASK_CLARIFICATION'","service_category:'EDITING',resolved_economics_count:0,replay_now:REPLAY_NOW,expected_decision:'ASK_CLARIFICATION'",'preflight_replay_metadata');out=once(out,"service_category:'EDITING'},decision:'ASK_CLARIFICATION'","service_category:'EDITING'},replay_now:REPLAY_NOW,decision:'ASK_CLARIFICATION'",'result_replay_metadata');if(!out.includes("'historical_replay_now'"))fail('replay_patch_missing');if(!out.includes('replay_now:REPLAY_NOW'))fail('replay_metadata_missing');if(sourceSha===EXPECTED_SHA&&sha(Buffer.from(out))!==EXPECTED_AFTER_SHA)fail('candidate_sha_mismatch:'+sha(Buffer.from(out)));return out}
function nodeCheck(bytes){const node=process.execPath;const r=cp.spawnSync(node,['--check','-'],{input:bytes,encoding:null,timeout:10000});if(r.error||r.status!==0)fail('syntax_invalid:'+String(r.stderr||''))}
function atomic(file,bytes,st){const tmp=file+'.v24-'+process.pid+'-'+Date.now()+'.tmp';fs.writeFileSync(tmp,bytes,{mode:st.mode&0o777,flag:'wx'});fs.chownSync(tmp,st.uid,st.gid);fs.renameSync(tmp,file)}
function preflight(){const old=fs.readFileSync(TARGET),cur=sha(old);if(cur!==EXPECTED_SHA)fail('baseline_sha_mismatch:'+cur);const next=Buffer.from(patchSource(old.toString('utf8')));nodeCheck(next);return{ok:true,action:ACTION,schema_version:'prhm.host-action-preflight.v1',preflight_only:true,production_mutation:false,database_mutation:false,business_mutation:false,before_sha256:cur,after_sha256:sha(next),replay_now:REPLAY_NOW,production_worker_mutation:false,temp_worker_replay_only:true}}
function apply(){const pf=preflight(),st=fs.statSync(TARGET),old=fs.readFileSync(TARGET),next=Buffer.from(patchSource(old.toString('utf8'))),stamp=new Date().toISOString().replace(/[:.]/g,'-'),dir=path.join(BACKUP_ROOT,stamp);fs.mkdirSync(dir,{recursive:true,mode:0o700});const backup=path.join(dir,'real-market-shadow-uat-v1.js.bak');fs.writeFileSync(backup,old,{mode:0o600,flag:'wx'});try{atomic(TARGET,next,st);nodeCheck(fs.readFileSync(TARGET));const after=sha(fs.readFileSync(TARGET));if(after!==EXPECTED_AFTER_SHA)fail('post_sha_mismatch:'+after);const result={ok:true,action:ACTION,schema_version:'prhm.host-action-result.v1',installed:true,rollback_performed:false,before_sha256:pf.before_sha256,after_sha256:after,backup_path:backup,replay_now:REPLAY_NOW,production_worker_mutation:false,temp_worker_replay_only:true,database_mutation:false,business_mutation:false};fs.mkdirSync(path.dirname(RESULT),{recursive:true,mode:0o700});fs.writeFileSync(RESULT,JSON.stringify(result)+'\n',{mode:0o600});return result}catch(e){try{atomic(TARGET,old,st)}catch{}throw e}}
function main(){if(process.argv.includes('--preflight-only')){console.log(JSON.stringify(preflight()));return}if(process.argv.includes('--apply')){console.log(JSON.stringify(apply()));return}fail('expected_--preflight-only_or_--apply')}
if(require.main===module){try{main()}catch(e){console.error(e&&e.stack||e);process.exit(1)}}
module.exports={patchSource,EXPECTED_SHA,EXPECTED_AFTER_SHA,REPLAY_NOW};
