#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const ACTION='leadops_language_gate_summary_parser_repair_v22';
const TARGET='/opt/prhm-agent-selfmaint-exec/actions/leadops-language-gate-v1.js';
const EXPECTED_SHA='bc5b41039d3928d1062f7d545b932123ecd3a8733881703965430394d7a0af5f';
const BACKUP_ROOT='/var/backups/prhm-leadops-language-gate-summary-parser-v22';
const RESULT='/var/lib/prhm-agent-selfmaint-exec/leadops-language-gate-summary-parser-v22/latest.json';
const MARKER='__LEADOPS_JSON__';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(m){throw new Error(m)}
function once(s,a,b,l){const n=s.split(a).length-1;if(n!==1)fail('anchor_mismatch:'+l+':'+n);return s.replace(a,b)}
function patchSource(src){
 let out=src;
 const oldParser="function parseLastJson(text){const lines=String(text||'').split(/\\r?\\n/).map(x=>x.trim()).filter(Boolean);for(let i=lines.length-1;i>=0;i--){try{return JSON.parse(lines[i]);}catch{}}throw Error('json_summary_missing');}";
 const newParser="function parseLastJson(text){const lines=String(text||'').split(/\\r?\\n/).map(x=>x.trim()).filter(Boolean);for(let i=lines.length-1;i>=0;i--){const p=lines[i].indexOf('__LEADOPS_JSON__');if(p<0)continue;const payload=lines[i].slice(p+'__LEADOPS_JSON__'.length).trim();try{return JSON.parse(payload);}catch(e){throw Error('json_summary_invalid:'+e.message);}}throw Error('json_summary_marker_missing');}";
 out=once(out,oldParser,newParser,'marker_parser');
 const needle='SELECT json_build_object(';
 const count=out.split(needle).length-1;
 if(count!==2)fail('summary_select_count:'+count);
 out=out.split(needle).join("SELECT '__LEADOPS_JSON__'||json_build_object(");
 if((out.split(MARKER).length-1)!==4)fail('marker_occurrence_count');
 if(out.includes("throw Error('json_summary_missing')"))fail('legacy_parser_remaining');
 return out;
}
function nodeCheck(bytes){const r=cp.spawnSync('/usr/local/bin/prhm-node',['--check','-'],{input:bytes,encoding:null,timeout:10000});if(r.error||r.status!==0)fail('syntax_invalid:'+String(r.stderr||''))}
function atomic(file,bytes,st){const tmp=file+'.v22-'+process.pid+'-'+Date.now()+'.tmp';fs.writeFileSync(tmp,bytes,{mode:st.mode&0o777,flag:'wx'});fs.chownSync(tmp,st.uid,st.gid);fs.renameSync(tmp,file)}
function preflight(){const old=fs.readFileSync(TARGET),cur=sha(old);if(cur!==EXPECTED_SHA)fail('baseline_sha_mismatch:'+cur);const next=Buffer.from(patchSource(old.toString('utf8')));nodeCheck(next);return{ok:true,action:ACTION,schema_version:'prhm.host-action-preflight.v1',preflight_only:true,production_mutation:false,database_mutation:false,business_mutation:false,before_sha256:cur,after_sha256:sha(next),summary_marker:MARKER}}
function apply(){const pf=preflight(),st=fs.statSync(TARGET),old=fs.readFileSync(TARGET),next=Buffer.from(patchSource(old.toString('utf8'))),stamp=new Date().toISOString().replace(/[:.]/g,'-'),dir=path.join(BACKUP_ROOT,stamp);fs.mkdirSync(dir,{recursive:true,mode:0o700});const backup=path.join(dir,'leadops-language-gate-v1.js.bak');fs.writeFileSync(backup,old,{mode:0o600,flag:'wx'});let installed=false;try{atomic(TARGET,next,st);installed=true;nodeCheck(fs.readFileSync(TARGET));if(sha(fs.readFileSync(TARGET))!==pf.after_sha256)fail('post_sha_mismatch');const result={ok:true,action:ACTION,schema_version:'prhm.host-action-result.v1',installed:true,rollback_performed:false,before_sha256:pf.before_sha256,after_sha256:pf.after_sha256,backup_path:backup,summary_marker:MARKER,database_mutation:false,business_mutation:false};fs.mkdirSync(path.dirname(RESULT),{recursive:true,mode:0o700});fs.writeFileSync(RESULT,JSON.stringify(result)+'\n',{mode:0o600});console.log(JSON.stringify(result));}catch(e){if(installed)atomic(TARGET,old,st);throw e}}
function main(){if(process.argv.includes('--preflight-only')){console.log(JSON.stringify(preflight()));return}if(process.argv.includes('--apply')){apply();return}fail('usage')}
if(require.main===module)main();else module.exports={patchSource,EXPECTED_SHA,MARKER};
