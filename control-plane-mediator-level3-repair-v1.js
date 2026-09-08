'use strict';

const fs=require('node:fs');
const crypto=require('node:crypto');
const cp=require('node:child_process');

const ACTION='control_plane_root_scripts_stage_mediator_level3_repair_v1';
const TARGET='/opt/prhm-company-control-plane/root-scripts-stage-mediator-v1/control-plane-root-scripts-stage-mediator-v1.js';
const SERVICE='prhm-root-scripts-stage-mediator-v1.service';
const SOCKET='/run/prhm-root-scripts-stage-mediator-v1/mediator.sock';
const BACKUP_ROOT='/var/backups/prhm-root-scripts-stage-mediator-level3-repair-v1';
const BASELINE_SHA256='e8fc3f5185f01efeca5563490461566f64fc8bda1534bad5a3c39e73a7108abb';
const CONFIRM_LITERAL='CONFIRM_LEVEL_3_PRODUCTION';
const REPLACEMENTS=Object.freeze([
  Object.freeze(["  risk:'critical',","  risk:'high',",'risk']),
  Object.freeze(["export const CONFIRM_LITERAL='CONFIRM_LEVEL_4_CRITICAL';","export const CONFIRM_LITERAL='CONFIRM_LEVEL_3_PRODUCTION';",'confirmation']),
  Object.freeze(["if(Number(request.level)!==4)throw new Error('request_binding_mismatch');","if(Number(request.level)!==3)throw new Error('request_binding_mismatch');",'request_level']),
  Object.freeze(["return {request_id:request.request_id,binding_metadata:{action:FIXED_BINDING.action,operation:FIXED_BINDING.operation,project:FIXED_BINDING.project,environment:FIXED_BINDING.environment,risk:FIXED_BINDING.risk,arguments_sha256:ARGUMENTS_SHA256,level:4,expires_at:request.expires_at??null}};","return {request_id:request.request_id,binding_metadata:{action:FIXED_BINDING.action,operation:FIXED_BINDING.operation,project:FIXED_BINDING.project,environment:FIXED_BINDING.environment,risk:FIXED_BINDING.risk,arguments_sha256:ARGUMENTS_SHA256,level:3,expires_at:request.expires_at??null}};",'metadata_level']),
  Object.freeze(["if(String(second_confirmation||'')!==CONFIRM_LITERAL)throw new Error('critical_second_confirmation_required');","if(String(second_confirmation||'')!==CONFIRM_LITERAL)throw new Error('level3_confirmation_required');",'confirmation_error'])
]);

