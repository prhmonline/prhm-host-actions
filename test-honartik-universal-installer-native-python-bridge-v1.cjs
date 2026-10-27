'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const m=require('./honartik-universal-installer-native-python-bridge-v1.cjs');
const {CONTRACT:C}=require('./honartik-universal-installer-l4-v1.cjs');
test('the bridge exposes no CLI, registration or generic installer executor',()=>{
 assert.equal(m.ROOT_ACTION_REGISTERED,false);
 assert.equal(m.PRODUCTION_INSTALL_AUTHORIZED,false);
 assert.equal(m.INDEPENDENT_SIGNED_LINUX_PROVENANCE_REQUIRED,true);
 assert.equal(m.run,undefined);
 assert.equal(m.cli,undefined);
 assert.equal(m.install,undefined);
 assert.equal(m.installViaFixedTrustedPython.length,3);
});
test('fixed Python bridge calls EXACT installed install_bundle signature',()=>{
 const script=m.fixedPythonCode();
 assert.match(script,/from universal\.install import install_bundle,bundle_digest/);
 assert.ok(script.includes('install_bundle(source,dest,"'+C.candidate_digest+
  '","'+C.existing_digest+'")'));
 assert.ok(script.includes('"'+C.installer_prefix+'"'));
 assert.ok(script.includes('"'+C.installer_prefix+'/versions/'+C.existing_digest+'"'));
 assert.ok(!script.includes('subprocess'));
 assert.ok(!script.includes('os.system'));
 assert.ok(!script.includes('shell=True'));
 assert.ok(!script.includes('eval('));
});
test('only a fixed candidate and immutable active Python are selected',()=>{
 const script=m.fixedPythonCode();
 assert.ok(script.includes('/var/lib/prhm-agent-selfmaint-exec/honartik-universal-installer-l4/candidate-source'));
 assert.ok(script.includes('if bundle_digest(source)!='));
 assert.ok(script.includes('raise RuntimeError("candidate_sha_drift")'));
 assert.equal(script.split('install_bundle(').length,2);
});
test('Linux: unregistered bridge refuses nonroot without calling Python',()=>{
 if(process.getuid?.()!==0){
  assert.throws(()=>m.installViaFixedTrustedPython(
   '11111111-2222-4333-8444-555555555555',
   'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
   ()=>{throw Error('should_not_call');}),/root_required/);
 }
});
test('coordinator bridge only builds a trusted root-owned capability',()=>{
 assert.equal(m.makeFixedCoordinatorPythonTransaction.length,1);
 if(process.getuid?.()!==0){
  assert.throws(()=>m.makeFixedCoordinatorPythonTransaction(()=>{}),
   /root_required/);
 }
 assert.equal(m.ROOT_ACTION_REGISTERED,false);
 assert.equal(m.PRODUCTION_INSTALL_AUTHORIZED,false);
});
test('Python code is unchanged and cannot accept runtime source arguments',()=>{
 assert.equal(m.fixedPythonCode.length,0);
 const a=m.fixedPythonCode(),b=m.fixedPythonCode();
 assert.equal(a,b);
 assert.ok(a.includes('PRHM_FIXED_PYTHON_INSTALL_OK=1'));
});

const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const cp=require('node:child_process');
const canFixture=process.platform==='linux'&&process.getuid?.()!==0;
const receipt=()=>({
 journal_id:'11111111-2222-4333-8444-555555555555',
 request_id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
 approval_id:'eeeeeeee-1111-4111-8111-222222222222',
 state:'PREPARED',old_digest:C.existing_digest,next_digest:C.candidate_digest
});
function isolated(run){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),
  'prhm-honartik217-python-attempt-fixture-'));
 fs.chmodSync(dir,0o700);
 try{return run(dir)}finally{fs.rmSync(dir,{recursive:true,force:true})}
}
test('Linux: fixed one-use execution marker is durable and refuses replay',
 {skip:!canFixture},()=>{
 isolated(dir=>{
  const first=m.reserveIsolatedPythonAttemptFixture(dir,receipt());
  assert.equal(first.attempt_reserved,true);
  assert.equal(first.approval_reusable,false);
  const file=path.join(dir,'python-attempt-started.json');
  const pre=fs.readFileSync(file);
  assert.equal(fs.statSync(file).mode&0o777,0o600);
  const j=JSON.parse(pre);
  assert.equal(j.action,C.action);
  assert.equal(j.request_id,receipt().request_id);
  assert.equal(j.journal_id,receipt().journal_id);
  assert.throws(()=>m.reserveIsolatedPythonAttemptFixture(dir,receipt()),
   /execution_already_attempted_recovery_required/);
  assert.deepEqual(fs.readFileSync(file),pre);
 });
});
test('Linux: invalid approval or journal identity is denied without marker',
 {skip:!canFixture},()=>{
 isolated(dir=>{
  for(const change of [
   {journal_id:'not-a-uuid'},{request_id:''},{approval_id:'wrong'},
   {state:'COMMITTED'},{old_digest:'f'.repeat(64)},
   {next_digest:'f'.repeat(64)}
  ]){
   assert.throws(()=>m.reserveIsolatedPythonAttemptFixture(
    dir,{...receipt(),...change}),/execution_attempt_identity_invalid/);
  }
  assert.deepEqual(fs.readdirSync(dir),[]);
 });
});
test('Linux: durable empty marker after interrupted creation burns attempt',
 {skip:!canFixture},()=>{
 isolated(dir=>{
  const child=cp.spawnSync(process.execPath,[
   '-e','require(process.argv[1]).reserveIsolatedPythonAttemptFixture(process.argv[2],JSON.parse(process.argv[3]),process.argv[4])',
   require.resolve('./honartik-universal-installer-native-python-bridge-v1.cjs'),
   dir,JSON.stringify(receipt()),'after_exclusive_create'
  ],{timeout:10000,encoding:'utf8'});
  assert.equal(child.status,111,child.stderr);
  const file=path.join(dir,'python-attempt-started.json');
  assert.equal(fs.statSync(file).size,0);
  assert.throws(()=>m.reserveIsolatedPythonAttemptFixture(dir,receipt()),
   /execution_already_attempted_recovery_required/);
 });
});
test('Linux: crash after fsynced marker never allows a second Python call',
 {skip:!canFixture},()=>{
 isolated(dir=>{
  const child=cp.spawnSync(process.execPath,[
   '-e','require(process.argv[1]).reserveIsolatedPythonAttemptFixture(process.argv[2],JSON.parse(process.argv[3]),process.argv[4])',
   require.resolve('./honartik-universal-installer-native-python-bridge-v1.cjs'),
   dir,JSON.stringify(receipt()),'after_durable_marker'
  ],{timeout:10000,encoding:'utf8'});
  assert.equal(child.status,112,child.stderr);
  const j=JSON.parse(fs.readFileSync(path.join(dir,'python-attempt-started.json')));
  assert.equal(j.state,'started_once_recovery_only');
  assert.throws(()=>m.reserveIsolatedPythonAttemptFixture(dir,receipt()),
   /execution_already_attempted_recovery_required/);
 });
});
test('nonroot fixture never admits production fence path',()=>{
 if(process.getuid?.()!==0){
  assert.throws(()=>m.reserveIsolatedPythonAttemptFixture(
   '/var/lib/prhm-agent-selfmaint-exec/honartik-universal-installer-l4',
   receipt()),/fixture_scope_denied/);
 }
});
