'use strict';
const crypto=require('node:crypto');
const ACTION='control_plane_typed_bootstrap_fixed_verifier_native_install_v1';
const TARGET_ACTION='control_plane_typed_bootstrap_fixed_verifier_bootstrap_v1';
const TARGET_OPERATION='host_action.control_plane_typed_bootstrap_fixed_verifier_bootstrap_v1';
const INSTALL_OPERATION='host_action.control_plane_typed_bootstrap_fixed_verifier_native_install_v1';
const VERIFIER_SHA='f5e3cb6a9ce6c88229ffbd2fafd1e48742562f8c3edbc7aac113e2cb4f292b5a';
const BOOTSTRAP_COMMIT='0d40e9e051cc39d23fed106fd7b301c7e1654568';
const LEVEL4_REQUIRED=true;
const ZERO_INPUT=true;
const BASELINE_SHA=Object.freeze({
 base:'e186036e8efd9c9663b977a20f62fb90cedb70b48bfa0f1fb48cbc53a64020cd',
 executor:'1e683d0962bc1e0503b9deb1f0d266ad44d6fc5d3c1566dc87f2f7733d4802bd',
 mcp:'44520b67bb352ab243698c5cf50b39d09a65c833fee9cfd3ebc5a50379ecaa71',
 policy:'76cca4574708709c921d67e91068e9f25508c6769f4d150718c8b068f870233d'
});
function sha(s){return crypto.createHash('sha256').update(Buffer.from(String(s))).digest('hex');}
function fail(code){throw new Error(code);}
function verifyBaselineMap(current){for(const k of Object.keys(BASELINE_SHA)){if(!current||current[k]!==BASELINE_SHA[k])fail('baseline_drift:'+k);}return true;}
function replaceUnique(source,needle,replacement,label){const n=source.split(needle).length-1;if(n!==1)fail(label+(n===0?'_missing':'_ambiguous'));return source.replace(needle,replacement);}
function ensureAbsent(source,token,label){if(source.includes(token))fail(label+'_conflict');}
function patchBase(source){ensureAbsent(source,TARGET_ACTION,'base_target');const anchor="imotion_credential_bind_v1: { operation: 'host_action.imotion_credential_bind_v1', rollback: 'host-action-v2:imotion-credential-bind-v1:remote-controller-backup-restore' }";const add=anchor+",\n  "+TARGET_ACTION+": { operation: '"+TARGET_OPERATION+"', rollback: 'host-action-v2:typed-bootstrap-fixed-verifier-bootstrap-v1:rollback' }";return replaceUnique(source,anchor,add,'base_anchor');}
function patchExecutor(source){ensureAbsent(source,TARGET_ACTION,'executor_target');const mapAnchor="imotion_credential_bind_v1:{operation:'host_action.imotion_credential_bind_v1',kind:'imotion_credential_bind_v1'}";let out=replaceUnique(source,mapAnchor,mapAnchor+",\n  "+TARGET_ACTION+":{operation:'"+TARGET_OPERATION+"',kind:'"+TARGET_ACTION+"'}",'executor_map_anchor');const dispatchAnchor="return applyHostActionV2Original(action);";const dispatch="if(action==='"+TARGET_ACTION+"')return applyControlPlaneTypedBootstrapFixedVerifierBootstrapV1();"+dispatchAnchor;out=replaceUnique(out,dispatchAnchor,dispatch,'executor_dispatch_anchor');return out;}
function patchMcp(source){ensureAbsent(source,TARGET_ACTION,'mcp_target');const anchor="'imotion_credential_bind_v1'";return replaceUnique(source,anchor,anchor+",'"+TARGET_ACTION+"'",'mcp_enum_anchor');}
function patchPolicy(source){let obj;try{obj=JSON.parse(source);}catch{fail('policy_json_invalid');}if(!obj.operations||typeof obj.operations!=='object'||Array.isArray(obj.operations))fail('policy_operations_invalid');if(Object.prototype.hasOwnProperty.call(obj.operations,TARGET_OPERATION))fail('policy_target_conflict');obj.operations[TARGET_OPERATION]={level:4};return JSON.stringify(obj,null,2)+'\n';}

function isExactlyInstalled({baseSource,executorSource,mcpSource,policySource}){
  let po;try{po=JSON.parse(policySource);}catch{return false;}
  return baseSource.includes(TARGET_ACTION+": { operation: '"+TARGET_OPERATION+"', rollback: 'host-action-v2:typed-bootstrap-fixed-verifier-bootstrap-v1:rollback' }") &&
    executorSource.includes(TARGET_ACTION+":{operation:'"+TARGET_OPERATION+"',kind:'"+TARGET_ACTION+"'}") &&
    executorSource.includes("if(action==='"+TARGET_ACTION+"')return applyControlPlaneTypedBootstrapFixedVerifierBootstrapV1();") &&
    mcpSource.includes("'"+TARGET_ACTION+"'") &&
    po&&po.operations&&po.operations[TARGET_OPERATION]&&po.operations[TARGET_OPERATION].level===4;
}

function validateExecutionContract(input={}){if(Object.keys(input).length)fail('arbitrary_input_rejected');return {level4_required:true,zero_input:true,park_production_mutation:false,database_mutation:false,network_access:false};}
function planNativeInstall({baseSource,executorSource,mcpSource,policySource,currentSha}){validateExecutionContract({});const before={base:baseSource,executor:executorSource,mcp:mcpSource,policy:policySource};if(isExactlyInstalled({baseSource,executorSource,mcpSource,policySource}))return {ok:true,action:ACTION,target_action:TARGET_ACTION,operation:INSTALL_OPERATION,level4_required:true,zero_input:true,changed:false,rollbackPerformed:false,before,after:{...before}};verifyBaselineMap(currentSha);const after={base:patchBase(baseSource),executor:patchExecutor(executorSource),mcp:patchMcp(mcpSource),policy:patchPolicy(policySource)};return {ok:true,action:ACTION,target_action:TARGET_ACTION,operation:INSTALL_OPERATION,level4_required:true,zero_input:true,changed:true,rollbackPerformed:false,before,after};}
function simulateTransactionalInstall(input,failurePoint){const plan=planNativeInstall(input);const order=['base','executor','mcp','policy'];let state={...plan.before};const journal=[];try{for(const k of order){journal.push([k,state[k]]);state[k]=plan.after[k];if(failurePoint===k)fail('simulated_failure:'+k);}return {ok:true,state,rollbackPerformed:false};}catch(e){for(let i=journal.length-1;i>=0;i--){const [k,v]=journal[i];state[k]=v;}return {ok:false,error:e.message,state,rollbackPerformed:true};}}
module.exports={ACTION,TARGET_ACTION,TARGET_OPERATION,INSTALL_OPERATION,VERIFIER_SHA,BOOTSTRAP_COMMIT,LEVEL4_REQUIRED,ZERO_INPUT,BASELINE_SHA,sha,verifyBaselineMap,patchBase,patchExecutor,patchMcp,patchPolicy,isExactlyInstalled,validateExecutionContract,planNativeInstall,simulateTransactionalInstall};
