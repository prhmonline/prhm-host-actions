'use strict';
// SOURCE ONLY. No production mutation, signed approval, or root adapter.
// Candidate registration remains fail-closed until reviewed root installer exists.
const crypto=require('node:crypto');
const ACTION='solo_company_runtime_install_v1';
const OPERATION='host_action.'+ACTION;
const RELEASE_SHA='0eb43d72aab3f10db22172c8be4c0411cf22d074';
const ROOT_HELPER_SHA256='5180d025321ce2cb3b8526b518b23b00655e516e046f6aa1385ccb1a542bf7b7';
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
  // This hook is only reachable after the independent one-time Level-4 approval.
  // The fixed helper is separately pinned by SHA256 and loaded in a transient unit.
  const fn="function applySoloCompanyRuntimeInstallV1(){\n  const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto');\n  const H='/opt/prhm-agent-selfmaint-exec/actions/solo-company-runtime-root-action-v1.js';\n  const EXPECTED='5180d025321ce2cb3b8526b518b23b00655e516e046f6aa1385ccb1a542bf7b7';\n  const RESULT='/var/lib/prhm-agent-selfmaint-exec/solo-company-runtime-install-v1/root-action-result.json';\n  const st=fs.lstatSync(H);\n  if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(H)!==H)throw Error('solo_root_helper_not_regular');\n  if(crypto.createHash('sha256').update(fs.readFileSync(H)).digest('hex')!==EXPECTED)throw Error('solo_root_helper_sha_mismatch');\n  try{fs.unlinkSync(RESULT)}catch(e){if(e.code!=='ENOENT')throw e}\n  const unit='prhm-solo-root-action-'+Date.now();\n  const args=['--wait','--pipe','--collect','--quiet',\n    '--unit='+unit,'--property=Type=oneshot','--property=UMask=0077',\n    '--property=NoNewPrivileges=yes','--property=PrivateTmp=yes','--property=PrivateDevices=yes',\n    '--property=ProtectSystem=full','--property=ProtectHome=read-only',\n    '--property=ProtectKernelTunables=yes','--property=ProtectKernelModules=yes',\n    '--property=ProtectControlGroups=yes','--property=RestrictSUIDSGID=yes',\n    '--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6',\n    '--property=ReadWritePaths=/etc/systemd/system',\n    '--property=ConfigurationDirectory=prhm-solo-company',\n    '--property=ConfigurationDirectoryMode=0700',\n    '--property=EnvironmentFile=/etc/prhm-agent-mcp-auth.env',\n    '--setenv=PORT=8123',\n    '--setenv=PRHM_SOLO_HOST_ACTION_V1=fixed-root-transaction-v1',\n    '/usr/local/bin/prhm-node',H];\n  const run=cp.spawnSync('/usr/bin/systemd-run',args,{encoding:'utf8',timeout:155000,\n    maxBuffer:24000,stdio:['ignore','pipe','pipe'],\n    env:{PATH:'/usr/local/bin:/usr/bin:/bin',LANG:'C'}});\n  if(!fs.existsSync(RESULT))throw Error('solo_root_result_missing');\n  const result=JSON.parse(fs.readFileSync(RESULT,'utf8'));\n  if(result?.schema_version!=='prhm.solo-runtime-root-result.v1'||\n    result.action!=='solo_company_runtime_install_v1'||\n    result.release_sha!=='0eb43d72aab3f10db22172c8be4c0411cf22d074'||\n    (result.source_sha256&&result.source_sha256!=='826da54790d826b47a5ae0d0b41bfac515b2a4fdbd44251bdcd59265744f3101'))\n      throw Error('solo_root_result_binding_invalid');\n  if(run.error||run.status!==0||result.ok!==true)throw Error('solo_root_transaction_failed');\n  if(result.service_active!==true||result.service_enabled!==true)\n    throw Error('solo_runtime_service_health_failed');\n  return {ok:true,schema_version:'prhm.host-action-result.v1',\n    action:'solo_company_runtime_install_v1',release_sha:result.release_sha,\n    source_sha256:result.source_sha256,service_active:true,service_enabled:true,\n    rollback_performed:false,health_verified:true,database_mutation:false};\n}\n";
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
module.exports={ACTION,RELEASE_SHA,ROOT_HELPER_SHA256,EXPECTED,sha,approval,executor,mcp,policy,buildCandidates};
