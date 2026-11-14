'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const mod=require('./honartik-u06-expired-owner-challenge-reconcile-v1.cjs');
const now=1_800_000_000_000;
const nonce='a'.repeat(64);
const sha=buf=>crypto.createHash('sha256').update(buf).digest('hex');
const mk=()=>{
  const root='/tmp/u06-owner-reconcile-test-'+crypto.randomBytes(6).toString('hex');
  fs.mkdirSync(root,{mode:0o700});
  for(const d of ['owner-oidc','consumed'])fs.mkdirSync(path.join(root,d),{mode:0o700});
  const key=crypto.generateKeyPairSync('x25519');
  const challenge={schema:'prhm.u06.root-owner-identity-challenge.v1',
    challenge:nonce,expectedRunSha:'b'.repeat(40),
    issued_at_ms:now-3_600_000-480_000,expires_at_ms:now-3_600_000,
    workflow_ref:mod.LIVE.workflowRef,
    public_key_spki_b64:key.publicKey.export({format:'der',type:'spki'}).toString('base64')};
  const p=name=>path.join(root,'owner-oidc',name);
  const put=(name,data)=>{fs.writeFileSync(p(name),data,{mode:0o600});};
  put('challenge.json',JSON.stringify(challenge)+'\n');
  put('host-private.pem',key.privateKey.export({format:'pem',type:'pkcs8'}));
  return {root,p,put,challenge,cleanup:()=>fs.rmSync(root,{recursive:true,force:true}),
    engine:(hooks={})=>mod.createDisposableFixtureReconciler(root,{clock:()=>now,...hooks})};
};
function withFixture(fn){const f=mk();try{return fn(f)}finally{f.cleanup()}}
function error(pattern,fn){assert.throws(fn,new RegExp('u06_expired_oidc_reconcile_'+pattern))}

