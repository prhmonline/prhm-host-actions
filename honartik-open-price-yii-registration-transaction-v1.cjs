'use strict';
/**
 * SOURCE-ONLY transaction primitive for the fixed Honartik restored-backup Yii
 * Host Action. It has NO CLI, filesystem write, signer, or MCP endpoint.
 * Only an existing trusted root installer may provide the capabilities below.
 *
 * This module does not install the action merely by being committed to Git.
 */
const crypto = require('node:crypto');
const ACTION = 'honartik_open_price_yii_scratch_v1';
const OPERATION = 'host_action.honartik_open_price_yii_registration_v1';
const SOURCE_COMMIT = 'a361761a29b61bfdb4abefb660ce0f11c38edea7';
const OWNER = Object.freeze({
  base: Object.freeze({path:'/opt/prhm-agent-selfmaint/server.js',
    sha256:'4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406'}),
  executor: Object.freeze({path:'/opt/prhm-agent-selfmaint-exec/server.js',
    sha256:'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0'}),
  mcp: Object.freeze({path:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
    sha256:'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166'}),
  policy: Object.freeze({path:'/opt/prhm-company-control-plane/config/approval-policy.json',
    sha256:'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174'})
});
const FILES = Object.freeze({
  coordinator: Object.freeze({path:'/opt/prhm-agent-selfmaint-exec/actions/honartik-open-price-yii-scratch-v1.cjs',
    source:'honartik-open-price-yii-scratch-v1.cjs',gitBlob:'05adcbd3c2984c39328ade604516e14150b4bc0c'}),
  nativeAdapter: Object.freeze({path:'/opt/prhm-agent-selfmaint-exec/actions/honartik-open-price-yii-native-adapter-v1.cjs',
    source:'honartik-open-price-yii-native-adapter-v1.cjs',gitBlob:'53afe9ce55df07aa2c36d99469ef560381cb624e'})
});
const ORDER = Object.freeze(['coordinator','nativeAdapter','base','executor','mcp','policy']);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const gitBlob = b => crypto.createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
function deny(reason){throw new Error('honartik_registration_'+reason)}
function exactKeys(obj,keys){
  return obj && !Array.isArray(obj) && typeof obj==='object' &&
    Object.keys(obj).sort().join(',') === keys.slice().sort().join(',');
}
function validatePlan(plan) {
  if (!plan || !exactKeys(plan.files,ORDER)) deny('files_not_exact');
  for(const key of ORDER){
    const file=plan.files[key];
    const allowed=OWNER[key] || FILES[key];
    if(!file || file.path!==allowed.path || !Buffer.isBuffer(file.bytes) || file.bytes.length<10)
      deny('invalid_candidate_'+key);
    if(file.sha256!==sha(file.bytes))deny('candidate_digest_mismatch_'+key);
    if(OWNER[key] && !file.bytes.includes(Buffer.from(ACTION)))
      deny('owner_missing_specific_registration_'+key);
    if(FILES[key] && gitBlob(file.bytes)!==allowed.gitBlob)
      deny('immutable_source_blob_mismatch_'+key);
  }
  return Object.freeze(Object.fromEntries(ORDER.map(k=>[k,plan.files[k].sha256])));
}
/**
 * All capabilities must come from the ROOT trusted installer, not from request
 * JSON. Signed authorization is asserted/consumed by that installer itself.
 * No approval bytes or secrets are accepted from callers here.
 */
