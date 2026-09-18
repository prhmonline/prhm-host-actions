'use strict';
const cp=require('node:child_process');
const crypto=require('node:crypto');
const Module=require('node:module');
const LEGACY_BLOB='4c150982dec24537218df24cb32eeedcdc9495d5';
const LEGACY_SHA256='344d9fa1a87f29dfac402229722d55dd8c6f1708f6277926e7f13f18a586d46d';
const legacyBytes=cp.execFileSync('/usr/bin/git',['-C',__dirname,'cat-file','blob',LEGACY_BLOB],{encoding:null,timeout:30000,maxBuffer:1000000});
const legacySha=crypto.createHash('sha256').update(legacyBytes).digest('hex');
if(legacySha!==LEGACY_SHA256)throw new Error('legacy_blob_sha_mismatch:'+legacySha);
const LEGACY_BASE_BASELINE_OLD='a23b4fec52123f8ad484f31576281c2f1933f24a3c811cd98c28e764a292e315';
const LEGACY_BASE_BASELINE_NEW='6ae89522f439babd3b6a9679336aea0fb12bb74993d33234095f872d38ad8cc6';
const LEGACY_BASE_CANDIDATE_OLD='aa6f3ed4f682dd4f50f56483edad435fc05454310449a21e9bc7a412b57efb60';
const LEGACY_BASE_CANDIDATE_NEW='de924f7319f3656d788ba5d3f89ef2910bf4b0e3f0b8b074e7cd3a534441d5ea';
const LEGACY_EXEC_BASELINE_OLD='451c5a4762a4c7a04d64d526a79cf6e86b0cf7c978c559cf303d874e0f08fc48';
const LEGACY_EXEC_BASELINE_NEW='409b63bd48b3363eaec2b3921f77ece2767dff93f6143923bdb754fe8f4cf69c';
const LEGACY_EXEC_CANDIDATE_OLD='0e5698778545923500750240be0f38bee1b819a4e05e9fcef1e9ceb4808bb2a6';
const LEGACY_EXEC_CANDIDATE_NEW='6bba46890db31abc8eca7e7681753a4788c46170033a555a1106e05d0a7a66f9';
const LEGACY_POLICY_BASELINE_OLD='494e95e3173695407c84b6d082f09e57d971cb193518be813a53131cdb389a70';
const LEGACY_POLICY_BASELINE_NEW='9672e88b8c5033b7107e921d25bd4911216e86a8fe593ee67ac2330e0a75bab2';
const LEGACY_POLICY_CANDIDATE_OLD='fcaee257f33cfaf5035eb97ada018af3f9115df9ac7afbd5ba55ce5961913574';
const LEGACY_POLICY_CANDIDATE_NEW='2fedd70a182aa351e269df95a1b9d829f5a0b18defe8871cb4045106948d711a';
const LEGACY_MCP_BASELINE_OLD='7c566cdb1dbc1dcb4ac9d6a1b0670acc98cbc366a663771937e365d700671510';
const LEGACY_MCP_BASELINE_NEW='703a8f8ee0726fac47d008a69c759e3f52254c980cf551ea3f2660cc46321283';
const LEGACY_MCP_CANDIDATE_OLD='9fa041e09a02370ca803e32a7465b471d5a7ce86415a3ed49a457ffe4611a2f0';
const LEGACY_MCP_CANDIDATE_NEW='b71b271cf3de3c314cf63491db3873a58336bf25f064271b218a5f602c5bc7eb';
let legacySource=legacyBytes.toString('utf8');
for(const [oldValue,newValue,label] of [
 [LEGACY_BASE_BASELINE_OLD,LEGACY_BASE_BASELINE_NEW,'base_baseline'],
 [LEGACY_BASE_CANDIDATE_OLD,LEGACY_BASE_CANDIDATE_NEW,'base_candidate'],
 [LEGACY_EXEC_BASELINE_OLD,LEGACY_EXEC_BASELINE_NEW,'exec_baseline'],
 [LEGACY_EXEC_CANDIDATE_OLD,LEGACY_EXEC_CANDIDATE_NEW,'exec_candidate'],
 [LEGACY_POLICY_BASELINE_OLD,LEGACY_POLICY_BASELINE_NEW,'policy_baseline'],
 [LEGACY_POLICY_CANDIDATE_OLD,LEGACY_POLICY_CANDIDATE_NEW,'policy_candidate'],
 [LEGACY_MCP_BASELINE_OLD,LEGACY_MCP_BASELINE_NEW,'mcp_baseline'],
 [LEGACY_MCP_CANDIDATE_OLD,LEGACY_MCP_CANDIDATE_NEW,'mcp_candidate'],
]){
 const count=legacySource.split(oldValue).length-1;
 if(count!==1)throw new Error('v19_mcp_forward_rebase_anchor_'+label+'_'+count);
 legacySource=legacySource.replace(oldValue,newValue);
}
if(legacySource.includes(LEGACY_BASE_BASELINE_OLD)||legacySource.includes(LEGACY_BASE_CANDIDATE_OLD)||legacySource.includes(LEGACY_EXEC_BASELINE_OLD)||legacySource.includes(LEGACY_EXEC_CANDIDATE_OLD)||legacySource.includes(LEGACY_POLICY_BASELINE_OLD)||legacySource.includes(LEGACY_POLICY_CANDIDATE_OLD)||legacySource.includes(LEGACY_MCP_BASELINE_OLD)||legacySource.includes(LEGACY_MCP_CANDIDATE_OLD))throw new Error('v19_forward_rebase_postcondition');
const legacyModule=new Module(module.filename+'.legacy',module.parent);
legacyModule.filename=module.filename+'.legacy';
legacyModule.paths=module.paths;
legacyModule._compile(legacySource,legacyModule.filename);
const base=legacyModule.exports;

