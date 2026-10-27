'use strict';

/**
 * Issue #221: source-only trust-boundary policy/preimage gate.
 *
 * This module cannot install, issue or consume approvals, restart services,
 * run commands, modify files, or authorize itself. A separately reviewed,
 * root-owned, provider-console bootstrap must supply the native adapter.
 *
 * The GitHub approval for PBCinema PR #220 authorizes source review only.
 */
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const gateway=require('./prhm-action-registry-gateway-v1.cjs');
const ACTION='prhm_action_registry_install_v1';
const OPERATION='host_action.'+ACTION;
const VERSION='2026-10-27.2-shared-registrar-bootstrap-proposal';
const RELEASE_COMMIT='70a51f7ddc00136863904873ab2a146b6227b7c2';
const BACKUP_DIR='/var/backups/prhm-host-actions-registration/preinstall.EHclsBk3';
const OWNERS=Object.freeze({
  base:Object.freeze({path:'/opt/prhm-agent-selfmaint/server.js',
    sha256:'4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406'}),
  executor:Object.freeze({path:'/opt/prhm-agent-selfmaint-exec/server.js',
    sha256:'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0'}),
  mcp:Object.freeze({path:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
    sha256:'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166'}),
  policy:Object.freeze({path:'/opt/prhm-company-control-plane/config/approval-policy.json',
    sha256:'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174'})
});
const SERVICES=Object.freeze([
 'prhm-agent-selfmaint.service','prhm-agent-selfmaint-exec.service',
 'prhm-agent-mcp-blue.service','prhm-agent-mcp-green.service'
]);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=x=>{throw Error('registrar_bootstrap_'+x)};
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function checkPreflightRecords({live,backups,services,sourceCommit}){
 // This is data integrity only, not proof of who collected the data. The
 // privileged installer MUST read all bytes itself just before mutation.
 if(!obj(live)||!obj(backups)||!obj(services)||
    sourceCommit!==RELEASE_COMMIT)fail('preflight_input');
 if(Object.keys(live).sort().join('|')!==Object.keys(OWNERS).sort().join('|')||
    Object.keys(backups).sort().join('|')!==Object.keys(OWNERS).sort().join('|'))
    fail('owner_set_drift');
 const digests={};
 for(const [id,expected] of Object.entries(OWNERS)){
  const active=live[id],copy=backups[id];
  if(!obj(active)||!Buffer.isBuffer(active.bytes)||active.path!==expected.path||
     active.regular!==true||active.symlink!==false||active.realpath!==expected.path||
     !Number.isInteger(active.uid)||!Number.isInteger(active.gid)||
     !Number.isInteger(active.mode)||active.mode<0||active.mode>0o777)
     fail('live_metadata_'+id);
  if(sha(active.bytes)!==expected.sha256)fail('live_sha_drift_'+id);
  if(!obj(copy)||copy.path!==BACKUP_DIR+'/'+id+'.bak'||
     !Buffer.isBuffer(copy.bytes)||sha(copy.bytes)!==expected.sha256||
     !copy.bytes.equals(active.bytes))fail('backup_integrity_'+id);
  digests[id]=expected.sha256;
 }
 for(const name of SERVICES){
  if(!own(services,name)||services[name]!=='active')fail('service_unhealthy_'+name);
 }
 if(Object.keys(services).length!==SERVICES.length)fail('service_set_drift');
 return Object.freeze({phase:'preinstall',ownerSha256:Object.freeze(digests),
  backupDir:BACKUP_DIR,sourceCommit:RELEASE_COMMIT,
  policyOnly:false,rootAdapterInstalled:false,
  signedApprovalIssued:false,productionChanged:false});
}
function buildPolicyCandidate(live){
 // Candidate for independent review, never a live reload or authorization.
 // The L4 approval MUST bind all five canonical fields; the installed
 // one-argument Host Actions v2 API is not suitable without a native upgrade.
 if(!obj(live)||live.schema_version!=='prhm.approval-policy.v1'||
    live.default_deny!==true||live.scope_freeze!==true||
    !obj(live.operations)||!Array.isArray(live.typed_scopes))
    fail('policy_contract_invalid');
 if(own(live.operations,OPERATION)||
    live.typed_scopes.some(s=>s?.action===ACTION||s?.operation===OPERATION))
    fail('registrar_already_in_policy');
 const added=Object.freeze({
  level:4,risk:'critical',requires_second_confirmation:true,
  one_time_use:true,requested_approver:'mohammad',expires_seconds:180,
  policy_version:VERSION,
  rollback_reference:'host-action-v2:shared-registrar:exact-four-owner-restore'
 });
 const scope=Object.freeze({
  tool:'host_action_v2_apply',project:'control_plane',
  environment:'production',action:ACTION,risk:'critical',
  operation:OPERATION,principals:[{principal_id:'mohammad',roles:['mcp-operator']}]
 });
 const candidate={...live,version:VERSION,
  operations:{...live.operations,[OPERATION]:added},
  typed_scopes:[...live.typed_scopes,scope]};
 // No mutation of the input, no removal/modification of existing scope,
 // configuration or permission data. Always fail closed on scope drift.
 const stripped={...candidate,version:live.version,
  operations:Object.fromEntries(Object.entries(candidate.operations)
   .filter(([k])=>k!==OPERATION)),
  typed_scopes:candidate.typed_scopes.slice(0,-1)};
 assert.deepStrictEqual(stripped,live);
 return Object.freeze({
  action:ACTION,mode:'SOURCE_ONLY_REVIEW',
  livePolicy:live.version,candidatePolicy:candidate,
  signer:'existing-prhm-company-approval-ed25519',
  canonicalFields:Object.freeze([
   'action','project','source_commit','manifest_commit','manifest_sha256'
  ]),
  requiresReviewedRootAdapter:true,
  requiresNativeSingleUseL4:true,
  requiresAtomicBackupRollback:true,
  installationAuthorized:false
 });
}
function fiveFieldBinding(args){
 // Calls the already-reviewed gateway canonicalizer and hashes; this does
 // NOT request, verify, consume or forge an Approval Center receipt.
 return gateway.approvalBindingSha(args);
}
module.exports=Object.freeze({
 ACTION,OPERATION,VERSION,RELEASE_COMMIT,BACKUP_DIR,OWNERS,SERVICES,
 checkPreflightRecords,buildPolicyCandidate,fiveFieldBinding
});
