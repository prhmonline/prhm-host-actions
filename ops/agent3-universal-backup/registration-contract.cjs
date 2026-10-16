'use strict';
/**
 * Adapter contract for the ONE previously reviewed Host Actions v2 shared
 * registration gateway. Source-only; NOT an Approval Center, registry writer,
 * CLI installer, key loader, network listener or production endpoint.
 *
 * Enroll a NEW fixed Agent 3 action only after a trusted operator has bound:
 * action, project, exact source commit, manifest commit and manifest SHA256.
 *
 * The old action-only request API cannot carry this binding and MUST NOT be
 * used to register the Agent 3 Universal Backup Engine.
 */
const gateway=require('../../prhm-action-registry-gateway-v1.cjs');
const bridge=require('../../prhm-action-registry-host-actions-v2-bridge-v1.cjs');

const INSTALL_ACTION='agent3_universal_backup_engine_install_v1';
const REGISTRY_ACTION=gateway.ACTION;
const PROJECT='agent3';
const SOURCE_COMMIT='9617f0dfe5db19feb22e06764ec116223867d4d9';
const SOURCE_CI_RUN='https://github.com/prhmonline/prhm-host-actions/actions/runs/38980723563';
const EXPECTED_MANIFEST_PATH='ops/agent3-universal-backup/registry-release-manifest.json';
const EXPECTED_GIT_REPO='prhmonline/prhm-host-actions';
function deny(reason){throw Error('agent3_registration_denied:'+reason);}
function boundArgs(fields){
 if(!fields||typeof fields!=='object'||Array.isArray(fields)||
    Object.keys(fields).sort().join('|')!==
    ['action','project','source_commit','manifest_commit','manifest_sha256'].sort().join('|'))
   deny('exact_five_field_schema_required');
 if(fields.action!==REGISTRY_ACTION||fields.project!==PROJECT||
    fields.source_commit!==SOURCE_COMMIT)deny('fixed_action_project_source_required');
 const canonical=gateway.canonicalArgs(fields);
 if(!canonical||canonical.length>360)deny('oversized_binding');
 return Object.freeze({...fields});
}
function dryRunApprovalRequest(fields){
 const args=boundArgs(fields);
 const proposal=bridge.typedApprovalRequest(args);
 if(proposal.risk!=='critical'||proposal.ttl_seconds>180||
    proposal.arguments_sha256!==gateway.approvalBindingSha(args)||
    proposal.action!==REGISTRY_ACTION||proposal.arguments.project!==PROJECT||
    proposal.project!=='control_plane')deny('untrusted_approval_contract');
 // Proposal ONLY. This does not mint/sign/consume an approval.
 return Object.freeze({mode:'not_submitted',requires_level4:true,
   registry_action:REGISTRY_ACTION,target_action:INSTALL_ACTION,
   expected_manifest_path:EXPECTED_MANIFEST_PATH,
   immutable_source_commit:SOURCE_COMMIT,
   approval_request:Object.freeze(proposal)});
}
function verifyReviewedManifest({bytes,gitPath}){
 if(!Buffer.isBuffer(bytes)||bytes.length>160000||bytes.length<100||
    gitPath!==EXPECTED_MANIFEST_PATH)deny('pinned_manifest_required');
 let manifest;
 try{manifest=JSON.parse(bytes.toString('utf8'))}catch{deny('manifest_parse');}
 // Reject wrong target before shared schema/health validation so no unrelated
 // registration manifest can be interpreted as a release for Agent 3.
 if(!manifest||manifest.project!==PROJECT||manifest.action!==INSTALL_ACTION||
    manifest.source_commit!==SOURCE_COMMIT||manifest.git_path!==EXPECTED_MANIFEST_PATH)
   deny('manifest_target_mismatch');
 const release=gateway.assertManifest(manifest);
 if(release.project!==PROJECT||release.action!==INSTALL_ACTION||
    release.source_commit!==SOURCE_COMMIT||
    release.git_path!==EXPECTED_MANIFEST_PATH)deny('manifest_target_mismatch');
 // Manifest itself is insufficient: the trusted executor must also verify
 // live four-owner preimages, all source blobs, signed Ed25519 receipt,
 // consumption ledger and a separate byte-preserving rollback.
 return Object.freeze({release,sha256:gateway.sha(bytes),trusted_install_ready:false});
}
function status(input={}){
 const q=gateway.readiness({
  phase:'preinstall',release:input.gitAttested===true,
  registrarInstalled:input.sharedRegistrarVisible===true,
  approvalRouteInstalled:input.typedApprovalRouteVisible===true,
  rollbackReady:input.fourOwnerRollbackVerified===true,
  servicesHealthy:input.allFourServicesHealthy===true
 });
 const blockers=[...q.gaps];
 if(input.liveInstallerRegistered!==true)blockers.push('TARGET_INSTALL_ACTION_NOT_REGISTERED');
 if(input.pinnedServiceKeyReady!==true)blockers.push('BACKUP_KEY_NOT_PROVISIONED');
 return Object.freeze({phase:'preinstall',ready:q.ready&&
    input.liveInstallerRegistered===true&&input.pinnedServiceKeyReady===true,
    action:INSTALL_ACTION,source_commit:SOURCE_COMMIT,source_ci:SOURCE_CI_RUN,
    request_schema:'action,project,source_commit,manifest_commit,manifest_sha256',
    approval:'new one-time Ed25519 Level-4, signed and ledger-consumed',
    owner_count:4,git_repo:EXPECTED_GIT_REPO,
    gaps:Object.freeze(blockers)});
}
module.exports=Object.freeze({INSTALL_ACTION,REGISTRY_ACTION,PROJECT,
 SOURCE_COMMIT,SOURCE_CI_RUN,EXPECTED_MANIFEST_PATH,EXPECTED_GIT_REPO,
 boundArgs,dryRunApprovalRequest,verifyReviewedManifest,status});
