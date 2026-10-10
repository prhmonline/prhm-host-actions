'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const pins=require('./drtarjomeh-incident47-l4-registration-candidate-v1.js');
const registration=require('./drtarjomeh-incident47-runtime-registration-v1.js');
const runner=require('./drtarjomeh-incident47-reviewed-host-runner-v1.js');
const tx=require('./drtarjomeh-incident47-signed-registration-transaction-v1.js');
const readiness=require('./drtarjomeh-incident47-production-readiness-v1.js');
const mergeSha='c1e03335f5b9c963672af1050089d8e197a729ef';
const expectedBlob='4f532f6a1b58d80d4010002b954fe13eaaecb420';
const hostBaseline='2ae43c70b38a61a21ebf2c6caebe9ae1571caec4';
test('application and host SHAs agree across every fixed-scope component',()=>{
  assert.equal(pins.SOURCE_COMMIT,mergeSha);
  assert.equal(runner.APP_SHA,mergeSha);
  assert.equal(registration.HOST_BASE,hostBaseline);
  assert.equal(pins.HOST_ACTIONS_BASE,hostBaseline);
  assert.equal(pins.APP_BLOBS.guard.git_blob_sha,expectedBlob);
  assert.equal(tx.TARGETS.runner,registration.RUNNER_TARGET);
  assert.equal(readiness.FILES.script.git_blob_sha,expectedBlob);
  assert.equal(readiness.FILES.conf.git_blob_sha,pins.APP_BLOBS.policy.git_blob_sha);
  assert.ok(runner.INVOKE_PYTHON.includes("m.preflight('"+mergeSha+"')"));
  assert.ok(runner.INVOKE_PYTHON.includes("m.install_guard(policy,'"+mergeSha+"'"));
});
test('runtime dispatch is pinned to the EXACT reviewed host runner source',()=>{
  const file=fs.readFileSync(path.join(__dirname,
    'drtarjomeh-incident47-reviewed-host-runner-v1.js'));
  const gitBlob=crypto.createHash('sha1').update(Buffer.concat([
    Buffer.from('blob '+file.length+'\0'),file])).digest('hex');
  assert.equal(gitBlob,registration.RUNNER_GIT_BLOB);
  assert.doesNotThrow(()=>registration.verifyRunner(()=>file));
  assert.ok(!runner.INVOKE_PYTHON.includes('e20f4055610d9e61bd8ec42e4d271d97f7433ace'));
});
test('runner scopes Git safe.directory per command and does not self-authorize',()=>{
  const cmds=[];
  const fakeBytes=Buffer.from('placeholder-not-the-reviewed-source');
  assert.throws(()=>runner.inspectPrerequisites({
    cmd:(bin,args)=>{cmds.push({bin,args});return args.at(-1)==='HEAD'?mergeSha:'';},
    readFile:()=>fakeBytes,
  }),/application_script_blob_changed/);
  const gitCommands=cmds.filter(x=>x.bin==='/usr/bin/git');
  assert.equal(gitCommands.length,2);
  for(const c of gitCommands){
    assert.ok(c.args.includes('safe.directory='+runner.APP_REPO));
    assert.equal(c.args[0],'-c');
  }
  assert.equal(registration.cli(['--selftest']).production_mutation,false);
  assert.equal(pins.runCli(['--selftest']).registration_authorized,false);
});
