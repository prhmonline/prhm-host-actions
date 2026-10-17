'use strict';
/**
 * READ-ONLY validation of ORIGINAL root installer patch-anchor compatibility.
 * No file writes, file reading, process spawn, network, execution of installer
 * code, approval, secret output, or live service changes. Pure function only.
 *
 * IMPORTANT: This intentionally checks what the EXISTING failed installer
 * would try to patch, not whether registration is approved for Production.
 */
const crypto=require('node:crypto');
const vm=require('node:vm');
const {ORDER,OWNERS,INSTALLER_SHA256}=require('./honartik-iticket-root-installer-four-owner-review-v1.cjs');
const sha256=b=>crypto.createHash('sha256').update(b).digest('hex');
const TARGET='honartik_git_worktree_fixed_v1';
const OP='host_action.honartik_git_worktree_fixed_v1';
const LF='\n';

const ANCHOR=Object.freeze({
  base: "  agent_zero_downtime_bootstrap_v1: { operation: 'host_action.agent_zero_downtime_bootstrap_v1', rollback: 'host-action-v2:agent-zero-downtime-bootstrap-v1:backup-restore' },\n  host_action_v2_installer_v1: { operation: 'host_action.host_action_v2_installer_v1', rollback: 'host-action-v2:host-action-v2-installer-v1:four-file-restore' }\n});",
  execSpec: "  host_action_v2_installer_v1:{operation:'host_action.host_action_v2_installer_v1',kind:'host_action_v2_installer_v1'}\n});",
  execHelper: "const applyHostActionV2Original=applyHostActionV2;\n",
  execDispatch: "applyHostActionV2=async function(action){if(action==='host_action_v2_installer_v1')return applyHostActionV2InstallerV1();if(action==='agent_zero_downtime_bootstrap_v1')return applyAgentZeroDowntimeBootstrapV1();return applyHostActionV2Original(action);};",
  mcpEnum: "'agent_zero_downtime_bootstrap_v1','host_action_v2_installer_v1']);"
});
const INSERT=Object.freeze({
  base: "  agent_zero_downtime_bootstrap_v1: { operation: 'host_action.agent_zero_downtime_bootstrap_v1', rollback: 'host-action-v2:agent-zero-downtime-bootstrap-v1:backup-restore' },\n  host_action_v2_installer_v1: { operation: 'host_action.host_action_v2_installer_v1', rollback: 'host-action-v2:host-action-v2-installer-v1:four-file-restore' },\n  honartik_git_worktree_fixed_v1: { operation: 'host_action.honartik_git_worktree_fixed_v1', rollback: 'host-action-v2:honartik-git-worktree-fixed-v1:worktree-remove' }\n});",
  execSpec: "  host_action_v2_installer_v1:{operation:'host_action.host_action_v2_installer_v1',kind:'host_action_v2_installer_v1'},\n  honartik_git_worktree_fixed_v1:{operation:'host_action.honartik_git_worktree_fixed_v1',kind:'honartik_git_worktree_fixed_v1'}\n});",
  execHelper: "const HONARTIK_GIT_WORKTREE_FIXED_HELPER='/opt/prhm-agent-selfmaint-exec/actions/honartik-git-worktree-fixed-v1.js';\nconst HONARTIK_GIT_WORKTREE_FIXED_RESULT='/var/lib/prhm-agent-selfmaint-exec/honartik-git-worktree-fixed-v1/latest.json';\nfunction applyHonartikGitWorktreeFixedV1(){if(!fs.existsSync(HONARTIK_GIT_WORKTREE_FIXED_HELPER))throw new Error('honartik_git_worktree_fixed_helper_missing');try{if(fs.existsSync(HONARTIK_GIT_WORKTREE_FIXED_RESULT))fs.unlinkSync(HONARTIK_GIT_WORKTREE_FIXED_RESULT)}catch{};const u='prhm-honartik-git-worktree-fixed-v1-'+Date.now();const a=['--wait','--unit='+u,'--property=Type=oneshot','--property=UMask=0077','--property=NoNewPrivileges=true','--property=PrivateTmp=true','--property=ProtectSystem=strict','--property=ProtectHome=read-only','--property=ReadWritePaths=/home/honartik /var/lib/prhm-agent-selfmaint-exec','--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','/usr/local/bin/prhm-node',HONARTIK_GIT_WORKTREE_FIXED_HELPER];cp.execFileSync('/usr/bin/systemd-run',a,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:300000});const r=readJson(HONARTIK_GIT_WORKTREE_FIXED_RESULT);if(r.ok!==true||r.action!=='honartik_git_worktree_fixed_v1'||r.schema_version!=='prhm.host-action-result.v1'||r.release_candidate_ready!==true||r.production_deploy!==false)throw new Error('honartik_git_worktree_fixed_result_invalid');return r}\n",
  execDispatch: "applyHostActionV2=async function(action){if(action==='honartik_git_worktree_fixed_v1')return applyHonartikGitWorktreeFixedV1();if(action==='host_action_v2_installer_v1')return applyHostActionV2InstallerV1();if(action==='agent_zero_downtime_bootstrap_v1')return applyAgentZeroDowntimeBootstrapV1();return applyHostActionV2Original(action);};",
  mcpEnum: "'agent_zero_downtime_bootstrap_v1','host_action_v2_installer_v1','honartik_git_worktree_fixed_v1']);"
});
function fail(code){throw Error('owner_anchor_audit_'+code);}
function exactOnce(input,oldText,newText,label){
  const n=input.split(oldText).length-1;
  if(n!==1)fail('anchor_'+label+'_count_'+n);
  return input.replace(oldText,newText);
}
function patchPure(sources){
  if(!sources||ORDER.some(k=>typeof sources[k]!=='string'))fail('sources_invalid');
  const result={};
  result.base=exactOnce(sources.base,ANCHOR.base,INSERT.base,'base');
  let ex=exactOnce(sources.exec,ANCHOR.execSpec,INSERT.execSpec,'exec_spec');
  ex=exactOnce(ex,ANCHOR.execHelper,INSERT.execHelper+ANCHOR.execHelper,'exec_helper');
  result.exec=exactOnce(ex,ANCHOR.execDispatch,INSERT.execDispatch,'exec_dispatch');
  result.mcp=exactOnce(sources.mcp,ANCHOR.mcpEnum,INSERT.mcpEnum,'mcp_enum');
  let data;
  try{data=JSON.parse(sources.policy);}
  catch{fail('policy_json_invalid');}
  if(!data||typeof data!=='object'||!data.operations||typeof data.operations!=='object'||
     !Array.isArray(data.typed_scopes))fail('policy_shape_invalid');
  if(data.operations[OP]||data.typed_scopes.some(x=>x&&x.action===TARGET))
    fail('policy_action_already_registered');
  data.operations[OP]={level:4};  // faithful to original installer source
  data.typed_scopes.push({tool:'host_action_v2_apply',project:'control_plane',
    environment:'production',action:TARGET,risk:'critical',operation:OP,
    principals:[{principal_id:'mohammad',roles:['mcp-operator']}]});
  result.policy=JSON.stringify(data,null,2)+LF;
  return result;
}
function verifySyntax(patched){
  for(const k of ['base','exec']){
    try{new vm.Script(patched[k],{filename:'in-memory-'+k+'.js'});}
    catch{fail('postimage_syntax_invalid_'+k);}
  }
  try{JSON.parse(patched.policy);}
  catch{fail('postimage_policy_json_invalid');}
  // mcp is ES module; vm.Script cannot prove ESM syntax. Explicit follow-up.
}
function audit({originalInstallerBytes,ownerBytes,helperBytes,stateBytes,expected}={}){
  if(!Buffer.isBuffer(originalInstallerBytes)||!ownerBytes||
     ORDER.some(k=>!Buffer.isBuffer(ownerBytes[k]))||
     !Buffer.isBuffer(helperBytes)||!Buffer.isBuffer(stateBytes))
    fail('trusted_bytes_missing');
  if(sha256(originalInstallerBytes)!==INSTALLER_SHA256)
    fail('original_installer_sha_drift');
  if(expected && Object.keys(expected).some(k=>!ORDER.includes(k)))fail('invalid_expectation');
  for(const k of ORDER)
    if(sha256(ownerBytes[k])!==OWNERS[k].live)fail('live_sha_drift_'+k);
  const sources=Object.fromEntries(ORDER.map(k=>[k,ownerBytes[k].toString('utf8')]));
  for(const k of ORDER)
    if(!Buffer.from(sources[k],'utf8').equals(ownerBytes[k]))fail('owner_encoding_invalid_'+k);
  let state;
  try{state=JSON.parse(stateBytes.toString('utf8'));}
  catch{fail('state_json_invalid');}
  if(!state||typeof state.honartik_worktree_helper_sha256!=='string'||
     !/^[a-f0-9]{64}$/.test(state.honartik_worktree_helper_sha256))
    fail('state_helper_binding_invalid');
  if(sha256(helperBytes)!==state.honartik_worktree_helper_sha256)
    fail('helper_sha_drift');
  const patched=patchPure(sources);
  verifySyntax(patched);
  const postimage=Object.fromEntries(ORDER.map(k=>[k,sha256(Buffer.from(patched[k]))]));
  // A Level-4 operation with only {level:4} requires effective-policy review:
  // require explicit one-time/critical/second confirmation in a NEW installer.
  const newOp=JSON.parse(patched.policy).operations[OP];
  const complete=!!(newOp.risk==='critical'&&newOp.one_time_use===true&&
    newOp.requires_second_confirmation===true);
  return Object.freeze({
    schema:'prhm.iticket.original-installer-live-anchor-audit.v1',
    root_owned_installer_original_sha256:INSTALLER_SHA256,
    owner_current_sha256:Object.fromEntries(ORDER.map(k=>[k,OWNERS[k].live])),
    owner_postimage_sha256:postimage,
    sha_check:'PASS',four_anchor_transform:'PASS',
    base_exec_syntax:'PASS',policy_json:'PASS',
    mcp_esm_syntax:'NOT_TESTED',
    helper_state_binding:'PASS',
    inserted_operation:TARGET,
    operation_security_fields_complete:complete,
    level4_effective_policy_validation:complete?'REQUIRED':'BLOCKED_INCOMPLETE_OPERATION_FIELDS',
    source_only:true,original_source_exposed:false,
    production_mutation:false,install_authorized:false,
  });
}
module.exports=Object.freeze({ANCHOR,INSERT,TARGET,OP,patchPure,verifySyntax,audit});
