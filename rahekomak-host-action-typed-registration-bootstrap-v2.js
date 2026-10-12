'use strict';
/*
 * RahKomak #143 — SOURCE ONLY, never a production CLI.
 * Only a preexisting trusted Host Actions dispatcher can provide the adapter:
 * signed + consumed one-use L4 approval, path-scoped atomic writes, backups,
 * service reload and positive health attestation. A JS proof object is NOT auth.
 */
const crypto=require('node:crypto');
const registry=require('./rahekomak-host-action-registration-v2.js');
const ACTION='rahekomak_host_action_repair_registration_v2';
const OPERATION='host_action.'+ACTION;
const SOURCE_COMMIT='12d4c80011c723bf0f51defa6a515db30a432aa7';
const ARTIFACT_ROOT='/opt/prhm-agent-selfmaint-exec/actions/';
const KEYS=Object.freeze(['base','executor','mcp','policy']);
const NAMES=Object.freeze(Object.keys(registry.ARTIFACTS));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const blob=b=>crypto.createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
function fail(code){throw Error(code)}
function strictState(state,target,mustExist){
 if(!state||typeof state!=='object'||state.exists!==mustExist)fail('target_presence_drift:'+target);
 if(mustExist&&(state.regular!==true||state.symlink===true||state.realpath!==target||
     (state.mode&0o002)!==0||!Number.isInteger(state.mode)||!Number.isInteger(state.uid)||
     !Number.isInteger(state.gid)))fail('unsafe_owner_state:'+target);
}
function paths(){
 return [...KEYS.map(k=>registry.PATHS[k]),...NAMES.map(n=>ARTIFACT_ROOT+n)];
}
function prepare(adapter){
 if(!adapter||typeof adapter.readBytes!=='function'||typeof adapter.statExact!=='function'||
    typeof adapter.readSourceArtifact!=='function')fail('trusted_read_adapter_required');
 const live={},steps=[];
 for(const key of KEYS){
   const target=registry.PATHS[key],state=adapter.statExact(target);
   strictState(state,target,true);
   const before=adapter.readBytes(target);
   if(!Buffer.isBuffer(before)||sha(before)!==registry.PREIMAGE[key])fail('live_preimage_drift:'+key);
   live[key]=before.toString('utf8');
 }
 const candidates=registry.buildCandidate(live);
 for(const key of KEYS){
   const target=registry.PATHS[key],before=adapter.readBytes(target),state=adapter.statExact(target);
   strictState(state,target,true);
   if(sha(before)!==registry.PREIMAGE[key])fail('concurrent_preimage_drift:'+key);
   const bytes=Buffer.from(candidates[key],'utf8');
   if(sha(before)===sha(bytes))fail('unchanged_owner_candidate:'+key);
   steps.push(Object.freeze({key,target,previous:before,previous_sha:sha(before),bytes,
     next_sha:sha(bytes),mode:state.mode,uid:state.uid,gid:state.gid,was_present:true}));
 }
 for(const name of NAMES){
   const target=ARTIFACT_ROOT+name,st=adapter.statExact(target);
   strictState(st,target,false); // refuse overwrite of unknown or stale artifacts
   const bytes=adapter.readSourceArtifact(name,SOURCE_COMMIT);
   if(!Buffer.isBuffer(bytes)||blob(bytes)!==registry.ARTIFACTS[name])
     fail('artifact_git_blob_mismatch:'+name);
   steps.push(Object.freeze({key:name,target,previous:null,previous_sha:null,bytes,
     next_sha:sha(bytes),mode:0o644,uid:0,gid:0,was_present:false}));
 }
 if(steps.length!==9||new Set(steps.map(s=>s.target)).size!==9)fail('unexpected_transaction_scope');
 return Object.freeze({action:ACTION,operation:OPERATION,source_commit:SOURCE_COMMIT,
   requires_signed_consumed_level4:true,approved:false,steps:Object.freeze(steps)});
}
function assertPlan(plan){
 if(!plan||plan.action!==ACTION||plan.operation!==OPERATION||
    plan.source_commit!==SOURCE_COMMIT||plan.steps?.length!==9)fail('plan_identity_invalid');
 const required=paths();
 for(let i=0;i<9;i++){
   const s=plan.steps[i];
   if(s.target!==required[i]||!Buffer.isBuffer(s.bytes)||sha(s.bytes)!==s.next_sha||
      s.was_present!==(i<4)||s.uid<0||s.gid<0||!Number.isInteger(s.mode))
      fail('plan_step_invalid:'+i);
   if(i<4&&(!Buffer.isBuffer(s.previous)||sha(s.previous)!==registry.PREIMAGE[KEYS[i]]||
      s.previous_sha!==registry.PREIMAGE[KEYS[i]]))fail('owner_plan_preimage_invalid:'+i);
   if(i>=4&&(s.previous!==null||blob(s.bytes)!==registry.ARTIFACTS[NAMES[i-4]]))
      fail('artifact_plan_blob_invalid:'+i);
 }
}
async function applyFromTrustedDispatcher(adapter,plan){
 assertPlan(plan);
 const methods=['acquireExclusive','consumeSignedLevel4','hasReceipt','statExact','readBytes',
   'backupExact','replaceAtomic','removeExact','reloadAndHealth','persistReceipt'];
 for(const name of methods)if(typeof adapter?.[name]!=='function')
   fail('trusted_dispatcher_adapter_missing:'+name);
 const release=await adapter.acquireExclusive(ACTION);
 if(typeof release!=='function')fail('exclusive_lock_contract_invalid');
 let changed=[],receipt=null,mutating=false;
 try{
   // Only the trusted native approval dispatcher may implement this method.
   // The returned signed receipt is bound to the canonical action + exact Git commit.
   const approval=await adapter.consumeSignedLevel4({action:ACTION,operation:OPERATION,
     source_commit:SOURCE_COMMIT,level:4,risk:'critical',one_time:true});
   if(!approval||approval.trusted_dispatcher!==true||approval.signature_verified!==true||
      approval.one_time_consumed!==true||approval.action!==ACTION||
      approval.operation!==OPERATION||approval.source_commit!==SOURCE_COMMIT||
      !approval.request_id)fail('trusted_signed_consumed_level4_required');
   if(await adapter.hasReceipt(ACTION))fail('registration_replay_forbidden');
   for(const s of plan.steps){
     strictState(await adapter.statExact(s.target),s.target,s.was_present);
     if(s.was_present&&sha(await adapter.readBytes(s.target))!==s.previous_sha)
       fail('prewrite_drift:'+s.key);
   }
   // Complete all backups before the first live mutation.
   for(const s of plan.steps.filter(s=>s.was_present))
     await adapter.backupExact(s.target,s.previous,s.previous_sha,approval.request_id);
   await adapter.persistReceipt({status:'prepared',action:ACTION,source_commit:SOURCE_COMMIT,
      request_id:approval.request_id,changed:[],production_mutation:false});
   mutating=true;
   for(const s of plan.steps){
     await adapter.replaceAtomic(s.target,s.bytes,{mode:s.mode,uid:s.uid,gid:s.gid});
     changed.push(s);
     if(sha(await adapter.readBytes(s.target))!==s.next_sha)fail('postwrite_mismatch:'+s.key);
   }
   const health=await adapter.reloadAndHealth('candidate',{
      mustExpose:[registry.ACTION_STAGE,registry.ACTION_ACTIVATE],
      residentProtectHome:'yes'});
   if(health?.ok!==true||health.protect_home!=='yes'||
      !registry.actionSpecs().every(x=>health.actions?.includes(x.name)))
      fail('candidate_health_incomplete');
   receipt={ok:true,action:ACTION,source_commit:SOURCE_COMMIT,request_id:approval.request_id,
      status:'registration_installed',changed:changed.map(x=>({path:x.target,sha256:x.next_sha})),
      separate_level4_stage_required:true,application_deployed:false,rollback_performed:false};
   await adapter.persistReceipt(receipt);
   return receipt;
 }catch(error){
   if(mutating){
     let rollbackError=null;
     try{
       for(const s of [...changed].reverse()){
         if(s.was_present)await adapter.replaceAtomic(s.target,s.previous,
            {mode:s.mode,uid:s.uid,gid:s.gid});
         else await adapter.removeExact(s.target);
         if(s.was_present&&sha(await adapter.readBytes(s.target))!==s.previous_sha)
           fail('rollback_sha_mismatch:'+s.key);
         if(!s.was_present&&(await adapter.statExact(s.target)).exists!==false)
           fail('rollback_absence_mismatch:'+s.key);
       }
       const health=await adapter.reloadAndHealth('baseline',{residentProtectHome:'yes'});
       if(health?.ok!==true||health.protect_home!=='yes')fail('baseline_health_failed');
     }catch(e){rollbackError=e}
     try{await adapter.persistReceipt({ok:false,action:ACTION,status:'rolled_back',
       changed:changed.map(x=>x.target),rollback_performed:!rollbackError,
       rollback_incomplete:!!rollbackError,reason:String(error?.message||error).slice(0,180)})}
     catch(e){if(!rollbackError)rollbackError=e}
     if(rollbackError)fail('REGISTRATION_ROLLBACK_INCOMPLETE:'+String(rollbackError.message||rollbackError));
     fail('registration_failed_rollback_complete:'+String(error.message||error));
   }
   throw error;
 }finally{await release()}
}
module.exports=Object.freeze({ACTION,OPERATION,SOURCE_COMMIT,KEYS,NAMES,ARTIFACT_ROOT,
  sha,blob,paths,prepare,assertPlan,applyFromTrustedDispatcher});
if(require.main===module){process.stderr.write('No direct apply. Trusted, signed, consumed Level-4 dispatcher required.\n');process.exitCode=64}
