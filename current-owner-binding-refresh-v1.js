'use strict';
const crypto=require('node:crypto');
const manifestMod=require('./current-owner-binding-manifest-v1.js');
const adapters=require('./current-owner-binding-adapters-v1.js');
const systemd=require('./current-owner-binding-systemd-v1.js');

const ACTION='control_plane_current_owner_binding_refresh_v1';
const STATE_ROOT='/var/lib/prhm-agent-selfmaint-exec/current-owner-binding-v1';
const TRANSACTION_ROOT=STATE_ROOT+'/transactions';
const MANIFEST_PATH=STATE_ROOT+'/manifest.json';
const BACKUP_ROOT='/var/backups/prhm-current-owner-binding-refresh-v1';
const CONSUMER_ORDER=Object.freeze(['registry_bridge','v19_binding','current_baseline_refresh','rolling_refresh','titan_handoff_sandbox']);
const VERIFICATION_ORDER=Object.freeze(['selfmaint_health','v19_contract','registry_bootstrap_readiness','current_baseline_backup_readiness','rolling_refresh_owner_validation','titan_contract','titan_preflight']);
const HEX64=/^[a-f0-9]{64}$/;

function fail(code){throw new Error(code);}
function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function parseMode(args){
  if(!Array.isArray(args)||args.length!==1)fail('unexpected_arguments');
  if(args[0]==='--preflight-only')return 'preflight';
  if(args[0]==='--apply')return 'apply';
  fail('unexpected_arguments');
}
function requireDeps(d){
  const names=['now','acquireLock','selfmaintHealth','inventoryOwners','snapshotConsumer','inspectDropin','probeWritable','validateCandidate','persistCandidate','persistPreimage','persistTransaction','installDropin','removeDropin','daemonReload','restartService','effectiveState','atomicReplace','verifyFileSha','verifyHook','persistRollback'];
  if(!d||typeof d!=='object')fail('deps_invalid');
  for(const n of names)if(typeof d[n]!=='function')fail('dep_missing:'+n);
  return d;
}
function validateSnapshot(id,snap){
  const spec=manifestMod.INITIAL_CONSUMER_PREIMAGES[id];
  if(!spec||!snap||snap.consumer_id!==id||snap.target_path!==spec.target_path)fail('snapshot_target_invalid:'+id);
  if(snap.is_symlink===true||snap.is_file!==true||snap.realpath!==spec.target_path)fail('snapshot_path_invalid:'+id);
  if(!Buffer.isBuffer(snap.bytes))fail('snapshot_bytes_invalid:'+id);
  if(!HEX64.test(String(snap.sha256||'')))fail('snapshot_sha_invalid:'+id);
  if(!Number.isInteger(snap.uid)||!Number.isInteger(snap.gid)||!Number.isInteger(snap.mode))fail('snapshot_metadata_invalid:'+id);
  return Object.freeze({...snap});
}
function makeManifest(d){
  const owners=d.inventoryOwners();
  if(!Array.isArray(owners))fail('owner_inventory_invalid');
  return manifestMod.buildManifest({capturedAt:d.now(),owners,serviceFacts:{service:systemd.SERVICE}});
}
function prepareUnlocked(d){
  d.selfmaintHealth();
  const manifest=makeManifest(d);
  const snapshots={};
  for(const id of CONSUMER_ORDER)snapshots[id]=validateSnapshot(id,d.snapshotConsumer(id,manifestMod.INITIAL_CONSUMER_PREIMAGES[id]));
  const dropinState=d.inspectDropin();
  const dropinPlan=systemd.planDropin(dropinState);
  d.probeWritable(STATE_ROOT);
  d.probeWritable(BACKUP_ROOT);
  return {manifest,snapshots,dropinState,dropinPlan};
}
function materializeCandidates(context,d){
  const candidates={};
  for(const id of CONSUMER_ORDER){
    const s=context.snapshots[id];
    const candidate=adapters.buildConsumerCandidate(id,{manifest:context.manifest,target_path:s.target_path,before_sha256:s.sha256,before_bytes:s.bytes});
    d.validateCandidate(id,candidate,context);
    d.persistCandidate(id,candidate,context);
    candidates[id]=candidate;
  }
  return Object.freeze(candidates);
}
async function preflight(deps){
  const d=requireDeps(deps), release=d.acquireLock();
  try{
    const context=prepareUnlocked(d);
    materializeCandidates(context,d);
    return Object.freeze({ok:true,action:ACTION,phase:'preflight',manifest_sha256:context.manifest.manifest_sha256,production_mutation:false,production_application_mutation:false,database_mutation:false,titan_cutover:false});
  }finally{release();}
}
async function rollback(context,d,mutated,dropinCreated,cause){
  const rollbackErrors=[];
  for(const id of [...mutated].reverse()){
    const s=context.snapshots[id];
    try{d.atomicReplace(s.target_path,s.bytes,{uid:s.uid,gid:s.gid,mode:s.mode},'rollback');d.verifyFileSha(s.target_path,s.sha256,'rollback');}
    catch(e){rollbackErrors.push('consumer:'+id+':'+String(e&&e.message||e));}
  }
  if(dropinCreated){
    try{d.removeDropin(systemd.DROPIN);d.daemonReload();d.restartService(systemd.SERVICE);systemd.validateEffectiveState(d.effectiveState());}
    catch(e){rollbackErrors.push('dropin:'+String(e&&e.message||e));}
  }
  try{d.selfmaintHealth();}catch(e){rollbackErrors.push('health:'+String(e&&e.message||e));}
  try{d.persistRollback({action:ACTION,cause:String(cause&&cause.message||cause),mutated:[...mutated],dropin_created:dropinCreated,errors:[...rollbackErrors]});}
  catch(e){rollbackErrors.push('persist:'+String(e&&e.message||e));}
  if(rollbackErrors.length)throw new Error('rollback_failed:'+rollbackErrors.join('|'));
  return true;
}
async function apply(deps){
  const d=requireDeps(deps), release=d.acquireLock();
  let context=null,candidates=null,dropinCreated=false;const mutated=[];
  try{
    context=prepareUnlocked(d);
    candidates=materializeCandidates(context,d);
    for(const id of CONSUMER_ORDER){const s=context.snapshots[id];d.persistPreimage(id,{target_path:s.target_path,sha256:s.sha256,bytes:s.bytes,uid:s.uid,gid:s.gid,mode:s.mode},context);}
    const tx={action:ACTION,manifest_sha256:context.manifest.manifest_sha256,created_at:d.now(),consumers:CONSUMER_ORDER.map(id=>({consumer_id:id,before_sha256:context.snapshots[id].sha256,after_sha256:candidates[id].after_sha256})),dropin_state:context.dropinPlan.state};
    d.persistTransaction(tx,context);
    if(context.dropinPlan.state==='create'){
      d.installDropin(systemd.DROPIN,systemd.DROPIN_CONTENT);dropinCreated=true;
      d.daemonReload();d.restartService(systemd.SERVICE);systemd.validateEffectiveState(d.effectiveState());
    }
    for(const id of CONSUMER_ORDER){
      const c=candidates[id], s=context.snapshots[id];
      if(c.after_sha256===s.sha256)continue;
      d.atomicReplace(c.target_path,c.after_bytes,{uid:s.uid,gid:s.gid,mode:s.mode},'apply');
      mutated.push(id);
      d.verifyFileSha(c.target_path,c.after_sha256,'apply');
    }
    for(const name of VERIFICATION_ORDER)d.verifyHook(name,{context,candidates,mutated:[...mutated],dropinCreated});
    return Object.freeze({ok:true,schema_version:'prhm.host-action-result.v1',action:ACTION,manifest_sha256:context.manifest.manifest_sha256,mutated_consumers:[...mutated],dropin_changed:dropinCreated,rollback_performed:false,production_application_mutation:false,database_mutation:false,titan_cutover:false});
  }catch(error){
    if(context){
      try{await rollback(context,d,mutated,dropinCreated,error);}
      catch(rb){throw new Error('refresh_failed:'+String(error&&error.message||error)+':'+String(rb&&rb.message||rb));}
      throw new Error('refresh_failed:'+String(error&&error.message||error)+':rollback_performed=true');
    }
    throw error;
  }finally{release();}
}
async function runCli(args,deps){const mode=parseMode(args);return mode==='preflight'?preflight(deps):apply(deps);}
module.exports=Object.freeze({ACTION,STATE_ROOT,TRANSACTION_ROOT,MANIFEST_PATH,BACKUP_ROOT,CONSUMER_ORDER,VERIFICATION_ORDER,parseMode,materializeCandidates,preflight,apply,rollback,runCli});
