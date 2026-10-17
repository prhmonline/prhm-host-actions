'use strict';
/**
 * Reviewed contract for a SEPARATE root-owned, transient systemd runner.
 * SOURCE ONLY: no CLI, token loading, service restart, file write, exec or
 * registration endpoint. The trusted Host Actions installer must stage and
 * separately approve a pinned executable implementation before use.
 */
const closure=require('./manifests/honartik-shared-registry-bootstrap-source-closure-v1.json');
const gateway=require('./prhm-action-registry-gateway-v1.cjs');
const release=require('./manifests/honartik-config-center-registry-release-v1.json');
const bridge=require('./prhm-action-registry-host-actions-v2-bridge-v1.cjs');
const UNIT_PREFIX='prhm-shared-registry-bootstrap-v1-';
const RUNNER_ENTRY='/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v1/prhm-action-registry-independent-runner-entry-v1.cjs';
const ROOTS=Object.freeze([
 '/opt/prhm-agent-selfmaint',
 '/opt/prhm-agent-selfmaint-exec/actions',
 '/opt/prhm-company-control-plane/config',
 '/home/agent/ssh-mcp-server/src/plugins',
 '/var/backups/prhm-honartik-config-center-registration-v1',
 '/var/lib/prhm-agent-selfmaint-exec/registry-one-time-v1',
 '/var/lib/prhm-agent-selfmaint-exec/registry-recovery-lock-v1',
 '/var/lib/prhm-agent-selfmaint-exec/registry-audit-v1',
 '/opt/prhm-agent-selfmaint-exec/staged/honartik-config-center-v1'
]);
const SERVICES=Object.freeze([
 'prhm-agent-selfmaint.service','prhm-agent-selfmaint-exec.service',
 'prhm-agent-mcp-blue.service','prhm-agent-mcp-green.service'
]);
const OWNER_PINS=Object.freeze(Object.fromEntries(Object.entries(release.registry_owners)
 .map(([k,v])=>[k,v.before_sha256])));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX=/^[0-9a-f]{64}$/;
const SHA=/^[0-9a-f]{40}$/;
function fail(code){throw Error('shared_runner_'+code)}
function check(v,code){if(!v)fail(code)}
function exact(obj,keys,code){
 check(obj&&typeof obj==='object'&&!Array.isArray(obj)&&
   Object.keys(obj).sort().join('|')===keys.slice().sort().join('|'),code);
}
function immutableRelease(){
 check(closure.repo==='prhmonline/prhm-host-actions'&&
  closure.source_commit===release.source_commit&&
  closure.release_manifest_path==='manifests/honartik-config-center-registry-release-v1.json'&&
  closure.status==='NOT_STAGED'&&closure.installation_authorized===false&&
  closure.execution_available===false,
  'source_closure_not_pending');
 check(SHA.test(closure.source_commit)&&SHA.test(closure.release_manifest_commit)&&
  closure.source_commit!==closure.release_manifest_commit&&
  HEX.test(closure.release_manifest_sha256)&&
  HEX.test(closure.expected_approval_arguments_sha256),
  'unbound_git_release');
 const args=Object.freeze({action:gateway.ACTION,project:release.project,
  source_commit:closure.source_commit,manifest_commit:closure.release_manifest_commit,
  manifest_sha256:closure.release_manifest_sha256});
 check(bridge.strictRequest(args).arguments_sha256===closure.expected_approval_arguments_sha256,
  'approval_argument_drift');
 check(gateway.assertManifest(release).action==='honartik_config_center_readonly_enroll_v1',
  'target_action_invalid');
 check(Object.keys(OWNER_PINS).sort().join('|')==='base|executor|mcp|policy',
  'owner_set_invalid');
 return args;
}
/**
 * Read-only plan for a trusted publisher. Never produce a systemctl argv
 * that could be executed without a separately approved root bootstrap.
 * The independent unit's paths are EXACT scoped directories, not
 * /, /home, /opt, or /etc/systemd/system.
 */
