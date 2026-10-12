'use strict';
// Source-only SHA repair candidate. It does not install or authorize itself.
// A separately registered, signed, one-use Level-4 trusted installer is required.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const ACTION='installer_refresh_l4_state_on_disk_sha_repair_v1';
const OPERATION='host_action.'+ACTION;
const TARGET='/opt/prhm-agent-selfmaint-exec/actions/installer-refresh-l4-binding-repair-state-v1.js';
const SOURCE=path.join(__dirname,'safeFiles-installer-refresh-l4-binding-repair-surface-v1.js');
const FROM_SHA='b3b99e33fccb9122bcb5155cce64e4a6e9c73ce2404860d43aaa0def2a12db1e';
const TO_SHA='b80f1f75e1794b7ffd21a432564454a5da42245b533e1b8cae09c4c73113c2cb';
const OLD="const p=path.join(ROOT,'prhm-installer-refresh-l4-binding-repair-v1-'+process.pid+'.js');";
const NEW="const p='/run/prhm-installer-refresh-l4-binding-repair-v1-'+process.pid+'.js';";
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(s){throw Error(s);}
function deriveReviewedBytes(sourceBytes){
  const source=sourceBytes.toString('utf8');
  const begin='const STATE_SCRIPT=String.raw'+String.fromCharCode(96);
  const start=source.indexOf(begin);
  if(start<0||source.lastIndexOf(begin)!==start)fail('reviewed_source_anchor_missing_or_duplicate');
  const after=start+begin.length,end=source.indexOf(String.fromCharCode(96)+';',after);
  if(end<0)fail('reviewed_template_unbounded');
  const target=Buffer.from(source.slice(after,end),'utf8');
  if(hash(target)!==TO_SHA)fail('reviewed_target_sha_mismatch');
  if(target.includes(OLD)||target.toString('utf8').split(NEW).length!==2)
    fail('target_anchor_invariant_failed');
  const old=Buffer.from(target.toString('utf8').replace(NEW,OLD),'utf8');
  if(hash(old)!==FROM_SHA)fail('reviewed_old_sha_mismatch');
  return {old,target};
}
function plan(sourceBytes,liveSha=FROM_SHA){
  const {old,target}=deriveReviewedBytes(sourceBytes);
  if(liveSha!==FROM_SHA)fail('actual_live_sha_drift');
  return Object.freeze({
    schema:'prhm.installer-refresh-l4.state-sha-repair-plan.v1',
    action:ACTION,operation:OPERATION,target:TARGET,
    current_sha256:hash(old),target_sha256:hash(target),
    exact_line_replacement:{before:OLD,after:NEW},
    changes_count:1,expected_uid:0,expected_gid:0,expected_mode:0o600,
    require_signed_level4:true,application_rows_changed:false,
    execute_authorized:false
  });
}
async function applySigned(planObject,adapter){
  if(!planObject||planObject.schema!=='prhm.installer-refresh-l4.state-sha-repair-plan.v1'||
    planObject.action!==ACTION||planObject.operation!==OPERATION||
    planObject.target!==TARGET||planObject.current_sha256!==FROM_SHA||
    planObject.target_sha256!==TO_SHA||planObject.changes_count!==1)
    fail('plan_identity_mismatch');
  for(const k of ['assertConsumedSignedLevel4','assertReviewedRelease','exclusiveLock',
   'state','read','saveDurableBackup','atomicWrite','checkInstallerPreflight',
   'restore','recordAudit']){
    if(typeof adapter?.[k]!=='function')fail('trusted_adapter_required:'+k);
  }
  const auth=await adapter.assertConsumedSignedLevel4({
    action:ACTION,operation:OPERATION,level:4,
    exact_target:TARGET,current_sha256:FROM_SHA,target_sha256:TO_SHA
  });
  if(auth?.signed!==true||auth?.consumed!==true||auth?.one_time!==true||
     auth?.approver!=='mohammad'||auth?.level!==4||
     auth?.operation!==OPERATION||auth?.current_sha256!==FROM_SHA||
     auth?.target_sha256!==TO_SHA||auth?.exact_target!==TARGET)
    fail('signed_level4_binding_invalid');
  if(!/^[a-f0-9]{40}$/.test(auth.reviewed_release_sha||'')||
     await adapter.assertReviewedRelease(auth.reviewed_release_sha)!==true)
    fail('reviewed_release_not_verified');
  const unlock=await adapter.exclusiveLock(TARGET);
  if(typeof unlock!=='function')fail('exclusive_lock_failed');
  let snapshot=null,mutated=false;
  try{
    const stat=await adapter.state(TARGET);
    if(stat?.regular!==true||stat?.symlink!==false||
      stat?.sha256!==FROM_SHA||stat?.uid!==0||stat?.gid!==0||
      stat?.mode!==0o600)fail('on_disk_preimage_mismatch');
    const existing=await adapter.read(TARGET);
    if(!Buffer.isBuffer(existing)||hash(existing)!==FROM_SHA)
      fail('on_disk_readback_sha_drift');
    const reviewedSource=fs.readFileSync(SOURCE);
    const derived=deriveReviewedBytes(reviewedSource);
    if(!existing.equals(derived.old))fail('reviewed_preimage_bytes_mismatch');
    snapshot=await adapter.saveDurableBackup(TARGET,existing,{
      source_sha256:FROM_SHA,mode:0o600,uid:0,gid:0
    });
    if(snapshot?.durable!==true||snapshot?.sha256!==FROM_SHA)
      fail('backup_not_durable_or_verified');
    mutated=true;
    await adapter.atomicWrite(TARGET,derived.target,{
      expected_before_sha256:FROM_SHA,expected_after_sha256:TO_SHA,
      mode:0o600,uid:0,gid:0
    });
    const after=await adapter.state(TARGET);
    if(after?.regular!==true||after?.symlink!==false||
      after?.sha256!==TO_SHA||after?.uid!==0||after?.gid!==0||
      after?.mode!==0o600)fail('installed_sha_or_mode_mismatch');
    const health=await adapter.checkInstallerPreflight({
      expected_state_sha256:TO_SHA,
      expected_read_only_preflight:true
    });
    if(health?.ok!==true||health?.live_sha256!==TO_SHA||
       health?.read_only!==true)fail('live_preflight_failed');
    const result={ok:true,action:ACTION,operation:OPERATION,
      request_id:auth.request_id,release_sha:auth.reviewed_release_sha,
      file:TARGET,sha256_before:FROM_SHA,sha256_after:TO_SHA,
      live_preflight:true,production_database_mutation:false,
      other_files_changed:0,rollback_performed:false};
    await adapter.recordAudit(result);
    return result;
  }catch(err){
    if(mutated){
      try{
        await adapter.restore(TARGET,snapshot,{sha256:FROM_SHA});
        const restored=await adapter.state(TARGET);
        if(restored?.sha256!==FROM_SHA||restored?.mode!==0o600)
          fail('rollback_fingerprint_mismatch');
        await adapter.recordAudit({ok:false,action:ACTION,request_id:auth.request_id,
          rollback_performed:true,error_code:'STATE_SHA_REPAIR_ROLLED_BACK'});
      }catch(r){throw Error('repair_rollback_failed:'+r.message);}
    }
    throw Error('repair_failed:'+err.message);
  }finally{await unlock();}
}
module.exports={ACTION,OPERATION,TARGET,SOURCE,FROM_SHA,TO_SHA,OLD,NEW,hash,
 deriveReviewedBytes,plan,applySigned};