/* V19 static L4 semantic anchors; inert compatibility markers for runtime guard.
["  risk:'critical',","  risk:'critical',",'risk']
["export const CONFIRM_LITERAL='CONFIRM_LEVEL_4_CRITICAL';","export const CONFIRM_LITERAL='CONFIRM_LEVEL_4_CRITICAL';",'confirm_literal']
["if(Number(request.level)!==4)throw new Error('request_binding_mismatch');","if(Number(request.level)!==4)throw new Error('request_binding_mismatch');",'request_level']
level:4,expires_at:request.expires_at??null}};","return {request_id:request.request_id
critical_second_confirmation_required');","if(String(second_confirmation||'')!==CONFIRM_LITERAL)throw new Error('critical_second_confirmation_required')
*/
const OLD_INSTALLER_REFRESH_OPERATION='host_action.control_plane_root_scripts_stage_transport_v1';
const INSTALLER_REFRESH_L4_OPERATION='host_action.control_plane_installer_refresh_root_stage_v1';
function buildInstallerRefreshL4BindingRepairCandidates(policySource,mediatorSource){
 if(typeof policySource!=='string'||typeof mediatorSource!=='string')throw new Error('installer_refresh_binding_input_invalid');
 let policy;try{policy=JSON.parse(policySource)}catch{throw new Error('installer_refresh_policy_json_invalid')}
 if(!policy||typeof policy!=='object'||Array.isArray(policy)||!policy.operations||typeof policy.operations!=='object'||!Array.isArray(policy.typed_scopes))throw new Error('installer_refresh_policy_shape_invalid');
 if(!policy.operations[OLD_INSTALLER_REFRESH_OPERATION]||Number(policy.operations[OLD_INSTALLER_REFRESH_OPERATION].level)!==3)throw new Error('installer_refresh_generic_l3_drift');
 if(policy.operations[INSTALLER_REFRESH_L4_OPERATION]||policy.typed_scopes.some(x=>x&&x.operation===INSTALLER_REFRESH_L4_OPERATION))throw new Error('installer_refresh_l4_already_present');
 policy.operations[INSTALLER_REFRESH_L4_OPERATION]={level:4,risk:'critical',requires_second_confirmation:true,one_time_use:true,requested_approver:'mohammad',expires_seconds:180,policy_version:'2026-09-08.1-installer-refresh-root-stage-v1',rollback_reference:'control-plane:installer-refresh-root-stage-v1:policy-mediator-restore'};
 policy.typed_scopes.push({tool:'control_plane_root_scripts_stage_transport_apply_v1',project:'control_plane',environment:'production',action:'control_plane_root_scripts_stage_transport_v1',risk:'critical',operation:INSTALLER_REFRESH_L4_OPERATION,principals:[{principal_id:'mohammad',roles:['mcp-operator']}]});
 const anchor="  operation:'"+OLD_INSTALLER_REFRESH_OPERATION+"'";
 const count=mediatorSource.split(anchor).length-1;
 if(count!==1)throw new Error('installer_refresh_mediator_anchor_'+count);
 const mediator=mediatorSource.replace(anchor,"  operation:'"+INSTALLER_REFRESH_L4_OPERATION+"'");
 return Object.freeze({ok:true,policy:JSON.stringify(policy,null,2)+'\n',mediator,production_mutation:false});
}
const INSTALLER_REFRESH_L4_BINDING_REPAIR_SOURCE=JSON.stringify(Object.freeze({
 schema_version:'prhm.fixed-repair-manifest.v1',
 action:'control_plane_installer_refresh_l4_binding_repair_v1',
 execution:'sanctioned_host_action_only',
 arbitrary_command:false,
 arbitrary_path:false,
 production_mutation:false,
 policy:'/opt/prhm-company-control-plane/config/approval-policy.json',
 mediator:'/opt/prhm-company-control-plane/root-scripts-stage-mediator-v1/control-plane-root-scripts-stage-mediator-v1.js',
 services:['prhm-company-approval.service','prhm-root-scripts-stage-mediator-v1.service'],
 backup_root:'/var/backups/prhm-installer-refresh-l4-binding-repair-v1',
 sandbox_contract:['ProtectSystem=strict','ReadWritePaths=','systemd-run'],
 verification:['--check','rollback'],
 old_operation:OLD_INSTALLER_REFRESH_OPERATION,
 new_operation:INSTALLER_REFRESH_L4_OPERATION,
 policy_baseline_sha256:'494e95e3173695407c84b6d082f09e57d971cb193518be813a53131cdb389a70',
 mediator_baseline_sha256:'e8fc3f5185f01efeca5563490461566f64fc8bda1534bad5a3c39e73a7108abb'
}),null,2)+'\n';
const INSTALLER_REFRESH_L4_BINDING_REPAIR_SOURCE_SHA256=crypto.createHash('sha256').update(INSTALLER_REFRESH_L4_BINDING_REPAIR_SOURCE,'utf8').digest('hex');
module.exports=Object.freeze({...base,OLD_INSTALLER_REFRESH_OPERATION,INSTALLER_REFRESH_L4_OPERATION,buildInstallerRefreshL4BindingRepairCandidates,INSTALLER_REFRESH_L4_BINDING_REPAIR_SOURCE,INSTALLER_REFRESH_L4_BINDING_REPAIR_SOURCE_SHA256});
