'use strict';
// SOURCE ONLY. No production mutation, signed approval, or root adapter.
// Candidate registration remains fail-closed until reviewed root installer exists.
const crypto=require('node:crypto');
const ACTION='solo_company_runtime_install_v1';
const OPERATION='host_action.'+ACTION;
const RELEASE_SHA='0eb43d72aab3f10db22172c8be4c0411cf22d074';
const EXPECTED=Object.freeze({
  approval:'4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406',
  executor:'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0',
  policy:'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174',
  mcp:'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166'
});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function once(src,anchor,replace,label){
  if(src.split(anchor).length!==2)throw Error(label+'_anchor_invalid');
  return src.replace(anchor,replace);
}
function approval(src){
  if(src.includes(OPERATION))throw Error('approval_already_registered');
  const a='const HOST_ACTION_V2_SPECS = Object.freeze({';
  return once(src,a,a+"\n  solo_company_runtime_install_v1: {operation:'host_action.solo_company_runtime_install_v1',rollback:'host-action-v2:solo-company-runtime-install-v1:root-adapter-verified-rollback'},",'approval');
}
function executor(src){
  if(src.includes(OPERATION))throw Error('executor_already_registered');
  const a='const HOST_ACTION_V2_SPECS = Object.freeze({';
  src=once(src,a,a+"\n  solo_company_runtime_install_v1:{operation:'host_action.solo_company_runtime_install_v1',kind:'solo_company_runtime_install_v1'},",'executor');
  const d='applyHostActionV2=async function(action){';
  // No privilege granted by merely registering a name.
  const fn="function applySoloCompanyRuntimeInstallV1(){throw Error('solo_runtime_root_adapter_not_installed')}\n";
  return once(src,d,fn+d+"if(action==='solo_company_runtime_install_v1')return applySoloCompanyRuntimeInstallV1();",'dispatch');
}
function mcp(src){
  if(src.includes("'"+ACTION+"'"))throw Error('mcp_already_registered');
  const a=src.match(/const HostActionV2=z\.enum\(\[[^\n]*?\]\);/g)||[];
  if(a.length!==1)throw Error('mcp_enum_invalid');
  return once(src,a[0],a[0].replace(/\]\);$/,",'"+ACTION+"']);"),'mcp');
}
function policy(src){
  const p=JSON.parse(src);
  if(!p.operations||!Array.isArray(p.typed_scopes)||p.operations[OPERATION])throw Error('policy_invalid_or_duplicate');
  if(p.typed_scopes.some(s=>s&&s.action===ACTION))throw Error('policy_scope_duplicate');
  const ref=p.typed_scopes.find(s=>s&&s.action==='rahekomak_production_deploy_v1');
  if(!ref||!Array.isArray(ref.principals)||!ref.principals.length)throw Error('policy_approval_principals_missing');
  p.operations[OPERATION]={level:4,risk:'critical',requires_second_confirmation:true,one_time_use:true,requested_approver:'mohammad',expires_seconds:180,policy_version:'solo-company-runtime-install-v1-candidate',rollback_reference:'host-action-v2:solo-company-runtime-install-v1:root-adapter-verified-rollback'};
  p.typed_scopes.push({tool:'host_action_v2_apply',project:'control_plane',environment:'production',action:ACTION,risk:'critical',operation:OPERATION,principals:JSON.parse(JSON.stringify(ref.principals))});
  return JSON.stringify(p,null,2)+'\n';
}
function buildCandidates(raw){
  for(const k of Object.keys(EXPECTED)){
    if(!Buffer.isBuffer(raw[k])||sha(raw[k])!==EXPECTED[k])throw Error('baseline_sha_mismatch_'+k);
  }
  const sources={approval:Buffer.from(approval(raw.approval.toString('utf8'))),executor:Buffer.from(executor(raw.executor.toString('utf8'))),policy:Buffer.from(policy(raw.policy.toString('utf8'))),mcp:Buffer.from(mcp(raw.mcp.toString('utf8')))};
  return {sources,sha256:Object.fromEntries(Object.entries(sources).map(([k,v])=>[k,sha(v)])),action:ACTION,release_sha:RELEASE_SHA,root_adapter_state:'NOT_INSTALLED',production_mutation:false};
}
module.exports={ACTION,RELEASE_SHA,EXPECTED,sha,approval,executor,mcp,policy,buildCandidates};
