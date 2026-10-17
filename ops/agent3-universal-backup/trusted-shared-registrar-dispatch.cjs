'use strict';
/**
 * Narrow Agent 3 handler for the FUTURE already-authorized shared registrar.
 *
 * SOURCE ONLY: cannot register a route, mint/consume approvals, write owner
 * files, spawn processes or install itself. The existing trusted Host Actions
 * v2 root executor must bind real readers, atomic installer, rollback, audit,
 * discovery and signed Approval Center consumption. No legacy "action only"
 * call may invoke this handler.
 */
const bridge=require('../../prhm-action-registry-host-actions-v2-bridge-v1.cjs');
const gateway=require('../../prhm-action-registry-gateway-v1.cjs');
const registration=require('./registration-contract.cjs');
const lock=require('./release-lock.json');
const pins=require('./production-registration-contract.json');
const durableClaim=require('./durable-execution-claim.cjs');
const SOURCE='ops/agent3-universal-backup/install-candidate.js';
const DEST='/opt/prhm-agent-selfmaint-exec/actions/agent3-backup-installer.cjs';
const OWNERS=Object.freeze(['base','executor','policy','mcp']);
function stop(reason){throw Error('agent3_shared_dispatch_denied:'+reason);}
function exact(obj,fields) {
 return Boolean(obj&&typeof obj==='object'&&!Array.isArray(obj)&&
   Object.keys(obj).sort().join('|')===fields.slice().sort().join('|'));
}
function assertFixedManifest(bytes,path){
 if(!Buffer.isBuffer(bytes)||path!==registration.EXPECTED_MANIFEST_PATH)
   stop('unbound_manifest_path_or_bytes');
 const attested=registration.verifyReviewedManifest({bytes,gitPath:path});
 let m;
 try{m=JSON.parse(bytes.toString('utf8'));}catch{stop('invalid_manifest_json');}
 if(!Array.isArray(m.assets)||m.assets.length!==1||
    !exact(m.assets[0],['path','source_path','sha256'])||
    m.assets[0].path!==DEST||m.assets[0].source_path!==SOURCE||
    m.assets[0].sha256!==lock.expected_sha256?.[SOURCE])
   stop('untrusted_installer_asset_or_source');
 if(!exact(m.registry_owners,OWNERS))
   stop('unbound_owner_set');
 for(const key of OWNERS){
  const owner=m.registry_owners[key];
  if(owner.path!==gateway.OWNER_PATHS[key]||
     owner.before_sha256!==pins.preimage_sha256[key])
    stop('unbound_owner_preimage:'+key);
 }
 if(m.action!==registration.INSTALL_ACTION||m.project!==registration.PROJECT||
    m.source_commit!==registration.SOURCE_COMMIT||attested.release.action!==m.action)
   stop('unbound_project_or_action');
 if(lock.source_commit_sha!==registration.SOURCE_COMMIT||
    lock.fixed_action!==registration.INSTALL_ACTION||
    lock.target_host!=='prhm-production')
   stop('release_lock_drift');
 return Object.freeze({
  target_action:registration.INSTALL_ACTION,
  source_commit:registration.SOURCE_COMMIT,
  manifest_sha256:attested.sha256,
  registrar_action:gateway.ACTION,
  owner_count:4,
  staged_installer_sha256:lock.expected_sha256[SOURCE],
  installed:false,
  authorization_consumed:false
 });
}
/**
 * Root executor owns these capabilities. They MUST NOT be constructed using
 * arguments from an MCP client. Bridge attests nine core capabilities; the
 * Agent 3 adapter additionally REQUIRES a root-owned durable exclusive claim.
 * That claim must use a crash-safe O_EXCL + fsync journal keyed by request_id
 * and immutable five-field argument digest, BEFORE the installer is invoked.
 * An existing claim, even from a failed attempt, MUST deny another execution.
 *
 * Both calling this function and passing plausible callbacks are insufficient:
 * bridge.applyAfterConsumption calls the root-only verifier against the true
 * Approval Center Ed25519 public key and persisted once-only ledger.
 */
