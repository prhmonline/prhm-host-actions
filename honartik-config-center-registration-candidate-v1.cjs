'use strict';
// Git-only, exact-preimage Host Action enrollment registration builder.
// It NEVER writes a server, installs credentials, or spends approval.
const crypto = require('node:crypto');
const {CONTRACT} = require('./honartik-config-center-enrollment-action-v1.cjs');
const ACTION = CONTRACT.action, OPERATION = CONTRACT.operation;
const POLICY_VERSION = '2026-10-13.1-honartik-config-read-enroll-v1';
const BASE_POLICY_VERSION = '2026-10-02.1-control-plane-current-owner-bootstrap-repair-v1';
const LIVE = Object.freeze({
  base: {path:'/opt/prhm-agent-selfmaint/server.js',sha256:'4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406'},
  executor: {path:'/opt/prhm-agent-selfmaint-exec/server.js',sha256:'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0'},
  policy: {path:'/opt/prhm-company-control-plane/config/approval-policy.json',sha256:'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174'},
  mcp: {path:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',sha256:'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166'}
});
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
function fail(m){throw new Error(m)}
function once(s,marker,replacement,label){
  if(typeof s!=='string'||s.split(marker).length!==2)fail(label+'_anchor_mismatch');
  if(s.includes(ACTION)||s.includes(OPERATION))fail(label+'_duplicate');
  return s.replace(marker,replacement);
}
const BASE_ANCHOR='const HOST_ACTION_V2_SPECS = Object.freeze({\n';
const BASE_LINE = "  "+ACTION+": { operation: '"+OPERATION+"', rollback: 'host-action-v2:honartik-config-read-enroll-v1:credential-revoke' },\n";
function patchBase(source){
  return once(source,BASE_ANCHOR,BASE_ANCHOR+BASE_LINE,'base');
}
function patchExecutor(source){
  const SPEC_ANCHOR='const HOST_ACTION_V2_SPECS = Object.freeze({\n';
  const SPEC_LINE="  "+ACTION+":{operation:'"+OPERATION+"',kind:'"+ACTION+"'},\n";
  let result=once(source,SPEC_ANCHOR,SPEC_ANCHOR+SPEC_LINE,'executor');
  // Dispatch through a separate, hash-pinned trusted runner. The runner MUST
  // be installed by an independently authorized SHA-bound transaction first.
  // A missing runner fails closed (never provisions a credential).
  const DISPATCH='applyHostActionV2=async function(action){';
  if(result.split(DISPATCH).length!==2)fail('executor_dispatch_anchor_mismatch');
  const RUNNER='/opt/prhm-agent-selfmaint-exec/actions/honartik-config-center-enrollment-runner-v1.cjs';
  const GUARD=[
    "if(action==='"+ACTION+"'){",
    " const fs=require('node:fs');",
    " const runner='"+RUNNER+"';",
    " const stat=fs.lstatSync(runner);",
    " if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022)!==0||stat.size<100||stat.size>1000000)throw new Error('honartik_runner_unsafe');",
    " // A separate installer must pin and attest the exact runner bytes and source SHA.",
    " if(!process.env.PRHM_HONARTIK_ENROLL_RUNNER_INSTALLED_SHA)throw new Error('honartik_runner_not_sha_bound');",
    " throw new Error('honartik_enrollment_dispatch_not_yet_approved');",
    "}"
  ].join('');
  return result.replace(DISPATCH,DISPATCH+GUARD);
}
function patchMcp(source){
  const enumEnd="'control_plane_current_owner_binding_refresh_v1']);";
  return once(source,enumEnd,
    "'control_plane_current_owner_binding_refresh_v1','"+ACTION+"']);",'mcp');
}
function patchPolicy(source){
  if(typeof source!=='string'||source.includes(ACTION)||source.includes(OPERATION))fail('policy_duplicate_or_invalid');
  let policy;
  try{policy=JSON.parse(source)}catch{fail('policy_json_invalid')}
  if(policy.schema_version!=='prhm.approval-policy.v1'||policy.version!==BASE_POLICY_VERSION||
     policy.default_deny!==true||!policy.operations||Array.isArray(policy.operations)||
     !Array.isArray(policy.typed_scopes))fail('policy_structure_or_version_mismatch');
  if(Object.hasOwn(policy.operations,OPERATION)||policy.typed_scopes.some(x=>x?.action===ACTION||x?.operation===OPERATION))
    fail('policy_already_registered');
  policy.version=POLICY_VERSION;
  policy.operations[OPERATION]={
    level:4,risk:'critical',requires_second_confirmation:true,one_time_use:true,
    requested_approver:'mohammad',expires_seconds:180,policy_version:POLICY_VERSION,
    rollback_reference:'host-action-v2:honartik-config-read-enroll-v1:credential-revoke'
  };
  policy.typed_scopes.push({
    tool:'host_action_v2_apply',project:'control_plane',environment:'production',
    action:ACTION,risk:'critical',operation:OPERATION,
    principals:[{principal_id:'mohammad',roles:['mcp-operator']}]
  });
  return JSON.stringify(policy,null,2)+'\n';
}
function buildCandidates(readOwner){
  if(typeof readOwner!=='function')fail('trusted_readonly_owner_required');
  const before={},after={};
  const transforms={base:patchBase,executor:patchExecutor,policy:patchPolicy,mcp:patchMcp};
  for(const [kind,owner] of Object.entries(LIVE)){
    const bytes=readOwner(owner.path);
    if(!Buffer.isBuffer(bytes)||bytes.length<50||bytes.length>3000000||sha256(bytes)!==owner.sha256)
      fail('pinned_owner_sha_mismatch:'+kind);
    before[kind]=owner.sha256;
    after[kind]=transforms[kind](bytes.toString('utf8'));
  }
  return Object.freeze({
    action:ACTION,operation:OPERATION,site:CONTRACT.site,revision:CONTRACT.revision,
    scope:CONTRACT.scope,backend_sha:CONTRACT.backendSha,
    input_sha256:before,
    output_sha256:Object.fromEntries(Object.entries(after).map(([k,v])=>[k,sha256(Buffer.from(v))])),
    sources:after,install_authorized:false,production_mutation:false,
    registration_complete:false
  });
}
module.exports=Object.freeze({ACTION,OPERATION,LIVE,POLICY_VERSION,BASE_POLICY_VERSION,
  patchBase,patchExecutor,patchMcp,patchPolicy,buildCandidates,sha256});