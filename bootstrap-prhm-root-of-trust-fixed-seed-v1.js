#!/usr/local/bin/prhm-node
'use strict';

const crypto = require('node:crypto');

const ACTION = 'control_plane_root_scripts_stage_transport_v1';
const OPERATION = 'host_action.control_plane_root_scripts_stage_transport_v1';
const VERSION = 'prhm-root-of-trust-fixed-seed-v1';
const POLICY_VERSION = '2026-08-25.1-control-plane-root-scripts-stage-transport-v1';
const RUNTIME_INPUTS = Object.freeze([]);
const PATHS = Object.freeze({
  base: '/opt/prhm-agent-selfmaint/server.js',
  executor: '/opt/prhm-agent-selfmaint-exec/server.js',
  policy: '/opt/prhm-company-control-plane/config/approval-policy.json',
  transport: '/home/agent/ssh-agent-api/control-plane-root-scripts-stage-transport-v1.js'
});
const BASELINE_SHA = Object.freeze({
  base: 'e186036e8efd9c9663b977a20f62fb90cedb70b48bfa0f1fb48cbc53a64020cd',
  executor: '1e683d0962bc1e0503b9deb1f0d266ad44d6fc5d3c1566dc87f2f7733d4802bd',
  policy: '76cca4574708709c921d67e91068e9f25508c6769f4d150718c8b068f870233d'
});
const TRANSPORT_HELPER_SHA = 'c64d2fb4c2ae2b048f7f57f6a5e4923588b76ae8a134a540e791b03285ff4d87';

const BASE_ANCHOR = "  imotion_credential_bind_v1: { operation: 'host_action.imotion_credential_bind_v1', rollback: 'host-action-v2:imotion-credential-bind-v1:remote-controller-backup-restore' }";
const BASE_ENTRY = "  control_plane_root_scripts_stage_transport_v1: { operation: 'host_action.control_plane_root_scripts_stage_transport_v1', rollback: 'host-action-v2:control-plane-root-scripts-stage-transport-v1:registration-only' },";
const EXEC_SPEC_ANCHOR = "  imotion_credential_bind_v1:{operation:'host_action.imotion_credential_bind_v1',kind:'imotion_credential_bind_v1'}";
const EXEC_SPEC_ENTRY = "  control_plane_root_scripts_stage_transport_v1:{operation:'host_action.control_plane_root_scripts_stage_transport_v1',kind:'control_plane_root_scripts_stage_transport_v1'},";
const DISPATCH_ANCHOR = "applyHostActionV2=async function(action){if(action==='imotion_credential_bind_v1')return applyImotionCredentialBindV1();";
const DISPATCH_ENTRY = "applyHostActionV2=async function(action){if(action==='control_plane_root_scripts_stage_transport_v1')return applyControlPlaneRootScriptsStageTransportV1();if(action==='imotion_credential_bind_v1')return applyImotionCredentialBindV1();";
const EXEC_APPLY_MARKER = 'function applyControlPlaneRootScriptsStageTransportV1()';

