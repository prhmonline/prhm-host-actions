'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const Lease=require('./honartik-u06-native-root-lease-v1.cjs');
const create=()=>{
 const root=fs.mkdtempSync('/tmp/u06-root-lease-test-');
 fs.chmodSync(root,0o700);
 const profile=path.join(root,'profile.json');
 const adapter=path.join(root,'database.py');
 const credential=path.join(root,'mysql.cnf');
 fs.writeFileSync(profile,'{"backup":{"offsite_required":false}}\n',{mode:0o600});
 fs.writeFileSync(adapter,'# fixture adapter\n',{mode:0o600});
 return {root,profile,adapter,credential};
};
const open=files=>Lease.createDisposableFixtureLease(files.root,files.profile,files.adapter,files.credential);
const remove=files=>fs.rmSync(files.root,{recursive:true,force:true});
test('real exclusive O_EXCL lock, fsync journal and verified rollback',()=>{
 const f=create();
 try{
  const a=open(f);
  assert.equal(a.acquire().durable,true);
  assert.equal(a.prepareJournal().state,'PREPARED');
  assert.throws(()=>a.release(),/unresolved_journal_lock_retained/);
  assert.throws(()=>open(f).acquire(),/prior_journal_requires_trusted_recovery/);
  assert.equal(a.verifyAndRecordRollback().rolled_back,true);
  assert.equal(a.inspect().journal_state,'ROLLED_BACK');
  assert.equal(a.release().released,true);
  assert.equal(a.inspect().lease_present,false);
 }finally{remove(f)}
});
test('SIGKILL after real fsynced journal preserves exclusive lease across process death',()=>{
 const f=create();
 try{
  const child=String.raw`const m=require('./honartik-u06-native-root-lease-v1.cjs');
const l=m.createDisposableFixtureLease(process.argv[1],process.argv[2],process.argv[3],process.argv[4]);
l.acquire();l.prepareJournal();process.kill(process.pid,'SIGKILL');`;
  const p=cp.spawnSync(process.execPath,['-e',child,f.root,f.profile,f.adapter,f.credential],
   {cwd:__dirname,timeout:10000});
  assert.equal(p.signal,'SIGKILL');
  const l=open(f),status=l.inspect();
  assert.equal(status.lease_present,true);
  assert.equal(status.journal_state,'PREPARED');
  assert.equal(status.recovery_required,true);
  assert.throws(()=>l.acquire(),/prior_journal_requires_trusted_recovery/);
  assert.throws(()=>l.release(),/not_lease_owner/);
 }finally{remove(f)}
});
test('profile drift or unexpected credential preserves journal and stops rollback',()=>{
 const f=create();
 try{
  const a=open(f);a.acquire();a.prepareJournal();
  fs.writeFileSync(f.profile,'{"backup":{"offsite_required":true}}\n');
  assert.throws(()=>a.verifyAndRecordRollback(),/profile_not_rolled_back/);
  assert.throws(()=>a.release(),/unresolved_journal_lock_retained/);
  assert.equal(a.inspect().recovery_required,true);
 }finally{remove(f)}
});
test('symlink preimage and credential creation are rejected',()=>{
 const f=create();
 try{
  const a=open(f);a.acquire();
  fs.unlinkSync(f.adapter);fs.symlinkSync(f.profile,f.adapter);
  assert.throws(()=>a.prepareJournal(),/file_untrusted/);
  assert.equal(a.inspect().lease_present,true);
 }finally{remove(f)}
});
test('fixture refuses root and production scope, never registers action',()=>{
 assert.equal(Lease.ROOT_ACTION_REGISTERED,false);
 assert.equal(Lease.PRODUCTION_BACKUP_IMPLEMENTED,false);
 assert.equal(Lease.COMMIT_IMPLEMENTED,false);
 assert.equal(Lease.MYSQL_ACCESS_EXPORTED,false);
 assert.equal(Lease.install,undefined);
 assert.equal(Lease.run,undefined);
});
