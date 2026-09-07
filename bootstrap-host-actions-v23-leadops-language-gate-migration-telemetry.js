#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const ACTION='leadops_language_gate_migration_telemetry_repair_v23';
const TARGET='/opt/prhm-agent-selfmaint-exec/actions/leadops-language-gate-v1.js';
const EXPECTED_SHA='00b5e035f823f65156e1ebd04c0f9de1367efe230de8c9fcb5438c6159d90a72';
const BACKUP_ROOT='/var/backups/prhm-leadops-language-gate-v23';
const RESULT='/var/lib/prhm-agent-selfmaint-exec/leadops-language-gate-v23/latest.json';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(m){throw Error(m)}
function once(s,a,b,l){const n=s.split(a).length-1;if(n!==1)fail('anchor_mismatch:'+l+':'+n);return s.replace(a,b)}
function patchSource(src){
  let out=src;
  out=once(out,
    "    const migration=parseLastJson(psql(migrationSql()));",
    "    const migrationOutput=psql(migrationSql());\n    const migration={committed:true,output_sha256:shaBuffer(Buffer.from(migrationOutput)),output_bytes:Buffer.byteLength(migrationOutput)};",
    'migration_stdout_not_gate');
  if(out.includes('const migration=parseLastJson(psql(migrationSql()))'))fail('legacy_migration_parse_remaining');
  if(!out.includes('const finalCheck=parseLastJson(psql(detectionSql(),{readOnly:true}))'))fail('postcheck_parse_missing');
  if(!out.includes("if(Number(finalCheck.missing)!==0)throw Error('language_gate_postcheck_missing:'"))fail('postcheck_guard_missing');
  return out;
}
function nodeCheck(bytes){const r=cp.spawnSync('/usr/local/bin/prhm-node',['--check','-'],{input:bytes,encoding:null,timeout:10000});if(r.error||r.status!==0)fail('syntax_invalid:'+String(r.stderr||''))}
function preflight(){const old=fs.readFileSync(TARGET),cur=sha(old);if(cur!==EXPECTED_SHA)fail('baseline_sha_mismatch:'+cur);const next=Buffer.from(patchSource(old.toString('utf8')));nodeCheck(next);return{ok:true,action:ACTION,schema_version:'prhm.host-action-preflight.v1',preflight_only:true,production_mutation:false,database_mutation:false,business_mutation:false,before_sha256:cur,after_sha256:sha(next),migration_stdout_required:false,postcheck_required:true}}
function atomic(file,bytes,st){const tmp=file+'.v23-'+process.pid+'-'+Date.now()+'.tmp';fs.writeFileSync(tmp,bytes,{mode:st.mode&0o777,flag:'wx'});fs.chownSync(tmp,st.uid,st.gid);fs.renameSync(tmp,file)}
function apply(){const pf=preflight(),old=fs.readFileSync(TARGET),st=fs.statSync(TARGET),next=Buffer.from(patchSource(old.toString('utf8'))),dir=path.join(BACKUP_ROOT,new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(dir,{recursive:true,mode:0o700});const backup=path.join(dir,'leadops-language-gate-v1.js.bak');fs.writeFileSync(backup,old,{mode:0o600,flag:'wx'});let done=false;try{atomic(TARGET,next,st);done=true;const after=sha(fs.readFileSync(TARGET));if(after!==pf.after_sha256)fail('post_sha_mismatch:'+after);const result={ok:true,action:ACTION,schema_version:'prhm.host-action-result.v1',installed:true,rollback_performed:false,before_sha256:pf.before_sha256,after_sha256:after,backup_path:backup,migration_stdout_required:false,postcheck_required:true,database_mutation:false,business_mutation:false};fs.mkdirSync(path.dirname(RESULT),{recursive:true,mode:0o700});fs.writeFileSync(RESULT,JSON.stringify(result)+'\n',{mode:0o600});console.log(JSON.stringify(result));}catch(e){if(done)atomic(TARGET,old,st);throw e}}
function main(){if(process.argv.includes('--preflight-only')){console.log(JSON.stringify(preflight()));return}if(process.argv.includes('--apply')){apply();return}fail('usage')}
if(require.main===module)main();
module.exports={patchSource,EXPECTED_SHA};
