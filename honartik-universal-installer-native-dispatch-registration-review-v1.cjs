'use strict';
/**
 * PRHM #217, source-only fixed native dispatcher binding review.
 * Does NOT install root helper, edit server, activate Policy, obtain/consume
 * signed Level 4 or authorize release. Replaces the exact fail-closed
 * dispatcher placeholder IN THE REVIEW CANDIDATE ONLY after verifying
 * all 3 installed owner SHA preimages and the reviewed shim Git blob.
 */
const crypto=require('node:crypto');
const P=require('./honartik-universal-installer-owner-registration-candidate-v1.cjs');
const REG=require('./honartik-universal-installer-registration-review-pack-v1.cjs');
const ACTION='honartik_universal_installer_upgrade_v1';
const SHIM='honartik-universal-installer-native-dispatch-trust-v1.cjs';
const SHIM_BLOB='bc0b277dc5979fcdaaa00674feda8bf1949ad1c1';
const SHIM_ROOT='/opt/prhm-agent-selfmaint-exec/actions/'+SHIM;
const DENY="throw new Error('honartik_universal_installer_upgrade_v1_native_root_dispatch_not_reviewed');";
const FORWARD="return require('"+SHIM_ROOT+"').runFixedRegisteredAction(l4Binding);";
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const blob=value=>crypto.createHash('sha1').update('blob '+value.length+'\0').update(value).digest('hex');
const fail=reason=>{throw Error('honartik217_review_binding_'+reason)};
function once(src,anchor,tag){
 if(typeof src!=='string'||src.split(anchor).length!==2)
  fail('ambiguous_'+tag);
}
function reviewCandidate(candidate,shimBytes){
 if(!Buffer.isBuffer(shimBytes)||blob(shimBytes)!==SHIM_BLOB)
  fail('shim_git_blob_drift');
 if(!candidate||candidate.action!==ACTION||
  candidate.security_boundary?.level4_only!==true||
  candidate.security_boundary?.root_dispatch_explicitly_denied!==true||
  candidate.security_boundary?.fixed_authenticated_request_context_injected_after_consume!==true||
  candidate.security_boundary?.consumed_token_remains_in_executor_memory!==true||
  candidate.security_boundary?.install_authorized!==false||
  candidate.security_boundary?.production_mutation!==false)
  fail('unreviewed_owner_context');
 if(JSON.stringify(candidate.source_preimages)!==
  JSON.stringify(Object.fromEntries(['base','executor','mcp'].map(k=>[k,REG.TARGETS[k].sha256]))))
  fail('owner_preimages_changed');
 const files=candidate.proposed_owner_text;
 if(!files||typeof files.base!=='string'||typeof files.executor!=='string'||typeof files.mcp!=='string')
  fail('owner_source_missing');
 once(files.executor,DENY,'fail_closed_dispatcher');
 once(files.executor,"loadConsumedServerToken:",'server_token_closure');
 once(files.executor,"authorize-consume",'consumed_route');
 const executor=files.executor.replace(DENY,FORWARD);
 once(executor,FORWARD,'native_forward');
 if(executor.includes(DENY))fail('deny_placeholder_not_removed');
 if(!files.base.includes('const HOST_ACTION_V2_LEVEL3 = new Set('))
  fail('level3_classifier_missing');
 const l3=files.base.split('const HOST_ACTION_V2_LEVEL3 = new Set(')[1].split('function hostActionV2ApprovalMeta')[0];
 if(l3.includes(ACTION))fail('level3_promotion_forbidden');
 return Object.freeze({
  schema:'prhm.honartik217.native-root-dispatch-review-only.v1',
  action:ACTION,shim_blob:SHIM_BLOB,shim_absolute_path:SHIM_ROOT,
  original_preimages:candidate.source_preimages,
  proposed_owner_sha256:Object.freeze({
   base:hash(Buffer.from(files.base)),
   executor:hash(Buffer.from(executor)),
   mcp:hash(Buffer.from(files.mcp))
  }),
  // For offline, independent source review only. No writer or CLI.
  proposed_owner_text:Object.freeze({base:files.base,executor,mcp:files.mcp}),
  security_boundary:Object.freeze({
   level4_only:true,independent_consumed_receipt_required:true,
   trusted_root_shim_blob_required:true,
   installed_helper_present:false,live_policy_activated:false,
   independent_review_complete:false,real_linux_rollback_attested:false,
   trusted_root_registration_complete:false,install_authorized:false,
   production_mutation:false
  })
 });
}
// Root-console evidence 2026-10-28, pinned four-owner preimages: main
// dispatcher has 13 fixed actions, final wrapper has 19 fixed actions.
// This is an ADDITIONAL read-only shape gate for the exact live source,
// not a signature, Root-of-Trust installation, or execution authorization.
const EXPECTED_MAIN_ACTIONS=Object.freeze([
 'parham_page_create_v1','leadops_language_gate_v1',
 'mcp_candidate_schema_compare_v1','leadops_economics_inputs_foundation_v1',
 'solo_company_selftest_v1','control_plane_current_owner_bootstrap_repair_v1',
 'real_market_shadow_uat_v1','real_market_verified_economics_uat_v1',
 'company_os_dashboard_v1','company_os_dashboard_credentials_reset_v1',
 'company_os_dashboard_persian_v1',
 'leadops_parscoders_runtime_v3_restore_v1',
 'leadops_parscoders_selinux_exec_remediate_v1'
]);
const EXPECTED_WRAPPER_ACTIONS=Object.freeze([
 'control_plane_current_owner_binding_refresh_v1',
 'agent_zdt_source_sha_refresh_publisher_v1',
 'control_plane_root_scripts_stage_transport_v1',
 'imotion_credential_bind_v1','root_scripts_fixed_stage_v1',
 'agent_zdt_existing_topology_rolling_refresh_v1',
 'drtarjomeh_security_containment_v1',
 'agent_zdt_existing_topology_rolling_refresh_rollback_v1',
 'agent_zdt_existing_topology_rolling_refresh_finalize_v1',
 'rahekomak_production_deploy_v1',
 'control_plane_typed_bootstrap_current_baseline_refresh_v1',
 'imotion_marketing_targets_register_v2',
 'imotion_marketing_target_register_v1',
 'host_action_v2_installer_v1',
 'agent_zero_downtime_bootstrap_v1',
 'honartik_iticket_dark_backend_batch1_v1',
 'honartik_iticket_dark_backend_batch2_v1',
 'honartik_iticket_dark_backend_batch2_result_bridge_helper_refresh_v1',
 'selfmaint_exec_route_refresh_v1'
]);
function inspectPinnedLiveDispatcher(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length===0||bytes.length>2_000_000)
  fail('live_executor_missing');
 const value=bytes.toString('utf8');
 if(!Buffer.from(value,'utf8').equals(bytes))fail('live_executor_not_utf8');
 const lines=value.split(/\r?\n/);
 const main=lines.filter(s=>/^\s*async function applyHostActionV2\(action\)\{/.test(s));
 const wrapper=lines.filter(s=>/^\s*applyHostActionV2=async function\(action\)\{/.test(s));
 if(main.length!==1||wrapper.length!==1||
  lines.indexOf(main[0])>=lines.indexOf(wrapper[0]))
  fail('live_dispatcher_wrapper_ambiguous');
 const actions=line=>[...line.matchAll(/if\s*\(\s*action\s*===\s*['"]([^'"]+)['"]\s*\)/g)]
  .map(m=>m[1]);
 const same=(got,expected)=>JSON.stringify(got)===JSON.stringify(expected);
 if(!same(actions(main[0]),EXPECTED_MAIN_ACTIONS))
  fail('live_main_dispatcher_shape_drift');
 if(!same(actions(wrapper[0]),EXPECTED_WRAPPER_ACTIONS))
  fail('live_final_wrapper_shape_drift');
 if(value.includes("if(action==='honartik_universal_installer_upgrade_v1')"))
  fail('live_upgrade_action_already_dispatched');
 return Object.freeze({
  main_actions:EXPECTED_MAIN_ACTIONS.length,
  final_wrapper_actions:EXPECTED_WRAPPER_ACTIONS.length,
  live_apply_authorized:false,production_mutation:false
 });
}
function previewPinnedProduction(readOwner,readShim){
 if(typeof readShim!=='function')fail('shim_reader_required');
 if(typeof readOwner!=='function')fail('owner_reader_required');
 // First SHA-pin every owner preimage; inspect only the pinned source shape.
 const candidate=P.previewOwnerPatch(readOwner);
 inspectPinnedLiveDispatcher(readOwner(REG.TARGETS.executor.path));
 return reviewCandidate(candidate,readShim(SHIM));
}
function previewIsolatedSynthetic(files,shimBytes){
 // Test-only synthetic fixtures must be clearly marked and non-root.
 return reviewCandidate(P.previewIsolatedSyntheticFixture(files),shimBytes);
}
module.exports=Object.freeze({
 ACTION,SHIM,SHIM_BLOB,SHIM_ROOT,inspectPinnedLiveDispatcher,
 EXPECTED_MAIN_ACTIONS,EXPECTED_WRAPPER_ACTIONS,previewPinnedProduction,
 previewIsolatedSynthetic,REVIEW_ONLY:true,PRODUCTION_INSTALL_AUTHORIZED:false
});
