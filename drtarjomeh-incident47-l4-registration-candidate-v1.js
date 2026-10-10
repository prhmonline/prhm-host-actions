'use strict';
// Incident #47: Git-only, read-only, fail-closed Level-4 registration CANDIDATE.
// Never writes live policy, deploys the site, or authorizes an action.
const crypto=require('node:crypto');

const ACTION='drtarjomeh_incident47_uploads_guard_install_v1';
const OPERATION='host_action.'+ACTION;
const HOST_ACTIONS_BASE='83eb88558decaaf09b6e66706ffe413dc404ed8d';
const SOURCE_REPO='prhmonline/drtarjomeh';
const SOURCE_COMMIT='e20f4055610d9e61bd8ec42e4d271d97f7433ace';
const SOURCE_PR=50;
const SITE='drtarjomeh.ir';
const TARGET='/etc/httpd/conf.d/95-drt-wordpress-uploads-deny.conf';
const POLICY_VERSION='2026-10-10.2-drtarjomeh-incident47-guard-v1';
const LIVE_POLICY_VERSION='2026-10-02.1-control-plane-current-owner-bootstrap-repair-v1';
const LIVE=Object.freeze({
 base:Object.freeze({path:'/opt/prhm-agent-selfmaint/server.js',sha256:'4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406'}),
 executor:Object.freeze({path:'/opt/prhm-agent-selfmaint-exec/server.js',sha256:'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0'}),
 policy:Object.freeze({path:'/opt/prhm-company-control-plane/config/approval-policy.json',sha256:'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174'}),
 mcp:Object.freeze({path:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',sha256:'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166'})
});
const APP_BLOBS=Object.freeze({
 guard:Object.freeze({path:'ops/security-cutover/incident47-host-guard-v1.py',git_blob_sha:'39e78c45f4c454e56874bc3941f82a5a43cfc8f8'}),
 policy:Object.freeze({path:'ops/security-cutover/apache-wp-uploads-exec-deny-v1.conf',git_blob_sha:'5adb676a1f9b7e3aa295f469a39071cfc1d1a6f5'})
});
const SHA256=/^[0-9a-f]{64}$/;
const sha256=b=>crypto.createHash('sha256').update(b).digest('hex');
const gitBlob=b=>{const bytes=Buffer.isBuffer(b)?b:Buffer.from(String(b));return crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex');};
function fail(code){throw new Error(code);}
function checkedBytes(value,label){
  if(!Buffer.isBuffer(value)||!value.length||value.length>1000000)fail(label+'_bytes_invalid');
  return value;
}
function verifyOwnerPreimages(readOwner){
  if(typeof readOwner!=='function')fail('read_owner_required');
  const out={};
  for(const [kind,pin] of Object.entries(LIVE)){
    const data=checkedBytes(readOwner(pin.path),kind);
    const got=sha256(data);
    if(got!==pin.sha256)fail('live_'+kind+'_sha_drift');
    out[kind]={path:pin.path,sha256:got,verified:true};
  }
  return Object.freeze(out);
}
function verifyApplicationBlobs(readArtifact){
  if(typeof readArtifact!=='function')fail('read_artifact_required');
  const out={};
  for(const [kind,pin] of Object.entries(APP_BLOBS)){
    const data=checkedBytes(readArtifact(pin.path,SOURCE_COMMIT),kind);
    const got=gitBlob(data);
    if(got!==pin.git_blob_sha)fail('application_'+kind+'_blob_drift');
    out[kind]={path:pin.path,git_blob_sha:got,verified:true};
  }
  return Object.freeze(out);
}
function approvalPolicyOperation(){
  return Object.freeze({
    level:4,risk:'critical',requires_second_confirmation:true,
    one_time_use:true,requested_approver:'mohammad',expires_seconds:180,
    policy_version:POLICY_VERSION,
    rollback_reference:'host-action-v2:drtarjomeh-incident47-guard-v1:preimage-restore'
  });
}
function typedScope(){
  return Object.freeze({
    tool:'host_action_v2_apply',
    project:'control_plane',environment:'production',
    action:ACTION,risk:'critical',operation:OPERATION,
    principals:[{principal_id:'mohammad',roles:['mcp-operator']}]
  });
}
function buildPolicyStructure(source){
  let p;try{p=JSON.parse(source.toString('utf8'));}catch{fail('policy_json_invalid');}
  if(p.schema_version!=='prhm.approval-policy.v1'||p.version!==LIVE_POLICY_VERSION)fail('policy_baseline_mismatch');
  if(!p.operations||typeof p.operations!=='object'||Array.isArray(p.operations)||!Array.isArray(p.typed_scopes))fail('policy_structure_invalid');
  if(Object.prototype.hasOwnProperty.call(p.operations,OPERATION)||p.typed_scopes.some(x=>x?.action===ACTION||x?.operation===OPERATION))fail('action_already_registered');
  const beforeOps=Object.keys(p.operations).length,beforeScopes=p.typed_scopes.length;
  p.version=POLICY_VERSION;
  p.operations[OPERATION]=approvalPolicyOperation();
  p.typed_scopes.push(typedScope());
  if(Object.keys(p.operations).length!==beforeOps+1||p.typed_scopes.length!==beforeScopes+1)fail('policy_cardinality_invalid');
  return Buffer.from(JSON.stringify(p,null,2)+'\n');
}
function buildPolicyCandidate(source){
  if(!Buffer.isBuffer(source))fail('policy_bytes_required');
  if(sha256(source)!==LIVE.policy.sha256)fail('policy_sha_drift');
  return buildPolicyStructure(source);
}
function buildReadOnlyPlan({readOwner,readArtifact,hostMainCommit=HOST_ACTIONS_BASE,appHeadCommit=SOURCE_COMMIT,appPrMerged=false}={}){
  if(hostMainCommit!==HOST_ACTIONS_BASE)fail('host_actions_base_sha_drift');
  if(appHeadCommit!==SOURCE_COMMIT)fail('application_head_sha_drift');
  const owners=verifyOwnerPreimages(readOwner);
  const artifacts=verifyApplicationBlobs(readArtifact);
  const policyCandidate=buildPolicyCandidate(checkedBytes(readOwner(LIVE.policy.path),'policy'));
  // Intentionally metadata only. Never return candidate policy or private inputs.
  return Object.freeze({
    schema:'prhm.drtarjomeh.incident47.l4-registration-candidate.v1',
    action:ACTION,operation:OPERATION,
    source_repository:SOURCE_REPO,source_pr:SOURCE_PR,source_commit:SOURCE_COMMIT,
    source_merged:appPrMerged===true,
    host_actions_base:HOST_ACTIONS_BASE,
    policy_preimage_sha256:LIVE.policy.sha256,
    policy_candidate_sha256:sha256(policyCandidate),
    owner_sha_match:Object.values(owners).every(x=>x.verified),
    source_git_blob_match:Object.values(artifacts).every(x=>x.verified),
    target:TARGET,hostname:SITE,
    requested_approval_level:4,one_time_use:true,expires_seconds:180,
    production_mutation:false,registration_authorized:false,
    action_registered:false,runner_wired:false,deploy_allowed:false,
    reasons:Object.freeze([
      'SIGNED_APPROVAL_AND_REPLAY_CHECK_NOT_REGISTERED',
      'SERVER_SIDE_REQUEST_CONSUMPTION_NOT_REGISTERED',
      'EXACT_ACTION_DISPATCH_AND_ROLLBACK_NOT_REGISTERED',
      ...(appPrMerged?[]:['SOURCE_APP_PR_NOT_MERGED'])
    ])
  });
}
function runCli(argv=process.argv.slice(2)){
  if(argv.length!==1||argv[0]!=='--selftest')fail('readonly_selftest_only');
  // Source invariant checks ONLY; no file/system/network/approval access.
  if(!SHA256.test(LIVE.base.sha256)||!SHA256.test(LIVE.executor.sha256)||
     !SHA256.test(LIVE.policy.sha256)||!SHA256.test(LIVE.mcp.sha256))fail('pin_invalid');
  if(!/^[a-f0-9]{40}$/.test(SOURCE_COMMIT)||!APP_BLOBS.guard.git_blob_sha)fail('source_pin_invalid');
  return {ok:true,preflight_only:true,deploy_allowed:false,registration_authorized:false,operation:OPERATION};
}
if(require.main===module){
  try{process.stdout.write(JSON.stringify(runCli())+'\n');}
  catch(e){process.stderr.write(JSON.stringify({ok:false,error:String(e.message).slice(0,160)})+'\n');process.exitCode=1;}
}
module.exports=Object.freeze({ACTION,OPERATION,SOURCE_COMMIT,HOST_ACTIONS_BASE,APP_BLOBS,LIVE,
  approvalPolicyOperation,typedScope,sha256,gitBlob,verifyOwnerPreimages,verifyApplicationBlobs,
  buildPolicyStructure,buildPolicyCandidate,buildReadOnlyPlan,runCli});
