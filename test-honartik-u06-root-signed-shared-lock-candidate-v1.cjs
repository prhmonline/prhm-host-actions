'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');
const Gate=require('./honartik-u06-root-signed-shared-lock-candidate-v1.cjs');
const Recon=require('./honartik-u06-expired-owner-reconcile-l4-consumed-v1.cjs');
const Native=require('./honartik-u06-native-l4-consumed-receipt-v1.cjs');
const NativeGate=require('./honartik-u06-native-root-l4-admission-v1.cjs');
const H=x=>crypto.createHash('sha256').update(x).digest('hex');
const ID='11111111-1111-4111-8111-111111111111';
const RID='22222222-2222-4222-8222-222222222222';
const uuid=()=>crypto.randomUUID();
const modulePath=path.join(__dirname,'honartik-u06-root-signed-shared-lock-candidate-v1.cjs');
const sourceError=/u06_signed_root_lock_|u06_shared_lock_|u06_expired_reconcile_l4_|u06_native_root_l4_|prhm_u06_l4_|honartik_l4_receipt_/;
function write600(f,body){fs.writeFileSync(f,body,{mode:0o600});}
function signed(pair,claims){
 const pub=pair.publicKey.export({format:'der',type:'spki'});
 const header={alg:'EdDSA',typ:'PRHM-COMPANY-APPROVAL',kid:H(pub).slice(0,16)};
 const a=[header,claims].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
 return a+'.'+crypto.sign(null,Buffer.from(a),pair.privateKey).toString('base64url');
}
function policy(kind,version){
 const action=kind==='reconcile'?Recon.ACTION:Native.ACTION;
 const operation=kind==='reconcile'?Recon.OPERATION:Native.OPERATION;
 const rollback=kind==='reconcile'?Recon.ROLLBACK:Native.EXPECTED.rollback;
 const operationValue={level:4,risk:'critical',requires_second_confirmation:true,
  one_time_use:true,expires_seconds:180,policy_version:version,
  requested_approver:'mohammad',rollback_reference:rollback};
 const scopes=[{tool:'host_action_v2_apply',project:'control_plane',
  environment:'production',action,operation,risk:'critical',
  principals:[{principal_id:'mohammad',roles:['mcp-operator']}]}];
 const operations={[operation]:operationValue};
 if(kind==='reconcile'){
  operations[Recon.NATIVE_OPERATION]={level:4,risk:'critical'};
  scopes.push({tool:'host_action_v2_apply',project:'control_plane',
   environment:'production',action:Native.ACTION,operation:Native.OPERATION,
   risk:'critical',principals:[{principal_id:'mohammad',roles:['mcp-operator']}]});
 }
 return {schema_version:'prhm.approval-policy.v1',issuer:'prhm-company-approval',
  version,default_deny:true,one_time_use:true,scope_freeze:true,
  levels:{'4':{human_approval:true,second_confirmation_required:true,
   max_ttl_seconds:180}},operations,typed_scopes:scopes};
}
function setup(kind='reconcile'){
 const sharedRoot='/tmp/u06-owner-shared-test-'+crypto.randomBytes(6).toString('hex');
 const authRoot='/tmp/u06-root-signed-gate-test-'+crypto.randomBytes(6).toString('hex');
 for(const d of [sharedRoot,authRoot])fs.mkdirSync(d,{mode:0o700});
 const nRoot=fs.mkdtempSync('/tmp/u06-root-l4-test-');fs.chmodSync(nRoot,0o700);
 const nativePaths={policy:path.join(nRoot,'policy.json'),issuer:path.join(nRoot,'issuer.pem'),
  consumed:path.join(nRoot,'consumed'),fence:path.join(nRoot,'fence'),policy_sha256:null};
 const nativeRoot=fs.mkdtempSync('/tmp/u06-root-lease-test-');fs.chmodSync(nativeRoot,0o700);
 const roots=[sharedRoot,authRoot,nRoot,nativeRoot];
 fs.mkdirSync(path.join(authRoot,'consumed'),{mode:0o700});
 const ledgerDir=kind==='reconcile'?path.join(authRoot,'consumed'):nativePaths.consumed;
 if(kind==='native')fs.mkdirSync(ledgerDir,{mode:0o700});
 if(kind==='native')fs.mkdirSync(nativePaths.fence,{mode:0o700});
 const policyDoc=policy(kind,'2026-11-15-signed-root-gate-test');
 const p=Buffer.from(JSON.stringify(policyDoc,null,2)+'\n');
 const policyHash=H(p);nativePaths.policy_sha256=policyHash;
 const pair=crypto.generateKeyPairSync('ed25519');
 const pub=pair.publicKey.export({format:'pem',type:'spki'});
 const now=Math.floor(Date.now()/1000);
 const approvalId=uuid(),requestId=uuid();
 const action=kind==='reconcile'?Recon.ACTION:Native.ACTION;
 const operation=kind==='reconcile'?Recon.OPERATION:Native.OPERATION;
 const argsHash=kind==='reconcile'?Recon.argDigest():Native.argDigest();
 const claims={approval_id:approvalId,request_id:requestId,jti:approvalId,
  iss:'prhm-company-approval',action,operation,project:'control_plane',
  environment:'production',tool:'host_action_v2_apply',principal_id:'mohammad',
  role:'mcp-operator',level:4,risk:'critical',decision:'accept',one_time_use:true,
  policy_version:policyDoc.version,
  policy_hash:H(Buffer.from(JSON.stringify(policyDoc))),
  arguments_sha256:argsHash,request_hash:argsHash,
  iat:now-30,nbf:now-30,exp:now+120};
 const token=signed(pair,claims);
 const ledger={schema_version:'prhm.approval-consumption.v1',
  approval_id:approvalId,request_id:requestId,work_order_id:null,
  project_id:'control_plane',operation,request_hash:argsHash,
  consumed_at:new Date((now-10)*1000).toISOString(),
  consumer:'prhm-agent-selfmaint-exec-host-actions-v2',consumption_hash:null};
 ledger.consumption_hash=H(Buffer.from(JSON.stringify({...ledger,consumption_hash:null})));
 const root=kind==='reconcile'?authRoot:nRoot;
 write600(path.join(root,'policy.json'),p);write600(path.join(root,'issuer.pem'),pub);
 if(kind==='native'){
  write600(path.join(authRoot,'policy.json'),p);
  write600(path.join(authRoot,'issuer.pem'),pub);
 }
 const ledgerFile=path.join(ledgerDir,approvalId+'.json');
 write600(ledgerFile,JSON.stringify(ledger));
 if(kind==='native')write600(path.join(authRoot,'consumed',approvalId+'.json'),JSON.stringify(ledger));
 const nativeContext={requestId,paths:nativePaths,
  F:{operation:'honartik_back.production.native_backup',reviewed_l4_policy_sha256:policyHash},
  journal:{id:'u06_signed_shared_native_test_journal_01'}};
 return {kind,sharedRoot,authRoot,nRoot,nativeRoot,roots,token,approvalId,requestId,
  policyHash,pair,claims,ledger,ledgerFile,nativeContext,
  create:()=>Gate.createUnprivilegedSignedLockFixture({sharedRoot,authRoot}),
  grant:(tokenValue=token)=>kind==='reconcile'?
   {token:tokenValue,reviewedPolicySha256:policyHash}:
   {token:tokenValue,requestId,paths:nativePaths,F:nativeContext.F,nativeRoot},
  clean:()=>roots.forEach(d=>fs.rmSync(d,{recursive:true,force:true}))
 };
}
function terminal(session){return {lease_id:session.binding.lease.id,
 kind:session.kind,approval_id:session.approval_id,
 terminal:'DONE',journal_sha256:H('fixture-only-journal')}}

