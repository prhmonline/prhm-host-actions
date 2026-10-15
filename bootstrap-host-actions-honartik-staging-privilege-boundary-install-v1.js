'use strict';
/**
 * Fixed Honartik 35-root-file + 1-systemd-unit registrar staging transaction.
 * SHA-bound, REVIEW/PLAN ONLY; does not use fs, child_process, network,
 * systemd or Approval Center. No host mutation/approval is possible here.
 *
 * Authoritative external signed root installer must independently retrieve
 * and SHA-attest the pinned Git objects, attest the protected owner preimages,
 * acquire an exclusive durable WAL, verify a fresh consumed signed five-field
 * Level-4 receipt and implement atomic, crash-safe create/rollback. This
 * candidate must NOT be callable as a privileged installer itself.
 */
const boundary=require('./honartik-staging-privilege-boundary-install-v1.js');
const layout=require('./prhm-action-registry-v2-root-bootstrap-layout-v1.cjs');
const ROOT=boundary.ROOT;
const UNIT=boundary.UNIT;
const ACTION='prhm_action_registry_install_v1';
const JOURNAL='/var/lib/prhm-agent-selfmaint-exec/registry-bootstrap-v2-journal.json';
const LOCK='/var/lib/prhm-agent-selfmaint-exec/registry-bootstrap-v2-exclusive.lock';
// Use the canonical reviewed root/runner/sidecar directory layout, not a
// competing two-directory plan. Source-only module; no fs operations here.
const DIRECTORY_SPECS=layout.required;
const DIRECTORIES=Object.freeze(DIRECTORY_SPECS.map(d=>d.path));
const PARENTS=layout.PARENTS;
const SOCKET='/run/prhm-shared-registry-v2/registry.sock';
function fail(reason){throw Error('honartik_root_bootstrap_plan_'+reason)}
function check(ok,reason){if(!ok)fail(reason)}
function exact(value,keys,reason){
 check(value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join('|')===keys.slice().sort().join('|'),reason);
}
function plan(inspectInput){
 const reviewed=boundary.inspectReview(inspectInput);
 check(reviewed.stage_source_count===35&&
  reviewed.required_action===ACTION&&
  reviewed.installation_authorized===false&&
  reviewed.action_registered===false,'unreviewed_input');
 const reviewedLayout=layout.immutablePlan();
 check(reviewedLayout.required_dirs.length===10&&
  DIRECTORIES.length===10&&new Set(DIRECTORIES).size===10&&
  DIRECTORIES[0]===ROOT&&DIRECTORIES[1]===ROOT+'/manifests'&&
  DIRECTORY_SPECS.every(d=>d.uid===0&&d.gid===0&&d.mode===0o700),
  'canonical_root_layout_drift');
 const files=reviewed.stage_sources.map(f=>Object.freeze({
  kind:'create_exclusive_pinned_git_file',
  destination:f.destination,source_commit:f.source_commit,
  source_path:f.source_path,git_blob_sha1:f.git_blob_sha1,
  uid:0,gid:0,mode:'0600',max_bytes:4000000
 }));
 const service=Object.freeze({
  kind:'create_exclusive_pinned_git_file',destination:UNIT,
  source_commit:reviewed.signed_unit.source_commit,
  source_path:reviewed.signed_unit.source_path,
  git_blob_sha1:reviewed.signed_unit.git_blob_sha1,
  uid:0,gid:0,mode:'0644',max_bytes:8192
 });
 check(files.length===35&&new Set([...files,service].map(f=>f.destination)).size===36,
  'duplicate_or_missing_stage_files');
 const ops=Object.freeze([
  ...DIRECTORY_SPECS.map(spec=>Object.freeze({
   kind:'mkdir_if_absent_root_only',destination:spec.path,
   owner_role:spec.writer,uid:0,gid:0,mode:'0700'
  })),
  ...files,service
 ]);
 const rollbacks=Object.freeze([...ops].reverse().map(x=>Object.freeze(
  x.kind==='mkdir_if_absent_root_only'?
   {kind:'rmdir_if_created_and_verified_empty',destination:x.destination}:
   {kind:'unlink_only_if_created_by_current_verified_journal',
    destination:x.destination,git_blob_sha1:x.git_blob_sha1}
 )));
 return Object.freeze({
  schema:'prhm.honartik.root-bootstrap-staging-plan.v1',
  action:ACTION,repo:reviewed.source_repo,
  fixed_owners:reviewed.owner_sha256,
  manifest_blobs:reviewed.reviewed_manifest_blobs,
  exclusive_lock_path:LOCK,durable_journal_path:JOURNAL,
  write_precondition:'independently_authenticated_signed_l4_and_durable_lock',
  directory_count:10,source_file_count:35,unit_count:1,
  fixed_directory_parents:Object.freeze(Object.fromEntries(
   DIRECTORY_SPECS.map(d=>[d.path,PARENTS[d.key]]))),
  preexisting_directory_policy:'exact_secure_root_owned_0700_or_absent',
  operations:ops,rollback_operations:rollbacks,
  phases:Object.freeze([
   'independent_host_readonly_preflight',
   'signed_five_field_authorization_separately_validated_and_consumed',
   'durable_exclusive_lock_and_WAL_before_first_write',
   'exact_Git_source_download_and_independent_hash_attestation',
   'root_only_atomic_exclusive_stage_and_persistent_step_journal',
   'independent_36_file_postcondition',
   'isolated_unit_setup_and_authenticated_dual_MCP_discovery',
   'on_failure_journal_ownership_verified_rollback_and_recheck'
  ]),
  root_approval_not_issued:true,
  external_root_installer_required:true,
  no_overwrite_existing_targets:true,
  no_protected_owner_rewrites:true,
  does_not_remove_unowned_files:true,
  verified_on_real_host:false,
  safe_to_request_l4:false,production_mutation:false,
  installs:false,executes:false
 });
}
/**
 * A diagnostic consistency assessment; caller-supplied observed state is not
 * trusted root evidence. Even a clean report cannot authorize installation.
 */
