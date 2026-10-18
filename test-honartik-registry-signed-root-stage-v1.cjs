'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const Module=require('node:module');

const ROOT='/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v2';
const UNIT='/etc/systemd/system/prhm-shared-registry-approval-v2.service';
const OWNERS=Object.freeze({
 base:'4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406',
 executor:'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0',
 policy:'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174',
 mcp:'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166'
});
const PINS={
 runner:{path:'manifests/runner.json',blob:'a'.repeat(40)},
 sidecar:{path:'manifests/sidecar.json',blob:'b'.repeat(40)},
 unit:{path:'manifests/unit.json',blob:'c'.repeat(40)}
};
const DIRS=Array.from({length:10},(_,i)=>({
 kind:'mkdir_if_absent_root_only',destination:ROOT+'/dir-'+i,uid:0,gid:0,mode:'0700'
}));
const FILES=Array.from({length:35},(_,i)=>({
 kind:'create_exclusive_pinned_git_file',destination:ROOT+'/fixed-file-'+i+'.cjs',
 source_commit:'c'.repeat(40),source_path:'fixed-file-'+i+'.cjs',
 git_blob_sha1:'d'.repeat(40),uid:0,gid:0,mode:'0600'
}));
const UNIT_FILE={
 kind:'create_exclusive_pinned_git_file',destination:UNIT,
 source_commit:'c'.repeat(40),source_path:'systemd/fixed.service',
 git_blob_sha1:'e'.repeat(40),uid:0,gid:0,mode:'0644'
};
const basePlan=()=>({
 schema:'prhm.honartik.root-bootstrap-staging-plan.v1',
 action:'prhm_action_registry_install_v1',
 external_root_installer_required:true,installs:false,executes:false,
 operations:[...DIRS,...FILES,UNIT_FILE],
 directory_count:10,source_file_count:35,unit_count:1,
 fixed_owners:{...OWNERS}
});
const boundary={ROOT,UNIT,OWNERS,PINS};
const originalLoad=Module._load;
Module._load=function(name,parent,isMain){
 if(parent?.filename?.endsWith('/honartik-registry-signed-root-stage-v1.cjs')){
   if(name==='./honartik-staging-privilege-boundary-install-v1.js')return boundary;
   if(name==='./bootstrap-host-actions-honartik-staging-privilege-boundary-install-v1.js')
     return {plan:({manifestBytes,observedOwnerSha256})=>{
       assert.deepEqual(Object.keys(manifestBytes).sort(),Object.keys(PINS).sort());
       assert.deepEqual(observedOwnerSha256,OWNERS);
       return basePlan();
     }};
 }
 return originalLoad.call(this,name,parent,isMain);
};
const subject=require('./honartik-registry-signed-root-stage-v1.cjs');
Module._load=originalLoad;