test('genuine signed reconciliation consumed L4 issues EXACT common lease and durable no-replay fence',()=>{
 const f=setup();try{
  const g=f.create(),s=g.beginAuthorized('expired_challenge_reconciliation',f.grant());
  assert.equal(g.assertAuthorized(s,s.kind),true);
  assert.equal(s.operation,Recon.OPERATION);
  assert.equal(g.inspect().kind,s.kind);
  const p=path.join(f.sharedRoot,'u06-owner-shared-signed-fences',f.approvalId+'.used');
  assert.equal(fs.statSync(p).mode&0o777,0o600);
  assert.equal(JSON.parse(fs.readFileSync(p)).spent,true);
  assert.equal(g.finishFixture(s,terminal(s)).released,true);
  assert.equal(g.inspect().locked,false);
 }finally{f.clean()}
});
test('replaying same signed and consumed reconciliation L4 is blocked even after previous lock release',()=>{
 const f=setup();try{
  const g=f.create(),kind='expired_challenge_reconciliation';
  const s=g.beginAuthorized(kind,f.grant());g.finishFixture(s,terminal(s));
  assert.throws(()=>g.beginAuthorized(kind,f.grant()),/EEXIST/);
  assert.equal(g.inspect().locked,true,'a failed replay remains fail-closed');
 }finally{f.clean()}
});
test('reconciliation requires the real Ed25519 signature, matching source SHA and consumed ledger',()=>{
 for(const tamper of ['bad_signature','other_action','other_policy','ledger_corrupt']){
  const f=setup();try{
   if(tamper==='ledger_corrupt'){
    const l={...f.ledger,consumption_hash:'0'.repeat(64)};
    write600(f.ledgerFile,JSON.stringify(l));
   }
   const grant=f.grant();
   if(tamper==='bad_signature')grant.token=grant.token.slice(0,-2)+'xx';
   if(tamper==='other_action')grant.token=signed(f.pair,{...f.claims,action:Native.ACTION});
   if(tamper==='other_policy')grant.reviewedPolicySha256='a'.repeat(64);
   const g=f.create();
   assert.throws(()=>g.beginAuthorized('expired_challenge_reconciliation',grant),sourceError);
   assert.equal(g.inspect().locked,true);
  }finally{f.clean()}
 }
});
test('one signed reconciliation L4 cannot authorize Native or any of three unregistered actors',()=>{
 const f=setup();try{
  const g=f.create();
  for(const kind of ['owner_challenge_issuance','owner_evidence_staging','owner_evidence_consumption']){
   assert.throws(()=>g.beginAuthorized(kind,f.grant()),
    /independent_signed_l4_scope_not_registered/);
  }
  assert.throws(()=>g.beginAuthorized('native_backup_transaction',f.grant()),
    /native_authorization_shape/);
 }finally{f.clean()}
});
test('Native admission verifies signed/consumed L4 but ONLY prepared-journal coordinator spends authoritative fence',()=>{
 const f=setup('native');try{
  const g=f.create(),s=g.beginAuthorized('native_backup_transaction',f.grant());
  const nativeFence=path.join(f.nRoot,'fence',f.approvalId+'.json');
  const sharedFence=path.join(f.sharedRoot,'u06-owner-shared-signed-fences',f.approvalId+'.used');
  assert.equal(s.operation,Native.OPERATION);
  assert.equal(g.assertAuthorized(s,'native_backup_transaction'),true);
  assert.equal(fs.existsSync(nativeFence),false,
    'pre-admission must NEVER consume the official Native replay fence');
  const admitted=JSON.parse(fs.readFileSync(sharedFence,'utf8'));
  assert.equal(admitted.native_l4_fence_reserved_by_gate,false);
  assert.equal(admitted.native_l4_fence_owner,'native_coordinator_only');
  // Simulate the coordinator AFTER it has prepared a durable journal:
  // reuse the unchanged native verifier and fsynced O_EXCL replay fence ONCE.
  const {requestId,paths,F,journal}=f.nativeContext;
  const native=NativeGate.createDisposableRootL4Fixture(requestId,()=>f.token,paths);
  const proof=native.verifyNativeConsumedSignedLevel4(F,journal);
  assert.equal(native.reserveNativeLevel4ReplayFence(F,journal,proof),true);
  assert.equal(fs.statSync(nativeFence).mode&0o777,0o600);
  const again=NativeGate.createDisposableRootL4Fixture(requestId,()=>f.token,paths);
  const anotherProof=again.verifyNativeConsumedSignedLevel4(F,journal);
  assert.throws(()=>again.reserveNativeLevel4ReplayFence(F,journal,anotherProof),/EEXIST/);
  assert.throws(()=>g.finishFixture(s,terminal(s)),/ENOENT|native_rollback_disk_not_verified/);
  assert.equal(g.inspect().locked,true);
  assert.throws(()=>g.beginAuthorized('native_backup_transaction',f.grant()),/EEXIST|busy_or_unrecovered/);
 }finally{f.clean()}
});
test('Native separate approval cannot be used to reconcile expired owner proof',()=>{
 const f=setup('native');try{
  const g=f.create();
  assert.throws(()=>g.beginAuthorized('expired_challenge_reconciliation',
   {token:f.token,reviewedPolicySha256:f.policyHash}),sourceError);
  assert.equal(g.inspect().locked,true);
 }finally{f.clean()}
});
test('false positive caller booleans and handcrafted receipt cannot issue or release lock',()=>{
 const f=setup();try{
  const g=f.create();
  assert.throws(()=>g.beginAuthorized('expired_challenge_reconciliation',{
   signature_verified:true,consumed_ledger_verified:true
  }),/reconciliation_authorization_shape/);
  assert.equal(g.inspect().locked,true);
 }finally{f.clean()}
});
test('a issued session cannot be released with a false or wrong terminal journal',()=>{
 const f=setup();try{
  const a=f.create(),b=f.create(),s=a.beginAuthorized('expired_challenge_reconciliation',f.grant());
  assert.throws(()=>a.finishFixture(s,{terminal:true}),/typed_fixture_terminal_record_required/);
  assert.throws(()=>b.finishFixture(s,terminal(s)),/session_not_issued_here/);
  assert.equal(a.inspect().locked,true);
  assert.throws(()=>a.finishFixture(s,{...terminal(s),journal_sha256:'x'}),/typed_fixture_terminal_record_required/);
  assert.equal(a.finishFixture(s,terminal(s)).released,true);
 }finally{f.clean()}
});
test('tampered root directories, file mode or consumed symlink abort before authorization',()=>{
 for(const damage of ['dir_mode','policy_mode','ledger_symlink']){
  const f=setup();try{
   if(damage==='dir_mode')fs.chmodSync(f.authRoot,0o755);
   if(damage==='policy_mode')fs.chmodSync(path.join(f.authRoot,'policy.json'),0o644);
   if(damage==='ledger_symlink'){
    fs.unlinkSync(f.ledgerFile);
    fs.symlinkSync(path.join(f.authRoot,'policy.json'),f.ledgerFile);
   }
   if(damage==='dir_mode'){
    assert.throws(()=>f.create(),/untrusted_directory/);
   }else{
    const g=f.create();
    assert.throws(()=>g.beginAuthorized('expired_challenge_reconciliation',f.grant()),
     /untrusted_file/);
    assert.equal(g.inspect().locked,true);
   }
  }finally{f.clean()}
 }
});
test('inter-process competition admits one correctly signed grant only',async()=>{
 const f=setup();try{
  const js=[
   "const Gate=require("+JSON.stringify(modulePath)+");",
   "const p="+JSON.stringify({sharedRoot:f.sharedRoot,authRoot:f.authRoot})+";",
   "const auth="+JSON.stringify(f.grant())+";",
   "try{const gate=Gate.createUnprivilegedSignedLockFixture(p);",
   "const s=gate.beginAuthorized('expired_challenge_reconciliation',auth);",
   "console.log('WIN');",
   "setTimeout(()=>gate.finishFixture(s,{lease_id:s.binding.lease.id,kind:s.kind,approval_id:s.approval_id,terminal:'DONE',journal_sha256:'a'.repeat(64)}),350);",
   "}catch(e){if(/busy_or_unrecovered|EEXIST/.test(e.message))console.log('BUSY');else{console.error(e.message);process.exitCode=2}}"
  ].join('\n');
  const jobs=Array.from({length:8},()=>new Promise((resolve,reject)=>{
   const proc=spawn(process.execPath,['-e',js],{stdio:['ignore','pipe','pipe']});
   let stdout='',stderr='';
   proc.stdout.on('data',b=>stdout+=b);
   proc.stderr.on('data',b=>stderr+=b);
   proc.on('error',reject);
   proc.on('close',code=>resolve({code,stdout,stderr}));
  }));
  const out=await Promise.all(jobs);
  assert.ok(out.every(x=>x.code===0),JSON.stringify(out));
  assert.equal(out.filter(x=>x.stdout.includes('WIN')).length,1,JSON.stringify(out));
  assert.equal(out.filter(x=>x.stdout.includes('BUSY')).length,7,JSON.stringify(out));
 }finally{f.clean()}
});
test('SIGKILL after signed grant and durable fence leaves shared lock and no replay',()=>{
 const f=setup();try{
  const js=[
   "const Gate=require("+JSON.stringify(modulePath)+");",
   "const gate=Gate.createUnprivilegedSignedLockFixture("+JSON.stringify({sharedRoot:f.sharedRoot,authRoot:f.authRoot})+");",
   "gate.beginAuthorized('expired_challenge_reconciliation',"+JSON.stringify(f.grant())+");",
   "process.kill(process.pid,'SIGKILL')"
  ].join('\n');
  const p=spawnSync(process.execPath,['-e',js],{encoding:'utf8',timeout:10000});
  assert.equal(p.signal,'SIGKILL',p.stderr);
  const g=f.create();
  assert.equal(g.inspect().locked,true);
  assert.equal(fs.existsSync(path.join(f.sharedRoot,'u06-owner-shared-signed-fences',f.approvalId+'.used')),true);
  assert.throws(()=>g.beginAuthorized('expired_challenge_reconciliation',f.grant()),
   /busy_or_unrecovered/);
 }finally{f.clean()}
});
test('a caller cannot supply a fake prepared Native journal during shared gate admission',()=>{
 const f=setup('native');try{
  const g=f.create();
  assert.throws(()=>g.beginAuthorized('native_backup_transaction',{
   ...f.grant(),journal:{id:'invented_journal_without_disk'}
  }),/native_authorization_shape/);
  assert.equal(g.inspect().locked,true,'ambiguous admission remains fail-closed');
  assert.equal(fs.existsSync(path.join(f.nRoot,'fence',f.approvalId+'.json')),false);
 }finally{f.clean()}
});
test('native SIGKILL between shared signed admission and journal preparation cannot burn official L4 fence',()=>{
 const f=setup('native');try{
  const js=[
   "const Gate=require("+JSON.stringify(modulePath)+");",
   "const gate=Gate.createUnprivilegedSignedLockFixture("+JSON.stringify({
    sharedRoot:f.sharedRoot,authRoot:f.authRoot
   })+");",
   "gate.beginAuthorized('native_backup_transaction',"+JSON.stringify(f.grant())+");",
   "process.kill(process.pid,'SIGKILL')"
  ].join('\n');
  const child=spawnSync(process.execPath,['-e',js],{encoding:'utf8',timeout:10000});
  assert.equal(child.signal,'SIGKILL',child.stderr);
  assert.equal(fs.existsSync(path.join(f.nRoot,'fence',f.approvalId+'.json')),false);
  assert.equal(fs.existsSync(path.join(f.sharedRoot,
   'u06-owner-shared-signed-fences',f.approvalId+'.used')),true);
  const g=f.create();
  assert.equal(g.inspect().kind,'native_backup_transaction');
  assert.throws(()=>g.beginAuthorized('native_backup_transaction',f.grant()),
   /busy_or_unrecovered/);
 }finally{f.clean()}
});
test('coordinator owns exactly one official Native replay-fence reservation AFTER durable journal',()=>{
 const coordinator=fs.readFileSync(path.join(__dirname,
  'honartik-u06-owner-native-transaction-v1.cjs'),'utf8');
 const gateCandidate=fs.readFileSync(path.join(__dirname,
  'honartik-u06-root-signed-shared-lock-candidate-v1.cjs'),'utf8');
 const durable=coordinator.indexOf('native.assertRollbackJournalDurable(F,journal)');
 const verify=coordinator.indexOf('native.verifyNativeConsumedSignedLevel4(F,journal)');
 const reserve=coordinator.indexOf('native.reserveNativeLevel4ReplayFence(F,journal,approval)');
 const mutate=coordinator.indexOf('native.provisionBackupOnlyIdentityAndPrivateCredential(F,journal)');
 assert.ok(durable>=0&&verify>durable&&reserve>verify&&mutate>reserve);
 assert.equal(coordinator.split('native.reserveNativeLevel4ReplayFence(F,journal,approval)').length,2);
 assert.equal(gateCandidate.includes('admit.reserveNativeLevel4ReplayFence'),false);
 assert.equal(gateCandidate.includes('createDisposableRootL4Fixture'),false);
});