async function applyTrustedRegistration(cap) {
  const functions=['readOwner','readSourceBlob','buildReviewedOwnerCandidate',
    'assertConsumedLevel4','lock','snapshot','writeExact','verifyFile',
    'verifyRegistration','restoreSnapshot','audit'];
  for(const name of functions)if(typeof cap?.[name]!=='function')
    deny('trusted_capability_missing_'+name);

  const previous={},sources={};
  for(const [key,owner] of Object.entries(OWNER)){
    const state=await cap.readOwner(owner.path);
    if(!state || !Buffer.isBuffer(state.bytes) || state.symlink===true ||
      state.sha256!==sha(state.bytes) || state.sha256!==owner.sha256)
      deny('live_owner_sha_drift_'+key);
    previous[key]=state;
  }
  for(const [key,file] of Object.entries(FILES)){
    const state=await cap.readOwner(file.path);
    if(state!==null && state!==undefined) deny('native_action_already_present_'+key);
    const bytes=await cap.readSourceBlob(SOURCE_COMMIT,file.source);
    if(!Buffer.isBuffer(bytes)||gitBlob(bytes)!==file.gitBlob)
      deny('pinned_source_unavailable_'+key);
    sources[key]=bytes;
  }
  // The trusted installer builds its exact, independently reviewed owner
  // diffs. NEVER accept patches from a user request.
  const patches=await cap.buildReviewedOwnerCandidate(
    Object.freeze({action:ACTION,operation:OPERATION,sourceCommit:SOURCE_COMMIT}),
    Object.freeze({...previous}),Object.freeze({...sources})
  );
  const plan={files:{}};
  for(const key of ORDER){
    const bytes=FILES[key]?sources[key]:patches?.[key];
    plan.files[key]={path:(FILES[key]||OWNER[key]).path,bytes,sha256:Buffer.isBuffer(bytes)?sha(bytes):null};
  }
  const digests=validatePlan(plan);
  // Exact plan digests, owner fingerprints and action are bound to one already
  // signed & consumed critical Level-4 approval by the trusted server.
  const receipt=await cap.assertConsumedLevel4({
    action:ACTION,operation:OPERATION,level:4,risk:'critical',
    sourceCommit:SOURCE_COMMIT,preimages:Object.fromEntries(
      Object.entries(OWNER).map(([k,v])=>[k,v.sha256])),candidateSha256:digests
  });
  if(!receipt || receipt.consumed!==true || receipt.level!==4 ||
    receipt.action!==ACTION || receipt.operation!==OPERATION ||
    receipt.sourceCommit!==SOURCE_COMMIT ||
    !exactKeys(receipt.candidateSha256,ORDER) ||
    ORDER.some(k=>receipt.candidateSha256[k]!==digests[k]) ||
    typeof receipt.requestId!=='string' || receipt.requestId.length<16)
    deny('signed_one_time_l4_binding_missing');

  const lock=await cap.lock('honartik-open-price-yii-registration-v1');
  let snapshot=null,attempted=false;
  try{
    // Recheck all preimages under the trusted installer lock.
    for(const [key,owner] of Object.entries(OWNER)){
      const state=await cap.readOwner(owner.path);
      if(!state || state.sha256!==owner.sha256 ||
        !Buffer.isBuffer(state.bytes) || sha(state.bytes)!==owner.sha256)
        deny('owner_drift_after_lock_'+key);
    }
    for(const f of Object.values(FILES))
      if(await cap.readOwner(f.path)!==null)deny('new_action_exists_after_lock');
    snapshot=await cap.snapshot(ORDER.map(k=>plan.files[k].path));
    if(!snapshot || snapshot.verified!==true)deny('rollback_snapshot_unverified');
    attempted=true;
    for(const key of ORDER){
      const item=plan.files[key];
      const mode=({base:0o644,executor:0o755,mcp:0o600,policy:0o644,
        coordinator:0o600,nativeAdapter:0o600})[key];
      await cap.writeExact(item.path,item.bytes,{sha256:digests[key],owner:'root',mode});
      await cap.verifyFile(item.path,digests[key]);
    }
    const verified=await cap.verifyRegistration({
      action:ACTION,operation:OPERATION,
      expectedSha256:digests,
      requiresBoundApprovalConsumer:true,requiresDurableAudit:true
    });
    if(!verified || verified.installed!==true ||
      verified.signedConsumerBound!==true || verified.durableAuditBound!==true ||
      verified.existingActionsPreserved!==true)deny('trusted_registration_not_healthy');

    const audit=await cap.audit({
      action:ACTION,requestId:receipt.requestId,result:'installed',
      sha256:digests,productionDatabaseChanged:false,noExternalPayment:true
    });
    if(!audit || audit.persisted!==true)deny('durable_install_audit_failed');
    return {ok:true,installed:true,requestId:receipt.requestId,sha256:digests};
  }catch(e){
    if(attempted){
      try {
        await cap.restoreSnapshot(snapshot);
        const record=await cap.audit({
          action:ACTION,requestId:receipt.requestId,result:'rolled_back',
          productionDatabaseChanged:false,errorCode:'REGISTRATION_FAILED'
        });
        if(!record || record.persisted!==true)deny('rollback_audit_failed');
      }catch(rollbackError){deny('rollback_failed_manual_intervention_required')}
    }
    throw e;
  }finally{await lock?.release?.();}
}
module.exports=Object.freeze({ACTION,OPERATION,SOURCE_COMMIT,OWNER,FILES,ORDER,
  sha,gitBlob,validatePlan,applyTrustedRegistration});
if(require.main===module){
  process.stderr.write('No CLI: only the installed trusted Level-4 Host Actions registrar may invoke this module.\n');
  process.exitCode=2;
}
