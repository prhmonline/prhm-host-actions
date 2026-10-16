'use strict';

/**
 * Fixed Honartik V2 signed-root *staging* worker.
 *
 * Runs only when loaded by a separately reviewed, root-owned, SHA-attested
 * launcher whose capabilities are already authorized by Approval Center.
 * Direct execution cannot install or request an approval.
 * Stages 35 pinned root assets + 1 fixed systemd unit; DOES NOT enable units,
 * register actions in MCP, change four owner files, or deploy applications.
 *
 * This worker does not and cannot bootstrap its own privileged transport.
 */
const boundary=require('./honartik-staging-privilege-boundary-install-v1.js');
const planSource=require('./bootstrap-host-actions-honartik-staging-privilege-boundary-install-v1.js');

const ACTION='honartik_shared_registry_v2_fixed_root_stage_v1';
const SOURCE_ONLY=true;
const ALLOWED = Object.freeze([
  'readPinnedManifests','readProtectedOwnerDigests','verifyConsumedRootApproval',
  'attestRootContext','attestTargetsAndParents','lockDurably',
  'journalDurably','readVerifiedGitBlob','createDirectoryExclusive',
  'createPinnedFileExclusive','verifyPinnedFile','verifyStagedState',
  'rollbackOwnedMutation','verifyExactRollback','metadataAudit',
  'releaseVerifiedLock'
]);
function refuse(code){throw new Error('honartik_fixed_root_stage_'+code);}
function must(v,code){if(!v)refuse(code);}
function exactKeys(value,keys,code){
  must(value&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).sort().join('|')===keys.slice().sort().join('|'),code);
}
function checkTrustedRoot(bridge){
  must(bridge&&typeof bridge==='object'&&
    bridge.kind==='prhm.sealed-independent-root-bridge.v2'&&
    bridge.registeredAction===ACTION,'trusted_independent_root_bridge_missing');
  for(const key of ALLOWED)
    must(typeof bridge[key]==='function','trusted_root_capability_missing_'+key);
}
function validateStage(stage){
  must(stage&&stage.schema==='prhm.honartik.root-bootstrap-staging-plan.v1'&&
    stage.action==='prhm_action_registry_install_v1'&&
    stage.external_root_installer_required===true&&
    stage.installs===false&&stage.executes===false&&
    stage.operations?.length===46&&
    stage.directory_count===10&&stage.source_file_count===35&&
    stage.unit_count===1,'plan_drift');
  const ops=stage.operations;
  must(ops.slice(0,10).every(o=>o.kind==='mkdir_if_absent_root_only'&&
    o.uid===0&&o.gid===0&&o.mode==='0700'),'directory_policy_drift');
  must(ops.slice(10).every(o=>o.kind==='create_exclusive_pinned_git_file'&&
    o.uid===0&&o.gid===0&&
    /^(0600|0644)$/.test(o.mode)&&
    /^[0-9a-f]{40}$/.test(o.source_commit)&&
    /^[0-9a-f]{40}$/.test(o.git_blob_sha1)),'file_policy_drift');
  must(ops.at(-1).destination===boundary.UNIT,'unit_path_drift');
  must(stage.fixed_owners&&Object.keys(stage.fixed_owners).length===4,
    'owner_set_drift');
  must(Object.entries(boundary.OWNERS).every(
    ([key,sha])=>stage.fixed_owners[key]===sha),'owner_sha_drift');
  const dst=ops.map(x=>x.destination);
  must(new Set(dst).size===46,'duplicate_stage_target');
  must(ops.slice(10,45).every(x=>x.destination.startsWith(boundary.ROOT+'/')),
    'runtime_destination_drift');
  return stage;
}
/** The exact immutable review is computed from bytes, NOT a user-supplied plan. */
async function buildPinnedPlan(bridge){
  checkTrustedRoot(bridge);
  const manifests=await bridge.readPinnedManifests(boundary.PINS);
  const observed=await bridge.readProtectedOwnerDigests(boundary.OWNERS);
  exactKeys(manifests,Object.keys(boundary.PINS),'manifest_set_mismatch');
  exactKeys(observed,Object.keys(boundary.OWNERS),'owner_set_mismatch');
  for(const key of Object.keys(boundary.PINS)){
    must(Buffer.isBuffer(manifests[key]),'manifest_not_bytes_'+key);
  }
  const stage=planSource.plan({
    manifestBytes:manifests,observedOwnerSha256:observed
  });
  return validateStage(stage);
}
function checkReceipt(result,stage){
  must(result&&result.fromExistingTrustedApprovalCenter===true&&
    result.signatureVerified===true&&result.oneTimeConsumed===true&&
    result.approvalLevel===4&&result.action===ACTION&&
    result.exactStageOwnerShaVerified===true&&
    result.exactStageBlobPinsVerified===true&&
    typeof result.requestId==='string'&&
    /^[0-9a-f-]{36}$/i.test(result.requestId)&&
    result.manifestSetShaVerified===true&&
    result.verifiedByIndependentRoot===true&&
    result.externalApprovalExpiresAtVerified===true,
    'signed_fresh_consumed_l4_unproven');
  must(stage.fixed_owners&&stage.operations.length===46,'stage_invalid');
  return result.requestId;
}
/**
 * The trusted root owns durable WAL, fsync, O_NOFOLLOW, O_EXCL, ownership,
 * Approval Center Ed25519 verification, actual source retrieval and lock DAC.
 * Those operations cannot be supplied by arbitrary API clients.
 */
