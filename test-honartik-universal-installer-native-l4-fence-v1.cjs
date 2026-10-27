'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const m=require('./honartik-universal-installer-native-l4-fence-v1.cjs');
const valid=()=>({
 ok:true,action:m.ACTION,
 request_id:'11111111-2222-4333-8444-555555555555',
 approval_id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
 policy_sha256:'a'.repeat(64),arguments_sha256:'b'.repeat(64),
 signature_verified:true,consumed_ledger_verified:true,
 execution_fence_reserved:false,installer_upgraded:false
});
function fixture(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),
   'prhm-honartik217-fence-fixture-'));
 fs.chmodSync(dir,0o700);
 try{return fn(dir)}finally{fs.rmSync(dir,{recursive:true,force:true})}
}
test('immutable exact operation and disabled live registration',()=>{
 assert.equal(m.ACTION,'honartik_universal_installer_upgrade_v1');
 assert.equal(m.REAL_ROOT_REGISTRATION,false);
 assert.equal(m.INSTALLER_APPLY_PRESENT,false);
});
test('first reservation durable and file-private; second replay denied',()=>{
 fixture(dir=>{
  const p=valid();
  const got=m.reserveIsolatedFixtureFence(dir,p);
  assert.equal(got.durable_one_time_fence,true);
  assert.equal(got.installer_upgraded,false);
  const file=path.join(dir,p.approval_id+'.json');
  assert.equal(fs.statSync(file).mode&0o777,0o600);
  const obj=JSON.parse(fs.readFileSync(file));
  assert.equal(obj.action,m.ACTION);
  assert.equal(obj.state,'reserved_no_replay');
  assert.throws(()=>m.reserveIsolatedFixtureFence(dir,p),
    /approval_replayed/);
  assert.equal(fs.readdirSync(dir).length,1);
 });
});
test('invalid signature proof is denied without file write',()=>{
 fixture(dir=>{
  const p=valid();p.signature_verified=false;
  assert.throws(()=>m.reserveIsolatedFixtureFence(dir,p),
    /approval_proof_untrusted/);
  assert.deepEqual(fs.readdirSync(dir),[]);
 });
});
test('unconsumed ledger is denied',()=>{
 fixture(dir=>{
  const p=valid();p.consumed_ledger_verified=false;
  assert.throws(()=>m.reserveIsolatedFixtureFence(dir,p),
    /approval_proof_untrusted/);
 });
});
test('unexpected action identity is denied',()=>{
 fixture(dir=>{
  const p=valid();p.action='anything_else';
  assert.throws(()=>m.reserveIsolatedFixtureFence(dir,p),
    /approval_proof_untrusted/);
 });
});
test('invalid approval ID cannot escape fence dir',()=>{
 fixture(dir=>{
  const p=valid();p.approval_id='../../../etc/passwd';
  assert.throws(()=>m.reserveIsolatedFixtureFence(dir,p),
    /approval_proof_untrusted/);
 });
});
test('world-writable private fence directory is denied',()=>{
 fixture(dir=>{
  fs.chmodSync(dir,0o777);
  assert.throws(()=>m.reserveIsolatedFixtureFence(dir,valid()),
    /fence_directory_untrusted/);
 });
});
test('symlink fixture path is denied',()=>{
 fixture(dir=>{
  const alt=dir+'-link';
  fs.symlinkSync(dir,alt);
  try{
    assert.throws(()=>m.reserveIsolatedFixtureFence(alt,valid()),
      /fence_directory_untrusted/);
  }finally{fs.unlinkSync(alt)}
 });
});
test('fixture cannot create under arbitrary home path',()=>{
 assert.throws(()=>m.reserveIsolatedFixtureFence('/home/user/mydata',valid()),
   /fixture_path_denied/);
});
test('production native fence rejects nonroot invocation',()=>{
 if(typeof process.getuid==='function'&&process.getuid()!==0){
  assert.throws(()=>m.reserveFixedApprovalFence(valid().request_id,()=>{}),
    /root_required/);
 }
});
