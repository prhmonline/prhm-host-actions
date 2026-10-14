'use strict';
// SOURCE-ONLY REVIEW CONTRACT. Does not register a Host Action, issue or consume
// approvals, call privileged executors, or mutate a live filesystem.
const crypto=require('node:crypto');
const fail=(m)=>{throw new Error('deploy_control_cutover_'+m)};
const sha256=b=>crypto.createHash('sha256').update(b).digest('hex');

const CONTRACT=Object.freeze({
  schema_version:'prhm.deploy-control-cutover.contract.v1',
  action:'deploy_control_cutover_install_v1',
  operation:'host_action.deploy_control_cutover_install_v1',
  risk:'critical', level:4,
  principal_id:'mohammad', role:'mcp-operator',
  tool:'host_action_v2_apply',
  environment:'production', project:'control_plane',
  approval_center:'http://127.0.0.1:18133',
  live_policy_version:'2026-10-02.1-control-plane-current-owner-bootstrap-repair-v1',
  live_policy_object_sha256:'c141ce7d56bf1de9c11a6e98b0abd6d20da9a349a6cbe1735c5bb659e3a70fea',
  live_policy_raw_sha256:'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174',
  candidate_policy_version:'2026-10-15.1-deploy-control-l4-installer-enrollment-v1',
  candidate_policy_object_sha256:'732c21b15a54b47dced724e1f5be1c70aa1bd6c41cc5f94c5d2f600e45c36acb',
  source_shas:Object.freeze({
    'prhmonline/deploy-control':'e9d4b435a8bb73a507b2a7dd4affc4caa455d524',
    'prhmonline/prhm-company-control-plane':'acffc7f9e02073f7aaf6ba92777f7acff6481f81',
    'prhmonline/aranob':'0454dd4bfb74e3064da36955006dd38426b12b82',
    'prhmonline/Honar-front-new':'5a13a594fc0081dd202583df3f3d04b06aa34b4f',
    'prhmonline/honar-back-new':'c3a4b93035698315e1358a298316538bd2d2ce4b',
  }),
  legacy_production_sudoers:Object.freeze([
    '/etc/sudoers.d/aranob-deploy-runner',
    '/etc/sudoers.d/deploy-control-honartik'
  ]),
  staging_wrapper_sha256:'c71127722e4a8b93176aa0d1708de2fd083fd11681278af921da682cf0c905b1',
  staging_canonical_sha256:'d7f4b86e15e52f6a95058f2c4ed55e07dddc1db5b85bb5dc407e508f9bb636e8',
  approval_required:true, production_mutation_allowed:false
});

const newScope=(project)=>({
  tool:'deploy_control',project,environment:'production',action:'deploy_exact_sha',
  risk:'high',operation:'deploy.production',
  principals:[{principal_id:'mohammad',roles:['mcp-operator']}]
});
const expectedProjects=Object.freeze(['aranob','honartik_front','honartik_back']);
const INSTALLER_OPERATION='host_action.deploy_control_cutover_install_v1';
const installerRule=Object.freeze({
 level:4,risk:'critical',requires_second_confirmation:true,one_time_use:true,
 requested_approver:'mohammad',expires_seconds:180,
 policy_version:CONTRACT.candidate_policy_version,
 rollback_reference:'host-action-v2:deploy-control-cutover-install-v1:exact-preimage-runtime-restore'
});
const installerScope=Object.freeze({
 tool:'host_action_v2_apply',project:'control_plane',environment:'production',
 action:'deploy_control_cutover_install_v1',risk:'critical',operation:INSTALLER_OPERATION,
 principals:[{principal_id:'mohammad',roles:['mcp-operator']}]
});
const expectedIntegrity=Object.freeze({
  git_first_required:true,
  exact_commit_sha_required_for_production:true,
  direct_production_file_edit_forbidden:true,
  rollback_scope:'runtime_only',
  automatic_git_reset:false,
  automatic_git_revert:false,
  automatic_history_rewrite:false,
  failed_commit_preserved:true,
  allowed_remediation:['fix_forward','explicit_revert_commit']
});

