'use strict';
/*
 * Honartik Issue #217 — SHA-pinned SOURCE/REVIEW-ONLY registration pack.
 *
 * This is NOT a Host Action registration, L4 issuer, Production CLI, or
 * privileged installer. Root-of-Trust owner must independently verify source,
 * complete an installed adapter, reconcile Policy, obtain signed L4 and stage
 * changes with durable backup/reload/rollback. No write, shell, CLI or network.
 *
 * Unlike PR #15's Git-main policy candidate, the policy input must be the
 * verified raw LIVE preimage. A new candidate digest must be independently
 * reviewed and pinned in the native Ed25519 gate BEFORE installation.
 */
const crypto=require('node:crypto');
const {CONTRACT:C}=require('./honartik-universal-installer-l4-v1.cjs');
const ACTION=C.action, OP=C.operation;
const VERSION='2026-10-27.1-honartik-universal-installer-exact-l4-review';
const SOURCE_SHA='58e7e3bee2bedeb0298a33a86b9f0a32c181b291';
const TARGETS=Object.freeze({
  base:Object.freeze({path:'/opt/prhm-agent-selfmaint/server.js',
   sha256:'4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406'}),
  executor:Object.freeze({path:'/opt/prhm-agent-selfmaint-exec/server.js',
   sha256:'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0'}),
  mcp:Object.freeze({path:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
   sha256:'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166'}),
  policy:Object.freeze({path:'/opt/prhm-company-control-plane/config/approval-policy.json',
   sha256:'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174'})
});
const ARTIFACTS=Object.freeze({
 'honartik-universal-installer-l4-v1.cjs':'d9d25684f6480eb8bdbb4c097e0ffc3645e9c559',
 'honartik-universal-installer-l4-approval-verify-v1.cjs':'280cb91673c074f6abba6e82dc861ac0c0cf9a30',
 'honartik-universal-installer-native-approval-gate-v1.cjs':'227bc7fdf891bf67ddae1944936d30a72c7e10d5',
 'honartik-universal-installer-native-fs-v1.cjs':'9678e8d45e32c6989808ef7d7d2419f3426a1d0d',
 'honartik-universal-installer-native-journal-inspector-v1.cjs':'439380a7f382298f7c2a8a14cdf2142c0ad7f965',
 'honartik-universal-installer-native-journal-writer-v1.cjs':'a80f65b23a69d5f76af91797c4e2cc83ab6bf9c1',
 'honartik-universal-installer-native-l4-fence-v1.cjs':'9c3f1279fe0697affd774be35551d2c81a6912cd',
 'honartik-universal-installer-native-python-bridge-v1.cjs':'608bfcf07ac06c50081730b5f4863f0f2fc3f27c',
 'honartik-universal-installer-native-reconciler-v1.cjs':'9f471dff187e6305fde4d6f7f69920ea2bd4f124',
 'honartik-universal-installer-native-root-preflight-v1.cjs':'7a92e3d4f6c30aaca5d4d0b5794eccd5e83c9084',
 'honartik-universal-installer-native-root-receipt-v1.cjs':'106edec5141652f439f3dcecce359f0dc59fef84',
 'honartik-universal-installer-native-terminal-archive-v1.cjs':'7de2333ba52c25d9432e3d3e93edd00a5fb53816'
});
const PREIMAGE_POLICY_VERSION='2026-10-02.1-control-plane-current-owner-bootstrap-repair-v1';
// SHA-256 of JSON indent=2 + trailing LF, derived on the real Production host
// from the pinned live bytes by an operator's read-only Python check.
// This is NOT an independent signature or approval to activate the policy.
const RECONCILED_CANDIDATE_POLICY_SHA='981967b4ce770cd3aa89d27ae98552bbeb3ab31ed116d4e51aef91c0abf68358';
const fail=x=>{throw Error('honartik217_registration_pack_'+x)};
const need=(v,x)=>{if(!v)fail(x)};
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const gitBlob=b=>crypto.createHash('sha1')
 .update(Buffer.concat([Buffer.from('blob '+b.length+'\0'),b])).digest('hex');
