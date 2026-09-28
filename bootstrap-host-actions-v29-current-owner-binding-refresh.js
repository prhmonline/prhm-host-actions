'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const ACTION='control_plane_current_owner_binding_refresh_v1';
const OPERATION='host_action.control_plane_current_owner_binding_refresh_v1';
const LIVE_PINS=Object.freeze({
  base:'de924f7319f3656d788ba5d3f89ef2910bf4b0e3f0b8b074e7cd3a534441d5ea',
  executor:'6bba46890db31abc8eca7e7681753a4788c46170033a555a1106e05d0a7a66f9',
  policy:'2fedd70a182aa351e269df95a1b9d829f5a0b18defe8871cb4045106948d711a',
  mcp:'b2f95b97dfa7e26ca717dfbec7871bf2f64286952548fb4d6d8e99908aeaacc0'
});
const TARGETS=Object.freeze({
  base:'/opt/prhm-agent-selfmaint/server.js',
  executor:'/opt/prhm-agent-selfmaint-exec/server.js',
  policy:'/opt/prhm-company-control-plane/config/approval-policy.json',
  mcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js'
});
const PRIVATE_DIR='/opt/prhm-agent-selfmaint-exec/actions/current-owner-binding-v1';
const ACTION_PATH='/opt/prhm-agent-selfmaint-exec/actions/control-plane-current-owner-binding-refresh-v1.js';
const MODULE_INSTALLS=Object.freeze({
  'current-owner-binding-manifest-v1.js':Object.freeze({source_path:'current-owner-binding-manifest-v1.js',destination_path:PRIVATE_DIR+'/current-owner-binding-manifest-v1.js',sha256:'f2b039fcf2f143bc378c9d8d6e54d3ad34b9cdcf0735edf0aaaffcd3393b67a8'}),
  'current-owner-binding-adapters-v1.js':Object.freeze({source_path:'current-owner-binding-adapters-v1.js',destination_path:PRIVATE_DIR+'/current-owner-binding-adapters-v1.js',sha256:'b52ce1e600dcf46095ce85f211a518eb1dc08688a9373188d021afc34ab6562b'}),
  'current-owner-binding-systemd-v1.js':Object.freeze({source_path:'current-owner-binding-systemd-v1.js',destination_path:PRIVATE_DIR+'/current-owner-binding-systemd-v1.js',sha256:'c7a2a729aad741a9169ac455eb35e4a90ba78ff1a6e094ca5eaaecf9ed077070'}),
  'current-owner-binding-refresh-v1.js':Object.freeze({source_path:'current-owner-binding-refresh-v1.js',destination_path:PRIVATE_DIR+'/current-owner-binding-refresh-v1.js',sha256:'93ecebbd830bfac246aa3fee800181cd02f97ced215bee8ccf734eac7044e4a4'})
});
const EXECUTOR_SYSTEMD_PROPERTIES=Object.freeze([
  'Type=oneshot','UMask=0077','NoNewPrivileges=true','PrivateTmp=true','PrivateDevices=true',
  'ProtectSystem=strict','ProtectHome=read-only','ProtectKernelTunables=true','ProtectKernelModules=true','ProtectControlGroups=true',
  'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6','CapabilityBoundingSet=','AmbientCapabilities=','RestrictNamespaces=true',
  'ReadWritePaths=/home/agent/ssh-agent-api /home/agent/ssh-mcp-server/src/core /opt/prhm-agent-selfmaint-exec/actions /var/lib/prhm-agent-selfmaint-exec/current-owner-binding-v1 /var/backups/prhm-current-owner-binding-refresh-v1 /etc/systemd/system/prhm-agent-selfmaint-exec.service.d'
]);
function fail(code){throw new Error(code);}
function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function count(haystack,needle){return String(haystack).split(needle).length-1;}
function oneAnchor(source,re,code){const m=source.match(re);if(!m||m.length<1)fail(code+'_anchor_missing');const all=[...source.matchAll(new RegExp(re.source,re.flags.includes('g')?re.flags:re.flags+'g'))];if(all.length!==1)fail(code+'_anchor_nonunique');return m;}
function ensureAbsentOrOnce(source,needle){const n=count(source,needle);if(n>1)fail('action_duplicate');return n===1;}

