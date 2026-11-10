'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const gate=require('./honartik-u06-owner-oidc-identity-gate-v1.cjs');
const {G}=require('./universal-owner-oidc-recovery-gate-v1.cjs');
const core=require('./honartik-u06-owner-native-transaction-v1.cjs');
const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const kid='test-key-u06-coordinator',now=1800000000,nonce='b'.repeat(64),sha='c'.repeat(40);
function ownerProof(){
 const claims={
   iss:G.issuer,aud:gate.audience(nonce),
   sub:'repo:prhmonline/prhm-host-actions:environment:'+gate.W.environment,
   repository:'prhmonline/prhm-host-actions',repository_id:gate.W.repoId,
   repository_owner_id:gate.W.ownerId,workflow_ref:gate.W.workflowRef,
   workflow_sha:sha,environment:gate.W.environment,ref:'refs/heads/main',
   event_name:'workflow_dispatch',runner_environment:'github-hosted',
   actor_id:gate.W.actorId,run_id:'100001',run_attempt:'1',
   jti:'owner-core-test-jti-12345',iat:now-40,nbf:now-50,exp:now+100
 };
 const b=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const raw=b({kid,alg:'RS256',typ:'JWT'})+'.'+b(claims);
 const token=raw+'.'+crypto.sign('RSA-SHA256',Buffer.from(raw),privateKey).toString('base64url');
 return gate.verifyU06OwnerIdentity({
   token,jwks:{keys:[{...publicKey.export({format:'jwk'}),kid,alg:'RS256'}]},
   environment:{name:gate.W.environment,
     deployment_branch_policy:{custom_branch_policies:true,protected_branches:false},
     protection_rules:[{type:'required_reviewers',prevent_self_review:true,
       reviewers:[{type:'User',reviewer:{id:Number(gate.W.approverId)}}]}]},
   branches:{branch_policies:[{name:'main',type:'branch'}]},
   run:{id:100001,actor:{id:Number(gate.W.actorId)},event:'workflow_dispatch',
     head_branch:'main',head_sha:sha,run_attempt:1,conclusion:'success',
     path:gate.W.workflowPath},
   approvals:[{user:{id:Number(gate.W.approverId)},state:'approved'}],
   challenge:nonce,expectedRunSha:sha,nowSec:now
 });
}
const pre=()=>({
  host:core.F.host,project:core.F.project,database:core.F.database,
  adapter_sha256:core.F.adapter_sha256,
  profile_sha256:core.F.profile_sha256_before,
  native_credential_absent:true,offsite_required_before:false,
  provider_dependency_removed:true
});
const post=()=>({
  native_backup_sha256:'f'.repeat(64),actual_native_functions_executed:true,
  restored_tables:69,restored_fk_count:49,
  finance_counts_and_amounts_unchanged:true,
  wallet_and_reserve_integrity_verified:true,full_mysqlcheck_pass:true,
  offsite_required_true:true,offsite_remote_evidence_fresh:true,
  credential_file_private:true,root_journal_durable:true,
  production_application_unchanged:true,yii_migrations_unchanged:true
});
function fakeNative(custom={}){
 const calls=[];
 const handlers={
   exclusiveU06Lock:()=>{calls.push('lock')},
   readExactPreimage:()=>{calls.push('pre');return pre()},
   verifyIndependentNode1Recovery:()=>{calls.push('offsite');return true},
   prepareDurableRollbackJournal:()=>{calls.push('journal');return {id:'u06fixturejournal123456'}},
   assertRollbackJournalDurable:()=>{calls.push('durable');return true},
   provisionBackupOnlyIdentityAndPrivateCredential:()=>{calls.push('provision')},
   runInstalledUniversalNativeBackup:()=>{calls.push('backup')},
   verifyIsolatedRestoreAndFinancialIntegrity:()=>{calls.push('restore')},
   enableRequiredOffsiteWithRollback:()=>{calls.push('enable')},
   verifyExactPostflight:()=>{calls.push('post');return post()},
   commitDurableJournal:()=>{calls.push('commit');return true},
   rollbackExactPreimage:()=>{calls.push('rollback')},
   verifyExactRollback:()=>{calls.push('verifyRollback');return true},
   releaseU06Lock:()=>{calls.push('unlock')}
 };
 return {native:{...handlers,...custom},calls};
}
function tempLedger(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prhm-u06-native-test-'));
 fs.chmodSync(dir,0o700);return dir;
}
const options=directory=>({ledgerDir:directory,ledgerOwnerUid:process.getuid()});
test('exact identity, account, privileges and required adapters are pinned',()=>{
 assert.equal(core.F.operation,'honartik_back.production.native_backup');
 assert.equal(core.F.database,'honartik_db');
 assert.equal(core.F.account_host,'127.0.0.1');
 assert.deepEqual(core.F.grants,['SELECT','SHOW VIEW','TRIGGER','EVENT']);
 assert.equal(core.F.auto_deploy,false);
 assert.equal(core.F.yii_migrations,false);
 assert.equal(core.F.apache_cutover,false);
 assert.equal(core.REQUIRED.length,14);
 assert.equal(core.INSTALLED_ROOT_BINDING,false);
});
test('signed owner evidence and durable journal govern exact success order',async()=>{
 const dir=tempLedger();
 try{
   const proof=ownerProof(),{native,calls}=fakeNative();
   const r=await core.coordinateOwnerU06(native,proof,options(dir));
   assert.equal(r.coordinator_completed,true);
   assert.equal(r.installed_root_binding_proven,false);
   assert.equal(r.backend_deployment_authorized,false);
   assert.deepEqual(calls,[
     'lock','pre','offsite','journal','durable','provision','backup',
     'restore','enable','post','commit','unlock'
   ]);
   assert.equal(fs.readdirSync(dir).length,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('fake claims never get to lock or journal',async()=>{
 const dir=tempLedger();
 try{
   const {native,calls}=fakeNative();
   await assert.rejects(core.coordinateOwnerU06(native,{
     ...ownerProof(),owner_identity_verified:true
   },options(dir)),/owner_identity_not_cryptographically_verified/);
   assert.deepEqual(calls,[]);
   assert.equal(fs.readdirSync(dir).length,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('missing native capability fails before privileged operation',async()=>{
 const dir=tempLedger();
 try{
   const x=fakeNative();delete x.native.runInstalledUniversalNativeBackup;
   await assert.rejects(core.coordinateOwnerU06(x.native,ownerProof(),options(dir)),
     /trusted_fixed_native_adapter_not_supplied/);
   assert.deepEqual(x.calls,[]);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('SHA drift refuses before journal and receipt consumption',async()=>{
 const dir=tempLedger();
 try{
   const x=fakeNative({readExactPreimage:()=>({
     ...pre(),adapter_sha256:'0'.repeat(64)
   })});
   await assert.rejects(core.coordinateOwnerU06(x.native,ownerProof(),options(dir)),
     /production_preimage_drift/);
   assert.equal(fs.readdirSync(dir).length,0);
   assert.ok(!x.calls.includes('provision'));
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('unverified recent Node1 evidence prevents any account creation',async()=>{
 const dir=tempLedger();
 try{
   const x=fakeNative({verifyIndependentNode1Recovery:()=>false});
   await assert.rejects(core.coordinateOwnerU06(x.native,ownerProof(),options(dir)),
     /remote_offsite_recovery_not_verified/);
   assert.equal(fs.readdirSync(dir).length,0);
   assert.ok(!x.calls.includes('provision'));
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('non-durable journal rejects before receipt and write',async()=>{
 const dir=tempLedger();
 try{
   const x=fakeNative({assertRollbackJournalDurable:()=>false});
   await assert.rejects(core.coordinateOwnerU06(x.native,ownerProof(),options(dir)),
     /journal_not_durable/);
   assert.equal(fs.readdirSync(dir).length,0);
   assert.ok(!x.calls.includes('provision'));
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('native partial backup failure rolls back and does not refund approval',async()=>{
 const dir=tempLedger();
 try{
   const x=fakeNative({runInstalledUniversalNativeBackup:()=>{throw Error('fixture-backup-fail')}});
   const receipt=ownerProof();
   await assert.rejects(core.coordinateOwnerU06(x.native,receipt,options(dir)),
     /fixture-backup-fail/);
   assert.ok(x.calls.includes('rollback'));
   assert.ok(x.calls.includes('verifyRollback'));
   assert.equal(fs.readdirSync(dir).length,1);
   await assert.rejects(core.coordinateOwnerU06(fakeNative().native,receipt,options(dir)),
     /replayed_receipt/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('failed rollback retains critical recovery state and consumed approval',async()=>{
 const dir=tempLedger();
 try{
   const x=fakeNative({
     runInstalledUniversalNativeBackup:()=>{throw Error('fixture-backup-fail')},
     verifyExactRollback:()=>false
   });
   await assert.rejects(core.coordinateOwnerU06(x.native,ownerProof(),options(dir)),
     /CRITICAL_RECOVERY_JOURNAL_RETAINED/);
   assert.equal(fs.readdirSync(dir).length,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('postflight financial integrity failure triggers exact rollback',async()=>{
 const dir=tempLedger();
 try{
   const x=fakeNative({verifyExactPostflight:()=>({
     ...post(),finance_counts_and_amounts_unchanged:false
   })});
   await assert.rejects(core.coordinateOwnerU06(x.native,ownerProof(),options(dir)),
     /native_backup_postflight_not_proven/);
   assert.ok(x.calls.includes('rollback'));
   assert.ok(x.calls.includes('verifyRollback'));
   assert.ok(!x.calls.includes('commit'));
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('cannot use successful receipt twice to write credentials twice',async()=>{
 const dir=tempLedger();
 try{
   const proof=ownerProof();
   await core.coordinateOwnerU06(fakeNative().native,proof,options(dir));
   const x=fakeNative();
   await assert.rejects(core.coordinateOwnerU06(x.native,proof,options(dir)),
     /replayed_receipt/);
   assert.ok(!x.calls.includes('provision'));
   assert.ok(!x.calls.includes('commit'));
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('profile before and after exact shape refuses extra command arguments',()=>{
 assert.throws(()=>core.checkPreimage({...pre(),command:'bash'}),/untrusted_preimage_shape/);
 assert.throws(()=>core.checkPostflight({...post(),host:'other'}),/untrusted_postflight_shape/);
 assert.throws(()=>core.checkPostflight({...post(),full_mysqlcheck_pass:false}),
   /native_backup_postflight_not_proven/);
});