function canonical(v){
  if(v===null||typeof v!=='object')return JSON.stringify(v);
  if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
  return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
}
function decode(buffer,label){
  if(!Buffer.isBuffer(buffer)||buffer.length<100||buffer.length>500000)fail(label+'_invalid_buffer');
  try {return JSON.parse(buffer.toString('utf8'))}catch{fail(label+'_invalid_json')}
}
function verifyPolicyTransition(liveBytes,candidateBytes){
  const live=decode(liveBytes,'live_policy');
  const candidate=decode(candidateBytes,'candidate_policy');
  if(sha256(liveBytes)!==CONTRACT.live_policy_raw_sha256)fail('live_policy_preimage_drift');
  if(sha256(JSON.stringify(live))!==CONTRACT.live_policy_object_sha256)fail('live_policy_object_hash_drift');
  if(sha256(JSON.stringify(candidate))!==CONTRACT.candidate_policy_object_sha256)fail('candidate_policy_hash_drift');
  if(live.version!==CONTRACT.live_policy_version||candidate.version!==CONTRACT.candidate_policy_version)
    fail('policy_version_drift');
  const oldOps=Object.keys(live.operations||{}),newOps=Object.keys(candidate.operations||{});
  if(oldOps.length!==75||newOps.length!==76||
     canonical(candidate.operations[INSTALLER_OPERATION])!==canonical(installerRule)||
     canonical(live.operations)!==canonical(Object.fromEntries(
       Object.entries(candidate.operations).filter(([k])=>k!==INSTALLER_OPERATION))))
    fail('operations_mutated_or_missing');
  if(!Array.isArray(live.typed_scopes)||live.typed_scopes.length!==52||
     !Array.isArray(candidate.typed_scopes)||candidate.typed_scopes.length!==56)
    fail('typed_scope_count_drift');
  const extras=[...expectedProjects.map(newScope),installerScope];
  for(const e of extras){
    if(candidate.typed_scopes.filter(s=>canonical(s)===canonical(e)).length!==1)
      fail('missing_or_duplicate_exact_deploy_scope');
  }
  const addedSet=new Set(extras.map(canonical));
  const preserved=candidate.typed_scopes.filter(s=>!addedSet.has(canonical(s)));
  if(canonical(preserved.map(canonical).sort())!==canonical(live.typed_scopes.map(canonical).sort()))
    fail('existing_typed_scopes_mutated');
  if(canonical(candidate.deployment_integrity)!==canonical(expectedIntegrity))
    fail('deployment_integrity_drift');
  const ignored=new Set(['version','operations','typed_scopes','deployment_integrity']);
  const stableFields=p=>Object.fromEntries(Object.entries(p).filter(([k])=>!ignored.has(k)));
  if(canonical(stableFields(live))!==canonical(stableFields(candidate)))
    fail('existing_policy_fields_mutated');
  if(Object.hasOwn(live,'deployment_integrity'))fail('unexpected_preexisting_integrity');
  return Object.freeze({
    ok:true,source_only:true,original_operations:75,preserved_typed_scopes:52,
    added_exact_deploy_scopes:3,added_critical_installer_scopes:1,
    added_critical_operations:1,live_policy_raw_sha256:CONTRACT.live_policy_raw_sha256,
    candidate_policy_object_sha256:CONTRACT.candidate_policy_object_sha256
  });
}
function verifyIssuerHealth(health,phase){
  if(phase!=='before'&&phase!=='after')fail('phase_invalid');
  if(!health||typeof health!=='object'||Array.isArray(health)||
     health.ok!==true||health.service!=='prhm-company-approval'||
     health.mode!=='mcp-operator'||health.algorithm!=='Ed25519'||health.one_time_use!==true)
    fail('issuer_health_invalid');
  const version=phase==='before'?CONTRACT.live_policy_version:CONTRACT.candidate_policy_version;
  const digest=phase==='before'?CONTRACT.live_policy_object_sha256:CONTRACT.candidate_policy_object_sha256;
  if(health.policy_version!==version||health.policy_hash!==digest)
    fail('issuer_policy_version_or_hash_mismatch');
  return Object.freeze({ok:true,phase,policy_version:version,policy_hash:digest});
}
const REVIEW_EVIDENCE=Object.freeze([
  'source_git_blobs_pinned','runner_sudo_expansion_reviewed','external_hooks_reviewed',
  'root_owned_assets_preflight','staging_exception_hashes_verified',
  'private_issuer_bridge_verified','preimage_backups_verified',
  'rollback_fixture_pass','issuer_attestation_wired',
  'level4_action_registered_and_reviewed'
]);
function verifyReviewEvidence(evidence){
  // A checklist, NOT a privileged attestation or authorization. In particular,
  // caller-controlled booleans can never authorize a live cutover.
  if(!evidence||typeof evidence!=='object'||Array.isArray(evidence)||
    Object.keys(evidence).sort().join('|')!==[...REVIEW_EVIDENCE].sort().join('|'))
    fail('review_evidence_schema');
  for(const k of REVIEW_EVIDENCE)if(evidence[k]!==true)fail('review_missing_'+k);
  return Object.freeze({source_review_ready:true,execution_authorized:false,
    requires:'independently_signed_one_time_level4_token',may_install:false});
}
function assertNoRuntimeInputs(argv){
  if(!Array.isArray(argv)||argv.length!==0)fail('runtime_arguments_forbidden');
  return Object.freeze({action:CONTRACT.action,source_only:true,may_install:false});
}
module.exports=Object.freeze({
  CONTRACT,expectedProjects,expectedIntegrity,REVIEW_EVIDENCE,
  verifyPolicyTransition,verifyIssuerHealth,verifyReviewEvidence,assertNoRuntimeInputs
});
