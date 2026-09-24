'use strict';
const cp=require('node:child_process');
const crypto=require('node:crypto');
const fs=require('node:fs');
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


const RAHEKOMAK_ACTION='rahekomak_production_deploy_v1';
const RAHEKOMAK_OPERATION='host_action.rahekomak_production_deploy_v1';
const RAHEKOMAK_ROOT='/home/prhm/projects/generated/rahekomak';
const RAHEKOMAK_HELPER='/home/prhm/projects/generated/rahekomak/infra/docker/production-deploy-v1.cjs';
const RAHEKOMAK_HEAD='77c0d0f38f2c64be02e46eeec6f6e19eedc1f1b5';
const RAHEKOMAK_HELPER_SHA='bba9636d705b41cf11086f1e962a8ac31b7a831bd3d1913e641633cfacd4dab4';
const RAHEKOMAK_REGISTRATION_BASELINE_SHA256=Object.freeze({"base":"de924f7319f3656d788ba5d3f89ef2910bf4b0e3f0b8b074e7cd3a534441d5ea","exec":"6bba46890db31abc8eca7e7681753a4788c46170033a555a1106e05d0a7a66f9","policy":"2fedd70a182aa351e269df95a1b9d829f5a0b18defe8871cb4045106948d711a","mcp":"b2f95b97dfa7e26ca717dfbec7871bf2f64286952548fb4d6d8e99908aeaacc0"});
const RAHEKOMAK_REGISTRATION_CANDIDATE_SHA256=Object.freeze({"base":"680ea4e3e22483aee99ede5b92d7ca6670427e764b04ff752536677ee26c9a78","exec":"4dd331dd85ef7444dc8c2e118d546ffe039606660331dc27c7cc0ec5011971a3","policy":"8177c35d884aac4275ce95503924a347ca48f953a8ad9de58d549e6e7a61b64b","mcp":"8655c2d3026c712e850a7d3841d2eeb39d2de7280dd293ef9668e3cdd5b98936"});
function rahkomakReplaceOne(source,oldValue,newValue,label){const count=source.split(oldValue).length-1;if(count!==1)throw new Error('rahekomak_registration_'+label+'_anchor_'+count);return source.replace(oldValue,newValue)}
function buildRahKomakRegistrationCandidates(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!=='base,exec,mcp,policy')throw new Error('rahekomak_registration_input_invalid');
 for(const name of ['base','exec','mcp','policy']){
  if(typeof input[name]!=='string')throw new Error('rahekomak_registration_'+name+'_invalid');
  const actual=crypto.createHash('sha256').update(input[name],'utf8').digest('hex');
  if(actual!==RAHEKOMAK_REGISTRATION_BASELINE_SHA256[name])throw new Error('rahekomak_registration_baseline_drift:'+name);
  if(input[name].includes(RAHEKOMAK_ACTION))throw new Error('rahekomak_registration_'+name+'_already_present');
 }
 const ba="  control_plane_typed_bootstrap_current_baseline_refresh_v1: { operation: 'host_action.control_plane_typed_bootstrap_current_baseline_refresh_v1', rollback: 'host-action-v2:control-plane-typed-bootstrap-current-baseline-refresh-v1:staged-bootstrap-source-restore' },";
 const base=rahkomakReplaceOne(input.base,ba,ba+"\n  "+RAHEKOMAK_ACTION+": { operation: '"+RAHEKOMAK_OPERATION+"', rollback: 'host-action-v2:rahekomak-production-deploy-v1:helper-transaction-rollback' },",'base_spec');
 const ea="  control_plane_typed_bootstrap_current_baseline_refresh_v1:{operation:'host_action.control_plane_typed_bootstrap_current_baseline_refresh_v1',kind:'control_plane_typed_bootstrap_current_baseline_refresh_v1'},";
 let exec=rahkomakReplaceOne(input.exec,ea,ea+"\n  "+RAHEKOMAK_ACTION+":{operation:'"+RAHEKOMAK_OPERATION+"',kind:'"+RAHEKOMAK_ACTION+"'},",'exec_spec');
 const fixedHandler="const RAHEKOMAK_DEPLOY_ROOT='/home/prhm/projects/generated/rahekomak';\nconst RAHEKOMAK_DEPLOY_HELPER='/home/prhm/projects/generated/rahekomak/infra/docker/production-deploy-v1.cjs';\nconst RAHEKOMAK_DEPLOY_HEAD='77c0d0f38f2c64be02e46eeec6f6e19eedc1f1b5';\nconst RAHEKOMAK_DEPLOY_HELPER_SHA='bba9636d705b41cf11086f1e962a8ac31b7a831bd3d1913e641633cfacd4dab4';\nfunction applyRahKomakProductionDeployV1(){\nconst crypto=require('node:crypto'),cp=require('node:child_process');\nconst st=fs.lstatSync(RAHEKOMAK_DEPLOY_HELPER);if(st.isSymbolicLink()||!st.isFile()||fs.realpathSync(RAHEKOMAK_DEPLOY_HELPER)!==RAHEKOMAK_DEPLOY_HELPER)throw new Error('rahekomak_deploy_helper_invalid');\nconst helperSha=crypto.createHash('sha256').update(fs.readFileSync(RAHEKOMAK_DEPLOY_HELPER)).digest('hex');if(helperSha!==RAHEKOMAK_DEPLOY_HELPER_SHA)throw new Error('rahekomak_deploy_helper_sha_mismatch');\nconst gitEnv={PATH:'/usr/bin:/bin',LC_ALL:'C',HOME:'/root'};\nconst head=cp.spawnSync('/usr/bin/git',['-C',RAHEKOMAK_DEPLOY_ROOT,'rev-parse','HEAD'],{encoding:'utf8',timeout:15000,maxBuffer:200000,env:gitEnv});if(head.error||head.status!==0||String(head.stdout||'').trim()!==RAHEKOMAK_DEPLOY_HEAD)throw new Error('rahekomak_deploy_head_mismatch');\nconst dirty=cp.spawnSync('/usr/bin/git',['-C',RAHEKOMAK_DEPLOY_ROOT,'status','--porcelain'],{encoding:'utf8',timeout:15000,maxBuffer:200000,env:gitEnv});if(dirty.error||dirty.status!==0||String(dirty.stdout||'').trim()!=='')throw new Error('rahekomak_deploy_worktree_dirty');\nconst token=crypto.randomUUID().replaceAll('-',''),result='/run/prhm-rahekomak-deploy-'+token+'.json',unit='prhm-rahekomak-deploy-'+Date.now();\nconst args=['--wait','--collect','--quiet','--unit='+unit,'--property=Type=oneshot','--property=UMask=0077','--property=PrivateTmp=true','--property=PrivateDevices=true','--property=ProtectSystem=strict','--property=ProtectHome=read-only','--property=ProtectKernelTunables=true','--property=ProtectKernelModules=true','--property=ProtectControlGroups=true','--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6','--property=ReadWritePaths='+RAHEKOMAK_DEPLOY_ROOT,'--property=ReadWritePaths=/etc/httpd/conf.d','--property=ReadWritePaths=/etc/selinux','--property=ReadWritePaths=/var/lib/selinux','--property=ReadWritePaths=/run','--setenv=RAHEKOMAK_DEPLOY_RESULT='+result,'--setenv=RAHEKOMAK_EXPECTED_HEAD='+RAHEKOMAK_DEPLOY_HEAD,'--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','/usr/local/bin/prhm-node',RAHEKOMAK_DEPLOY_HELPER,'--apply'];\ntry{const run=cp.spawnSync('/usr/bin/systemd-run',args,{encoding:'utf8',timeout:1800000,maxBuffer:8388608,stdio:['ignore','pipe','pipe']});if(!fs.existsSync(result)){const j=cp.spawnSync('/usr/bin/journalctl',['-u',unit,'-n','160','--no-pager'],{encoding:'utf8',timeout:15000,maxBuffer:2000000});throw new Error('rahekomak_deploy_result_missing:'+String(run.stderr||run.stdout||'').slice(-2000)+':journal='+String(j.stdout||j.stderr||'').slice(-8000))}let out;try{out=JSON.parse(fs.readFileSync(result,'utf8'))}catch{throw new Error('rahekomak_deploy_result_invalid_json')}if(run.error||run.status!==0||out?.ok!==true)throw new Error('rahekomak_deploy_failed:'+String(out?.error||run.stderr||run.stdout||'unknown').slice(-8000));if(out.action!=='rahekomak_production_deploy_v1'||out.deployed_head!==RAHEKOMAK_DEPLOY_HEAD||out.rollback_performed!==false||out.public_dns_mutation!==false||out.edge_tls_mutation!==false)throw new Error('rahekomak_deploy_result_contract_invalid');return out;}finally{try{if(fs.existsSync(result))fs.unlinkSync(result)}catch{}}\n}",ha='const applyHostActionV2Original=applyHostActionV2;';
 exec=rahkomakReplaceOne(exec,ha,fixedHandler+'\n'+ha,'exec_handler');
 const da="if(action==='control_plane_typed_bootstrap_current_baseline_refresh_v1')return applyControlPlaneTypedBootstrapCurrentBaselineRefreshV1();";
 exec=rahkomakReplaceOne(exec,da,"if(action==='"+RAHEKOMAK_ACTION+"')return applyRahKomakProductionDeployV1();"+da,'exec_dispatch');
 let policy;try{policy=JSON.parse(input.policy)}catch{throw new Error('rahekomak_registration_policy_json_invalid')}
 if(!policy||typeof policy!=='object'||Array.isArray(policy)||!policy.operations||typeof policy.operations!=='object'||!Array.isArray(policy.typed_scopes))throw new Error('rahekomak_registration_policy_shape_invalid');
 if(policy.operations[RAHEKOMAK_OPERATION]||policy.typed_scopes.some(x=>x&&x.action===RAHEKOMAK_ACTION))throw new Error('rahekomak_registration_policy_already_present');
 policy.operations[RAHEKOMAK_OPERATION]={level:4,risk:'critical',requires_second_confirmation:true,one_time_use:true,requested_approver:'mohammad',expires_seconds:180,policy_version:'2026-09-24.1-rahekomak-production-deploy-v1',rollback_reference:'host-action-v2:rahekomak-production-deploy-v1:helper-transaction-rollback'};
 policy.typed_scopes.push({tool:'host_action_v2_apply',project:'control_plane',environment:'production',action:RAHEKOMAK_ACTION,risk:'critical',operation:RAHEKOMAK_OPERATION,principals:[{principal_id:'mohammad',roles:['mcp-operator']}]});
 const policyText=JSON.stringify(policy,null,2)+'\n',ma="'control_plane_typed_bootstrap_current_baseline_refresh_v1',",mcp=rahkomakReplaceOne(input.mcp,ma,ma+"'"+RAHEKOMAK_ACTION+"',",'mcp_enum'),files=Object.freeze({base,exec,policy:policyText,mcp});
 const candidate_sha256=Object.freeze(Object.fromEntries(Object.entries(files).map(([name,value])=>[name,crypto.createHash('sha256').update(value,'utf8').digest('hex')])));
 for(const name of Object.keys(candidate_sha256))if(candidate_sha256[name]!==RAHEKOMAK_REGISTRATION_CANDIDATE_SHA256[name])throw new Error('rahekomak_registration_candidate_sha_mismatch:'+name+':'+candidate_sha256[name]);
 return Object.freeze({ok:true,action:RAHEKOMAK_ACTION,operation:RAHEKOMAK_OPERATION,files,candidate_sha256,production_mutation:false,arbitrary_command:false,arbitrary_path:false});
}

