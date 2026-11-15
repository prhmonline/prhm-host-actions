'use strict';
/**
 * U06 Root-shared signed lock ADMISSION CANDIDATE — source/fixture only.
 *
 * Reconciliation and Native backup have separate, exact Action/L4 signed
 * receipt verifiers. Only an independently verified, already CONSUMED
 * Approval Center Ed25519 receipt can issue a fixture lock session.
 * Native official L4 replay-fence reservation is deferred EXCLUSIVELY to
 * the existing Native coordinator, AFTER its durable PREPARED journal. All
 * other actor kinds are denied until independently reviewed scoped actions
 * exist. This module never signs, registers, issues L4, connects Root or
 * runs Native / owner-identity work.
 *
 * Production deliberately has NO constructor or CLI. A future audited
 * Root adapter must pin all source bytes, trusted paths, approvals and the
 * durable terminal journal before using the same gate algorithm.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const Shared=require('./honartik-u06-shared-exclusive-lock-v1.cjs');
const Reconcile=require('./honartik-u06-expired-owner-reconcile-l4-consumed-v1.cjs');
const NativeScope=require('./honartik-u06-native-l4-consumed-receipt-v1.cjs');
const {decodeJws}=require('./honartik-universal-installer-l4-approval-verify-v1.cjs');

const ALLOWED=Object.freeze({
 expired_challenge_reconciliation:Reconcile.OPERATION,
 native_backup_transaction:NativeScope.OPERATION
});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX64=/^[a-f0-9]{64}$/;
const H=x=>crypto.createHash('sha256').update(x).digest('hex');
const fail=x=>{throw Error('u06_signed_root_lock_'+x)};
const need=(v,x)=>{if(!v)fail(x)};
// lstat, not existsSync: a dangling symlink is still an untrusted leaf.
const absent=p=>{try{fs.lstatSync(p);return false}catch(e){if(e.code==='ENOENT')return true;throw e}};
const dSync=dir=>{
 const fd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
 try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
};
function dir(dir,uid){
 const x=fs.lstatSync(dir);
 need(x.isDirectory()&&!x.isSymbolicLink()&&x.uid===uid&&
   (x.mode&0o777)===0o700,'untrusted_directory');
}
function fixedOwned(file,uid,max=200000){
 const a=fs.lstatSync(file);
 need(a.isFile()&&!a.isSymbolicLink()&&a.uid===uid&&a.nlink===1&&
   (a.mode&0o777)===0o600&&a.size>0&&a.size<=max,'untrusted_file');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try {
  const b=fs.fstatSync(fd);
  need(b.uid===uid&&a.dev===b.dev&&a.ino===b.ino&&
   a.mode===b.mode&&a.size===b.size,'raced_file');
  return fs.readFileSync(fd);
 }finally{fs.closeSync(fd)}
}
function createDirectoryOnce(d,uid){
 try{fs.mkdirSync(d,{mode:0o700});dSync(path.dirname(d))}
 catch(e){if(e.code!=='EEXIST')throw e}
 dir(d,uid);
}
function exclusive(file,bytes,uid){
 const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|
   fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{
  const st=fs.fstatSync(fd);
  need(st.isFile()&&st.uid===uid&&(st.mode&0o777)===0o600&&
    st.nlink===1,'fence_not_private');
  fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);
 }finally{fs.closeSync(fd)}
 dSync(path.dirname(file));
}
function rootOnlyFixture(sharedRoot,authRoot,uid){
 need(process.platform==='linux'&&typeof process.getuid==='function'&&
   uid===process.getuid()&&uid!==0,'unprivileged_fixture_only');
 need(typeof sharedRoot==='string'&&
  /^\/tmp\/u06-owner-shared-test-[0-9a-f]{12}$/.test(sharedRoot)&&
  typeof authRoot==='string'&&
  /^\/tmp\/u06-root-signed-gate-test-[0-9a-f]{12}$/.test(authRoot),
  'fixture_path_invalid');
 need(fs.realpathSync(sharedRoot)===sharedRoot&&
   fs.realpathSync(authRoot)===authRoot,'fixture_symlink_root');
 dir(sharedRoot,uid);dir(authRoot,uid);
}
function createUnprivilegedSignedLockFixture({sharedRoot,authRoot}={}){
 const uid=process.getuid?.();
 rootOnlyFixture(sharedRoot,authRoot,uid);
 const shared=Shared.createUnprivilegedFixtureSharedGate(sharedRoot);
 const ledgerDir=path.join(authRoot,'consumed');
 const policy=path.join(authRoot,'policy.json');
 const issuer=path.join(authRoot,'issuer.pem');
 const fenceDir=path.join(sharedRoot,'u06-owner-shared-signed-fences');
 dir(ledgerDir,uid);
 createDirectoryOnce(fenceDir,uid);
 const sessions=new WeakSet();
 function preflight(kind){
  need(Object.hasOwn(ALLOWED,kind),'independent_signed_l4_scope_not_registered');
  dir(sharedRoot,uid);dir(authRoot,uid);dir(ledgerDir,uid);dir(fenceDir,uid);
 }
 function verifyReconciliation(token,policySha){
  need(HEX64.test(policySha||''),'reconciliation_policy_sha_missing');
  const p=fixedOwned(policy,uid),pub=fixedOwned(issuer,uid,8192);
  need(H(p)===policySha,'reconciliation_pinned_policy_drift');
  // Verify signature BEFORE mapping approval_id to a ledger filename.
  const claims=decodeJws(token,pub);
  need(UUID.test(claims.approval_id||''),'signed_approval_uuid_invalid');
  const consumed=JSON.parse(fixedOwned(
   path.join(ledgerDir,claims.approval_id+'.json'),uid,16384).toString('utf8'));
  return Reconcile.verifySignedConsumedReconciliation({
   token,issuerPublicKey:pub,consumedLedger:consumed,policyBytes:p,
   reviewedPolicySha256:policySha,nowSec:Math.floor(Date.now()/1000)
  });
 }
 function verifyNative(token,requestId,paths,F,nativeRoot){
  need(typeof nativeRoot==='string'&&
   /^\/tmp\/u06-root-lease-test-[A-Za-z0-9]{6}$/.test(nativeRoot)&&
   fs.realpathSync(nativeRoot)===nativeRoot,'native_root_untrusted');
  dir(nativeRoot,uid);
  need(absent(path.join(nativeRoot,'u06-exclusive.lease'))&&
   absent(path.join(nativeRoot,'u06-rollback.json')),
   'prior_native_transaction_present');
  need(UUID.test(requestId||''),'native_request_id_invalid');
  // Native's authoritative replay reservation requires a PREPARED journal.
  // A new shared lock must be acquired BEFORE that journal can exist:
  // pre-admission verifies signed/consumed L4 without pretending a journal
  // already exists or modifying the Native fence. Only the coordinator may
  // later bind its REAL prepared journal and durably spend the Native fence.
  need(paths&&typeof paths==='object'&&!Array.isArray(paths)&&
    Object.keys(paths).sort().join('|')===
      ['policy','issuer','consumed','fence','policy_sha256'].sort().join('|'),
    'native_preflight_paths_invalid');
  const root=path.dirname(paths.policy);
  need(/^\/tmp\/u06-root-l4-test-[A-Za-z0-9]{6}$/.test(root)&&
    fs.realpathSync(root)===root&&
    paths.issuer===path.join(root,'issuer.pem')&&
    paths.consumed===path.join(root,'consumed')&&
    paths.fence===path.join(root,'fence'),'native_fixture_scope_invalid');
  dir(root,uid);dir(paths.consumed,uid);dir(paths.fence,uid);
  need(F&&F.operation==='honartik_back.production.native_backup'&&
    F.reviewed_l4_policy_sha256===paths.policy_sha256&&
    HEX64.test(paths.policy_sha256||''),'native_policy_scope_invalid');
  const policyBytes=fixedOwned(paths.policy,uid);
  const issuerPublicKey=fixedOwned(paths.issuer,uid,8192);
  need(H(policyBytes)===paths.policy_sha256,'native_policy_preimage_drift');
  const claims=decodeJws(token,issuerPublicKey);
  need(UUID.test(claims.approval_id||'')&&
    claims.request_id===requestId,'native_signed_request_drift');
  const consumedLedger=JSON.parse(fixedOwned(path.join(paths.consumed,
    claims.approval_id+'.json'),uid,16384).toString('utf8'));
  const proof=NativeScope.verifySignedConsumedL4({
    token,issuerPublicKey,consumedLedger,policyBytes,
    reviewedPolicySha256:paths.policy_sha256,
    nowSec:Math.floor(Date.now()/1000)
  });
  need(proof.operation===NativeScope.OPERATION&&
    proof.request_id===requestId&&proof.signature_verified===true&&
    proof.consumed_ledger_verified===true,'native_preflight_invalid');
  return proof;
 }
 function beginAuthorized(kind,authorization){
  preflight(kind);
  need(authorization&&typeof authorization==='object'&&
    !Array.isArray(authorization),'authorization_missing');
  // Native journal/rollback files are blocked by the underlying gate.
  const lease=shared.begin(kind);
  // On any post-acquisition error, retain this lease for reviewed recovery:
  // NEVER automatically delete it or refund a possibly consumed approval.
  let verified,nativeRoot=null;
  if(kind==='expired_challenge_reconciliation'){
   need(Object.keys(authorization).sort().join('|')===
    ['token','reviewedPolicySha256'].sort().join('|'),
    'reconciliation_authorization_shape');
   verified=verifyReconciliation(authorization.token,authorization.reviewedPolicySha256);
  }else{
   need(Object.keys(authorization).sort().join('|')===
    ['token','requestId','paths','F','nativeRoot'].sort().join('|'),
    'native_authorization_shape');
   nativeRoot=authorization.nativeRoot;
   verified=verifyNative(authorization.token,authorization.requestId,
     authorization.paths,authorization.F,nativeRoot);
  }
  need(verified.operation===ALLOWED[kind]&&
    verified.signature_verified===true&&
    verified.consumed_ledger_verified===true&&
    UUID.test(verified.approval_id||''),'verified_signed_scope_required');
  // Persist a shared cross-operation one-use fence independent of the
  // existing Native ledger fence. A replay cannot acquire a new lock.
  const file=path.join(fenceDir,verified.approval_id+'.used');
  exclusive(file,Buffer.from(JSON.stringify({
   schema:'prhm.u06.shared-root-signed-fence.fixture.v1',
   approval_id:verified.approval_id,operation:verified.operation,
   kind,shared_lease_id:lease.id,spent:true,
   native_l4_fence_reserved_by_gate:false,
   native_l4_fence_owner:'native_coordinator_only',
   native_root_sha256:nativeRoot?H(nativeRoot):null
  })+'\n'),uid);
  const session=Object.freeze({kind,approval_id:verified.approval_id,
   operation:verified.operation,nativeRoot,
   binding:Object.freeze({gate:shared,lease})});
  sessions.add(session);
  return session;
 }
 function assertAuthorized(session,kind){
  need(sessions.has(session)&&session.kind===kind&&
   session.operation===ALLOWED[kind],'session_not_issued_here');
  need(shared.assertHeld(session.binding.lease,kind)===true,
    'not_lease_owner');
  const record=JSON.parse(fixedOwned(path.join(fenceDir,
    session.approval_id+'.used'),uid,8192).toString('utf8'));
  need(record.kind===kind&&record.approval_id===session.approval_id&&
   record.shared_lease_id===session.binding.lease.id&&record.spent===true&&
   record.native_l4_fence_reserved_by_gate===false&&
   record.native_l4_fence_owner==='native_coordinator_only'&&
   record.native_root_sha256===(session.nativeRoot?H(session.nativeRoot):null),
   'signed_fence_drift');
  return true;
 }
 // Fixture only. Production terminal release must validate the real
 // journal and independent Root host recovery, not a caller's boolean.
 function finishFixture(session,terminalRecord){
  assertAuthorized(session,session.kind);
  if(session.kind==='native_backup_transaction'){
   const root=session.nativeRoot;
   need(typeof root==='string'&&
    /^\/tmp\/u06-root-lease-test-[A-Za-z0-9]{6}$/.test(root)&&
    fs.realpathSync(root)===root,'native_root_not_bound');
   dir(root,uid);
   need(absent(path.join(root,'u06-exclusive.lease')),
     'native_lease_must_be_released');
   const bytes=fixedOwned(path.join(root,'u06-rollback.json'),uid,2000000);
   let j;try{j=JSON.parse(bytes.toString('utf8'))}catch{fail('native_journal_invalid')}
   need(j.schema==='prhm.u06.root-rollback.v1'&&
    /^[a-f0-9]{40}$/.test(j.id||'')&&j.state==='ROLLED_BACK'&&
    j.rollback_original_profile_verified===true&&
    j.credential_absent_verified===true,
    'native_rollback_disk_not_verified');
   need(terminalRecord&&terminalRecord.journal_sha256===H(bytes),
    'native_terminal_sha_mismatch');
  }
  need(terminalRecord&&typeof terminalRecord==='object'&&
    Object.keys(terminalRecord).sort().join('|')===
      ['lease_id','kind','approval_id','terminal','journal_sha256'].sort().join('|')&&
    terminalRecord.lease_id===session.binding.lease.id&&
    terminalRecord.kind===session.kind&&
    terminalRecord.approval_id===session.approval_id&&
    terminalRecord.terminal==='DONE'&&
    HEX64.test(terminalRecord.journal_sha256||''),
    'typed_fixture_terminal_record_required');
  sessions.delete(session);
  return shared.finish(session.binding.lease,session.kind,{terminalProof:true});
 }
 return Object.freeze({
  beginAuthorized,assertAuthorized,finishFixture,
  inspect:()=>shared.inspect(),
  authorizedKinds:Object.freeze(Object.keys(ALLOWED)),
  sourceOnly:true
 });
}
module.exports=Object.freeze({
 createUnprivilegedSignedLockFixture,
 ALLOWED,
 ROOT_HANDLER_REGISTERED:false,
 LIVE_ROOT_CONSTRUCTOR_EXPORTED:false,
 L4_ISSUER:false,
 PRODUCTION_APPLY:false
});
if(require.main===module){
 process.stderr.write('U06 signed shared Root gate is source-only; no live constructor or CLI.\n');
 process.exitCode=64;
}
