'use strict';
// Issue #217: Linux-only source rehearsal on disposable nonprivileged fixtures.
// No server-side registration, signing, root commands, or production deployment.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const native=require('./honartik-universal-installer-native-fs-v1.cjs');

function setup(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'prhm-honartik217-native-fixture-'));
  fs.chmodSync(root,0o700);
  function source(which,body){
    const dir=path.join(root,'fixture-source-'+which);
    fs.mkdirSync(path.join(dir,'universal'),{recursive:true,mode:0o700});
    fs.writeFileSync(path.join(dir,'universal','cli.py'),body,{mode:0o600});
    fs.writeFileSync(path.join(dir,'universal','__init__.py'),'VERSION = 1\n',{mode:0o600});
    return dir;
  }
  const previous=source('previous','print(1)\n');
  const candidate=source('candidate','print(2)\n');
  const ids=native.initFixture(root,previous,candidate);
  return {root,...ids,dispose:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('real-filesystem SHA digest verifies the initial version',()=>{
  const x=setup();
  try{
    assert.match(x.old_digest,/^[a-f0-9]{64}$/);
    assert.match(x.candidate_digest,/^[a-f0-9]{64}$/);
    assert.notEqual(x.old_digest,x.candidate_digest);
    assert.equal(native.record(x.root).digest,x.old_digest);
  }finally{x.dispose()}
});
test('fixture switch then rollback restores exact manifest and release pointer',()=>{
  const x=setup();
  try{
    const original=fs.readFileSync(path.join(x.root,'installation.json'));
    native.begin(x.root,x.candidate_digest);
    const switched=native.switchFixture(x.root,x.candidate_digest);
    assert.equal(switched.state,'SWITCHED');
    assert.equal(native.record(x.root).digest,x.candidate_digest);
    const restored=native.recoverFixture(x.root);
    assert.equal(restored.state,'ROLLED_BACK');
    assert.equal(native.record(x.root).digest,x.old_digest);
    assert.deepEqual(fs.readFileSync(path.join(x.root,'installation.json')),original);
  }finally{x.dispose()}
});
test('interrupted transaction after durable journal but before pointer change recovers',()=>{
  const x=setup();
  try{
    native.begin(x.root,x.candidate_digest);
    assert.equal(native.recoverFixture(x.root).state,'ROLLED_BACK');
    assert.equal(native.record(x.root).digest,x.old_digest);
  }finally{x.dispose()}
});
for(const scenario of [{name:'pointer',stage:'after_pointer',code:87},{name:'manifest',stage:'after_manifest',code:88}]){
  test('Linux subprocess crashes after '+scenario.name+' change; durable journal restores exact preimage',()=>{
    const x=setup();
    try{
      const child=require('node:child_process');
      const exact=fs.readFileSync(path.join(x.root,'installation.json'));
      native.begin(x.root,x.candidate_digest);
      const source='require(process.argv[1]).switchFixture(process.argv[2],process.argv[3],process.argv[4])';
      const result=child.spawnSync(process.execPath,['-e',source,
        path.resolve(__dirname,'honartik-universal-installer-native-fs-v1.cjs'),
        x.root,x.candidate_digest,scenario.stage],{
        encoding:'utf8',timeout:10000
      });
      assert.equal(result.status,scenario.code,result.stderr);
      assert.equal(native.recoverFixture(x.root).state,'ROLLED_BACK');
      assert.equal(native.record(x.root).digest,x.old_digest);
      assert.deepEqual(fs.readFileSync(path.join(x.root,'installation.json')),exact);
      assert.equal(fs.existsSync(path.join(x.root,'upgrade.lock')),false);
    }finally{x.dispose()}
  });
}
test('concurrent transaction is rejected by exclusive lock',()=>{
  const x=setup();
  try{
    native.begin(x.root,x.candidate_digest);
    assert.throws(()=>native.begin(x.root,x.candidate_digest),/exclusive_lock_busy/);
    assert.equal(native.record(x.root).digest,x.old_digest);
    native.recoverFixture(x.root);
  }finally{x.dispose()}
});
test('candidate content drift is rejected before journal creation',()=>{
  const x=setup();
  try{
    fs.appendFileSync(path.join(x.root,'versions',x.candidate_digest,'universal','cli.py'),'changed');
    assert.throws(()=>native.begin(x.root,x.candidate_digest),/candidate_content_drift/);
    assert.equal(fs.existsSync(path.join(x.root,'upgrade.journal')),false);
  }finally{x.dispose()}
});
test('original source drift prevents rollback and retains recovery lock',()=>{
  const x=setup();
  try{
    native.begin(x.root,x.candidate_digest);
    fs.appendFileSync(path.join(x.root,'versions',x.old_digest,'universal','cli.py'),'changed');
    assert.throws(()=>native.recoverFixture(x.root),/original_bytes_drift/);
    assert.equal(fs.existsSync(path.join(x.root,'upgrade.lock')),true);
  }finally{x.dispose()}
});
test('untrusted nested fixture root is rejected without touching production',()=>{
  const x=setup();
  try{
    const nested=path.join(x.root,'nested');
    fs.mkdirSync(nested);
    assert.throws(()=>native.fixtureRoot(nested),/fixture_root_denied/);
  }finally{x.dispose()}
});
test('module has no production apply, registration or shell API',()=>{
  assert.equal(native.applyProduction,undefined);
  assert.equal(native.registerHostAction,undefined);
  assert.equal(native.executeCommand,undefined);
});

// Issue #217: a COMMITTED durable marker must never trigger rollback.
test('verified fixture commit survives normal recovery without reverting',()=>{
  const x=setup();
  try{
    native.begin(x.root,x.candidate_digest);
    native.switchFixture(x.root,x.candidate_digest);
    assert.equal(native.commitFixture(x.root).state,'COMMITTED');
    assert.equal(native.recoverFixture(x.root).state,'COMMITTED');
    assert.equal(native.record(x.root).digest,x.candidate_digest);
    assert.equal(fs.existsSync(path.join(x.root,'upgrade.lock')),false);
    assert.equal(fs.existsSync(path.join(x.root,'upgrade.journal')),false);
  }finally{x.dispose()}
});
test('Linux crash after durable COMMITTED marker never rolls back verified candidate',()=>{
  const x=setup();
  try{
    native.begin(x.root,x.candidate_digest);
    native.switchFixture(x.root,x.candidate_digest);
    const child=require('node:child_process');
    const source='require(process.argv[1]).commitFixture(process.argv[2],process.argv[3])';
    const result=child.spawnSync(process.execPath,['-e',source,
      path.resolve(__dirname,'honartik-universal-installer-native-fs-v1.cjs'),
      x.root,'after_commit'],{encoding:'utf8',timeout:10000});
    assert.equal(result.status,89,result.stderr);
    assert.equal(native.recoverFixture(x.root).state,'COMMITTED');
    assert.equal(native.record(x.root).digest,x.candidate_digest);
  }finally{x.dispose()}
});
test('failed journal fsync is indeterminate and retains recovery lock',()=>{
  const x=setup();
  const original=fs.fsyncSync;
  try{
    fs.fsyncSync=()=>{throw Error('injected-fsync-error')};
    assert.throws(()=>native.begin(x.root,x.candidate_digest),/injected-fsync-error/);
  }finally{fs.fsyncSync=original}
  try{
    assert.equal(fs.existsSync(path.join(x.root,'upgrade.lock')),true);
    assert.throws(()=>native.begin(x.root,x.candidate_digest),/exclusive_lock_busy/);
    assert.equal(native.record(x.root).digest,x.old_digest);
  }finally{x.dispose()}
});
test('corrupt committed postimage blocks recovery and retains lock',()=>{
  const x=setup();
  try{
    native.begin(x.root,x.candidate_digest);
    native.switchFixture(x.root,x.candidate_digest);
    native.commitFixture(x.root);
    fs.appendFileSync(path.join(x.root,'versions',x.candidate_digest,'universal','cli.py'),'tamper');
    assert.throws(()=>native.recoverFixture(x.root),/installed_content_drift/);
    assert.equal(fs.existsSync(path.join(x.root,'upgrade.lock')),true);
    assert.equal(fs.existsSync(path.join(x.root,'upgrade.journal')),true);
  }finally{x.dispose()}
});