function boundRootCapabilities(input,rootCapabilities) {
 const request=registration.boundArgs(input);
 const root=bridge.attestExistingRoute(rootCapabilities);
 if(typeof root.claimExecutionOnce!=='function')
   stop('root_exclusive_claim_required');
 return Object.freeze({
  readPinnedGitManifest(query) {
   if(query.repo!==registration.EXPECTED_GIT_REPO||
      query.source_commit!==registration.SOURCE_COMMIT||
      query.manifest_commit!==request.manifest_commit||
      query.project!==registration.PROJECT)stop('untrusted_manifest_query');
   const result=root.readPinnedGitManifest(query);
   assertFixedManifest(result?.bytes,result?.path);
   return result;
  },
  readPinnedGitSource(query) {
   if(query.repo!==registration.EXPECTED_GIT_REPO||
      query.source_commit!==registration.SOURCE_COMMIT||
      query.source_path!==SOURCE)stop('untrusted_git_source');
   return root.readPinnedGitSource(query);
  },
  readLiveOwner(p) {
   if(!Object.values(gateway.OWNER_PATHS).includes(p))
     stop('untrusted_owner_path');
   return root.readLiveOwner(p);
  },
  readStagedAsset(p) {
   if(p!==DEST)stop('untrusted_asset_destination');
   return root.readStagedAsset(p);
  },
  getInstaller(a) {
   if(a!==registration.INSTALL_ACTION)stop('untrusted_installer_dispatch');
   // Eagerly resolve and type-check the reviewed root installer *before*
   // the bridge enters signed approval verification and the durable
   // execution claim. A missing installer must NOT consume a one-time
   // signed Level-4 request merely because we returned a wrapper.
   const installer=root.getInstaller(a);
   if(typeof installer!=='function')stop('root_installer_not_callable');
   // The shared bridge calls this callback only AFTER authenticating the
   // Ed25519 JWS and the Approval Center consumed ledger in the trusted root
   // executor. An exclusive durable claim prevents replay or concurrent runs
   // of the *same* valid consumed approval.
   return async ctx=>{
    const approval=ctx?.approval;
    const release=ctx?.release;
    const digest=gateway.approvalBindingSha(request);
    if(approval?.level!==4||approval?.risk!=='critical'||
       approval?.operation!==gateway.OPERATION||
       !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(approval?.request_id||'')||
       approval?.arguments_sha256!==digest||
       approval?.source_commit!==request.source_commit||
       approval?.manifest_sha256!==request.manifest_sha256||
       release?.source_commit!==request.source_commit||
       release?.manifest_commit!==request.manifest_commit||
       release?.manifest_sha256!==request.manifest_sha256||
       release?.normalized?.project!==registration.PROJECT||
       release?.normalized?.action!==registration.INSTALL_ACTION)
      stop('unbound_verified_approval_context');
    const claimInput=Object.freeze({
      request_id:approval.request_id,
      arguments_sha256:digest,
      project:registration.PROJECT,
      action:registration.REGISTRY_ACTION,
      target_action:registration.INSTALL_ACTION,
      source_commit:request.source_commit,
      manifest_commit:request.manifest_commit,
      manifest_sha256:request.manifest_sha256
    });
    const claim=await root.claimExecutionOnce(claimInput);
    if(!claim||Object.keys(claim).sort().join('|')!==
       ['claimed','durable','exclusive','request_id','arguments_sha256'].sort().join('|')||
       claim.claimed!==true||claim.durable!==true||claim.exclusive!==true||
       claim.request_id!==approval.request_id||
       claim.arguments_sha256!==digest)
      stop('durable_exclusive_execution_claim_denied');
    // Never retry the claim or installer after an exception. The root journal
    // remains consumed even when rollback restores original owner bytes.
    return installer(ctx);
   };
  },
  getRollback(a) {
   if(a!==registration.INSTALL_ACTION)stop('untrusted_rollback_dispatch');
   return root.getRollback(a);
  },
  verifyOriginalState(release) {
   if(release?.normalized?.action!==registration.INSTALL_ACTION||
      release?.normalized?.project!==registration.PROJECT||
      release?.source_commit!==registration.SOURCE_COMMIT)
      stop('untrusted_rollback_evidence');
   return root.verifyOriginalState(release);
  },
  getToolDiscovery(a) {
   if(a!==registration.INSTALL_ACTION)stop('untrusted_discovery');
   return root.getToolDiscovery(a);
  },
  writeMetadataAudit(record) {
   if(record?.project!==registration.PROJECT||
      record?.action!==registration.INSTALL_ACTION||
      record?.source_commit!==registration.SOURCE_COMMIT)
      stop('untrusted_audit_record');
   return root.writeMetadataAudit(record);
  }
 });
}
function rootWithFixedJournal(rootCapabilities){
 // Static local module binding: no caller-selected journal path, file or
 // callbacks. The journal validates UID 0 and its fixed root-only directory.
 if(!rootCapabilities||typeof rootCapabilities!=='object'||
    Array.isArray(rootCapabilities))stop('trusted_root_capabilities_required');
 if(Object.prototype.hasOwnProperty.call(rootCapabilities,'claimExecutionOnce'))
   stop('untrusted_execution_claim_override');
 return Object.freeze({...rootCapabilities,claimExecutionOnce:durableClaim.claimExecutionOnce});
}
async function dispatch({input,approvalToken,rootCapabilities}={}) {
 const request=registration.boundArgs(input);
 if(!request.manifest_commit||!request.manifest_sha256)
   stop('immutable_manifest_required');
 if(typeof approvalToken!=='string'||approvalToken.length<120)
   stop('signed_approval_required');
 const narrowed=boundRootCapabilities(request,rootWithFixedJournal(rootCapabilities));
 return bridge.applyAfterConsumption({
  input:request,approvalToken,capabilities:narrowed
 });
}
if(require.main===module){
 process.stderr.write('No CLI. Future root executor and signed Level-4 registrar required.\n');
 process.exitCode=78;
}
module.exports=Object.freeze({
 SOURCE,DEST,OWNERS,assertFixedManifest,boundRootCapabilities,rootWithFixedJournal,dispatch
});
