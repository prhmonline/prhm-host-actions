'use strict';
/**
 * A04 EXACT FOUR-FILE REGISTRATION PLAN (SOURCE ONLY, no CLI apply).
 *
 * This module cannot register a live action, issue an owner permit, install a
 * root dispatcher, restart services or write any production path. All four
 * source preimages must match SHA-256 from the 2026-11-13 live host audit.
 * Activation needs a separate signed root-owned transaction with rollback.
 */
const crypto=require('node:crypto');
const ACTION='universal_existing_stateful_service_observe_adoption_v2';
const OPERATION='host_action.'+ACTION;
const OWNER_OPERATION='universal.existing_stateful_service_observe_adoption_v2';
const DRIVER_SHA='d9d4a3a5d4cb6e6fe6744637e73113c6759709f9';
const BEFORE=Object.freeze({
  base:'57828b344aca1d1fb51e74cc2c64094edb03c5fd86fe68420d7185f0d12b6530',
  exec:'4c136a210681ee07a45d96d38d91c1253afcce67feed0a9d062f9f14d0557169',
  policy:'26359a31efdfe0acde07cc9f4001afddee98efaa206e4528880068bf93c425f5',
  mcp:'0c6a74757696a0d85840a0aec1bc53c91431481024f2be56e4ecb02f789073ef'
});
const PATHS=Object.freeze({
  base:'/opt/prhm-agent-selfmaint/server.js',
  exec:'/opt/prhm-agent-selfmaint-exec/server.js',
  policy:'/opt/prhm-company-control-plane/config/approval-policy.json',
  mcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js'
});
const fail=x=>{throw Error('a04_review_registry_'+x)};
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function once(source,oldText,newText,label){
  if(typeof source!=='string'||source.split(oldText).length!==2)
    fail('unique_anchor_missing_'+label);
  return source.replace(oldText,newText);
}
function patchBase(src){
  const anchor="  host_action_v2_installer_v1: { operation: 'host_action.host_action_v2_installer_v1', rollback: 'host-action-v2:host-action-v2-installer-v1:four-file-restore' },";
  const line="  "+ACTION+": { operation: '"+OPERATION+"', rollback: 'host-action-v2:a04-solo-v2:root-journal-restore' },";
  const out=once(src,anchor,anchor+'\n'+line,'base');
  if(!out.includes('HOST_ACTION_V2_LEVEL3'))fail('level_classifier_missing');
  const level3=out.match(/const HOST_ACTION_V2_LEVEL3 = new Set\((\[[^\n]+\])\)/);
  if(!level3||level3[1].includes(ACTION))fail('a04_level3_not_allowed');
  return out;
}
const CALLBACK=[
  "async function applySoloUniversalV2A04(){",
  "  const sourceRoot='/var/lib/prhm-agent-selfmaint-exec/solo-universal-v2-reviewed-source';",
  "  const driverSha='d9d4a3a5d4cb6e6fe6744637e73113c6759709f9';",
  "  const deny=x=>{throw Error('a04_fixed_host_action_'+x)};",
  "  const st=fs.lstatSync(sourceRoot);",
  "  if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==0||st.gid!==0||",
  "     (st.mode&0o777)!==0o700)deny('source_directory_untrusted');",
  "  const gopts={encoding:'utf8',timeout:8000,maxBuffer:2048,",
  "    env:{PATH:'/usr/bin:/bin',LANG:'C',HOME:'/nonexistent',",
  "         GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',",
  "         GIT_TERMINAL_PROMPT:'0'}};",
  "  const git=args=>cp.execFileSync('/usr/bin/git',['-C',sourceRoot,...args],gopts).trim();",
  "  if(git(['rev-parse','HEAD'])!==driverSha||git(['status','--porcelain'])!=='')",
  "    deny('immutable_git_source_drift');",
  "  const driver=path.join(sourceRoot,'solo-universal-v2-native-root-dispatcher-v1.cjs');",
  "  const ds=fs.lstatSync(driver);",
  "  if(!ds.isFile()||ds.isSymbolicLink()||ds.uid!==0||ds.gid!==0||",
  "     (ds.mode&0o022)!==0)deny('driver_file_not_trusted');",
  "  const api=require(driver);",
  "  if(typeof api.applyAuthorizedRelease!=='function')deny('driver_entry_missing');",
  "  /* The canonical driver independently verifies fresh owner Ed25519 JWS,",
  "   * replay ledger, immutable payload, live preimage and durable rollback. */",
  "  const result=await api.applyAuthorizedRelease();",
  "  if(!result||result.status!=='COMMITTED'||",
  "     result.operation!=='universal.existing_stateful_service_observe_adoption_v2'||",
  "     result.observer_registered!==true||",
  "     result.managed_for_deployment!==false||",
  "     result.solo_runtime_restarted!==false)deny('signed_postflight_missing');",
  "  return {ok:true,schema_version:'prhm.host-action-result.v1',",
  "    action:'universal_existing_stateful_service_observe_adoption_v2',",
  "    observer_registered:true,managed_by_universal:false,",
  "    solo_restart:false,solo_state_modified:false,",
  "    owner_grant_cryptographically_verified:true,rollback_performed:false};",
  "}"
].join('\n');
function patchExec(src){
  const anchor="  host_action_v2_installer_v1:{operation:'host_action.host_action_v2_installer_v1',kind:'host_action_v2_installer_v1'},";
  let out=once(src,anchor,anchor+'\n'+"  "+ACTION+":{operation:'"+OPERATION+"',kind:'"+ACTION+"'},",'exec_specs');
  const prefix="applyHostActionV2=async function(action){if(action==='solo_company_runtime_install_v1')";
  out=once(out,prefix,CALLBACK+'\n'+
    "applyHostActionV2=async function(action){if(action==='"+ACTION+
    "')return applySoloUniversalV2A04();if(action==='solo_company_runtime_install_v1')",
    'exec_dispatch');
  return out;
}
function patchPolicy(src){
  let doc;try{doc=JSON.parse(src)}catch{fail('policy_invalid_json')}
  if(!doc||typeof doc!=='object'||Array.isArray(doc)||
     !doc.operations||typeof doc.operations!=='object'||
     !Array.isArray(doc.typed_scopes))fail('policy_structure_drift');
  if(Object.hasOwn(doc.operations,OPERATION)||
     doc.typed_scopes.some(s=>s?.action===ACTION))
    fail('policy_action_already_defined');
  doc.operations[OPERATION]={
    level:4,risk:'critical',requires_second_confirmation:true,
    one_time_use:true,requested_approver:'mohammad',expires_seconds:180,
    policy_version:'solo-universal-a04-observe-only-v2',
    rollback_reference:'host-action-v2:a04-solo-v2:root-journal-restore'
  };
  doc.typed_scopes.push({
    tool:'host_action_v2_apply',project:'control_plane',environment:'production',
    action:ACTION,risk:'critical',operation:OPERATION,
    principals:[{principal_id:'mohammad',roles:['mcp-operator']}]
  });
  return JSON.stringify(doc,null,2)+'\n';
}
function patchMcp(src){
  const anchor="'host_action_v2_installer_v1','imotion_marketing_target_register_v1'";
  const replacement="'host_action_v2_installer_v1','"+ACTION+
    "','imotion_marketing_target_register_v1'";
  return once(src,anchor,replacement,'mcp_enum');
}
function review(sources){
  if(!sources||typeof sources!=='object'||Array.isArray(sources)||
     Object.keys(sources).sort().join('|')!==Object.keys(BEFORE).sort().join('|'))
    fail('four_exact_sources_required');
  const functions={base:patchBase,exec:patchExec,policy:patchPolicy,mcp:patchMcp};
  const files={},after={};
  for(const key of Object.keys(BEFORE)){
    if(typeof sources[key]!=='string'||sha(Buffer.from(sources[key]))!==BEFORE[key])
      fail('sha256_preimage_mismatch_'+key);
    const result=functions[key](sources[key]);
    if(result===sources[key])fail('no_change_'+key);
    files[key]=result;after[key]=sha(Buffer.from(result));
  }
  return Object.freeze({
    schema:'prhm.host-actions.a04.review-only-four-file-registration.v1',
    operation:OWNER_OPERATION,action:ACTION,level:4,
    approved_canonical_driver_sha:DRIVER_SHA,
    root_driver_staged:false,owner_signed_receipt_present:false,
    owner_level4_approval_is_not_signature:true,registered:false,
    production_mutation:false,can_apply:false,preimages:BEFORE,
    postimages:Object.freeze(after),paths:PATHS,
    planned_files:Object.freeze(files),
    expected_observer_managed_by_universal:false
  });
}
module.exports=Object.freeze({
  ACTION,OPERATION,OWNER_OPERATION,DRIVER_SHA,BEFORE,PATHS,
  sha,patchBase,patchExec,patchPolicy,patchMcp,review
});
if(require.main===module){
  process.stderr.write('SOURCE_ONLY_NO_PRODUCTION_REGISTRATION\n');
  process.exitCode=64;
}
