'use strict';
/**
 * Fixed typed boundary for the EXISTING Host Actions v2 / Approval Center.
 * Not a CLI, server, root helper, bootstrap, registration endpoint or installer.
 * The trusted executor must add its single action-specific dispatch after Git
 * review and fresh L4 approval, preserving all previously installed actions.
 */
const g=require('./prhm-action-registry-gateway-v1.cjs');
const crypto=require('node:crypto');
const ACTION=g.ACTION;
const MAX_SOURCE_BYTES=160000;
const JWS_BOUNDARY='existing-prhm-company-approval';
function fail(code){throw new Error('typed_registry_'+code)}
function exactFields(obj,fields) {
 if(!obj||typeof obj!=='object'||Array.isArray(obj)||
    Object.keys(obj).sort().join(':')!==fields.slice().sort().join(':'))fail('request_schema');
}
function strictRequest(input){
 exactFields(input,['action','project','source_commit','manifest_commit','manifest_sha256']);
 if(input.action!==ACTION)fail('action_not_allowlisted');
 // A release manifest contains the immutable source commit; publishing
 // that manifest must yield its OWN second Git commit. Never accept a
 // self-referential or mutable release ID at the approval boundary.
 if(input.source_commit===input.manifest_commit)
   fail('source_and_manifest_commits_must_differ');
 const json=g.canonicalArgs(input);
 if(json.length>360)fail('request_size');
 return Object.freeze({...input,arguments_sha256:g.approvalBindingSha(input)});
}
function typedApprovalRequest(input){
 const spec=strictRequest(input);
 return Object.freeze({
  principal_id:'mohammad',role:'mcp-operator',tool:'host_action_v2_apply',
  project:'control_plane',environment:'production',
  action:ACTION,risk:'critical',operation:g.OPERATION,
  arguments:JSON.parse(g.canonicalArgs(input)),
  arguments_sha256:spec.arguments_sha256,
  ttl_seconds:180,
  rollback_reference:'host-action-v2:prhm-action-registry-install-v1:verified-four-owner-restore'
 });
}
function validateReceipt(request,confirmation,issued){
 const expected=strictRequest(request);
 if(confirmation!=='CONFIRM_LEVEL_4_CRITICAL')fail('critical_confirmation_required');
 if(!issued||issued.action!==ACTION||issued.level!==4||issued.risk!=='critical'||
    issued.arguments_sha256!==expected.arguments_sha256||
    issued.execution_authorized!==true||
    issued.one_time_use!==true||
    typeof issued.request_id!=='string'||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(issued.request_id))fail('receipt_binding_invalid');
 return Object.freeze({request_id:issued.request_id,arguments_sha256:expected.arguments_sha256});
}
function attestExistingRoute(bridge){
 // Externally injected capabilities are owned exclusively by the existing
 // root executor, never constructed from client-provided path/code.
 const functions=['readPinnedGitManifest','readPinnedGitSource','readLiveOwner','readStagedAsset',
    'getInstaller','getRollback','claimOnce','verifyOriginalState',
    'restartService','checkServiceHealth','getToolDiscovery','writeMetadataAudit'];
 for(const f of functions)if(!bridge||typeof bridge[f]!=='function')fail('trusted_capability_missing_'+f);
 return bridge;
}
function immutableManifest(input,bridge){
 const request=strictRequest(input),cap=attestExistingRoute(bridge);
 // Repo is a fixed constant; client cannot choose arbitrary Git host.
 const file=cap.readPinnedGitManifest({
   repo:'prhmonline/prhm-host-actions',
   source_commit:input.source_commit,
   manifest_commit:input.manifest_commit,project:input.project,
   max_bytes:MAX_SOURCE_BYTES,
 });
 if(!file||typeof file.path!=='string'||!Buffer.isBuffer(file.bytes)||
    file.bytes.length<=100||file.bytes.length>MAX_SOURCE_BYTES)
   fail('git_manifest_missing');
 const out=g.attestRelease({
  manifestBytes:file.bytes,expectedManifestSha:input.manifest_sha256,
  sourceCommit:input.source_commit,manifestCommit:input.manifest_commit,
  readOwner:p=>cap.readLiveOwner(p),
  readAsset:p=>cap.readStagedAsset(p),
  readGitBlob:(commit,path)=>{
    // Enforce precisely the already pinned, previously retrieved Git object.
    if(commit!==input.manifest_commit||path!==file.path)fail('git_blob_unbound');
    return file.bytes;
  },
  readGitSource:(commit,path)=>{
    if(commit!==input.source_commit)fail('source_git_commit_unbound');
    const bytes=cap.readPinnedGitSource({repo:'prhmonline/prhm-host-actions',
      source_commit:commit,source_path:path,max_bytes:4000000});
    if(!Buffer.isBuffer(bytes))fail('source_git_blob_missing');
    return bytes;
  }
 });
 if(out.normalized.project!==input.project||out.normalized.git_path!==file.path)
    fail('manifest_project_or_path_mismatch');
 if(input.project==='honartik'&&
    out.normalized.git_path!=='manifests/honartik-config-center-registry-release-v1.json')
    fail('honartik_release_manifest_path_unexpected');
 return out;
}
/**
 * Fixed compatibility handoff to the existing Honartik atomic installer.
 * Only the original signed token goes forward; a boolean 'approved' object
 * cannot be repackaged into a successful project installer invocation.
 *
 * Source-only transport: the root executor must supply trusted pinned Git
 * readers and allowlisted systemd controls. No user-supplied callback input.
 */
