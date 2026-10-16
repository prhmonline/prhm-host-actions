'use strict';
/**
 * Agent 3 Universal Backup: source-only trusted shared-registry adapter.
 *
 * This deliberately does NOT install a registrar, mutate the four Control
 * Plane owners, issue or consume approval, mint tokens, or run a shell.
 *
 * It binds the existing reviewed shared-registry Host Actions v2 bridge to
 * EXACTLY one Agent 3 release. The bridge alone validates the real Ed25519
 * signature and one-time consumed ledger before any installer callback.
 *
 * Live registration remains impossible until the previously reviewed shared
 * registrar has itself been installed through an authorized route.
 */
const registration=require('./registration-contract.cjs');
const bridge=require('../../prhm-action-registry-host-actions-v2-bridge-v1.cjs');
const gateway=require('../../prhm-action-registry-gateway-v1.cjs');

const ACTION=registration.INSTALL_ACTION;
const PROJECT=registration.PROJECT;
const SOURCE_COMMIT=registration.SOURCE_COMMIT;
const REPO=registration.EXPECTED_GIT_REPO;
const MANIFEST_PATH=registration.EXPECTED_MANIFEST_PATH;
function deny(code){throw Error('agent3_shared_registration_denied:'+code);}
function validate(input){
 const fields=registration.boundArgs(input);
 if(fields.project!==PROJECT||fields.source_commit!==SOURCE_COMMIT||
    fields.action!==gateway.ACTION)deny('wrong_action_project_source');
 return Object.freeze({...fields});
}
/**
 * Trusted capabilities are provided ONLY by the already authenticated root
 * registrar. None are constructed from request body, a network URL, or CLI.
 * The wrapper never lets an Agent 3 registration select another action.
 */
function boundCapabilities(capabilities){
 const cap=bridge.attestExistingRoute(capabilities);
 const only=(actual,expected,name)=>{if(actual!==expected)deny('unexpected_'+name);};
 return Object.freeze({
  readPinnedGitManifest:request=>{
   only(request.repo,REPO,'repository');
   only(request.project,PROJECT,'project');
   only(request.source_commit,SOURCE_COMMIT,'source');
   const file=cap.readPinnedGitManifest(request);
   if(!file||file.path!==MANIFEST_PATH||!Buffer.isBuffer(file.bytes))
    deny('unreviewed_manifest');
   registration.verifyReviewedManifest({bytes:file.bytes,gitPath:file.path});
   return file;
  },
  readPinnedGitSource:request=>{
   only(request.repo,REPO,'source_repository');
   only(request.source_commit,SOURCE_COMMIT,'source_revision');
   return cap.readPinnedGitSource(request);
  },
  readLiveOwner:owner=>cap.readLiveOwner(owner),
  readStagedAsset:asset=>cap.readStagedAsset(asset),
  getInstaller:action=>{
   only(action,ACTION,'install_action');
   return cap.getInstaller(action);
  },
  getRollback:action=>{
   only(action,ACTION,'rollback_action');
   return cap.getRollback(action);
  },
  verifyOriginalState:release=>cap.verifyOriginalState(release),
  getToolDiscovery:action=>{
   only(action,ACTION,'discovery_action');
   return cap.getToolDiscovery(action);
  },
  writeMetadataAudit:record=>{
   only(record.project,PROJECT,'audit_project');
   only(record.action,ACTION,'audit_action');
   return cap.writeMetadataAudit(record);
  }
 });
}
/** Read-only release review (no approval, no registration, no install). */
function preview({input,capabilities}={}){
 const args=validate(input);
 const cap=boundCapabilities(capabilities);
 const release=bridge.immutableManifest(args,cap);
 if(release.normalized.action!==ACTION||release.normalized.project!==PROJECT||
    release.source_commit!==SOURCE_COMMIT||
    release.normalized.git_path!==MANIFEST_PATH)deny('release_binding');
 return Object.freeze({
  ok:true,mode:'UNAUTHORIZED_SOURCE_ONLY_PREVIEW',
  action:ACTION,project:PROJECT,source_commit:SOURCE_COMMIT,
  manifest_commit:args.manifest_commit,manifest_sha256:args.manifest_sha256,
  asset_count:release.normalized.assets.length,
  owner_count:Object.keys(release.normalized.owners).length,
  registry_installed:false,approval_consumed:false,production_mutation:false
 });
}
/**
 * Call only from the existing trusted root Host Actions v2 dispatcher.
 * No user-controlled boolean or fabricated approval receipt can authorize.
 *
 * bridge.applyAfterConsumption -> gateway.executeAfterTrustedAuthorization
 * -> verifyLiveConsumedRegistrationApproval uses the on-host public key,
 * signature, strict claims, expiry and persisted consumed-once ledger.
 */
async function executeWithTrustedRegistrar({input,approvalToken,capabilities}={}){
 const args=validate(input);
 if(typeof approvalToken!=='string'||approvalToken.length<120)
  deny('signed_consumed_l4_required');
 const cap=boundCapabilities(capabilities);
 return bridge.applyAfterConsumption({
  input:args,approvalToken,capabilities:cap
 });
}
if(require.main===module){
 process.stderr.write('no standalone apply; signed consumed Level-4 registrar route required\n');
 process.exitCode=78;
}
module.exports=Object.freeze({ACTION,PROJECT,SOURCE_COMMIT,MANIFEST_PATH,
 validate,boundCapabilities,preview,executeWithTrustedRegistrar});
