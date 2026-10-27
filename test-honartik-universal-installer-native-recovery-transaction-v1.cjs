'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {readTree}=require('./honartik-universal-installer-native-fs-v1.cjs');
const tx=require('./honartik-universal-installer-native-recovery-transaction-v1.cjs');
function fixture(callback){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'prhm-honartik217-recovery-fixture-'));
 fs.chmodSync(root,0o700);
 try{
  const versions=path.join(root,'versions');
  fs.mkdirSync(versions, {mode:0o700});
  function make(s){
   const dir=path.join(root,'.build-'+s);
   fs.mkdirSync(path.join(dir,'universal'),{recursive:true,mode:0o700});
   fs.writeFileSync(path.join(dir,'universal','cli.py'),'print('+JSON.stringify(s)+')\n');
   const hash=readTree(dir).digest;
   fs.renameSync(dir,path.join(versions,hash));
   return hash;
  }
  const old=make('old'),next=make('next');
  fs.symlinkSync(path.join(versions,old),path.join(root,'current'));
  const manifest=Buffer.from(JSON.stringify({digest:old,previous:null,entrypoint:'fixture-only'}));
  const wrapper=Buffer.from('#!/bin/sh\n# original-wrapper\n');
  fs.writeFileSync(path.join(root,'installation.json'),manifest);
  fs.writeFileSync(path.join(root,'deploy-project'),wrapper);
  return callback({root,old,next,manifest,wrapper});
 }finally{fs.rmSync(root,{recursive:true,force:true})}
}
test('no production entrypoint and no request/token arguments',()=>{
 assert.equal(tx.PRODUCTION_EXECUTION_AUTHORIZED,false);
 assert.deepEqual(Object.keys(tx).sort(),[
  'beginFixture','applyFixture','finishFixture','recoverFixture',
  'snapshot','PRODUCTION_EXECUTION_AUTHORIZED'].sort());
});
for(const step of ['after_pointer','after_manifest','after_wrapper']){
 test('interrupted '+step+' restores exact pointer manifest wrapper',()=>{
  fixture(({root,old,next,manifest,wrapper})=>{
   tx.beginFixture(root,next);
   assert.throws(()=>tx.applyFixture(root,step),/INJECTED_/);
   const recovered=tx.recoverFixture(root);
   assert.equal(recovered.rolled_back,true);
   assert.equal(recovered.exact_bytes_restored,true);
   assert.equal(recovered.digest,old);
   assert.equal(fs.realpathSync(path.join(root,'current')),
    path.join(root,'versions',old));
   assert.deepEqual(fs.readFileSync(path.join(root,'installation.json')),manifest);
   assert.deepEqual(fs.readFileSync(path.join(root,'deploy-project')),wrapper);
   assert.equal(fs.statSync(path.join(root,'installation.json')).mode&0o777,0o644);
   assert.equal(fs.statSync(path.join(root,'deploy-project')).mode&0o777,0o644);
   assert.equal(fs.existsSync(path.join(root,'install-transaction.lock')),false);
   assert.match(fs.readFileSync(path.join(root,'install-transaction.journal'),'utf8'),/ROLLED_BACK/);
   assert.throws(()=>tx.beginFixture(root,next),/old_journal_requires_reconciliation/);
  });
 });
}
test('fully switched fixture commits after postimage verification',()=>{
 fixture(({root,old,next})=>{
  tx.beginFixture(root,next);
  assert.equal(tx.applyFixture(root).switched,true);
  const committed=tx.finishFixture(root);
  assert.equal(committed.committed,true);
  assert.equal(committed.installed_digest,next);
  assert.equal(tx.snapshot(root).digest,next);
  assert.equal(fs.existsSync(path.join(root,'install-transaction.lock')),false);
  assert.match(fs.readFileSync(path.join(root,'install-transaction.journal'),'utf8'),/COMMITTED/);
  assert.throws(()=>tx.recoverFixture(root),/journal_untrusted/);
 });
});
test('interrupted journal creation does not permit another begin',()=>{
 fixture(({root,next})=>{
  tx.beginFixture(root,next);
  assert.throws(()=>tx.beginFixture(root,next),/old_journal_requires_reconciliation/);
  assert.equal(fs.existsSync(path.join(root,'install-transaction.lock')),true);
 });
});
test('changed old bundle prevents rollback and retains recovery lock',()=>{
 fixture(({root,old,next})=>{
  tx.beginFixture(root,next);
  assert.throws(()=>tx.applyFixture(root,'after_pointer'),/INJECTED_/);
  fs.writeFileSync(path.join(root,'versions',old,'universal','cli.py'),'tampered\n');
  assert.throws(()=>tx.recoverFixture(root),/old_bundle_modified/);
  assert.equal(fs.existsSync(path.join(root,'install-transaction.lock')),true);
 });
});
test('a third-party pointer prevents rollback and holds lock',()=>{
 fixture(({root,old,next})=>{
  tx.beginFixture(root,next);
  assert.throws(()=>tx.applyFixture(root,'after_pointer'),/INJECTED_/);
  const third=crypto.randomBytes(32).toString('hex');
  const dir=path.join(root,'versions',third);
  fs.mkdirSync(dir);
  const ptr=path.join(root,'current');
  fs.unlinkSync(ptr);fs.symlinkSync(dir,ptr);
  assert.throws(()=>tx.recoverFixture(root),/third_party_pointer/);
  assert.equal(fs.existsSync(path.join(root,'install-transaction.lock')),true);
 });
});
test('no arbitrary path outside isolated tmp fixtures',()=>{
 assert.throws(()=>tx.snapshot('/usr/local/libexec/deploy-control/universal'),
   /fixture_path_denied/);
});
test('running as root cannot invoke fixture methods',()=>{
 // Non-root sandbox is required. When running test as root, this test only
 // verifies the explicit root-deny path rather than simulating privilege.
 if(process.getuid?.()===0){
  assert.throws(()=>tx.snapshot('/tmp/prhm-honartik217-recovery-fixture-notreal'),
    /nonroot_only/);
 }
});