function invokeHonartikReviewedInstaller({input,release,approvalToken,installer,cap}){
 strictRequest(input);
 if(input.project!=='honartik'||
    release?.normalized?.project!=='honartik'||
    release?.normalized?.action!=='honartik_config_center_readonly_enroll_v1'||
    release.source_commit!==input.source_commit||
    release.manifest_commit!==input.manifest_commit||
    release.manifest_sha256!==input.manifest_sha256||
    typeof installer!=='function'||typeof approvalToken!=='string'||
    approvalToken.length<120)fail('honartik_adapter_binding');
 attestExistingRoute(cap);
 const approvedServices=release.normalized.health?.services;
 if(!Array.isArray(approvedServices)||approvedServices.length!==4)
   fail('honartik_service_manifest_missing');
 const service=(name,kind)=>{
   if(!approvedServices.includes(name))fail('service_not_allowlisted');
   const v=(kind==='restart'?cap.restartService:cap.checkServiceHealth)(name);
   if(v!==true)fail('service_'+kind+'_verification_failed');
   return v;
 };
 return installer({
   approvalToken,args:input,release,
   readPinnedManifest:(commit,path)=>{
     if(commit!==input.source_commit||
        path!=='honartik-config-center-install-manifest-v1.json')
       fail('honartik_source_manifest_unbound');
     const data=cap.readPinnedGitSource({
       repo:'prhmonline/prhm-host-actions',source_commit:commit,
       source_path:path,max_bytes:4000000});
     if(!Buffer.isBuffer(data)||data.length<=100)
       fail('honartik_source_manifest_missing');
     return data;
   },
   restart:name=>service(name,'restart'),
   health:name=>service(name,'health')
 });
}
async function applyAfterConsumption({input,approvalToken,capabilities}){
 const request=strictRequest(input);
 if(typeof approvalToken!=='string'||approvalToken.length<120)fail('signed_l4_token_missing');
 const cap=attestExistingRoute(capabilities);
 const release=immutableManifest(input,cap);
 const installer=cap.getInstaller(release.normalized.action);
 const rollback=cap.getRollback(release.normalized.action);
 if(typeof installer!=='function'||typeof rollback!=='function')
   fail('approved_installer_or_rollback_not_registered');
 return g.executeAfterTrustedAuthorization({
  release,args:input,signedApprovalToken:approvalToken,
  trustedClaimOnce:async bound=>cap.claimOnce(bound),
  trustedInstaller:async bound=>invokeHonartikReviewedInstaller({
    input,release:bound.release,approvalToken,installer,cap}),
  trustedRollback:async bound=>rollback(bound),
  verifyOriginalState:async bound=>cap.verifyOriginalState(bound),
  readInstalledTool:async action=>cap.getToolDiscovery(action),
  audit:async record=>cap.writeMetadataAudit(record)
 });
}
module.exports=Object.freeze({
 ACTION,JWS_BOUNDARY,strictRequest,typedApprovalRequest,validateReceipt,
 attestExistingRoute,immutableManifest,invokeHonartikReviewedInstaller,applyAfterConsumption
});
