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
 * Root executor owns these capabilities.  They MUST NOT be constructed using
 * arguments from an MCP client. Bridge attests all 9 capabilities.
 *
 * Both calling this function and passing plausible callbacks are insufficient:
 * bridge.applyAfterConsumption calls the root-only verifier against the true
 * Approval Center Ed25519 public key and persisted once-only ledger.
 */
async function dispatch({input,approvalToken,rootCapabilities}={}) {
 const request=registration.boundArgs(input);
 if(!request.manifest_commit||!request.manifest_sha256)
   stop('immutable_manifest_required');
 if(typeof approvalToken!=='string'||approvalToken.length<120)
   stop('signed_approval_required');
 const root=bridge.attestExistingRoute(rootCapabilities);
 const narrowed=Object.freeze({
  readPinnedGitManifest(query) {
   if(query.repo!==registration.EXPECTED_GIT_REPO||
      query.source_commit!==registration.SOURCE_COMMIT||
      query.manifest_commit!==input.manifest_commit||
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
   return root.getInstaller(a);
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
 return bridge.applyAfterConsumption({
  input:request,approvalToken,capabilities:narrowed
 });
}
if(require.main===module){
 process.stderr.write('No CLI. Future root executor and signed Level-4 registrar required.\n');
 process.exitCode=78;
}
module.exports=Object.freeze({
 SOURCE,DEST,OWNERS,assertFixedManifest,dispatch
});