test('dangling Native lease symlink is not treated as an absent transaction before signed admission',()=>{
 const f=setup('native');try{
  fs.symlinkSync('/definitely-nonexistent-u06-native-lease',
   path.join(f.nativeRoot,'u06-exclusive.lease'));
  const g=f.create();
  assert.throws(()=>g.beginAuthorized('native_backup_transaction',f.grant()),
   /prior_native_transaction_present/);
  assert.equal(g.inspect().locked,true);
  assert.equal(fs.readdirSync(path.join(f.nRoot,'fence')).length,0);
 }finally{f.clean()}
});

test('no Root constructor, no Root CLI, no approval issuer, and exactly two L4 operations enabled',()=>{
 assert.equal(Gate.ROOT_HANDLER_REGISTERED,false);
 assert.equal(Gate.LIVE_ROOT_CONSTRUCTOR_EXPORTED,false);
 assert.equal(Gate.PRODUCTION_APPLY,false);
 assert.equal(Gate.L4_ISSUER,false);
 assert.equal(typeof Gate.createLiveRootSharedGate,'undefined');
 assert.deepEqual(Object.keys(Gate.ALLOWED).sort(),
  ['expired_challenge_reconciliation','native_backup_transaction'].sort());
 const p=spawnSync(process.execPath,[modulePath],{encoding:'utf8'});
 assert.equal(p.status,64);
 assert.match(p.stderr,/no live constructor or CLI/);
});