function createSignedStage(bridge){
  checkTrustedRoot(bridge);
  let stage=null,phase='new',ownsLock=false;
  const trail=[];
  const journal=async(name,data={})=>{
    await bridge.journalDurably({name,action:ACTION,details:data});
    trail.push(name);
  };
  const run=async()=>{
    must(phase==='new','replay_or_reentry');
    stage=await buildPinnedPlan(bridge);
    const scope=await bridge.attestRootContext(ACTION);
    must(scope&&scope.rootUidVerified===true&&
      scope.independentSystemdUnitVerified===true&&
      scope.rootActionSourceShaVerified===true,'root_context_not_verified');
    const pre=await bridge.attestTargetsAndParents(stage);
    must(pre&&pre.targetCount===36&&pre.targetFilesAbsent===true&&
      pre.parentsSecure===true&&pre.noForeignLockOrWal===true&&
      pre.serviceNotInstalled===true&&pre.socketUnused===true,
      'host_preconditions_failed');
    // No write, no lock and no other host-side effect before signed L4 proof.
    const req=await bridge.verifyConsumedRootApproval({
      action:ACTION,fixedOwnerDigests:boundary.OWNERS,
      fixedManifestBlobPins:boundary.PINS,stageOperationCount:46
    });
    const receiptId=checkReceipt(req,stage);
    phase='authorized';
    try {
      await bridge.lockDurably({action:ACTION,receiptId});
      ownsLock=true;
      await journal('exclusive_lock_acquired',{receiptId});
      // WAL intent precedes EVERY physical filesystem write. A crash between
      // intent and completion must require cold recovery, NEVER blind retry.
      for(let i=0;i<stage.operations.length;i++){
        const op=stage.operations[i];
        await journal('intent',{index:i,kind:op.kind,destination:op.destination});
        if(op.kind==='mkdir_if_absent_root_only'){
          await bridge.createDirectoryExclusive(op);
        }else{
          // Git bytes are independently verified by trusted root on each read
          // before being passed to the only root-owned exclusive writer.
          const src=await bridge.readVerifiedGitBlob(op);
          must(src&&Buffer.isBuffer(src.bytes)&&src.blobVerified===true,
            'pinned_git_blob_not_verified');
          await bridge.createPinnedFileExclusive(op,src.bytes);
          await bridge.verifyPinnedFile(op);
        }
        await journal('done',{index:i});
      }
      const check=await bridge.verifyStagedState(stage);
      must(check&&check.all36FilesPinned===true&&
        check.tenDirectoriesSecure===true&&
        check.ownerFilesUnchanged===true&&
        check.systemdUnitInactive===true&&
        check.paymentGatesOff===true,'postcondition_failed');
      await bridge.metadataAudit({action:ACTION,result:'root_staged_not_activated',
        receiptId,operationCount:46});
      await journal('success',{receiptId});
      await bridge.releaseVerifiedLock({action:ACTION,receiptId,result:'success'});
      ownsLock=false;phase='staged';
      return Object.freeze({ok:true,action:ACTION,phase,receiptId,
        unitEnabled:false,releaseDeployed:false,financialGatesEnabled:false,
        operationCount:46});
    }catch(err){
      phase='recovery_required';
      // If a journal or rollback fails, the exclusive lock MUST remain for
      // manual cold recovery. Financial and application data are untouched.
      let restored=false;
      if(ownsLock){
        try {
          await bridge.rollbackOwnedMutation({action:ACTION,stage});
          const r=await bridge.verifyExactRollback(stage);
          restored=r&&r.originalStatePreserved===true&&
            r.noForeignFilesDeleted===true&&r.ownerFilesUnchanged===true;
          if(restored){
            await bridge.metadataAudit({action:ACTION,result:'verified_rollback',
              code:'fixed_root_stage_failed'});
            await journal('verified_rollback');
            await bridge.releaseVerifiedLock({action:ACTION,receiptId,result:'rollback'});
            ownsLock=false;phase='rolled_back';
          }
        }catch {}
      }
      if(!restored)
        refuse('rollback_not_verified_exclusive_lock_retained');
      throw err;
    }
  };
  return Object.freeze({run,getPhase:()=>phase,getTrail:()=>trail.slice()});
}
if(require.main===module){
  process.stdout.write(JSON.stringify({ok:false,action:ACTION,
    state:'signed_root_transport_not_installed',mutation:false})+'\n');
  process.exitCode=2;
}
module.exports=Object.freeze({ACTION,SOURCE_ONLY,validateStage,checkReceipt,
  buildPinnedPlan,createSignedStage});
