#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const ACTION='control_plane_selfmaint_level3_route_v1';
const TARGET='/opt/prhm-agent-selfmaint/server.js';
const EXPECTED_OLD_SHA='e265b63953571de826e86740386f60c9b13bbf6e4c684418a2e82a1094295213';
const BACKUP_ROOT='/var/backups/prhm-control-plane-selfmaint-level3-route-v1';
const RESULT='/var/lib/prhm-agent-selfmaint-exec/control-plane-selfmaint-level3-route-v1/latest.json';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(m){throw new Error(m)}
function once(s,a,b,label){const n=s.split(a).length-1;if(n!==1)fail('anchor_mismatch:'+label+':'+n);return s.replace(a,b)}
function transformSource(source){
 let s=String(source);
 s=once(s,"      'src/plugins/selfmaint.js'\n    ])","      'src/plugins/selfmaint.js',\n      'src/plugins/hostActionsV2.js'\n    ])",'mcp_allowlist');
 s=once(s,"    environment: 'production', action: 'write', risk: 'critical', operation: OPERATION,\n    arguments_sha256: argHash, consumer: 'selfmaint'","    environment: 'production', action: 'write', risk: 'high', operation: OPERATION,\n    arguments_sha256: argHash, consumer: 'selfmaint'",'apply_risk');
 s=once(s,"        environment: 'production', action: 'write', risk: 'critical', operation: OPERATION,\n        arguments: spec, ttl_seconds: 180, rollback_reference: 'selfmaint:auto-backup-on-apply'","        environment: 'production', action: 'write', risk: 'high', operation: OPERATION,\n        arguments: spec, ttl_seconds: 300, rollback_reference: 'selfmaint:auto-backup-on-apply'",'request_level3');
 s=once(s,"      if (String(input.second_confirmation || '') !== CONFIRM_LITERAL) throw Object.assign(new Error('critical_second_confirmation_required'), { status: 409 });","      if (String(input.second_confirmation || '') !== LEVEL3_CONFIRM_LITERAL) throw Object.assign(new Error('level3_second_confirmation_required'), { status: 409 });",'confirm_literal');
 s=once(s,"        decision: 'accept', note: String(input.note || 'Approved Level-4 self-maintenance change'),\n        second_confirmation: CONFIRM_LITERAL, rollback_reference: 'selfmaint:auto-backup-on-apply'","        decision: 'accept', note: String(input.note || 'Approved Level-3 self-maintenance change'),\n        second_confirmation: LEVEL3_CONFIRM_LITERAL, rollback_reference: 'selfmaint:auto-backup-on-apply'",'confirm_decision');
 return s;
}
function syntax(bytes){const r=cp.spawnSync('/usr/local/bin/prhm-node',['--check','-'],{input:bytes,encoding:'utf8',timeout:15000,maxBuffer:200000});if(r.error||r.status!==0)fail('candidate_syntax_invalid:'+String(r.stderr||r.stdout||''));}
function atomic(file,bytes,st){const tmp=file+'.candidate-'+process.pid+'-'+Date.now();let fd;try{fd=fs.openSync(tmp,'wx',st.mode&0o777);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.chownSync(tmp,st.uid,st.gid);fs.chmodSync(tmp,st.mode&0o777);fs.renameSync(tmp,file);}catch(e){try{if(fd!==undefined)fs.closeSync(fd)}catch{}try{if(fs.existsSync(tmp))fs.unlinkSync(tmp)}catch{}throw e}}
function buildCandidate(bytes){if(sha(bytes)!==EXPECTED_OLD_SHA)fail('baseline_sha_mismatch:'+sha(bytes));const next=Buffer.from(transformSource(bytes.toString('utf8')),'utf8');syntax(next);return next;}
function apply(){
 if(process.getuid&&process.getuid()!==0)fail('root_required');
 const st=fs.lstatSync(TARGET);if(st.isSymbolicLink()||!st.isFile())fail('target_not_regular');
 const old=fs.readFileSync(TARGET),next=buildCandidate(old),newSha=sha(next);
 const stamp=new Date().toISOString().replace(/[:.]/g,'-');const dir=path.join(BACKUP_ROOT,stamp);fs.mkdirSync(dir,{recursive:true,mode:0o700});const backup=path.join(dir,'server.js.bak');fs.writeFileSync(backup,old,{mode:0o600,flag:'wx'});
 let mutated=false;
 try{atomic(TARGET,next,st);mutated=true;if(sha(fs.readFileSync(TARGET))!==newSha)fail('postwrite_sha_mismatch');cp.execFileSync('/usr/bin/systemctl',['restart','prhm-agent-selfmaint.service'],{timeout:30000,stdio:'pipe'});const active=cp.execFileSync('/usr/bin/systemctl',['is-active','prhm-agent-selfmaint.service'],{encoding:'utf8',timeout:10000}).trim();if(active!=='active')fail('service_not_active');const out={ok:true,action:ACTION,schema_version:'prhm.host-action-result.v1',old_sha256:EXPECTED_OLD_SHA,new_sha256:newSha,backup_path:backup,service_active:true,rollback_performed:false,production_application_mutation:false,database_mutation:false,dns_mutation:false,firewall_mutation:false};fs.mkdirSync(path.dirname(RESULT),{recursive:true,mode:0o700});fs.writeFileSync(RESULT,JSON.stringify(out,null,2)+'\n',{mode:0o600});return out;}catch(e){if(mutated){atomic(TARGET,old,st);try{cp.execFileSync('/usr/bin/systemctl',['restart','prhm-agent-selfmaint.service'],{timeout:30000,stdio:'pipe'})}catch{}}throw new Error('apply_failed_rolled_back:'+e.message)}
}
if(require.main===module){try{const args=process.argv.slice(2);if(args.length!==1||args[0]!=='--apply')fail('unexpected_arguments');console.log(JSON.stringify(apply()))}catch(e){console.error(e.message);process.exit(1)}}
module.exports={ACTION,TARGET,EXPECTED_OLD_SHA,transformSource,buildCandidate,apply};
