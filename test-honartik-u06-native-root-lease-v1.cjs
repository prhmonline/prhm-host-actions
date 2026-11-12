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
test('dangling credential symlink is NOT treated as absent',()=>{
 const f=create();
 try{
  fs.symlinkSync('/nonexistent/u06-credential',f.credential);
  const a=open(f);a.acquire();
  assert.throws(()=>a.prepareJournal(),/credential_preimage_mismatch/);
  assert.equal(a.inspect().lease_present,true);
 }finally{remove(f)}
});
test('fixture refuses root and production scope, never registers action',()=>{
 assert.equal(Lease.ROOT_ACTION_REGISTERED,false);
 assert.equal(Lease.PRODUCTION_BACKUP_IMPLEMENTED,false);
 assert.equal(Lease.COMMIT_IMPLEMENTED,true);
 assert.equal(Lease.MYSQL_ACCESS_EXPORTED,false);
 assert.equal(Lease.install,undefined);
 assert.equal(Lease.run,undefined);
});

test('complete native financial+Node1 receipt yields durable COMMITTED but fake receipt is denied',()=>{
 const f=create();
 try{
  const l=open(f);l.acquire();l.prepareJournal();
  const sha=require('node:crypto').createHash('sha256');
  const original={backup:{offsite_required:true}};
  fs.writeFileSync(f.profile,JSON.stringify(original)+'\n');
  const h=sha.update(fs.readFileSync(f.profile)).digest('hex');
  fs.writeFileSync(f.credential,'[client]\nuser=fixture\npassword=fixture\n',{mode:0o600});
  const att={full_real_native_verified:true,independent_native_node1_verified:true,
    backup_sha256:'d'.repeat(64),post_profile_sha256:h};
  assert.throws(()=>l.verifyAndRecordCommit({...att,independent_native_node1_verified:false}),
    /commit_attestation_incomplete/);
  assert.throws(()=>l.verifyAndRecordCommit({...att,post_profile_sha256:'0'.repeat(64)}),
    /committed_profile_digest_drift/);
  assert.equal(l.journalState(),'PREPARED');
  assert.equal(l.verifyAndRecordCommit(att).committed,true);
  assert.equal(l.journalState(),'COMMITTED');
  assert.equal(l.release().released,true);
  const j=JSON.parse(fs.readFileSync(path.join(f.root,'u06-rollback.json')));
  assert.equal(j.state,'COMMITTED');
  assert.equal(j.native_node1_offsite_verified,true);
 }finally{remove(f)}
});