const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(m){throw new Error(m)}
function fixedCandidate(source){
  let out=source;
  for(const [oldValue,newValue,label] of REPLACEMENTS){
    const count=out.split(oldValue).length-1;
    if(count!==1)fail('mediator_anchor_'+label+'_'+count);
    out=out.replace(oldValue,newValue);
  }
  for(const [oldValue,,label] of REPLACEMENTS)if(out.includes(oldValue))fail('mediator_post_anchor_'+label);
  return out;
}
function inspect(){
  const st=fs.lstatSync(TARGET);
  if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(TARGET)!==TARGET)fail('mediator_target_not_regular');
  const bytes=fs.readFileSync(TARGET),actual=sha(bytes),source=bytes.toString('utf8');
  if(actual!==BASELINE_SHA256){
    const already=source.includes("  risk:'high',")&&source.includes("export const CONFIRM_LITERAL='CONFIRM_LEVEL_3_PRODUCTION';")&&source.includes("Number(request.level)!==3")&&source.includes('level:3,expires_at')&&source.includes('level3_confirmation_required');
    if(already)return {st,bytes,actual,already_applied:true,candidate_sha256:actual};
    fail('mediator_baseline_drift:'+actual);
  }
  const candidate=Buffer.from(fixedCandidate(source),'utf8');
  return {st,bytes,actual,already_applied:false,candidate,candidate_sha256:sha(candidate)};
}
function preflight(){
  const x=inspect();
  return {ok:true,schema_version:'prhm.mediator-level3-repair-preflight.v1',action:ACTION,target:TARGET,baseline_sha256:BASELINE_SHA256,current_sha256:x.actual,candidate_sha256:x.candidate_sha256,already_applied:x.already_applied===true,replacement_count:x.already_applied?0:5,production_mutation:false,database_mutation:false,policy_mutation:false,arbitrary_path:false,arbitrary_command:false};
}
function unitScript(){
  return String.raw`
const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto'),path=require('node:path');
const TARGET=${JSON.stringify(TARGET)},SERVICE=${JSON.stringify(SERVICE)},SOCKET=${JSON.stringify(SOCKET)},BACKUP_ROOT=${JSON.stringify(BACKUP_ROOT)},BASE=${JSON.stringify(BASELINE_SHA256)};
const R=${JSON.stringify(REPLACEMENTS)};
const H=b=>crypto.createHash('sha256').update(b).digest('hex');
function F(m){throw new Error(m)}
function cand(s){let o=s;for(const [a,b,l] of R){const n=o.split(a).length-1;if(n!==1)F('anchor_'+l+'_'+n);o=o.replace(a,b)}return o}
function run(bin,args,t=60000){const r=cp.spawnSync(bin,args,{encoding:'utf8',timeout:t,maxBuffer:300000});if(r.error||r.status!==0)F('exec_failed:'+bin+':'+String(r.stderr||r.stdout||'').slice(-2000));return String(r.stdout||'').trim()}
const st=fs.lstatSync(TARGET);if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(TARGET)!==TARGET)F('target_not_regular');
const original=fs.readFileSync(TARGET),actual=H(original),text=original.toString('utf8');
if(actual!==BASE){
 const already=text.includes("  risk:'high',")&&text.includes("export const CONFIRM_LITERAL='CONFIRM_LEVEL_3_PRODUCTION';")&&text.includes("Number(request.level)!==3")&&text.includes('level:3,expires_at')&&text.includes('level3_confirmation_required');
 if(!already)F('baseline_drift:'+actual);
 console.log(JSON.stringify({ok:true,action:${JSON.stringify(ACTION)},already_applied:true,current_sha256:actual,candidate_sha256:actual,production_mutation:false,rollback_performed:false}));process.exit(0);
}
const candidate=Buffer.from(cand(text),'utf8'),candidateSha=H(candidate);
fs.mkdirSync(BACKUP_ROOT,{recursive:true,mode:0o700});
const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14);
const backup=path.join(BACKUP_ROOT,'mediator-'+stamp+'-'+process.pid+'-'+BASE+'.bak');
fs.writeFileSync(backup,original,{mode:0o600,flag:'wx'});
const tmp=TARGET+'.level3-'+process.pid+'-'+Date.now()+'.tmp';let wrote=false;
try{
 fs.writeFileSync(tmp,candidate,{mode:st.mode&0o777,flag:'wx'});fs.chownSync(tmp,st.uid,st.gid);fs.chmodSync(tmp,st.mode&0o777);
 const syn=cp.spawnSync('/usr/local/bin/prhm-node',['--check',tmp],{encoding:'utf8',timeout:30000,maxBuffer:300000});
 if(syn.error||syn.status!==0)F('candidate_syntax_invalid');
 fs.renameSync(tmp,TARGET);wrote=true;
 if(H(fs.readFileSync(TARGET))!==candidateSha)F('postwrite_sha_mismatch');
 run('/usr/bin/systemctl',['restart',SERVICE],60000);
 if(run('/usr/bin/systemctl',['is-active',SERVICE],20000)!=='active')F('mediator_service_not_active');
 let ready=false;for(let i=0;i<40;i++){try{const s=fs.lstatSync(SOCKET);if(s.isSocket()){ready=true;break}}catch{} Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250)}
 if(!ready)F('mediator_socket_not_ready');
 console.log(JSON.stringify({ok:true,schema_version:'prhm.mediator-level3-repair-result.v1',action:${JSON.stringify(ACTION)},old_sha256:BASE,new_sha256:candidateSha,backup_path:backup,service:SERVICE,service_active:true,socket_ready:true,replacement_count:5,production_mutation:true,database_mutation:false,policy_mutation:false,rollback_performed:false}));
}catch(error){
 try{if(fs.existsSync(tmp))fs.unlinkSync(tmp)}catch{}
 if(wrote){
  let rb=TARGET+'.rollback-'+process.pid+'-'+Date.now()+'.tmp';
  fs.writeFileSync(rb,original,{mode:st.mode&0o777,flag:'wx'});fs.chownSync(rb,st.uid,st.gid);fs.chmodSync(rb,st.mode&0o777);fs.renameSync(rb,TARGET);
  try{run('/usr/bin/systemctl',['restart',SERVICE],60000)}catch{}
  if(H(fs.readFileSync(TARGET))!==BASE)F('rollback_sha_mismatch');
 }
 throw error;
}`;
}
function apply(second_confirmation){
  if(String(second_confirmation||'')!==CONFIRM_LITERAL)fail('level3_confirmation_required');
  const pre=preflight();
  if(pre.already_applied)return {...pre,schema_version:'prhm.mediator-level3-repair-result.v1',status:'already_applied',rollback_performed:false};
  const unit='prhm-mediator-level3-repair-'+process.pid+'-'+Date.now(),service=unit+'.service',script=unitScript();
  const args=['--unit='+unit,'--quiet','--property=Type=oneshot','--property=RemainAfterExit=yes','--property=TimeoutStartSec=120','--property=StandardOutput=journal','--property=StandardError=journal','--property=NoNewPrivileges=yes','--property=PrivateTmp=yes','--property=PrivateDevices=yes','--property=ProtectSystem=strict','--property=ProtectHome=true','--property=RestrictAddressFamilies=AF_UNIX','--property=ReadWritePaths=/opt/prhm-company-control-plane/root-scripts-stage-mediator-v1 /var/backups/prhm-root-scripts-stage-mediator-level3-repair-v1 /run/prhm-root-scripts-stage-mediator-v1','/usr/local/bin/prhm-node','-e',script];
  const started=cp.spawnSync('/usr/bin/systemd-run',args,{encoding:'utf8',timeout:15000,maxBuffer:120000,env:{PATH:'/usr/local/bin:/usr/bin:/bin',LC_ALL:'C'}});
  if(started.error||started.status!==0)fail('mediator_repair_unit_start_failed:'+String(started.stderr||started.stdout||'').slice(-2000));
  let status=null,result='',active='',sub='';
  const sleeper=new Int32Array(new SharedArrayBuffer(4));
  for(let i=0;i<480;i++){
    const r=cp.spawnSync('/usr/bin/systemctl',['show',service,'--no-pager','--property=ActiveState','--property=SubState','--property=Result','--property=ExecMainStatus'],{encoding:'utf8',timeout:5000,maxBuffer:60000});
    if(r.status===0){
      const p=Object.fromEntries(String(r.stdout||'').trim().split(/\n+/).map(x=>{const j=x.indexOf('=');return [x.slice(0,j),x.slice(j+1)]}));
      active=p.ActiveState||'';sub=p.SubState||'';result=p.Result||'';const n=parseInt(p.ExecMainStatus||'',10);status=Number.isInteger(n)?n:null;
      if(sub==='exited'||active==='failed'||active==='inactive')break;
    }
    Atomics.wait(sleeper,0,0,250);
  }
  const j=cp.spawnSync('/usr/bin/journalctl',['--no-pager','--quiet','--unit='+service,'--output=cat','--lines=300'],{encoding:'utf8',timeout:10000,maxBuffer:300000});
  cp.spawnSync('/usr/bin/systemctl',['stop',service],{encoding:'utf8',timeout:10000,maxBuffer:30000});
  cp.spawnSync('/usr/bin/systemctl',['reset-failed',service],{encoding:'utf8',timeout:10000,maxBuffer:30000});
  if(!(status===0&&result==='success'))fail('mediator_repair_unit_failed:'+String(j.stdout||j.stderr||'').slice(-6000));
  for(const line of String(j.stdout||'').trim().split(/\n+/).reverse()){try{const o=JSON.parse(line);if(o&&o.ok===true)return o}catch{}}
  fail('mediator_repair_result_missing');
}
module.exports=Object.freeze({ACTION,TARGET,SERVICE,SOCKET,BACKUP_ROOT,BASELINE_SHA256,CONFIRM_LITERAL,preflight,apply});