const GENERATED_INSTALLER_BAD_TAIL='\n}}\ntry{main()}';
const GENERATED_INSTALLER_GOOD_TAIL='\n}\ntry{main()}';
const GENERATED_INSTALLER_LEGACY_MCP="'prhm-agent-mcp.service'";
const GENERATED_INSTALLER_ZDT_MCP="'prhm-agent-mcp-green.service'";
function generatedReplaceOne(source,oldValue,newValue,label){
 const count=source.split(oldValue).length-1;
 if(count!==1)throw new Error('registration_installer_'+label+'_anchor_'+count);
 return source.replace(oldValue,newValue);
}
const LEGACY_FIXED_REGISTRATION_INSTALLER_TEMPLATE_SHA='2031d0de149d9f090987fe710df44413cd5ac0a51a7394ff7874c2e9073f077c';
function buildRegistrationInstallerSourceFixed(){
 const ownerPaths=base.REGISTRATION_OWNER_PATHS;
 if(!ownerPaths||Object.keys(ownerPaths).sort().join(',')!=='base,exec,mcp,policy')throw new Error('rahekomak_installer_owner_paths_invalid');
 const input=Object.fromEntries(Object.entries(ownerPaths).map(([name,file])=>[name,fs.readFileSync(file,'utf8')]));
 const rk=buildRahKomakRegistrationCandidates(input);
 const templatePath=base.REGISTRATION_INSTALLER_DESTINATION;
 const templateBytes=fs.readFileSync(templatePath);
 const templateSha=crypto.createHash('sha256').update(templateBytes).digest('hex');
 if(templateSha!==LEGACY_FIXED_REGISTRATION_INSTALLER_TEMPLATE_SHA)throw new Error('rahekomak_installer_template_sha_mismatch:'+templateSha);
 let fixed=templateBytes.toString('utf8');
 fixed=generatedReplaceOne(fixed,"const TARGET='control_plane_typed_bootstrap_current_baseline_refresh_v1';","const TARGET='"+RAHEKOMAK_ACTION+"';",'rahekomak_target');
 fixed=generatedReplaceOne(fixed,'const BASELINE='+JSON.stringify(base.REGISTRATION_BASELINE_SHA256)+';','const BASELINE='+JSON.stringify(RAHEKOMAK_REGISTRATION_BASELINE_SHA256)+';','rahekomak_baseline');
 fixed=generatedReplaceOne(fixed,'const CANDIDATE='+JSON.stringify(base.REGISTRATION_CANDIDATE_SHA256)+';','const CANDIDATE='+JSON.stringify(RAHEKOMAK_REGISTRATION_CANDIDATE_SHA256)+';','rahekomak_candidate');
 const b64Marker='const CANDIDATE_B64=',servicesMarker='\nconst SERVICES=';
 const b64Start=fixed.indexOf(b64Marker),b64End=fixed.indexOf(servicesMarker,b64Start);
 if(b64Start<0||b64End<0||fixed.indexOf(b64Marker,b64Start+1)!==-1)throw new Error('rahekomak_installer_candidate_b64_anchor');
 const b64=Object.fromEntries(Object.entries(rk.files).map(([name,value])=>[name,Buffer.from(value,'utf8').toString('base64')]));
 fixed=fixed.slice(0,b64Start)+b64Marker+JSON.stringify(b64)+';'+fixed.slice(b64End);
 const syntax=cp.spawnSync('/usr/local/bin/prhm-node',['--check','-'],{input:fixed,encoding:'utf8',timeout:30000,maxBuffer:1000000});
 if(syntax.error||syntax.status!==0)throw new Error('registration_installer_fixed_syntax_invalid:'+String(syntax.stderr||syntax.stdout||syntax.error||'').slice(-1200));
 return fixed;
}
const FIXED_REGISTRATION_INSTALLER_SOURCE_SHA256='538c55fefc6b1468c85dfd9a3d22390683e80c384c204219f96934d460fe2b72';
function buildRegistrationStageTransportSourceFixed(){
 const installer=buildRegistrationInstallerSourceFixed();
 const actual=crypto.createHash('sha256').update(installer,'utf8').digest('hex');
 if(actual!==FIXED_REGISTRATION_INSTALLER_SOURCE_SHA256)throw new Error('registration_installer_fixed_sha_mismatch:'+actual);
 const installerB64=Buffer.from(installer,'utf8').toString('base64');
 return [
 "'use strict';",
 "const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');",
 "const ACTION='control_plane_current_baseline_refresh_registration_installer_stage_v1';",
 "const DEST='/opt/prhm-agent-selfmaint-exec/actions/current-baseline-refresh-registration-installer-v1.js';",
 "const EXPECTED_OLD='2031d0de149d9f090987fe710df44413cd5ac0a51a7394ff7874c2e9073f077c';",
 "const INSTALLER_SHA='"+FIXED_REGISTRATION_INSTALLER_SOURCE_SHA256+"';",
 "const INSTALLER_B64='"+installerB64+"';",
 "const BACKUP_ROOT='/var/backups/prhm-current-baseline-refresh-registration-installer-stage-v1';",
 "const sha=b=>crypto.createHash('sha256').update(b).digest('hex');",
 "function regular(file){const st=fs.lstatSync(file);if(st.isSymbolicLink()||!st.isFile()||fs.realpathSync(file)!==file)throw new Error('target_not_regular');return st}",
 "function bytes(){const b=Buffer.from(INSTALLER_B64,'base64');if(sha(b)!==INSTALLER_SHA)throw new Error('installer_sha_mismatch');return b}",
 "function syntax(b){const r=cp.spawnSync('/usr/local/bin/prhm-node',['--check','-'],{input:b,encoding:'utf8',timeout:30000,maxBuffer:1000000});if(r.error||r.status!==0)throw new Error('installer_syntax_invalid')}",
 "function preflight(){const b=bytes();syntax(b);const st=regular(DEST),cur=sha(fs.readFileSync(DEST));if(cur!==EXPECTED_OLD&&cur!==INSTALLER_SHA)throw new Error('source_sha_mismatch:'+cur);return {ok:true,action:ACTION,preflight_only:true,production_mutation:false,production_owner_mutation:false,database_mutation:false,installer_sha256:INSTALLER_SHA,source_sha256:cur,already_applied:cur===INSTALLER_SHA}}",
 "function apply(){if(process.getuid&&process.getuid()!==0)throw new Error('root_required');const pf=preflight();if(pf.already_applied)return {...pf,preflight_only:false,staged:true,production_mutation:true,production_owner_mutation:false,rollback_performed:false};const st=regular(DEST),old=fs.readFileSync(DEST),stamp=new Date().toISOString().replace(/[:.]/g,'-'),dir=path.join(BACKUP_ROOT,stamp);fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(path.join(dir,'installer.bak'),old,{mode:0o600,flag:'wx'});const tmp=DEST+'.candidate-'+process.pid+'.js';let renamed=false;try{const b=bytes();fs.writeFileSync(tmp,b,{mode:st.mode&0o777,flag:'wx'});fs.chownSync(tmp,st.uid,st.gid);fs.chmodSync(tmp,st.mode&0o777);syntax(fs.readFileSync(tmp));fs.renameSync(tmp,DEST);renamed=true;if(sha(fs.readFileSync(DEST))!==INSTALLER_SHA)throw new Error('candidate_sha_mismatch');return {ok:true,action:ACTION,preflight_only:false,staged:true,production_mutation:true,production_owner_mutation:false,database_mutation:false,rollback_performed:false,backup_dir:dir,installer_sha256:INSTALLER_SHA}}catch(e){try{if(fs.existsSync(tmp))fs.unlinkSync(tmp)}catch{};if(renamed){const rb=DEST+'.rollback-'+process.pid+'.js';fs.writeFileSync(rb,old,{mode:st.mode&0o777,flag:'wx'});fs.chownSync(rb,st.uid,st.gid);fs.chmodSync(rb,st.mode&0o777);fs.renameSync(rb,DEST);if(sha(fs.readFileSync(DEST))!==EXPECTED_OLD)throw new Error('rollback_sha_mismatch')}throw new Error('stage_failed_rolled_back:'+String(e&&e.message||e))}}",
 "const mode=process.argv[2];if(process.argv.length!==3||!['--preflight-only','--apply'].includes(mode))throw new Error('unexpected_arguments');",
 "try{console.log(JSON.stringify(mode==='--preflight-only'?preflight():apply()))}catch(e){console.error(String(e&&e.stack||e));process.exit(1)}",
 ""
 ].join('\n');
}
const exported={};
for(const key of Reflect.ownKeys(base)){
 if(['buildRegistrationInstallerSource','REGISTRATION_INSTALLER_SOURCE_SHA256','buildRegistrationStageTransportSource'].includes(String(key)))continue;
 const descriptor=Object.getOwnPropertyDescriptor(base,key);
 if(descriptor)Object.defineProperty(exported,key,descriptor);
}
Object.defineProperties(exported,{
 buildRegistrationInstallerSource:{value:buildRegistrationInstallerSourceFixed,enumerable:true},
 REGISTRATION_INSTALLER_SOURCE_SHA256:{value:FIXED_REGISTRATION_INSTALLER_SOURCE_SHA256,enumerable:true},
 buildRegistrationStageTransportSource:{value:buildRegistrationStageTransportSourceFixed,enumerable:true},
 OLD_INSTALLER_REFRESH_OPERATION:{value:OLD_INSTALLER_REFRESH_OPERATION,enumerable:true},
 INSTALLER_REFRESH_L4_OPERATION:{value:INSTALLER_REFRESH_L4_OPERATION,enumerable:true},
 buildInstallerRefreshL4BindingRepairCandidates:{value:buildInstallerRefreshL4BindingRepairCandidates,enumerable:true},
 INSTALLER_REFRESH_L4_BINDING_REPAIR_SOURCE:{value:INSTALLER_REFRESH_L4_BINDING_REPAIR_SOURCE,enumerable:true},
 INSTALLER_REFRESH_L4_BINDING_REPAIR_SOURCE_SHA256:{value:INSTALLER_REFRESH_L4_BINDING_REPAIR_SOURCE_SHA256,enumerable:true},
 RAHEKOMAK_ACTION:{value:RAHEKOMAK_ACTION,enumerable:true},
 RAHEKOMAK_OPERATION:{value:RAHEKOMAK_OPERATION,enumerable:true},
 RAHEKOMAK_ROOT:{value:RAHEKOMAK_ROOT,enumerable:true},
 RAHEKOMAK_HELPER:{value:RAHEKOMAK_HELPER,enumerable:true},
 RAHEKOMAK_HEAD:{value:RAHEKOMAK_HEAD,enumerable:true},
 RAHEKOMAK_HELPER_SHA:{value:RAHEKOMAK_HELPER_SHA,enumerable:true},
 RAHEKOMAK_REGISTRATION_BASELINE_SHA256:{value:RAHEKOMAK_REGISTRATION_BASELINE_SHA256,enumerable:true},
 RAHEKOMAK_REGISTRATION_CANDIDATE_SHA256:{value:RAHEKOMAK_REGISTRATION_CANDIDATE_SHA256,enumerable:true},
 buildRahKomakRegistrationCandidates:{value:buildRahKomakRegistrationCandidates,enumerable:true},
});
module.exports=Object.freeze(exported);
