'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const C=require('./honartik-u06-owner-native-transaction-v1.cjs');
const R=require('./honartik-u06-real-root-callback-adapter-v1.cjs');
const L=require('./honartik-u06-native-root-lease-v1.cjs');
const I=require('./honartik-u06-native-root-mariadb-identity-v1.cjs');
const src=fs.readFileSync(path.join(__dirname,
 'honartik-u06-real-root-callback-adapter-v1.cjs'),'utf8');
const worker=fs.readFileSync(path.join(__dirname,
 'scripts/u06/u06_live_native_root_worker_v1.py'),'utf8');
test('all 16 actual callbacks are explicitly present; no extra CLI or action registration',()=>{
 assert.equal(C.REQUIRED.length,16);
 for(const name of C.REQUIRED){
  assert.match(src,new RegExp('\\b'+name+'\\s*\\('),name);
 }
 assert.equal(R.COMPLETE_16_ROOT_METHODS,true);
 assert.equal(R.REGISTERED_IN_PRODUCTION,false);
 assert.equal(R.BOOTSTRAP_INSTALLED,false);
 assert.equal(R.DIRECT_CLI_EXPORTED,false);
 assert.equal(R.APPROVAL_ISSUER_EXPORTED,false);
 assert.equal(typeof R.makeRootCallbacks,'function');
 assert.equal(R.install,undefined);
 assert.equal(R.apply,undefined);
 assert.equal(L.COMMIT_IMPLEMENTED,true);
});
test('live construction requires Root and in-process cryptographic owner proof',()=>{
 if(process.getuid()!==0){
  assert.throws(()=>R.makeRootCallbacks({
   requestId:'22222222-2222-4222-8222-222222222222',
   sealedToken:'token'.repeat(50),
   authoritativeConsumed:{valid:true,consumed:true},
   ownerProof:{owner_identity_verified:true}
  }),/trusted_root_host_required/);
 }
 assert.match(src,/Owner\.proofVerifiedInCurrentProcess\(ownerProof\)/);
 assert.match(src,/authoritativeConsumed\.consumed===true/);
 assert.match(src,/Identity\.createLiveBoundProvider\(requestId,\(\)=>sealedToken\)/);
 assert.match(src,/identity\.reserveNativeLevel4ReplayFence\(F,j,receipt\)/);
});
test('actual installed worker is pinned, cannot be CLI-run, and only runs after Root/receipt',()=>{
 assert.match(src,/WORKER_SHA='[a-f0-9]{64}'/);
 assert.match(src,/trustedFile\(WORKER,WORKER_SHA,200000\)/);
 assert.match(src,/workerCall\('native_backup'/);
 assert.match(src,/workerCall\('verify_native'/);
 assert.match(src,/workerCall\('native_offsite'/);
 assert.match(worker,/def require_active\(run_id,approval_id\):/);
 assert.match(worker,/DURABLE_LEVEL4_FENCE_MISSING/);
 assert.match(worker,/ROOT_JOURNAL_NOT_PREPARED/);
 assert.match(worker,/NO DIRECT ROOT WORKER CLI/);
 assert.match(worker,/def native_backup\(run_id,approval_id\):/);
 assert.match(worker,/def verify_native\(run_id,approval_id\):/);
 assert.match(worker,/def native_offsite\(run_id,approval_id\):/);
 assert.match(worker,/source_finance_unchanged/);
 assert.match(worker,/remote_independent_69_table_restore/);
});
test('offsite and financial parity require true independent 69/49 restore, private Restic',()=>{
 for(const v of [
  'finance_transactions','finance_wallet','reserve','reserve_item',
  'iticket_reservation','finance_offline_pay',
  'SELECT COUNT(*)','mariadb-check','--network=none',
  'full_restic_restore','restic_snapshot_id','sftp.command=',
  'RESTIC_PASSWORD_FILE','SHA_DRIFT'
 ]){
  assert.ok(worker.includes(v),v);
 }
 assert.ok(!worker.includes('--privileged'));
 assert.ok(!worker.includes('docker exec prhm-mariadb'));
 assert.ok(!worker.includes('sh -c '+String.fromCharCode(34)+'DROP DATABASE'));
 assert.ok(!worker.includes('DROP DATABASE honartik_db'));
 assert.ok(!worker.includes('FLUSH PRIVILEGES'));
});
test('rollback is fail-closed, not destructive to an unowned user or remote snapshot',()=>{
 assert.match(src,/identity\.rollbackOnlyThisTransaction\(F,j\)/);
 assert.match(src,/lease\.verifyAndRecordRollback\(\)/);
 assert.match(src,/lease\.verifyAndRecordCommit\(/);
 assert.match(src,/appFingerprint\(\)===initialApp/);
 assert.match(src,/node1\.full_finance_parity===true/);
 assert.match(src,/native_node1_evidence_invalid/);
 assert.ok(!src.includes('DROP USER'));
 assert.ok(!worker.includes('restic forget'));
 assert.ok(!worker.includes('restic prune'));
});
