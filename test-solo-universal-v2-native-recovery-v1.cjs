'use strict';
/** Real Linux /tmp filesystem recovery tests; never touch production targets. */
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const child=require('node:child_process');
const native=require('./solo-universal-v2-native-recovery-v1.cjs');
const {PINS}=require('./solo-universal-v2-signed-release-contract-v1.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const WRAPPER=Buffer.from('IyEvb3B0L3ByaG0vdW5pdmVyc2FsLXB5dGhvbi9iaW4vcHl0aG9uMwppbXBvcnQgc3lzCnN5cy5wYXRoLmluc2VydCgwLCcvdXNyL2xvY2FsL2xpYmV4ZWMvZGVwbG95LWNvbnRyb2wvdW5pdmVyc2FsL2N1cnJlbnQnKQpmcm9tIHVuaXZlcnNhbC5jbGkgaW1wb3J0IG1haW4KcmFpc2UgU3lzdGVtRXhpdChtYWluKCkpCg==','base64');
const MANIFEST=Buffer.from('ewogICJhY3RpdmF0ZWRfYXNfbGVnYWN5X2VudHJ5cG9pbnQiOiBmYWxzZSwKICAiZGlnZXN0IjogIjA4ODg5YzE4YTU3MGNjMmJmZjQwOGRmYmU3OGI3ZTVmNGY4ZGEyNGY0NjViNGZkZDQ0NTY0MGNkN2Y4OWQxN2QiLAogICJlbnRyeXBvaW50IjogIi91c3IvbG9jYWwvbGliZXhlYy9kZXBsb3ktY29udHJvbC91bml2ZXJzYWwvZGVwbG95LXByb2plY3QiLAogICJwcmV2aW91cyI6ICI0N2UyNDg2ODY5NzFmZDM3M2ZkMzJlYmU1MGY1OTNkZWFlNmU5OGUwMTk2YWU3ZTcwMjE1MDhlY2FiYjNjMTgxIgp9Cg==','base64');
const PROFILE=Buffer.from("{\n  \"version\": 2,\n  \"project\": \"solo_company\",\n  \"environment\": \"production\",\n  \"enabled\": true,\n  \"root\": \"/opt/prhm-solo-company\",\n  \"user\": \"root\",\n  \"repositories\": {},\n  \"services\": [],\n  \"databases\": [],\n  \"health\": [],\n  \"resources\": [\n    \"solo_company_stateful_observer\"\n  ],\n  \"backup\": {\n    \"paths\": [],\n    \"offsite_required\": false\n  },\n  \"adoption\": {\n    \"adapter\": \"existing_stateful_service\",\n    \"operation\": \"observe_only\",\n    \"unit\": \"prhm-solo-company-runtime.service\",\n    \"release_sha\": \"0eb43d72aab3f10db22172c8be4c0411cf22d074\",\n    \"release_marker\": \"/opt/prhm-solo-company/.release-sha\",\n    \"state_root\": \"/var/lib/private/prhm-solo-company\",\n    \"state_directory\": \"prhm-solo-company\",\n    \"loopback\": \"127.0.0.1:8782\",\n    \"approved_transaction\": \"host_action.solo_company_runtime_registration_v1\",\n    \"signed_installation_required\": true,\n    \"owns_existing_service\": false,\n    \"allows_deploy\": false,\n    \"allows_rollback\": false,\n    \"allows_restart\": false,\n    \"allows_migration\": false,\n    \"allows_state_write\": false\n  }\n}\n",'utf8');
const makeDir=p=>fs.mkdirSync(p,{mode:0o700});
let count=0;
function test(name,fn){
  fn();count++;console.log('PASS '+name);
}
function fixture(){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'solo-v2-native-linux-'));
  const prefix=path.join(base,'universal'),registry=path.join(base,'projects'),
    journalRoot=path.join(base,'journals');
  makeDir(prefix);makeDir(registry);makeDir(journalRoot);
  makeDir(path.join(prefix,'versions'));
  makeDir(path.join(prefix,'versions',PINS.installed_digest));
  makeDir(path.join(prefix,'versions',PINS.candidate_digest));
  fs.symlinkSync(path.join(prefix,'versions',PINS.installed_digest),
    path.join(prefix,'current'));
  fs.writeFileSync(path.join(prefix,'deploy-project'),WRAPPER,{mode:0o755});
  fs.writeFileSync(path.join(prefix,'installation.json'),MANIFEST,{mode:0o600});
  const params={prefix,registry,journalRoot,
    wrapperSha:sha(WRAPPER),expectedCurrent:PINS.installed_digest,
    expectedManifestSha:sha(MANIFEST),candidateDigest:PINS.candidate_digest,
    profileSha:PINS.profile_sha256};
  return {base,params};
}
function removeFixture(f){
  fs.rmSync(f.base,{recursive:true,force:true});
}
function candidatePointer(f){
  const p=f.params.prefix,current=path.join(p,'current');
  const temporary=path.join(p,'next-current');
  fs.symlinkSync(path.join(p,'versions',PINS.candidate_digest),temporary);
  fs.renameSync(temporary,current);
}
function candidateManifest(f){
  const p=f.params.prefix;
  const current=JSON.parse(MANIFEST.toString('utf8'));
  current.previous=PINS.installed_digest;current.digest=PINS.candidate_digest;
  fs.writeFileSync(path.join(p,'installation.json'),JSON.stringify(current)+'\n',
    {mode:0o600});
}
function attachTestPermit(f,j){
  // A fake grant is safe only for the isolated filesystem core fixture.
  // The real privileged dispatcher MUST verify and consume Ed25519 first.
  const g={verified:true,consumed:true,operation:PINS.operation,
    candidate_digest:PINS.candidate_digest,profile_sha256:PINS.profile_sha256,
    request_id:crypto.randomUUID(),jti:crypto.randomUUID(),
    driver_git_sha:'a'.repeat(40)};
  assert.equal(native.attachConsumedPermit(f.params,j.dir,g),true);
}
function emulateInstall(f,{pointer=true,manifest=true,profile=true}={}){
  if(pointer)candidatePointer(f);
  if(manifest)candidateManifest(f);
  if(profile)native.installProfile(f.params,PROFILE);
}
function oldState(f){
  assert.equal(native.attestBefore(f.params).target,
    path.join(f.params.prefix,'versions',PINS.installed_digest));
  assert.equal(fs.existsSync(path.join(f.params.registry,'solo_company.production.json')),false);
}
function newState(f){
  assert.equal(native.verifyPost(f.params),true);
  assert.equal(fs.readlinkSync(path.join(f.params.prefix,'current')),
    path.join(f.params.prefix,'versions',PINS.candidate_digest));
}
function testFixture(){
  assert.equal(sha(WRAPPER),'4c67a86046d0f2eb511a5fabe81b14e35ab9c17aaadf33c2064fa9d68e8989ce');
  assert.equal(sha(MANIFEST),PINS.manifest_preimage_sha256);
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?
    Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  assert.equal(sha(Buffer.from(JSON.stringify(canonical(JSON.parse(PROFILE))))),
    PINS.profile_sha256);
}
function runFixture(name,action){
  const f=fixture();
  try{action(f);count++;console.log('PASS '+name)}
  finally{removeFixture(f)}
}
if(process.argv[2]==='--crash-child'){
  // Tests an actual process death after the protected symlink flips.
  // Fails on production: only an entirely new /tmp fixture is accepted.
  const f={base:process.argv[3],params:JSON.parse(process.argv[4])};
  if(!f.base.startsWith(os.tmpdir()+'/solo-v2-native-linux-'))
    throw Error('test_fixture_only');
  const j=native.prepare(f.params);
  attachTestPermit(f,j);
      native.markApplying(f.params,j.dir);
  emulateInstall(f,{pointer:true,manifest:false,profile:false});
  process.kill(process.pid,'SIGKILL');
}
else if(process.argv[2]==='--crash-after-commit'){
  // Fail specifically AFTER durable COMMITTED journal, BEFORE lock unlink.
  const f={base:process.argv[3],params:JSON.parse(process.argv[4])};
  if(!f.base.startsWith(os.tmpdir()+'/solo-v2-native-linux-'))
    throw Error('test_fixture_only');
  const j=native.prepare(f.params);
  attachTestPermit(f,j);
      native.markApplying(f.params,j.dir);
  emulateInstall(f);
  const original=fs.unlinkSync;
  fs.unlinkSync=function(name){
    if(name===path.join(f.params.journalRoot,'active.lock'))
      process.kill(process.pid,'SIGKILL');
    return original.apply(fs,arguments);
  };
  native.finish(f.params,j.dir);
}
else {
  try {
    testFixture();count++;console.log('PASS pinned real production byte fixtures');
    runFixture('before-image validated without writes',f=>oldState(f));
    runFixture('prepared journal stores exact snapshots durably',f=>{
      const j=native.prepare(f.params);
      const data=JSON.parse(fs.readFileSync(path.join(j.dir,'journal.json')));
      assert.equal(data.status,'PREPARED');
      assert.equal(data.expectedCurrent,PINS.installed_digest);
      assert.equal(sha(fs.readFileSync(path.join(j.dir,'before-wrapper.bin'))),
        sha(WRAPPER));
      assert.throws(()=>native.prepare(f.params),/previous_lock_requires_recovery/);
      assert.equal(native.recover(f.params,j.dir).status,'ROLLED_BACK');
      oldState(f);
    });
    runFixture('unsigned transaction cancelled before any protected asset changes',f=>{
      const j=native.prepare(f.params);
      const preBytes=fs.readFileSync(path.join(f.params.prefix,'installation.json'));
      assert.equal(native.cancelPrepared(f.params,j.dir).status,'ROLLED_BACK');
      assert(!fs.existsSync(path.join(f.params.journalRoot,'active.lock')));
      assert.deepEqual(fs.readFileSync(path.join(f.params.prefix,'installation.json')),preBytes);
      oldState(f);
    });
    runFixture('unbound permit must not authorize writing phase',f=>{
      const j=native.prepare(f.params);
      assert.throws(()=>native.markApplying(f.params,j.dir),
        /apply_requires_durably_bound_consumed_l4/);
      native.cancelPrepared(f.params,j.dir);
      oldState(f);
    });
    runFixture('successful four-artifact commit, no stale lock',f=>{
      const j=native.prepare(f.params);
      attachTestPermit(f,j);
      native.markApplying(f.params,j.dir);
      emulateInstall(f);newState(f);
      assert.equal(native.finish(f.params,j.dir).status,'COMMITTED');
      assert(!fs.existsSync(path.join(f.params.journalRoot,'active.lock')));
      assert.equal(native.recover(f.params,j.dir).status,'COMMITTED');
      newState(f);
    });
    runFixture('rollback pointer-only interrupted upgrade',f=>{
      const j=native.prepare(f.params);
      attachTestPermit(f,j);
      native.markApplying(f.params,j.dir);
      emulateInstall(f,{pointer:true,manifest:false,profile:false});
      assert.equal(native.recover(f.params,j.dir).status,'ROLLED_BACK');
      oldState(f);
    });
    runFixture('rollback after manifest changed but profile absent',f=>{
      const j=native.prepare(f.params);
      attachTestPermit(f,j);
      native.markApplying(f.params,j.dir);
      emulateInstall(f,{pointer:true,manifest:true,profile:false});
      assert.equal(native.recover(f.params,j.dir).status,'ROLLED_BACK');
      oldState(f);
    });
    runFixture('rollback from full candidate without commit',f=>{
      const j=native.prepare(f.params);
      attachTestPermit(f,j);
      native.markApplying(f.params,j.dir);
      emulateInstall(f);newState(f);
      assert.equal(native.recover(f.params,j.dir).status,'ROLLED_BACK');
      oldState(f);
      assert(fs.existsSync(path.join(f.params.prefix,'versions',PINS.candidate_digest)));
    });
    runFixture('foreign user-supplied registry file cannot be deleted',f=>{
      const j=native.prepare(f.params);
      attachTestPermit(f,j);
      native.markApplying(f.params,j.dir);
      candidatePointer(f);
      const p=path.join(f.params.registry,'solo_company.production.json');
      fs.writeFileSync(p,'{"untrusted":true}\n',{mode:0o600});
      assert.throws(()=>native.recover(f.params,j.dir),
        /foreign_profile_recovery_refused/);
      assert(fs.existsSync(p));
    });
    runFixture('foreign current symlink cannot be overwritten',f=>{
      const j=native.prepare(f.params);
      attachTestPermit(f,j);
      native.markApplying(f.params,j.dir);
      const p=path.join(f.params.prefix,'current');
      fs.unlinkSync(p);
      fs.symlinkSync('/tmp/foreign-release',p);
      assert.throws(()=>native.recover(f.params,j.dir),
        /foreign_current_pointer_recovery_refused/);
    });
    runFixture('forged input source hash and relative target refused',f=>{
      assert.throws(()=>native.prepare({...f.params,
        expectedManifestSha:'f'.repeat(64)}),/immutable_contract_mismatch/);
      assert.throws(()=>native.prepare({...f.params,prefix:'./unsafe'}),
        /path_invalid/);
    });
    runFixture('Linux SIGKILL between current and manifest; true crash recovery',f=>{
      const r=child.spawnSync(process.execPath,
        [__filename,'--crash-child',f.base,JSON.stringify(f.params)],
        {encoding:'utf8',timeout:10000});
      assert.equal(r.signal,'SIGKILL',r.stderr);
      const journal=fs.readdirSync(f.params.journalRoot).find(x=>x.startsWith('tx-'));
      assert(journal);
      const jdir=path.join(f.params.journalRoot,journal);
      assert.equal(native.recover(f.params,jdir).status,'ROLLED_BACK');
      oldState(f);
    });
    runFixture('Linux SIGKILL after durable COMMITTED; release stale lock',f=>{
      const r=child.spawnSync(process.execPath,
        [__filename,'--crash-after-commit',f.base,JSON.stringify(f.params)],
        {encoding:'utf8',timeout:10000});
      assert.equal(r.signal,'SIGKILL',r.stderr);
      const journal=fs.readdirSync(f.params.journalRoot).find(x=>x.startsWith('tx-'));
      assert(journal);
      const jdir=path.join(f.params.journalRoot,journal);
      assert.equal(native.recover(f.params,jdir).status,'COMMITTED');
      assert(!fs.existsSync(path.join(f.params.journalRoot,'active.lock')));
      newState(f);
    });
    test('native module is not a CLI',()=>{
      const result=child.spawnSync(process.execPath,
        [path.join(__dirname,'solo-universal-v2-native-recovery-v1.cjs')],
        {encoding:'utf8',timeout:5000});
      assert.notEqual(result.status,0);
      assert.match(result.stderr,/NO_CLI/);
    });
    console.log('SOLO_V2_NATIVE_REAL_LINUX_TESTS='+count+' PASS');
  }catch(e){console.error(e.stack);process.exitCode=1}
}