const UUID='2e20d420-42d5-4e4e-8ba6-163fde641719';
function fake(options={}){
 let trace=[],journal=[],mutation=[],currentLock=false;
 const bridge={
   kind:'prhm.sealed-independent-root-bridge.v2',registeredAction:subject.ACTION,
   readPinnedManifests:async()=>{trace.push('manifests');return {
     runner:Buffer.from('approved-runner'),
     sidecar:Buffer.from('approved-sidecar'),unit:Buffer.from('approved-unit')
   };},
   readProtectedOwnerDigests:async()=>{trace.push('owners');return {...OWNERS};},
   attestRootContext:async()=>{trace.push('root-context');return {
     rootUidVerified:true,independentSystemdUnitVerified:true,rootActionSourceShaVerified:true
   };},
   attestTargetsAndParents:async()=>{trace.push('preflight');return {
     targetCount:36,targetFilesAbsent:!options.targetExists,parentsSecure:true,
     noForeignLockOrWal:true,serviceNotInstalled:true,socketUnused:true
   };},
   verifyConsumedRootApproval:async()=>{trace.push('approval');return {
     fromExistingTrustedApprovalCenter:!options.unsigned,
     signatureVerified:true,oneTimeConsumed:true,
     approvalLevel:4,action:subject.ACTION,exactStageOwnerShaVerified:true,
     exactStageBlobPinsVerified:true,requestId:UUID,
     manifestSetShaVerified:true,verifiedByIndependentRoot:true,
     externalApprovalExpiresAtVerified:true
   };},
   lockDurably:async()=>{trace.push('lock');currentLock=true;},
   journalDurably:async(value)=>{
     if(options.journalFailAt===value.name&&value.details?.index===options.journalFailIndex)
       throw Error('journal_failed');
     trace.push('journal:'+value.name);journal.push(value);
   },
   readVerifiedGitBlob:async(op)=>{
     trace.push('blob');return {bytes:Buffer.from(op.source_path),blobVerified:!options.badGitBlob};
   },
   createDirectoryExclusive:async(op)=>{
     trace.push('mkdir');if(options.failAt===mutation.length)throw Error('stage_failed');
     mutation.push(op.destination);
   },
   createPinnedFileExclusive:async(op)=>{
     trace.push('file');if(options.failAt===mutation.length)throw Error('stage_failed');
     mutation.push(op.destination);
   },
   verifyPinnedFile:async()=>{trace.push('verify-file');},
   verifyStagedState:async()=>{
     trace.push('verify-stage');return {all36FilesPinned:!options.badPostcondition,
       tenDirectoriesSecure:true,ownerFilesUnchanged:true,
       systemdUnitInactive:true,paymentGatesOff:true};
   },
   rollbackOwnedMutation:async()=>{
     trace.push('rollback');if(options.rollbackFails)throw Error('rollback_failed');
     mutation=[];
   },
   verifyExactRollback:async()=>{
     trace.push('verify-rollback');return {originalStatePreserved:!options.rollbackInvalid,
       noForeignFilesDeleted:true,ownerFilesUnchanged:true};
   },
   metadataAudit:async(event)=>{
     trace.push('audit:'+event.result);
     if(options.auditFails)throw Error('audit_failed');
   },
   releaseVerifiedLock:async()=>{
     trace.push('unlock');currentLock=false;
   }
 };
 return {bridge,trace,journal,mutation:()=>mutation.slice(),lock:()=>currentLock};
}
test('fixed root stage has no privileged CLI entry',()=>{
 const res=cp.spawnSync(process.execPath,[path.join(__dirname,'honartik-registry-signed-root-stage-v1.cjs')],{encoding:'utf8'});
 // Direct invocation fails closed even when real plan modules exist.
 assert.equal(res.status,2);
 assert.equal(JSON.parse(res.stdout).mutation,false);
});
test('reject fake bridges and generic callers before touching disk',()=>{
 assert.throws(()=>subject.createSignedStage({}),/trusted_independent_root_bridge_missing/);
 const b=fake().bridge;b.registeredAction='arbitrary_shell';
 assert.throws(()=>subject.createSignedStage(b),/trusted_independent_root_bridge_missing/);
});
test('stage schema is pinned to 10 dirs and exactly 36 fixed reviewed files',()=>{
 assert.equal(subject.validateStage(basePlan()).operations.length,46);
 for(const change of [
   p=>p.action='evil',p=>p.fixed_owners.base='f'.repeat(64),
   p=>p.operations.pop(),p=>p.operations[0].mode='0777',
   p=>p.operations[10].destination='/root/.ssh/authorized_keys',
   p=>p.operations[45].mode='0777'
 ]){
   const p=structuredClone(basePlan());change(p);
   assert.throws(()=>subject.validateStage(p));
 }
});
test('unsigned proof never acquires lock or writes a pinned file',async()=>{
 const f=fake({unsigned:true});
 await assert.rejects(subject.createSignedStage(f.bridge).run(),/signed_fresh_consumed_l4_unproven/);
 assert.equal(f.trace.includes('lock'),false);
 assert.equal(f.mutation().length,0);
});
test('occupied target blocks before approval and durable WAL',async()=>{
 const f=fake({targetExists:true});
 await assert.rejects(subject.createSignedStage(f.bridge).run(),/host_preconditions_failed/);
 assert.deepEqual(f.trace,['manifests','owners','root-context','preflight']);
});
test('success: 46 durable intents, 46 completion writes, and verified locked stage',async()=>{
 const f=fake();
 const result=await subject.createSignedStage(f.bridge).run();
 assert.equal(result.ok,true);assert.equal(result.operationCount,46);
 assert.equal(result.unitEnabled,false);assert.equal(result.financialGatesEnabled,false);
 assert.equal(f.mutation().length,46);
 assert.equal(f.journal.filter(e=>e.name==='intent').length,46);
 assert.equal(f.journal.filter(e=>e.name==='done').length,46);
 assert.equal(f.journal.filter(e=>e.name==='success').length,1);
 assert.equal(f.trace.indexOf('approval')<f.trace.indexOf('lock'),true);
 assert.equal(f.trace.indexOf('journal:intent')<f.trace.indexOf('mkdir'),true);
 assert.equal(f.lock(),false);
});
test('failure in stage rolls back owned writes, keeps foreign files intact',async()=>{
 const f=fake({failAt:14});
 const stage=subject.createSignedStage(f.bridge);
 await assert.rejects(stage.run(),/stage_failed/);
 assert.equal(stage.getPhase(),'rolled_back');
 assert.equal(f.mutation().length,0);assert.equal(f.lock(),false);
 assert.ok(f.trace.includes('audit:verified_rollback'));
});
test('rollback failure retains exclusive lock and requires manual recovery',async()=>{
 const f=fake({failAt:14,rollbackFails:true});
 const stage=subject.createSignedStage(f.bridge);
 await assert.rejects(stage.run(),/rollback_not_verified_exclusive_lock_retained/);
 assert.equal(stage.getPhase(),'recovery_required');
 assert.equal(f.lock(),true);
 assert.equal(f.trace.includes('unlock'),false);
});
test('uncertain post-write state also refuses success and rolls back',async()=>{
 const f=fake({badPostcondition:true});
 await assert.rejects(subject.createSignedStage(f.bridge).run(),/postcondition_failed/);
 assert.equal(f.mutation().length,0);
});
test('unverified rollback never releases exclusive lock',async()=>{
 const f=fake({failAt:14,rollbackInvalid:true});
 await assert.rejects(subject.createSignedStage(f.bridge).run(),/rollback_not_verified_exclusive_lock_retained/);
 assert.equal(f.lock(),true);
});