test('refuses execution as root, rejects live path and exports no live Root action',()=>{
  assert.equal(mod.LIVE_RECONCILIATION_EXPORTED,false);
  assert.equal(mod.ROOT_HANDLER_REGISTERED,false);
  assert.equal(mod.LEVEL4_ISSUER,false);
  assert.equal(mod.PRODUCTION_MUTATION_AUTHORIZED,false);
  error('fixture_path_rejected',()=>mod.createDisposableFixtureReconciler(mod.LIVE.directory));
});
test('isolated expired/unused challenge becomes a durable, redacted tombstone, with key retired',()=>withFixture(f=>{
  const info=f.engine().inspect();
  assert.equal(info.challenge_sha256,sha(Buffer.from(nonce)));
  assert.equal(info.expires_at_ms,now-3_600_000);
  assert.doesNotMatch(JSON.stringify(info),/BEGIN PRIVATE KEY/);
  const res=f.engine().start();
  assert.equal(res.status,'RECONCILED');
  assert.equal(res.production_mutated,false);
  assert.equal(res.owner_oidc_verified,false);
  const archived=path.join(f.root,'owner-oidc','abandoned',info.challenge_sha256);
  assert.equal(fs.existsSync(f.p('host-private.pem')),false);
  assert.equal(fs.existsSync(f.p('challenge.json')),false);
  assert.equal(fs.existsSync(f.p('reconciliation.journal.json')),false);
  assert.equal(fs.existsSync(path.join(archived,'host-private.pem')),false);
  const receipt=JSON.parse(fs.readFileSync(path.join(archived,'reconciled.json'),'utf8'));
  assert.equal(receipt.state,'RECONCILED');
  assert.equal(receipt.private_key_retired,true);
  assert.equal(receipt.level4_issued,false);
  assert.equal(fs.statSync(path.join(archived,'reconciled.json')).mode&0o777,0o600);
  assert.throws(()=>f.engine().inspect(),{code:'ENOENT'});
}));
test('never retires a live, not-yet-expired or too-recently-expired challenge',()=>withFixture(f=>{
  f.challenge.expires_at_ms=now-10_000; f.challenge.issued_at_ms=now-490_000;
  f.put('challenge.json',JSON.stringify(f.challenge));
  error('challenge_not_expired_or_scope_drift',()=>f.engine().start());
  assert.equal(fs.existsSync(f.p('host-private.pem')),true);
}));
test('rejects consumed identity, native lease, rollback journal or encrypted evidence',()=>{
  for(const [name,setup,expect] of [
    ['consumed', f=>fs.writeFileSync(path.join(f.root,'consumed', 'c'.repeat(64)+'.'+sha(nonce)+'.used'), 'consumed'), 'already_consumed'],
    ['lease', f=>fs.writeFileSync(path.join(f.root,'u06-exclusive.lease'),'active'), 'native_transaction_or_recovery_active'],
    ['journal', f=>fs.writeFileSync(path.join(f.root,'u06-rollback.json'),'PREPARED'), 'native_transaction_or_recovery_active'],
    ['envelope', f=>f.put('encrypted-gh-evidence.json','{}'), 'encrypted_evidence_requires_independent_review']
  ]) withFixture(f=>{setup(f);error(expect,()=>f.engine().start());
    assert.equal(fs.existsSync(f.p('host-private.pem')),true,name)});
});
test('rejects symlink/hardlink, wrong mode, mismatched X25519 and unexpected workflow ref',()=>{
  withFixture(f=>{fs.chmodSync(f.p('challenge.json'),0o644);
    error('file_untrusted',()=>f.engine().inspect());});
  withFixture(f=>{const privatePath=f.p('host-private.pem');fs.unlinkSync(privatePath);
    fs.symlinkSync('/etc/passwd',privatePath);error('file_untrusted',()=>f.engine().start());});
  withFixture(f=>{fs.linkSync(f.p('challenge.json'),f.p('duplicated-hardlink'));
    error('file_untrusted',()=>f.engine().start());});
  withFixture(f=>{f.put('host-private.pem',crypto.generateKeyPairSync('x25519').privateKey.export({format:'pem',type:'pkcs8'}));
    error('private_key_mismatched',()=>f.engine().start());});
  withFixture(f=>{f.challenge.workflow_ref='untrusted/workflow';f.put('challenge.json',JSON.stringify(f.challenge));
    error('challenge_not_expired_or_scope_drift',()=>f.engine().start());});
});
test('durable PREPARED journal forces explicit resume after a crash at every step',()=>{
  const steps=['journal_prepared','challenge_archived','private_archived',
    'retirement_intent_durable','private_retired','receipt_committed'];
  for(const step of steps)withFixture(f=>{
    error('simulation_'+step,()=>f.engine({failureHook:s=>{if(s===step)throw Error('u06_expired_oidc_reconcile_simulation_'+step)}}).start());
    assert.equal(fs.existsSync(f.p('reconciliation.journal.json')),true,step);
    error('pending_journal_requires_resume',()=>f.engine().start());
    const r=f.engine().resume();assert.equal(r.status,'RECONCILED',step);
    assert.equal(fs.existsSync(f.p('reconciliation.journal.json')),false,step);
    assert.equal(fs.existsSync(f.p('host-private.pem')),false,step);
  });
});
test('actual SIGKILL after durable key retirement recovers from disk without reusing key',()=>withFixture(f=>{
  const expression="const m=require("+JSON.stringify(path.join(__dirname,'honartik-u06-expired-owner-challenge-reconcile-v1.cjs'))+");m.createDisposableFixtureReconciler("+JSON.stringify(f.root)+",{clock:()=>"+now+",failureHook:s=>{if(s==='private_retired')process.kill(process.pid,'SIGKILL')}}).start()";
  const child=spawnSync(process.execPath,['-e',expression],{encoding:'utf8',timeout:5000});
  assert.equal(child.signal,'SIGKILL');
  const r=f.engine().resume();
  assert.equal(r.status,'RECONCILED');
  assert.equal(fs.existsSync(f.p('host-private.pem')),false);
}));
test('fails closed if pending journal or archived metadata are corrupted',()=>withFixture(f=>{
  error('simulation_journal_prepared',()=>f.engine({failureHook:s=>{if(s==='journal_prepared')throw Error('u06_expired_oidc_reconcile_simulation_journal_prepared')}}).start());
  const p=f.p('reconciliation.journal.json');
  let j=JSON.parse(fs.readFileSync(p));j.challenge_file_sha256='d'.repeat(64);
  fs.writeFileSync(p,JSON.stringify(j));
  error('file_sha_drift_challenge.json',()=>f.engine().resume());
  assert.equal(fs.existsSync(f.p('host-private.pem')),true);
}));
test('does not provide any direct-CLI privilege or L4 approval',()=>{
  const child=spawnSync(process.execPath,[path.join(__dirname,'honartik-u06-expired-owner-challenge-reconcile-v1.cjs')],{encoding:'utf8'});
  assert.equal(child.status,64);
  assert.match(child.stderr,/source-only/);
});
