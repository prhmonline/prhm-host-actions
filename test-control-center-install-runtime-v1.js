'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const action=require('./control-center-install-runtime-v1.js');

test('runtime installer source is fixed to the reviewed private Control Center commit',()=>{
  assert.equal(action.constants.SOURCE_REPO,'/opt/prhm-company-control-plane');
  assert.equal(action.constants.SOURCE_BRANCH,'design/unified-control-center');
  assert.equal(action.constants.CONTROL_PLANE_SHA,'ce40ec5a14e6a6b29e8e9fc555cc16a7621a4757');
  const args=action.sourceGitShowArgs('src/server.js');
  assert.deepEqual(args,['-C',action.constants.SOURCE_REPO,'show',`${action.constants.CONTROL_PLANE_SHA}:apps/control-center/src/server.js`]);
  assert.throws(()=>action.sourceGitShowArgs('../../etc/passwd'),/source_path_not_allowlisted/);
});

test('fixed source refresh may fetch only the reviewed branch ref',()=>{
  assert.deepEqual(action.sourceFetchArgs(),[
    '-C',action.constants.SOURCE_REPO,'fetch','--no-tags','origin',
    '+refs/heads/design/unified-control-center:refs/remotes/origin/design/unified-control-center'
  ]);
});

test('installer invocation accepts no user-controlled arguments',()=>{
  assert.doesNotThrow(()=>action.validateInvocation(['node','control-center-install-runtime-v1.js']));
  assert.throws(()=>action.validateInvocation(['node','control-center-install-runtime-v1.js','--path=/tmp/x']),/unexpected_arguments/);
});

test('Laravel env patch is idempotent and updates only fixed Control Center keys',()=>{
  const original='APP_ENV=production\nCONTROL_CENTER_CONFIG_SSO_SECRET=old\n';
  const once=action.patchLaravelEnv(original,{ssoSecret:'abc123',ssoAdminLogin:'Mohammad'});
  const twice=action.patchLaravelEnv(once,{ssoSecret:'abc123',ssoAdminLogin:'Mohammad'});
  assert.equal(once,twice);
  assert.match(once,/^CONTROL_CENTER_CONFIG_SSO_SECRET=abc123$/m);
  assert.match(once,/^CONTROL_CENTER_SSO_ADMIN_LOGIN=Mohammad$/m);
  assert.equal((once.match(/CONTROL_CENTER_CONFIG_SSO_SECRET=/g)||[]).length,1);
});

test('credential artifact contains plaintext only for one protected acceptance file',()=>{
  const text=action.buildCredentialArtifact({username:'cc-test',password:'VerySecret123!'});
  assert.match(text,/https:\/\/agent\.prhm\.ir\/control-center\//);
  assert.match(text,/username=cc-test/);
  assert.match(text,/password=VerySecret123!/);
  assert.equal(action.constants.CREDENTIALS_FILE,'/var/lib/prhm-agent-selfmaint-exec/control-center-install-v1/credentials.txt');
  assert.equal(action.constants.RESULT_FILE,'/var/lib/prhm-agent-selfmaint-exec/control-center-install-v1/latest.json');
});

test('password records are compatible with Control Center scrypt auth format',()=>{
  const record=action.makePasswordHash('Secret!123','00112233445566778899aabbccddeeff');
  assert.match(record,/^scrypt\$00112233445566778899aabbccddeeff\$[a-f0-9]{128}$/);
  assert.doesNotMatch(record,/Secret!123/);
});

test('runtime manifest copies only fixed application files and service definition',()=>{
  const paths=action.runtimeSourcePaths();
  assert.ok(paths.includes('src/server.js'));
  assert.ok(paths.includes('src/auth.js'));
  assert.ok(paths.includes('src/opportunities/sources/divar.js'));
  assert.ok(paths.includes('public/control-center.css'));
  assert.ok(paths.includes('package.json'));
  assert.ok(paths.includes('deploy/prhm-control-center.service'));
  assert.ok(paths.every(p=>!p.includes('..')&&!p.startsWith('/')));
});

test('installer fixed paths include backend env, backups and isolated result state',()=>{
  assert.equal(action.constants.CONFIG_API_ENV,'/srv/prhm-config-center/current/apps/api/.env');
  assert.equal(action.constants.BACKUP_ROOT,'/var/backups/prhm-control-center-install-v1');
  assert.equal(action.constants.RESULT_ROOT,'/var/lib/prhm-agent-selfmaint-exec/control-center-install-v1');
  assert.equal(action.constants.SERVICE_UNIT,'/etc/systemd/system/prhm-control-center.service');
});
