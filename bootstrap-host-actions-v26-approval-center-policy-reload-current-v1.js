#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const crypto=require('node:crypto');
const cp=require('node:child_process');

const ACTION='approval_center_policy_reload_v1';
const POLICY_VERSION='2026-09-05.3-autonomous-operator-v1';
const POLICY_PATH='/opt/prhm-company-control-plane/config/approval-policy.json';
const POLICY_SHA='494e95e3173695407c84b6d082f09e57d971cb193518be813a53131cdb389a70';
const APPROVAL_SERVER_PATH='/opt/prhm-company-control-plane/approval/server.js';
const APPROVAL_SERVER_SHA='de2569e481cd57b105b6a778cee7b32b2575fc88957d993c70760101ba39d13b';
const SERVICE='prhm-company-approval.service';
const REQUIRED_OPERATION='host_action.control_plane_root_scripts_stage_transport_v1';
const REQUIRED_TOOL='host_action_v2_apply';
const REQUIRED_ACTION='control_plane_root_scripts_stage_transport_v1';
const HEALTH_URL='http://127.0.0.1:18133/health';

function fail(m){throw new Error(m)}
function shaBuffer(b){return crypto.createHash('sha256').update(b).digest('hex')}
function samePrincipal(scope){return Array.isArray(scope.principals)&&scope.principals.some(p=>p&&p.principal_id==='mohammad'&&Array.isArray(p.roles)&&p.roles.includes('mcp-operator'))}
function validatePolicy(policy){
  if(!policy||typeof policy!=='object'||policy.version!==POLICY_VERSION)fail('policy_version_mismatch');
  if(policy.operations?.[REQUIRED_OPERATION]?.level!==3)fail('required_operation_missing_or_wrong_level');
  const ok=Array.isArray(policy.typed_scopes)&&policy.typed_scopes.some(s=>s&&s.tool===REQUIRED_TOOL&&s.project==='control_plane'&&s.environment==='production'&&s.action===REQUIRED_ACTION&&s.risk==='high'&&s.operation===REQUIRED_OPERATION&&samePrincipal(s));
  if(!ok)fail('required_typed_scope_missing');
  return true;
}
function baseline(deps){
  const policyBytes=deps.readFile(POLICY_PATH),serverBytes=deps.readFile(APPROVAL_SERVER_PATH);
  if(deps.sha(policyBytes)!==POLICY_SHA)fail('policy_sha_mismatch');
  if(deps.sha(serverBytes)!==APPROVAL_SERVER_SHA)fail('approval_server_sha_mismatch');
  validatePolicy(JSON.parse(policyBytes.toString('utf8')));
  return true;
}
function preflight(deps){
  baseline(deps); const pid=deps.servicePid(); const health=deps.health();
  return {ok:true,schema_version:'prhm.host-action-remediation-preflight.v1',action:ACTION,preflight_only:true,policy_version:POLICY_VERSION,policy_sha256:POLICY_SHA,approval_server_sha256:APPROVAL_SERVER_SHA,before_pid:pid,approval_health_before:health||null,required_operation:REQUIRED_OPERATION,required_tool:REQUIRED_TOOL,file_mutation:false,database_mutation:false,business_mutation:false,service_restart:false,production_application_mutation:false,external_network:false};
}
function apply(deps){
  const pf=preflight(deps); const before=pf.before_pid;
  deps.restart(SERVICE);
  let afterHealth=null;
  for(let i=0;i<50;i++){
    const h=deps.health();
    if(h&&h.ok===true&&h.service==='prhm-company-approval'&&h.policy_version===POLICY_VERSION){afterHealth=h;break;}
    deps.sleep(200);
  }
  if(!afterHealth)fail('approval_center_not_ready_after_restart');
  const after=deps.servicePid(); if(after===before)fail('approval_center_pid_did_not_change');
  baseline(deps);
  return {ok:true,schema_version:'prhm.host-action-remediation-result.v1',action:ACTION,installed:true,policy_version:POLICY_VERSION,policy_sha256:POLICY_SHA,approval_server_sha256:APPROVAL_SERVER_SHA,before_pid:before,after_pid:after,approval_health_before:pf.approval_health_before,approval_health_after:afterHealth,required_operation:REQUIRED_OPERATION,required_tool:REQUIRED_TOOL,file_mutation:false,database_mutation:false,business_mutation:false,service_restart:true,production_application_mutation:false,external_network:false,rollback_performed:false};
}
function prodExec(file,args,opt={}){const r=cp.spawnSync(file,args,{encoding:'utf8',timeout:opt.timeout||30000,maxBuffer:256*1024});if(r.error)fail('exec_error:'+r.error.message);if(r.status!==0)fail('exec_failed:'+file+':'+r.status+':'+String(r.stderr||'').slice(-500));return r}
function productionDeps(){return {
  readFile:p=>fs.readFileSync(p), sha:shaBuffer,
  servicePid:()=>{const s=String(prodExec('/usr/bin/systemctl',['show',SERVICE,'-p','MainPID','--value']).stdout||'').trim();if(!/^\d+$/.test(s)||s==='0')fail('approval_center_pid_unavailable');return Number(s)},
  restart:s=>prodExec('/usr/bin/systemctl',['restart',s],{timeout:60000}),
  health:()=>{const r=cp.spawnSync('/usr/bin/curl',['-fsS','--max-time','2',HEALTH_URL],{encoding:'utf8',timeout:4000,maxBuffer:64*1024});if(r.error||r.status!==0)return null;try{return JSON.parse(r.stdout)}catch{return null}},
  sleep:ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms),
}}
function main(argv=process.argv.slice(2)){
  if(argv.length>1||(argv.length===1&&argv[0]!=='--preflight-only'))fail('unexpected_arguments');
  if(process.getuid&&process.getuid()!==0)fail('must_run_as_root');
  const deps=productionDeps(); const out=argv[0]==='--preflight-only'?preflight(deps):apply(deps); process.stdout.write(JSON.stringify(out)+'\n'); return out;
}
if(require.main===module){try{main()}catch(e){process.stderr.write(String(e&&e.stack||e)+'\n');process.exit(1)}}
module.exports={ACTION,POLICY_VERSION,POLICY_PATH,POLICY_SHA,APPROVAL_SERVER_PATH,APPROVAL_SERVER_SHA,SERVICE,REQUIRED_OPERATION,REQUIRED_TOOL,REQUIRED_ACTION,HEALTH_URL,validatePolicy,baseline,preflight,apply,productionDeps,main};