function fail(code){ throw new Error(code); }
function sha(value){ return crypto.createHash('sha256').update(value).digest('hex'); }
function count(source, needle){ return String(source).split(needle).length - 1; }
function unique(source, needle, missing, duplicate){
  const n=count(source,needle);
  if(n===0) fail(missing);
  if(n!==1) fail(duplicate);
  return true;
}
function samePrincipalScope(x, tool){
  return Boolean(x && x.tool===tool && x.project==='control_plane' && x.environment==='production' && x.action===ACTION && x.risk==='critical' && x.operation===OPERATION && Array.isArray(x.principals) && x.principals.length===1 && x.principals[0]?.principal_id==='mohammad' && Array.isArray(x.principals[0]?.roles) && x.principals[0].roles.length===1 && x.principals[0].roles[0]==='mcp-operator');
}
function targetPolicyState(policy){
  if(!policy || typeof policy!=='object' || Array.isArray(policy) || !policy.operations || typeof policy.operations!=='object' || !Array.isArray(policy.typed_scopes)) fail('policy_shape_invalid');
  const operation=policy.operations[OPERATION];
  if(operation!==undefined && !(operation && operation.level===4 && Object.keys(operation).length===1)) fail('conflicting_existing_registration');
  const targetScopes=policy.typed_scopes.filter(x=>x && x.action===ACTION);
  for(const scope of targetScopes){
    if(scope.tool==='control_plane_root_scripts_stage_transport_apply_v1'){
      if(!samePrincipalScope(scope,'control_plane_root_scripts_stage_transport_apply_v1')) fail('conflicting_existing_registration');
    }else if(scope.tool==='host_action_v2_apply'){
      if(!samePrincipalScope(scope,'host_action_v2_apply')) fail('conflicting_existing_registration');
    }else fail('conflicting_existing_registration');
  }
  return {
    operationExact: operation!==undefined,
    actionSpecificExact: targetScopes.some(x=>samePrincipalScope(x,'control_plane_root_scripts_stage_transport_apply_v1')),
    hostV2Exact: targetScopes.some(x=>samePrincipalScope(x,'host_action_v2_apply'))
  };
}
function executorApplyBlock(){
  return `\nfunction applyControlPlaneRootScriptsStageTransportV1(){\n  const helper='${PATHS.transport}';\n  const bytes=fs.readFileSync(helper);\n  const helperSha=require('node:crypto').createHash('sha256').update(bytes).digest('hex');\n  if(helperSha!=='${TRANSPORT_HELPER_SHA}')throw new Error('transport_helper_sha_mismatch');\n  const raw=cp.execFileSync('/usr/local/bin/prhm-node',[helper,'--apply'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:180000,maxBuffer:400000,env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C',HOME:'/nonexistent'}}).trim();\n  let transport;try{transport=JSON.parse(raw)}catch{throw new Error('transport_result_invalid_json')}\n  if(!transport||transport.ok!==true||transport.schema_version!=='prhm.root-scripts-stage-transport-result.v1'||transport.action!=='${ACTION}'||transport.database_mutation!==false||transport.status!=='succeeded')throw new Error('transport_result_invalid');\n  return {ok:true,schema_version:'prhm.host-action-result.v1',action:'${ACTION}',production_mutation:transport.production_mutation===true,database_mutation:false,rollback_performed:transport.rollback_performed===true,transport_status:transport.status,old_sha256:transport.old_sha256,new_sha256:transport.new_sha256};\n}\n`;
}
function baseState(source){
  const has=source.includes(BASE_ENTRY);
  const mentions=count(source,ACTION);
  if(has && mentions===2) return 'exact';
  if(mentions!==0) fail('conflicting_existing_registration');
  return 'absent';
}
function executorState(source){
  const exactSpec=source.includes(EXEC_SPEC_ENTRY);
  const exactDispatch=source.includes("if(action==='control_plane_root_scripts_stage_transport_v1')return applyControlPlaneRootScriptsStageTransportV1();");
  const exactApply=source.includes(EXEC_APPLY_MARKER);
  const mentions=count(source,ACTION);
  if(exactSpec && exactDispatch && exactApply && mentions>=4) return 'exact';
  if(mentions!==0) fail('conflicting_existing_registration');
  return 'absent';
}
function patchBase(source){
  if(baseState(source)==='exact') return source;
  unique(source,'imotion_credential_bind_v1:','base_imotion_anchor_missing','base_imotion_anchor_duplicate');
  if(count(source,BASE_ANCHOR)!==1) fail('base_imotion_anchor_shape_invalid');
  return source.replace(BASE_ANCHOR,BASE_ENTRY+'\n'+BASE_ANCHOR);
}
function patchExecutor(source){
  if(executorState(source)==='exact') return source;
  unique(source,EXEC_SPEC_ANCHOR,'executor_imotion_spec_anchor_missing','executor_imotion_spec_anchor_duplicate');
  unique(source,DISPATCH_ANCHOR,'executor_dispatch_anchor_missing','executor_dispatch_anchor_duplicate');
  let out=source.replace(EXEC_SPEC_ANCHOR,EXEC_SPEC_ENTRY+'\n'+EXEC_SPEC_ANCHOR);
  out=out.replace(DISPATCH_ANCHOR,DISPATCH_ENTRY);
  out=out.replace(DISPATCH_ENTRY,executorApplyBlock()+DISPATCH_ENTRY);
  return out;
}
function patchPolicy(text){
  const p=JSON.parse(text);
  const state=targetPolicyState(p);
  if(!p.operations['host_action.imotion_credential_bind_v1']) fail('policy_imotion_operation_missing');
  if(!p.typed_scopes.some(x=>x && x.action==='imotion_credential_bind_v1')) fail('policy_imotion_scope_missing');
  if(!state.operationExact) p.operations[OPERATION]={level:4};
  if(!state.hostV2Exact) p.typed_scopes.push({tool:'host_action_v2_apply',project:'control_plane',environment:'production',action:ACTION,risk:'critical',operation:OPERATION,principals:[{principal_id:'mohammad',roles:['mcp-operator']}]});
  p.version=POLICY_VERSION;
  return JSON.stringify(p,null,2)+'\n';
}
function buildPatchedFrom({base,executor,policy}){
  if(typeof base!=='string'||typeof executor!=='string'||typeof policy!=='string') fail('snapshot_invalid');
  const bState=baseState(base), eState=executorState(executor), pObj=JSON.parse(policy), pState=targetPolicyState(pObj);
  const fullyApplied=bState==='exact' && eState==='exact' && pState.operationExact && pState.hostV2Exact;
  if(fullyApplied) return {base,executor,policy,alreadyApplied:true};
  return {base:patchBase(base),executor:patchExecutor(executor),policy:patchPolicy(policy),alreadyApplied:false};
}
function verifyFixedContract(){
  if(RUNTIME_INPUTS.length!==0) fail('runtime_inputs_not_empty');
  if(ACTION!=='control_plane_root_scripts_stage_transport_v1'||OPERATION!=='host_action.control_plane_root_scripts_stage_transport_v1') fail('fixed_identity_invalid');
  if(!/^[a-f0-9]{64}$/.test(TRANSPORT_HELPER_SHA)) fail('transport_helper_sha_invalid');
  for(const v of Object.values(BASELINE_SHA)) if(!/^[a-f0-9]{64}$/.test(v)) fail('baseline_sha_invalid');
  return true;
}
function preflightFrom(snapshot){
  verifyFixedContract();
  const out=buildPatchedFrom(snapshot);
  return {ok:true,schema_version:'prhm.root-of-trust-seed-preflight.v1',seed_id:VERSION,action_registered:ACTION,already_applied:out.alreadyApplied,before_sha256:{base:sha(snapshot.base),executor:sha(snapshot.executor),policy:sha(snapshot.policy)},after_sha256:{base:sha(out.base),executor:sha(out.executor),policy:sha(out.policy)},control_plane_mutation:false,database_mutation:false,transport_executed:false};
}

module.exports={ACTION,OPERATION,VERSION,POLICY_VERSION,RUNTIME_INPUTS,PATHS,BASELINE_SHA,TRANSPORT_HELPER_SHA,BASE_ANCHOR,EXEC_SPEC_ANCHOR,DISPATCH_ANCHOR,sha,verifyFixedContract,patchBase,patchExecutor,patchPolicy,buildPatchedFrom,preflightFrom};