function verifyOwnerPreimages(readOwners){
 need(typeof readOwners==='function','review_reader_required');
 const verified={};
 for(const [name,ref] of Object.entries(TARGETS)){
  const bytes=readOwners(ref.path);
  need(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=2_000_000,
   'owner_bytes_unavailable:'+name);
  need(hash(bytes)===ref.sha256,'live_owner_preimage_drift:'+name);
  verified[name]=Object.freeze({path:ref.path,sha256:ref.sha256,
   length:bytes.length,reviewed_only:true});
 }
 return Object.freeze(verified);
}
function verifyArtifactClosure(readArtifact){
 need(typeof readArtifact==='function','artifact_reader_required');
 const refs={};
 for(const [name,blob] of Object.entries(ARTIFACTS)){
  const bytes=readArtifact(name,SOURCE_SHA);
  need(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<1_000_000,
   'source_bytes_invalid:'+name);
  need(gitBlob(bytes)===blob,'source_git_blob_drift:'+name);
  refs[name]=Object.freeze({git_blob:blob,bytes:bytes.length,
   from_commit:SOURCE_SHA});
 }
 return Object.freeze(refs);
}
const operation=()=>({
 level:4,risk:'critical',requires_second_confirmation:true,
 one_time_use:true,requested_approver:'mohammad',expires_seconds:180,
 policy_version:VERSION,
 rollback_reference:'host-action-v2:honartik-universal-installer-upgrade-v1:locked-preimage-journal-rollback'
});
const scope=()=>({
 tool:'host_action_v2_apply',project:'control_plane',
 environment:'production',action:ACTION,risk:'critical',operation:OP,
 principals:[{principal_id:'mohammad',roles:['mcp-operator']}]
});
function overlayPolicyObject(live){
 need(live&&typeof live==='object'&&!Array.isArray(live)&&
  live.schema_version==='prhm.approval-policy.v1'&&
  live.default_deny===true&&live.one_time_use===true&&
  live.issuer==='prhm-company-approval','live_policy_structure_invalid');
 need(live.version===PREIMAGE_POLICY_VERSION,'live_policy_version_drift');
 need(live.levels?.['4']?.human_approval===true&&
  live.levels?.['4']?.second_confirmation_required===true&&
  live.levels?.['4']?.max_ttl_seconds===180,'live_l4_requirements_drift');
 need(live.operations&&typeof live.operations==='object'&&
  !Array.isArray(live.operations)&&Array.isArray(live.typed_scopes),
  'live_policy_registry_invalid');
 need(!Object.hasOwn(live.operations,OP)&&
  !live.typed_scopes.some(s=>s?.action===ACTION||s?.operation===OP),
  'action_already_present');
 // Deep-clone to avoid mutating raw baseline held by trusted reviewer.
 const candidate=JSON.parse(JSON.stringify(live));
 candidate.version=VERSION;
 candidate.operations[OP]=operation();
 candidate.typed_scopes.push(scope());
 // Explicitly prevent collateral changes to existing active operations,
 // scopes and otherwise unrelated security fields (including differences
 // between Git main and the actual installed Policy).
 const roundtrip=JSON.parse(JSON.stringify(candidate));
 delete roundtrip.operations[OP];
 roundtrip.typed_scopes.pop();
 roundtrip.version=live.version;
 need(JSON.stringify(roundtrip)===JSON.stringify(live),
  'live_policy_collateral_change');
 return candidate;
}
function proposeLivePolicyReview(liveBytes){
 need(Buffer.isBuffer(liveBytes)&&liveBytes.length>100&&
  liveBytes.length<250_000,'live_policy_bytes_invalid');
 need(hash(liveBytes)===TARGETS.policy.sha256,'policy_preimage_sha_drift');
 let live;try{live=JSON.parse(liveBytes.toString('utf8'))}
 catch{fail('live_policy_invalid_json')}
 const candidate=overlayPolicyObject(live);
 const bytes=Buffer.from(JSON.stringify(candidate,null,2)+'\n');
 const digest=hash(bytes);
 // Node JSON serializer MUST byte-match the host's Python-produced digest.
 // A differing JSON representation, source drift or encoding must block
 // registration review; never silently accept an alternative digest.
 need(digest===RECONCILED_CANDIDATE_POLICY_SHA,
  'operator_candidate_sha_mismatch');
 return Object.freeze({
  action:ACTION,operation:OP,review_only:true,production_mutation:false,
  source_sha:SOURCE_SHA,preimage_sha256:TARGETS.policy.sha256,
  candidate_sha256:digest,
  policy_version_before:PREIMAGE_POLICY_VERSION,
  policy_version_after:VERSION,
  operations_before:Object.keys(live.operations).length,
  operations_after:Object.keys(candidate.operations).length,
  scopes_before:live.typed_scopes.length,
  scopes_after:candidate.typed_scopes.length,
  // This digest is evidence for an independent reviewer, NOT authorization:
  // Gate source now pins this live-derived candidate; this equality alone
  // is NEVER permission to install or consume an L4 before independent
  // re-review and trusted Root-of-Trust registration.
  matches_current_approval_gate_pin:digest===
   require('./honartik-universal-installer-native-approval-gate-v1.cjs')
    .PINNED_POLICY_SHA,
  operator_candidate_sha_verified:true,
  requires_independent_policy_pin_review:true,
  requires_signed_level4:true,action_registered:false,install_authorized:false,
  candidate_policy_bytes:bytes
 });
}
function reviewPlan(readOwners,readArtifact){
 const owners=verifyOwnerPreimages(readOwners);
 const artifacts=verifyArtifactClosure(readArtifact);
 const policyRef=TARGETS.policy;
 const policy=proposeLivePolicyReview(readOwners(policyRef.path));
 return Object.freeze({
  schema:'prhm.honartik217.native-registration-review-only.v1',
  action:ACTION,source_sha:SOURCE_SHA,owners,artifacts,
  candidate_policy_sha256:policy.candidate_sha256,
  candidate_policy_bytes:policy.candidate_policy_bytes,
  unsigned:true,review_only:true,registered:false,
  independent_review_complete:false,signed_linux_attestation:false,
  root_of_trust_registered:false,level4_approval_issued:false,
  execution_authorized:false,production_mutated:false
 });
}
module.exports=Object.freeze({
 ACTION,OP,VERSION,SOURCE_SHA,TARGETS,ARTIFACTS,
 RECONCILED_CANDIDATE_POLICY_SHA,
 verifyOwnerPreimages,verifyArtifactClosure,
 overlayPolicyObject,proposeLivePolicyReview,reviewPlan
});
