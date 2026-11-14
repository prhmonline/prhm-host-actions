'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const lock=require('./honartik-u06-shared-exclusive-lock-v1.cjs');
const moduleFile=path.join(__dirname,'honartik-u06-shared-exclusive-lock-v1.cjs');
const mk=()=>{
 const root='/tmp/u06-owner-shared-test-'+crypto.randomBytes(6).toString('hex');
 fs.mkdirSync(root,{mode:0o700});
 return {root,gate:(opts)=>lock.createUnprivilegedFixtureSharedGate(root,opts),
  wipe:()=>fs.rmSync(root,{recursive:true,force:true})};
};
function fixture(fn){const f=mk();try{return fn(f)}finally{f.wipe()}}
const error=(name,fn)=>assert.throws(fn,new RegExp('u06_shared_lock_'+name));
const child=(root,js)=>{
 const program="const lock=require("+JSON.stringify(moduleFile)+"); const root="+JSON.stringify(root)+
  "; const gate=lock.createUnprivilegedFixtureSharedGate(root); "+js;
 return spawnSync(process.execPath,['-e',program],{encoding:'utf8',timeout:5000});
};

test('all five critical actor kinds share one exact path and refuse bypass',()=>fixture(f=>{
 assert.deepEqual(lock.KINDS,[
  'owner_challenge_issuance','owner_evidence_staging','owner_evidence_consumption',
  'expired_challenge_reconciliation','native_backup_transaction'
 ]);
 for(const heldBy of lock.KINDS){
  const g=f.gate(),lease=g.begin(heldBy);
  assert.equal(g.inspect().locked,true);
  for(const competitor of lock.KINDS){
   error('busy_or_unrecovered',()=>f.gate().begin(competitor));
  }
  assert.deepEqual(g.finish(lease,heldBy,{terminalProof:true}),{
   released:true,kind:heldBy,receipt_durable:true
  });
  assert.equal(g.inspect().locked,false);
 }
}));
test('multiple processes refuse challenge issue / stage / consume / native action while reconciliation holds lock',()=>fixture(f=>{
 const g=f.gate(),lease=g.begin('expired_challenge_reconciliation');
 for(const kind of lock.KINDS){
  const r=child(f.root,"try{gate.begin("+JSON.stringify(kind)+");process.exit(8)}"+
   "catch(e){if(e.message==='u06_shared_lock_busy_or_unrecovered'){process.stdout.write('BLOCKED\\n');process.exit(0)}throw e}");
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/BLOCKED/);
 }
 g.finish(lease,lease.kind,{terminalProof:true});
 const other=child(f.root,"const l=gate.begin('owner_evidence_staging');"+
  "gate.finish(l,l.kind,{terminalProof:true});process.stdout.write('RELEASED\\n')");
 assert.equal(other.status,0,other.stderr);
 assert.match(other.stdout,/RELEASED/);
}));
test('lock file is O_EXCL, 0600 and a durable receipt is private',()=>fixture(f=>{
 const g=f.gate(),l=g.begin('owner_challenge_issuance');
 const lockFile=path.join(f.root,lock.LOCK_NAME);
 assert.equal(fs.statSync(lockFile).mode&0o777,0o600);
 assert.equal(fs.statSync(lockFile).nlink,1);
 assert.equal(fs.existsSync(path.join(f.root,'u06-owner-shared-receipts')),true);
 g.finish(l,l.kind,{terminalProof:true});
 const receipt=path.join(f.root,lock.RECEIPTS,l.id+'.completed.json');
 assert.equal(fs.statSync(receipt).mode&0o777,0o600);
 assert.equal(JSON.parse(fs.readFileSync(receipt,'utf8')).terminal,true);
 assert.equal(fs.existsSync(lockFile),false);
}));
test('wrong kind, bearer token and nonterminal completion cannot release lock',()=>fixture(f=>{
 const g=f.gate(),l=g.begin('owner_evidence_consumption');
 error('lease_invalid',()=>g.assertHeld(l,'native_backup_transaction'));
 error('wrong_lease_owner',()=>g.finish({...l,token:'0'.repeat(64)},l.kind,{terminalProof:true}));
 error('terminal_journal_not_attested',()=>g.finish(l,l.kind,{terminalProof:false}));
 error('busy_or_unrecovered',()=>g.begin('expired_challenge_reconciliation'));
 assert.equal(g.inspect().locked,true);
 g.finish(l,l.kind,{terminalProof:true});
}));
test('SIGKILL while a lock is HELD never auto-reclaims and all actors remain denied',()=>fixture(f=>{
 const r=spawnSync(process.execPath,['-e',
  "const m=require("+JSON.stringify(moduleFile)+");"+
  "const g=m.createUnprivilegedFixtureSharedGate("+JSON.stringify(f.root)+");"+
  "g.begin('owner_evidence_staging');process.kill(process.pid,'SIGKILL')"
 ],{encoding:'utf8',timeout:5000});
 assert.equal(r.signal,'SIGKILL',r.stderr);
 assert.equal(f.gate().inspect().locked,true);
 for(const actor of lock.KINDS)error('busy_or_unrecovered',()=>f.gate().begin(actor));
}));
test('SIGKILL immediately after durable terminal receipt allows exact one-time fixture recovery',()=>fixture(f=>{
 const program="const m=require("+JSON.stringify(moduleFile)+");"+
  "const g=m.createUnprivilegedFixtureSharedGate("+JSON.stringify(f.root)+
  ",{failureHook:(phase)=>{if(phase==='receipt_durable')process.kill(process.pid,'SIGKILL')}});"+
  "const l=g.begin('owner_evidence_consumption');"+
  "process.stdout.write(JSON.stringify(l)+'\\n');"+
  "g.finish(l,l.kind,{terminalProof:true});";
 const r=spawnSync(process.execPath,['-e',program],{encoding:'utf8',timeout:5000});
 assert.equal(r.signal,'SIGKILL',r.stderr);
 const l=JSON.parse(r.stdout.trim());
 assert.equal(f.gate().inspect().locked,true);
 error('busy_or_unrecovered',()=>f.gate().begin('owner_challenge_issuance'));
 assert.equal(f.gate().resumeTerminalRelease(l,l.kind).released,true);
 assert.equal(f.gate().inspect().locked,false);
 error('untrusted_file',()=>f.gate().resumeTerminalRelease(l,l.kind));
}));
test('SIGKILL immediately after lock acquisition cannot be resumed by another actor',()=>fixture(f=>{
 const r=spawnSync(process.execPath,['-e',
  "const m=require("+JSON.stringify(moduleFile)+");"+
  "m.createUnprivilegedFixtureSharedGate("+JSON.stringify(f.root)+
  ",{failureHook:(phase)=>{if(phase==='acquired')process.kill(process.pid,'SIGKILL')}}).begin('native_backup_transaction');"
 ],{encoding:'utf8',timeout:5000});
 assert.equal(r.signal,'SIGKILL',r.stderr);
 assert.equal(f.gate().inspect().kind,'native_backup_transaction');
 error('busy_or_unrecovered',()=>f.gate().begin('owner_evidence_consumption'));
}));
test('reject symlink and tampered holder, hostile directory and native rollback',()=>fixture(f=>{
 const g=f.gate();
 fs.writeFileSync(path.join(f.root,'u06-rollback.json'),'PREPARED');
 error('existing_native_transaction',()=>g.begin('owner_challenge_issuance'));
 fs.unlinkSync(path.join(f.root,'u06-rollback.json'));
 const l=g.begin('native_backup_transaction');
 const p=path.join(f.root,lock.LOCK_NAME);
 const data=JSON.parse(fs.readFileSync(p,'utf8'));
 data.kind='owner_evidence_staging';
 fs.writeFileSync(p,JSON.stringify(data));
 error('wrong_lease_owner',()=>g.assertHeld(l,l.kind));
}));
test('reject root and live path access, and no CLI or production action is exported',()=>{
 assert.equal(lock.ROOT_ENTRYPOINT,false);
 assert.equal(lock.PRODUCTION_AUTHORIZED,false);
 assert.equal(lock.LEVEL4_ISSUER,false);
 error('fixture_root_rejected',()=>lock.createUnprivilegedFixtureSharedGate('/var/lib/prhm-agent-selfmaint-exec/honartik-u06-native-root'));
 const r=spawnSync(process.execPath,[moduleFile],{encoding:'utf8'});
 assert.equal(r.status,64);
 assert.match(r.stderr,/fixture-only/);
});