for(const [stage,exitStatus] of [
 ['crash_after_pointer',87],['crash_after_manifest',88],
 ['crash_after_wrapper',89]
]){
 test('hard process exit '+stage+' recovers exactly on next invocation',()=>{
  fixture(({root,old,next,manifest,wrapper})=>{
   tx.beginFixture(root,next);
   const child=require('node:child_process').spawnSync(process.execPath,[
    '-e','require(process.argv[1]).applyFixture(process.argv[2],process.argv[3])',
    require.resolve('./honartik-universal-installer-native-recovery-transaction-v1.cjs'),
    root,stage],{timeout:10000,encoding:'utf8'});
   assert.equal(child.status,exitStatus,child.stderr);
   const result=tx.recoverFixture(root);
   assert.equal(result.rolled_back,true);
   assert.deepEqual(fs.readFileSync(path.join(root,'installation.json')),manifest);
   assert.deepEqual(fs.readFileSync(path.join(root,'deploy-project')),wrapper);
   assert.equal(tx.snapshot(root).digest,old);
   assert.equal(fs.existsSync(path.join(root,'install-transaction.lock')),false);
  });
 });
}
test('altered wrapper fails commit and keeps lock',()=>{
 fixture(({root,next})=>{
  tx.beginFixture(root,next);
  tx.applyFixture(root);
  fs.writeFileSync(path.join(root,'deploy-project'), 'unauthorized-wrapper\n');
  assert.throws(()=>tx.finishFixture(root),/postimage_wrapper_mismatch/);
  assert.equal(fs.existsSync(path.join(root,'install-transaction.lock')),true);
  assert.equal(tx.recoverFixture(root).rolled_back,true);
 });
});