function buildPolicyRegistration(){return Object.freeze({level:4,risk:'critical',requires_second_confirmation:true,one_time_use:true,requested_approver:'mohammad',expires_seconds:180,policy_version:'2026-09-28.1-current-owner-binding-refresh-v1',rollback_reference:'host-action-v2:control-plane-current-owner-binding-refresh-v1:exact-preimage',operation:OPERATION});}
function buildTypedScope(){return Object.freeze({tool:'host_action_v2_apply',project:'control_plane',environment:'production',action:ACTION,risk:'critical',operation:OPERATION,principals:[{principal_id:'mohammad',roles:['mcp-operator']}]});}

function buildBaseRegistration(source){
  source=String(source);if(ensureAbsentOrOnce(source,ACTION))return source;
  const re=/const HOST_ACTION_V2_SPECS\s*=\s*Object\.freeze\(\{/;
  const m=oneAnchor(source,re,'base_specs');
  const entry=`\n  ${ACTION}: { operation: '${OPERATION}', rollback: 'host-action-v2:control-plane-current-owner-binding-refresh-v1:exact-preimage' },`;
  const out=source.slice(0,m.index+m[0].length)+entry+source.slice(m.index+m[0].length);
  const l3=/const HOST_ACTION_V2_LEVEL3\s*=\s*new Set\((\[[\s\S]*?\])\);/.exec(out);if(!l3)fail('base_level3_anchor_missing');if(l3[1].includes(ACTION))fail('base_level3_contains_current_owner_refresh');
  return out;
}
function buildExecutorRegistration(source){
  source=String(source);if(ensureAbsentOrOnce(source,ACTION))return source;
  const specRe=/const HOST_ACTION_V2_SPECS\s*=\s*(?:Object\.freeze\()?\{/;
  const sm=oneAnchor(source,specRe,'executor_specs');
  const specEntry=`\n  ${ACTION}:{operation:'${OPERATION}',kind:'${ACTION}'},`;
  let out=source.slice(0,sm.index+sm[0].length)+specEntry+source.slice(sm.index+sm[0].length);
  const dispatch='applyHostActionV2=async function(action){';
  if(count(out,dispatch)!==1)fail('executor_dispatch_anchor_nonunique');
  const helper=`const CURRENT_OWNER_BINDING_REFRESH_HELPER='${ACTION_PATH}';\nconst CURRENT_OWNER_BINDING_REFRESH_RESULT='/var/lib/prhm-agent-selfmaint-exec/current-owner-binding-v1/result.json';\nfunction applyControlPlaneCurrentOwnerBindingRefreshV1(){\n  if(!fs.existsSync(CURRENT_OWNER_BINDING_REFRESH_HELPER))throw new Error('current_owner_binding_refresh_helper_missing');\n  try{if(fs.existsSync(CURRENT_OWNER_BINDING_REFRESH_RESULT))fs.unlinkSync(CURRENT_OWNER_BINDING_REFRESH_RESULT)}catch{}\n  const unit='prhm-current-owner-binding-refresh-v1-'+Date.now();\n  const args=['--wait','--collect','--unit='+unit,${EXECUTOR_SYSTEMD_PROPERTIES.map(x=>`'--property=${x}'`).join(',')},'--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','/usr/local/bin/prhm-node',CURRENT_OWNER_BINDING_REFRESH_HELPER,'--apply'];\n  cp.execFileSync('/usr/bin/systemd-run',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:900000});\n  const result=readJson(CURRENT_OWNER_BINDING_REFRESH_RESULT);\n  if(result.ok!==true||result.action!=='${ACTION}'||result.production_application_mutation!==false||result.database_mutation!==false||result.titan_cutover!==false||result.rollback_performed!==false)throw new Error('current_owner_binding_refresh_result_invalid');\n  return result;\n}\n`;
  out=out.replace(dispatch,helper+dispatch+`if(action==='${ACTION}')return applyControlPlaneCurrentOwnerBindingRefreshV1();`);
  return out;
}
function buildMcpRegistration(source){
  source=String(source);if(ensureAbsentOrOnce(source,ACTION))return source;
  const re=/const HostActionV2\s*=\s*z\.enum\(\[([\s\S]*?)\]\);/;
  const m=oneAnchor(source,re,'mcp_enum');
  const body=m[1].trimEnd();
  const joined=body+(body.trim().endsWith(',')?'':',')+`'${ACTION}'`;
  return source.slice(0,m.index)+`const HostActionV2=z.enum([${joined}]);`+source.slice(m.index+m[0].length);
}
function buildPolicySourceRegistration(source){
  source=String(source);if(ensureAbsentOrOnce(source,ACTION))return source;
  let obj;try{obj=JSON.parse(source);}catch{fail('policy_json_invalid');}
  if(!obj.operations||typeof obj.operations!=='object'||Array.isArray(obj.operations))fail('policy_operations_missing');
  if(!Array.isArray(obj.typed_scopes))fail('policy_typed_scopes_missing');
  if(obj.operations[OPERATION])fail('policy_operation_duplicate');
  if(obj.typed_scopes.some(x=>x&&x.action===ACTION))fail('policy_scope_duplicate');
  const p=buildPolicyRegistration();obj.operations[OPERATION]={level:p.level,risk:p.risk,requires_second_confirmation:p.requires_second_confirmation,one_time_use:p.one_time_use,requested_approver:p.requested_approver,expires_seconds:p.expires_seconds,policy_version:p.policy_version,rollback_reference:p.rollback_reference};
  obj.typed_scopes.push(buildTypedScope());
  return JSON.stringify(obj,null,2)+'\n';
}
function verifyModuleSources(root=__dirname,fsApi=fs){
  const result={};
  for(const [name,spec] of Object.entries(MODULE_INSTALLS)){
    const p=path.join(root,spec.source_path);const st=fsApi.lstatSync(p);if(st.isSymbolicLink()||!st.isFile())fail('module_source_not_regular:'+name);const bytes=fsApi.readFileSync(p);const actual=sha256(bytes);if(actual!==spec.sha256)fail('module_source_sha_mismatch:'+name);result[name]={sha256:actual,bytes:bytes.length};
  }
  return Object.freeze(result);
}
function buildRegistrationCandidates(live){
  if(!live||typeof live!=='object')fail('live_sources_invalid');
  const out={};for(const k of Object.keys(TARGETS)){if(typeof live[k]!=='string')fail('live_source_missing:'+k);if(sha256(Buffer.from(live[k]))!==LIVE_PINS[k])fail('live_pin_mismatch:'+k);}
  out.base=buildBaseRegistration(live.base);out.executor=buildExecutorRegistration(live.executor);out.policy=buildPolicySourceRegistration(live.policy);out.mcp=buildMcpRegistration(live.mcp);
  return Object.freeze(out);
}
function contract(){return Object.freeze({schema_version:'prhm.host-actions-v29-current-owner-binding-refresh.contract.v1',action:'host_actions_v29_current_owner_binding_refresh_registration',target_action:ACTION,operation:OPERATION,registration_targets:['base','executor','policy','mcp'],module_count:4,production_application_mutation:false,database_mutation:false,titan_cutover:false,rollback:'exact-preimage'});}
module.exports=Object.freeze({ACTION,OPERATION,LIVE_PINS,TARGETS,PRIVATE_DIR,ACTION_PATH,MODULE_INSTALLS,EXECUTOR_SYSTEMD_PROPERTIES,buildPolicyRegistration,buildTypedScope,buildBaseRegistration,buildExecutorRegistration,buildMcpRegistration,buildPolicySourceRegistration,verifyModuleSources,buildRegistrationCandidates,contract});