function sandboxPlan(){
 const args=immutableRelease();
 const namePrefix=UNIT_PREFIX;
 return Object.freeze({
  schema:'prhm.shared-registry.independent-runner-plan.v1',
  unit_name_prefix:namePrefix,uid:'root',
  service_mode:'transient-oneshot-independent',
  restart_targets:SERVICES,
  source_commit:args.source_commit,manifest_commit:args.manifest_commit,
  manifest_sha256:args.manifest_sha256,
  approval_arguments_sha256:gateway.approvalBindingSha(args),
  fixed_entrypoint:RUNNER_ENTRY,
  systemd_properties:Object.freeze({
   Type:'oneshot',UMask:'0077',NoNewPrivileges:'yes',PrivateTmp:'yes',
   ProtectSystem:'strict',ProtectHome:'read-only',
   ReadWritePaths:ROOTS.join(' '),
   User:'root',Group:'root'
  }),
  pinned_owners:OWNER_PINS,
  root_access_granted:false,runner_staged:false,can_execute:false,
  requires_fresh_signed_level4:true
 });
}
/**
 * Evidence verification, not approval verification. The real executor must
 * check the Ed25519 token and durable consumption ledger independently.
 * This only blocks unsafe handoffs and records precise unresolved gates.
 */
function assess(evidence){
 const plan=sandboxPlan();
 exact(evidence,[
  'source_commit','manifest_commit','manifest_sha256','owner_shas',
  'git_blobs_verified','runner_binary_staged','runner_binary_sha_bound',
  'signed_five_field_route_installed','independent_process_preflight',
  'service_restart_tested','durable_recovery_tested','real_discovery_tested'
 ],'evidence_shape');
 const gaps=[];
 if(evidence.source_commit!==plan.source_commit||
    evidence.manifest_commit!==plan.manifest_commit||
    evidence.manifest_sha256!==plan.manifest_sha256)
    gaps.push('IMMUTABLE_RELEASE_DRIFT');
 exact(evidence.owner_shas,['base','executor','mcp','policy'],'owner_sha_shape');
 for(const [k,sha] of Object.entries(plan.pinned_owners))
   if(evidence.owner_shas[k]!==sha)gaps.push('ORIGINAL_SHA_DRIFT_'+k);
 for(const [key,code] of [
  ['git_blobs_verified','REVIEWED_GIT_BLOBS_UNATTESTED'],
  ['runner_binary_staged','SEPARATE_RUNNER_NOT_STAGED'],
  ['runner_binary_sha_bound','RUNNER_EXECUTABLE_UNATTESTED'],
  ['signed_five_field_route_installed','FIVE_FIELD_SIGNED_ROUTE_MISSING'],
  ['independent_process_preflight','INDEPENDENT_PROCESS_TEST_MISSING'],
  ['service_restart_tested','SERVICE_RESTART_TEST_MISSING'],
  ['durable_recovery_tested','DURABLE_CRASH_RECOVERY_TEST_MISSING'],
  ['real_discovery_tested','MCP_DISCOVERY_TEST_MISSING']
 ])if(evidence[key]!==true)gaps.push(code);
 return Object.freeze({ready:gaps.length===0,gaps:Object.freeze(gaps),
   source_only:true,level4_requested:false,production_mutation:false});
}
function verifyExecutionReport(report){
 // This is only an AFTER-execution evidence contract, never a request to
 // execute, mint a token, re-use an approval or bypass fail-closed checks.
 exact(report,['request_id','runner_process_id','source_commit','manifest_commit',
  'manifest_sha256','approval_arguments_sha256','journal_verified',
  'services_healthy','registry_visible','rollback','result'], 'report_shape');
 check(UUID.test(report.request_id||'')&&
  Number.isSafeInteger(report.runner_process_id)&&report.runner_process_id>0,
  'detached_execution_identity_invalid');
 const args=immutableRelease();
 check(report.source_commit===args.source_commit&&
  report.manifest_commit===args.manifest_commit&&
  report.manifest_sha256===args.manifest_sha256&&
  report.approval_arguments_sha256===gateway.approvalBindingSha(args),
  'execution_report_release_drift');
 check(report.journal_verified===true&&report.services_healthy===true,
  'durability_or_health_unverified');
 check(report.result==='registered'&&report.registry_visible===true&&
  report.rollback==='not_needed','installation_postcondition_unverified');
 return Object.freeze({ok:true,verified_metadata_only:true,
  request_id:report.request_id});
}
module.exports=Object.freeze({ROOTS,SERVICES,OWNER_PINS,sandboxPlan,
 immutableRelease,assess,verifyExecutionReport});