function assessObserved(stage,observed){
 check(stage?.schema==='prhm.honartik.root-bootstrap-staging-plan.v1'&&
  stage.action===ACTION&&stage.operations?.length===46&&
  stage.operations.at(-1)?.destination===UNIT&&
  stage.installs===false&&stage.executes===false,'untrusted_plan');
 exact(observed,
  ['owner_sha256','target_states','directory_states','parent_states',
   'unit_load_state','journal_absent','lock_absent','socket_absent'],
  'observation_schema');
 exact(observed.owner_sha256,Object.keys(boundary.OWNERS),'owner_set');
 const targets=stage.operations.filter(x=>x.kind==='create_exclusive_pinned_git_file');
 exact(observed.target_states,targets.map(x=>x.destination),'target_set');
 exact(observed.directory_states,DIRECTORIES,'directory_set');
 const parentPaths=[...new Set(Object.values(stage.fixed_directory_parents))];
 exact(observed.parent_states,parentPaths,'parent_set');
 const blockers=[];
 for(const [kind,sha] of Object.entries(boundary.OWNERS))
  if(observed.owner_sha256[kind]!==sha)blockers.push('OWNER_DRIFT_'+kind);
 for(const target of targets){
  const state=observed.target_states[target.destination];
  check(['absent','present','unknown'].includes(state),'target_state_invalid');
  if(state!=='absent')blockers.push('TARGET_NOT_ABSENT');
 }
 for(const parent of parentPaths){
  const state=observed.parent_states[parent];
  check(['secure_root_parent','absent','unsafe_or_unknown'].includes(state),
   'parent_state_invalid');
  if(state!=='secure_root_parent'&&
   !(state==='absent'&&DIRECTORIES.includes(parent)))
   blockers.push('UNSAFE_OR_MISSING_PARENT');
 }
 for(const d of DIRECTORIES){
  const state=observed.directory_states[d];
  check(['absent','secure_root_0700','unsafe_or_unknown'].includes(state),
   'directory_state_invalid');
  if(state==='unsafe_or_unknown')blockers.push('UNSAFE_STAGE_DIR');
 }
 check(['not-found','loaded','unknown'].includes(observed.unit_load_state),
  'systemd_state_invalid');
 if(observed.unit_load_state!=='not-found')blockers.push('UNIT_ALREADY_REGISTERED');
 if(observed.journal_absent!==true)blockers.push('FOREIGN_OR_UNKNOWN_JOURNAL');
 if(observed.lock_absent!==true)blockers.push('FOREIGN_OR_UNKNOWN_LOCK');
 if(observed.socket_absent!==true)blockers.push('FOREIGN_OR_UNKNOWN_SOCKET');
 return Object.freeze({
  schema:'prhm.honartik.root-bootstrap-staging-host-observation.v1',
  reviewed_file_count:36,reported_conditions_clear:blockers.length===0,
  blockers:Object.freeze([...new Set(blockers)]),
  independently_root_attested:false,
  authorized:false,installation_approved:false,
  can_stage:false,can_request_l4:false,production_mutation:false
 });
}
function execute(){fail('signed_root_host_adapter_missing')}
module.exports=Object.freeze({ACTION,ROOT,UNIT,JOURNAL,LOCK,DIRECTORIES,
 PARENTS,SOCKET,plan,assessObserved,execute});
