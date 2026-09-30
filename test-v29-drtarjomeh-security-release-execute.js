'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const bootstrap=require('./bootstrap-host-actions-v29-drtarjomeh-security-release-deploy.js');

function fakeBinding(){
  const manifest={}; let i=1;
  for(const [rel,spec] of Object.entries(bootstrap.PAYLOAD)){
    manifest[rel]={target_sha256:(i.toString(16).padStart(2,'0').repeat(32)).slice(0,64),preimage:i%4===0?'absent':((i+30).toString(16).padStart(2,'0').repeat(32)).slice(0,64),mode:spec.mode};
    i++;
  }
  return {schema:'prhm.drtarjomeh-security-release-binding.v1',target_commit:bootstrap.TARGET_COMMIT,expected_release:bootstrap.EXPECTED_RELEASE,manifest,env_preimage:'absent',runtime:{uid:1001,gid:1001}};
}
function loadBoundHelper(binding=fakeBinding()){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'drt-v29-bound-'));
  const file=path.join(dir,'helper.js');
  fs.writeFileSync(file,bootstrap.buildHelperSource(binding),'utf8');
  delete require.cache[require.resolve(file)];
  return {helper:require(file),dir,binding};
}

test('bound helper validates fixed commit/release, exact 24 manifest entries, and runtime identity',t=>{
  const {helper,dir,binding}=loadBoundHelper();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  assert.deepEqual(helper.BINDING,binding);
  assert.doesNotThrow(()=>helper.validateBinding(binding));
  assert.throws(()=>helper.validateBinding({...binding,target_commit:'0'.repeat(40)}),/binding_target_commit/);
  const bad={...binding,manifest:{...binding.manifest}};delete bad.manifest['yii'];
  assert.throws(()=>helper.validateBinding(bad),/binding_manifest_set/);
  assert.throws(()=>helper.validateBinding({...binding,runtime:{uid:-1,gid:1001}}),/binding_runtime_identity/);
});

test('secret extractor is fixed PHP code and outward failures never include captured stdout/stderr',t=>{
  const {helper,dir}=loadBoundHelper();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const script=helper.secretExtractorPhp('/fixed/release');
  assert.match(script,/common\/config\/env\/prod\.php/);
  assert.match(script,/DB2/);
  assert.match(script,/adminEmail/);
  assert.match(script,/noreplyEmail/);
  assert.doesNotMatch(script,/FIXTURE_SECRET/);
  const adapter={runCaptured:()=>({status:1,stdout:'FIXTURE_SECRET',stderr:'FIXTURE_SECRET'})};
  assert.throws(()=>helper.deriveCurrentSecrets(adapter,'/fixed/release'),/^Error: secret_extract_failed$/);
});

test('executeWithAdapter success performs fixed gates in order and returns bounded result',t=>{
  const {helper,dir}=loadBoundHelper();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const calls=[];
  const secrets={dbDsn:'dsn',dbUser:'u',dbPass:'SECRET1',db2Dsn:'dsn2',db2User:'u2',db2Pass:'SECRET2',operationalEmail:'ops@example.test',senderEmail:'sender@example.test',senderName:'DrTarjomeh'};
  const adapter={
    acquireLock:()=>calls.push('lock'), verifyPreflight:()=>calls.push('preflight'), readTargetBytes:()=>{calls.push('targets');return{}},
    deriveSecrets:()=>{calls.push('secrets');return secrets}, backupEnv:()=>{calls.push('backup_env');return{existed:false}},
    createCandidate:()=>{calls.push('candidate');return'/r/new'}, writeProtectedEnv:()=>calls.push('env'), verifyEnvReadable:()=>calls.push('env_read'),
    verifyCandidate:()=>calls.push('verify_candidate'), cutover:()=>{calls.push('cutover');return'/r/old'}, smoke:()=>{calls.push('smoke');return true},
    persistResult:r=>{calls.push('persist');return r}, releaseLock:()=>calls.push('unlock'), rollback:()=>{throw new Error('rollback_should_not_run')},
  };
  const r=helper.executeWithAdapter(adapter);
  assert.equal(r.ok,true);
  assert.equal(r.previous_release,'/r/old');
  assert.equal(r.new_release,'/r/new');
  assert.equal(r.database_mutation,false);
  assert.equal(r.provider_credential_rotation,false);
  assert.equal(r.credential_values_returned,false);
  assert.deepEqual(calls,['lock','preflight','targets','secrets','backup_env','candidate','env','env_read','verify_candidate','cutover','smoke','persist','unlock']);
  assert.equal(JSON.stringify(r).includes('SECRET1'),false);
  assert.equal(JSON.stringify(r).includes('SECRET2'),false);
});

test('executeWithAdapter rolls back after post-cutover smoke failure and never returns success',t=>{
  const {helper,dir}=loadBoundHelper();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const calls=[];
  const adapter={
    acquireLock:()=>calls.push('lock'), verifyPreflight:()=>calls.push('preflight'), readTargetBytes:()=>({}),
    deriveSecrets:()=>({dbDsn:'dsn',dbUser:'u',dbPass:'SECRET',db2Dsn:'dsn2',db2User:'u2',db2Pass:'SECRET2',operationalEmail:'o',senderEmail:'s',senderName:'DrTarjomeh'}),
    backupEnv:()=>({existed:false}),createCandidate:()=>'/r/new',writeProtectedEnv:()=>{},verifyEnvReadable:()=>{},verifyCandidate:()=>{},
    cutover:()=>'/r/old',smoke:()=>false,rollback:state=>{calls.push('rollback');assert.equal(state.cutoverPerformed,true);return{performed:true,verified:true,status:'FAILED_ROLLED_BACK'}},
    persistResult:r=>r,releaseLock:()=>calls.push('unlock'),
  };
  const r=helper.executeWithAdapter(adapter);
  assert.equal(r.ok,false);
  assert.equal(r.rollback_performed,true);
  assert.equal(r.rollback_verified,true);
  assert.equal(r.status,'FAILED_ROLLED_BACK');
  assert.deepEqual(calls,['lock','preflight','rollback','unlock']);
  assert.equal(JSON.stringify(r).includes('SECRET'),false);
});

test('bound helper source declares fixed live paths/result/lock and no free-form process arguments',()=>{
  const source=bootstrap.buildHelperSource(fakeBinding());
  for(const value of [
    '/home/drtarjomeh/domains/drtarjomeh.ir/public_html',
    '/home/drtarjomeh/domains/drtarjomeh.ir/releases',
    '/home/drtarjomeh/domains/drtarjomeh.ir/repository',
    '/etc/drtarjomeh/production.env',
    '/var/lib/prhm-agent-selfmaint-exec/drtarjomeh-security-release-deploy-v1/latest.json',
    '/var/lib/prhm-agent-selfmaint-exec/drtarjomeh-security-release-deploy-v1/run.lock',
  ]) assert.ok(source.includes(value),value);
  assert.doesNotMatch(source,/process\.argv\[[1-9]/);
});
