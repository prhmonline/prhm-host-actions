'use strict';
/**
 * V2-only recovery planner for PRHM shared Agent 3 registration.
 * No filesystem, CLI, socket, approval, or shell interface.
 * A separate root-owned trusted executor supplies a persistent journal,
 * a consumed one-time request binding, exclusive lock and I/O callbacks.
 *
 * Fail closed BEFORE the first restore if any of the nine files has drifted.
 * Safe to reconstruct from the same durable snapshot after process restart.
 * Exclusive recovery lock survives ALL failures (including partial file restore,\n * service failure, MCP visibility or audit failure). Never retry/auto-unlock.\n * Successful recovery additionally requires negative MCP discovery after
 * service verification, not just restored bytes and healthy processes.
 */
const crypto=require('node:crypto');
const G=require('./prhm-action-registry-gateway-v1.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function check(ok,why){if(!ok)throw Error('registry_recovery_'+why)}
const OWNER_KEYS=Object.freeze(['base','executor','policy','mcp']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX=/^[a-f0-9]{64}$/;
function exact(x,keys,code){
 check(x && typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join('|')===keys.slice().sort().join('|'),code);
}
function validateSnapshot(release,snapshot,readBackup){
 check(release&&release.normalized&&typeof readBackup==='function',
   'trusted_release_or_backup_reader_missing');
 const N=release.normalized;
 exact(snapshot,['schema','request_id','project','action','source_commit',
   'manifest_commit','manifest_sha256','owners'],'journal_shape');
 check(snapshot.schema==='prhm.registry.recovery.v1'&&UUID.test(snapshot.request_id)&&
   snapshot.project===N.project&&snapshot.action===N.action&&
   snapshot.source_commit===release.source_commit&&
   snapshot.manifest_commit===release.manifest_commit&&
   snapshot.manifest_sha256===release.manifest_sha256,
   'journal_release_binding');
 exact(snapshot.owners,OWNER_KEYS,'journal_owner_set');
 const copies={};
 for(const key of OWNER_KEYS){
   const record=snapshot.owners[key],expected=N.owners[key];
   exact(record,['sha256','uid','gid','mode'],'journal_owner_shape');
   check(expected?.path===G.OWNER_PATHS[key]&&
     record.sha256===expected.before_sha256&&
     HEX.test(record.sha256)&&Number.isSafeInteger(record.uid)&&record.uid>=0&&
     Number.isSafeInteger(record.gid)&&record.gid>=0&&
     Number.isInteger(record.mode)&&record.mode>=0o400&&record.mode<=0o755&&
     (record.mode&0o022)===0,'journal_owner_metadata');
   const b=readBackup(key);
   check(Buffer.isBuffer(b)&&sha(b)===record.sha256,'durable_backup_sha_'+key);
   copies[key]=b;
 }
 return Object.freeze({copies,request_id:snapshot.request_id});
}
function recoveryPlan({release,snapshot,live,readBackup}){
 const ready=validateSnapshot(release,snapshot,readBackup);
 const N=release.normalized;
 exact(live,['owners','assets'],'live_shape');
 exact(live.owners,OWNER_KEYS,'live_owner_set');
 check(live.assets&&typeof live.assets==='object'&&!Array.isArray(live.assets),
   'live_assets_missing');
 const steps=[],paths=new Set(),assetPaths=new Set(N.assets.map(x=>x.path));
 check(Object.keys(live.assets).length===assetPaths.size,'live_asset_count');
 for(const key of OWNER_KEYS){
   const pin=N.owners[key],state=live.owners[key],before=snapshot.owners[key];
   exact(state,['exists','regular','symlink','sha256','uid','gid','mode'],'live_owner_shape');
   check(state.exists===true&&state.regular===true&&state.symlink===false&&
    state.uid===before.uid&&state.gid===before.gid&&
    state.mode===before.mode&&
    (state.sha256===pin.before_sha256||state.sha256===pin.after_sha256),
    'owner_drift_'+key);
   check(!paths.has(pin.path),'owner_path_duplicate');paths.add(pin.path);
   if(state.sha256===pin.after_sha256)steps.push(Object.freeze({
     kind:'restore_owner',key,path:pin.path,sha256:before.sha256,
     uid:before.uid,gid:before.gid,mode:before.mode,
     bytes:ready.copies[key]
   }));
 }
 for(const a of N.assets){
   check(!paths.has(a.path),'asset_overlaps_owner');paths.add(a.path);
   check(assetPaths.has(a.path)&&Object.hasOwn(live.assets,a.path),
     'asset_missing_'+a.path);
   const state=live.assets[a.path];
   exact(state,['exists','regular','symlink','sha256','uid','gid','mode'],'live_asset_shape');
   if(state.exists){
     check(state.regular===true&&state.symlink===false&&state.sha256===a.sha256&&
       state.uid===0&&state.gid===0&&state.mode===0o644,
       'asset_drift_'+a.path);
     steps.push(Object.freeze({kind:'remove_asset',path:a.path,sha256:a.sha256}));
   }else{
     check(state.regular===false&&state.symlink===false&&state.sha256===null&&
       state.uid===null&&state.gid===null&&state.mode===null,
       'asset_absent_metadata_'+a.path);
   }
 }
 return Object.freeze({request_id:ready.request_id,
   source_commit:release.source_commit,manifest_commit:release.manifest_commit,
   manifest_sha256:release.manifest_sha256,project:N.project,action:N.action,
   steps:Object.freeze(steps)});
}
async function reconcileFromDurableJournal({release,snapshot,readBackup,readLive,
  authorizeRecovery,exclusiveLock,restoreOwner,removeAsset,
  verifyOriginalState,verifyServices,verifyTargetAbsent,audit}){
 const required={readBackup,readLive,authorizeRecovery,exclusiveLock,
   restoreOwner,removeAsset,verifyOriginalState,verifyServices,
   verifyTargetAbsent,audit};
 for(const [name,f] of Object.entries(required))
   check(typeof f==='function','trusted_callback_missing_'+name);
 // Only previously consumed original L4 request may be rolled back.
 const ok=await authorizeRecovery(Object.freeze({
   action:G.ACTION,operation:G.OPERATION,request_id:snapshot?.request_id,
   source_commit:release?.source_commit,
   manifest_commit:release?.manifest_commit,
   manifest_sha256:release?.manifest_sha256
 }));
 check(ok===true,'consumed_approval_binding_missing');
 const unlock=await exclusiveLock(snapshot.request_id);
 check(typeof unlock==='function','lock_missing');
 let fullyVerified=false;
 try{
   const plan=recoveryPlan({release,snapshot,live:await readLive(release),
     readBackup});
   // Preflight checks ALL nine paths before touching the first one.
   for(const step of plan.steps){
     if(step.kind==='restore_owner')await restoreOwner(step);
     else await removeAsset(step);
   }
   check(await verifyOriginalState(release,snapshot)===true,
     'original_state_unverified');
   check(await verifyServices(release)===true,'services_unhealthy');
   // Independently query the live MCP registry from the trusted executor,
   // including every active MCP worker. Restored on-disk bytes alone are not
   // a verified rollback while a stale worker can advertise the failed action.
   // Only an exact true from the trusted negative-discovery verifier suffices;
   // exceptions, unknown status, or a still-present tool fail closed.
   check(await verifyTargetAbsent(plan.action)===true,
     'target_mcp_tool_still_visible_or_unverified');
   await audit(Object.freeze({request_id:plan.request_id,
     action:plan.action,project:plan.project,
     source_commit:plan.source_commit,manifest_commit:plan.manifest_commit,
     manifest_sha256:plan.manifest_sha256,
     result:'restored',verified:true,steps:plan.steps.length}));
   fullyVerified=true;
   return Object.freeze({ok:true,restored:true,verified:true,
     steps:plan.steps.length,request_id:plan.request_id});
 }finally{if(fullyVerified)await unlock()}
}
module.exports=Object.freeze({OWNER_KEYS,validateSnapshot,recoveryPlan,reconcileFromDurableJournal});
