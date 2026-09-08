'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const Module=require('module');

const BASE_SHA='02e75837d0c8dacc5984aad676209ec003548a016136779090ab04818feeabf3';
const BACKUP_DIR='/var/backups/prhm-agent-selfmaint';
const PREFIX='agent_api-server.js-';
const SUFFIX='-'+BASE_SHA+'.bak';
const POLICY_PATH='/opt/prhm-company-control-plane/config/approval-policy.json';
const POLICY_SHA='494e95e3173695407c84b6d082f09e57d971cb193518be813a53131cdb389a70';
const APPROVAL_SERVER_PATH='/opt/prhm-company-control-plane/approval/server.js';
const APPROVAL_SERVER_SHA='de2569e481cd57b105b6a778cee7b32b2575fc88957d993c70760101ba39d13b';
const POLICY_VERSION='2026-09-05.3-autonomous-operator-v1';
const SERVICE='prhm-company-approval.service';
const EXPECTED_OLD_APPROVAL_PID=3715344;
const HEALTH_URL='http://127.0.0.1:18133/health';
const REQUIRED_OPERATION='host_action.control_plane_root_scripts_stage_transport_v1';
const REQUIRED_TOOL='host_action_v2_apply';
const REQUIRED_ACTION='control_plane_root_scripts_stage_transport_v1';

const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(m){throw new Error(m)}
function loadBase(){const names=fs.readdirSync(BACKUP_DIR).filter(n=>n.startsWith(PREFIX)&&n.endsWith(SUFFIX)).sort().reverse();if(!names.length)fail('approval_refresh_base_backup_missing');const bytes=fs.readFileSync(path.join(BACKUP_DIR,names[0]));if(sha(bytes)!==BASE_SHA)fail('approval_refresh_base_sha_mismatch');return bytes}
function validatePolicyObject(p){if(p.version!==POLICY_VERSION)fail('approval_policy_version_mismatch');if(p.operations?.[REQUIRED_OPERATION]?.level!==3)fail('approval_operation_missing');const ok=Array.isArray(p.typed_scopes)&&p.typed_scopes.some(s=>s&&s.tool===REQUIRED_TOOL&&s.project==='control_plane'&&s.environment==='production'&&s.action===REQUIRED_ACTION&&s.risk==='high'&&s.operation===REQUIRED_OPERATION&&Array.isArray(s.principals)&&s.principals.some(x=>x&&x.principal_id==='mohammad'&&Array.isArray(x.roles)&&x.roles.includes('mcp-operator')));if(!ok)fail('approval_typed_scope_missing');return true}
function validatePolicyBytes(bytes){if(sha(bytes)!==POLICY_SHA)fail('approval_policy_sha_mismatch');return validatePolicyObject(JSON.parse(bytes.toString('utf8')))}
function productionDeps(){return {
 readFile:p=>fs.readFileSync(p),sha,
 servicePid:()=>{const r=cp.spawnSync('/usr/bin/systemctl',['show',SERVICE,'-p','MainPID','--value'],{encoding:'utf8',timeout:10000,maxBuffer:64000});if(r.error||r.status!==0)fail('approval_pid_read_failed');const m=String(r.stdout||'').match(/MainPID=(\d+)/)||String(r.stdout||'').match(/^\s*(\d+)\s*$/m);if(!m||Number(m[1])<=0)fail('approval_pid_invalid');return Number(m[1])},
 restart:s=>{const r=cp.spawnSync('/usr/bin/systemctl',['restart',s],{encoding:'utf8',timeout:60000,maxBuffer:64000});if(r.error||r.status!==0)fail('approval_restart_failed')},
 health:()=>{const r=cp.spawnSync('/usr/bin/curl',['-fsS','--max-time','2',HEALTH_URL],{encoding:'utf8',timeout:4000,maxBuffer:64000});if(r.error||r.status!==0)return null;try{return JSON.parse(r.stdout)}catch{return null}},
 sleep:ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms),
}}
function baseline(deps){const p=deps.readFile(POLICY_PATH);if(deps.sha(p)!==POLICY_SHA)fail('approval_policy_sha_mismatch');validatePolicyObject(JSON.parse(p.toString('utf8')));const a=deps.readFile(APPROVAL_SERVER_PATH);if(deps.sha(a)!==APPROVAL_SERVER_SHA)fail('approval_server_sha_mismatch');return true}
function refreshApprovalOnce(deps=productionDeps()){
 baseline(deps);const before=deps.servicePid();let restarted=false;
 if(before===EXPECTED_OLD_APPROVAL_PID){deps.restart(SERVICE);restarted=true}
 let health=null;for(let i=0;i<50;i++){const h=deps.health();if(h&&h.ok===true&&h.service==='prhm-company-approval'&&h.policy_version===POLICY_VERSION){health=h;break}deps.sleep(200)}
 if(!health)fail('approval_health_not_ready');const after=deps.servicePid();if(restarted&&after===before)fail('approval_pid_did_not_change');baseline(deps);
 return {ok:true,restarted,before_pid:before,after_pid:after,policy_version:POLICY_VERSION,required_operation:REQUIRED_OPERATION,required_tool:REQUIRED_TOOL,file_mutation:false,database_mutation:false,production_application_mutation:false};
}

function compileBase(){const bytes=loadBase();const compiled=new Module(__filename,module);compiled.filename=path.join(__dirname,'server.approval-center-policy-refresh-once-v2.js');compiled.paths=module.paths;compiled._compile(bytes.toString('utf8'),compiled.filename);return compiled}
try{
 refreshApprovalOnce();
 compileBase();
}catch(e){process.stderr.write(String(e&&e.stack||e)+'\n');process.exit(1)}
module.exports={BASE_SHA,POLICY_PATH,POLICY_SHA,APPROVAL_SERVER_PATH,APPROVAL_SERVER_SHA,POLICY_VERSION,SERVICE,EXPECTED_OLD_APPROVAL_PID,HEALTH_URL,REQUIRED_OPERATION,REQUIRED_TOOL,REQUIRED_ACTION,validatePolicyObject,validatePolicyBytes,baseline,refreshApprovalOnce,productionDeps,loadBase,compileBase};
