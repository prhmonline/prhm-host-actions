'use strict';
// Fixed read-only HOST PREINSTALL evidence check. Does not patch root owners,
// register a tool, consume an approval, execute an action or contact a server.
const crypto=require('node:crypto');
const {CONTRACT}=require('./deploy-control-cutover-contract-v1.cjs');
const {inspect}=require('./deploy-control-l4-registration-readiness-v1.cjs');
const ACTION=CONTRACT.action;
const POLICY_VERSION=CONTRACT.candidate_policy_version;
const TARGETS=Object.freeze({
  '/opt/prhm-agent-selfmaint/server.js':
    '4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406',
  '/opt/prhm-agent-selfmaint-exec/server.js':
    '410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0',
  '/opt/prhm-company-control-plane/config/approval-policy.json':
    '148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174',
  '/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js':
    'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166',
});
const EXPECTED_SOURCE=Object.freeze({
  repo:'prhmonline/prhm-company-control-plane',
  commit:'acffc7f9e02073f7aaf6ba92777f7acff6481f81',
  path:'config/approval-policy.json',
  git_blob_sha:'702fbed1d0a9936e6fc0e42694f3e1ce6941f4bc',
  raw_sha256:'ed527c12ee330b8e1f5616fcb0c712eb89dddd9395197b2d855f00d3deea0678',
  object_sha256:CONTRACT.candidate_policy_object_sha256
});
const fail=c=>{throw new Error('deploy_control_preinstall_'+c)};
const sha256=b=>crypto.createHash('sha256').update(b).digest('hex');
const blob=b=>crypto.createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
function exactKeys(value,keys) {
  return !!value&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).sort().join('|')===keys.slice().sort().join('|');
}
function preinstall({owners,issuer,registry,policyBytes,source}){
  if(!exactKeys(owners,Object.keys(TARGETS)))fail('unreviewed_owner_path');
  for(const [p,digest] of Object.entries(TARGETS))
    if(owners[p]!==digest)fail('owner_preimage_sha_mismatch');
  if(!exactKeys(source,Object.keys(EXPECTED_SOURCE))||
     Object.entries(EXPECTED_SOURCE).some(([k,v])=>source[k]!==v))
    fail('source_git_identity_drift');
  if(!Buffer.isBuffer(policyBytes)||policyBytes.length<100||
     sha256(policyBytes)!==EXPECTED_SOURCE.raw_sha256||
     blob(policyBytes)!==EXPECTED_SOURCE.git_blob_sha)
    fail('candidate_policy_provenance_drift');
  let candidate;
  try{candidate=JSON.parse(policyBytes.toString('utf8'))}catch{fail('policy_json_invalid')}
  if(sha256(Buffer.from(JSON.stringify(candidate)))!==EXPECTED_SOURCE.object_sha256||
     candidate.version!==POLICY_VERSION)
    fail('candidate_policy_identity_drift');
  if(!issuer||issuer.ok!==true||issuer.service!=='prhm-company-approval'||
     issuer.mode!=='mcp-operator'||issuer.algorithm!=='Ed25519'||
     issuer.one_time_use!==true||
     issuer.policy_version!==CONTRACT.live_policy_version||
     issuer.policy_hash!==CONTRACT.live_policy_object_sha256)
    fail('active_issuer_preimage_drift');
  const registration=inspect({policy:candidate,health:registry});
  // Preinstallation never requires its as-yet-unregistered target tool to
  // already exist. That would make the legitimate trust bootstrap circular.
  if(registration.blockers.length!==2||
     !registration.blockers.includes('dedicated_fixed_action_not_registered')||
     !registration.blockers.includes('action_registry_uniqueness_failure'))
    fail('unrecognized_preinstall_registry_state');
  return Object.freeze({
    ok:true,phase:'source_preinstall_evidence',
    action:ACTION,owner_sha256_checked:Object.keys(TARGETS).length,
    policy_version:POLICY_VERSION,
    policy_raw_sha256:EXPECTED_SOURCE.raw_sha256,
    candidate_source_commit:EXPECTED_SOURCE.commit,
    authorized:false,host_registered:false,
    can_install:false,can_consume_approval:false,
    requires:'independently_reviewed_fixed_l4_host_action_registration_and_real_runtime_attestation'
  });
}
module.exports=Object.freeze({TARGETS,EXPECTED_SOURCE,preinstall});
