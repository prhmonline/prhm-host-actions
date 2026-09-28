'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const bootstrap=require('./bootstrap-host-actions-v29-drtarjomeh-security-release-deploy.js');

function loadHelper(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'drt-v29-helper-'));
  const file=path.join(dir,'helper.js');
  fs.writeFileSync(file,bootstrap.buildHelperSource(),'utf8');
  delete require.cache[require.resolve(file)];
  return {helper:require(file),dir};
}

test('generated helper has fixed identity and no caller-controlled production inputs',()=>{
  const src=bootstrap.buildHelperSource();
  assert.match(src,/drtarjomeh_security_release_deploy_v1/);
  assert.match(src,/f22b1d17801239f7539f84e5aa8b91250c87dc58/);
  assert.match(src,/20260805-011747-672d32f490bd/);
  assert.doesNotMatch(src,/process\.argv\[[1-9]/);
  assert.doesNotMatch(src,/req\.body|arbitrary_path|eval\(/);
});

test('candidate materialization leaves source bytes unchanged and overlays candidate only',t=>{
  const {helper,dir}=loadHelper();
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const source=path.join(dir,'source');
  const candidate=path.join(dir,'candidate');
  fs.mkdirSync(path.join(source,'common/config'),{recursive:true});
  fs.writeFileSync(path.join(source,'keep.txt'),'ORIGINAL');
  fs.writeFileSync(path.join(source,'common/config/base.php'),'OLD');
  const before=fs.readFileSync(path.join(source,'common/config/base.php'));
  helper.materializeCandidate(source,candidate,{
    'common/config/base.php':Buffer.from('NEW'),
  },{'common/config/base.php':{mode:0o644}});
  assert.deepEqual(fs.readFileSync(path.join(source,'common/config/base.php')),before);
  assert.equal(fs.readFileSync(path.join(source,'keep.txt'),'utf8'),'ORIGINAL');
  assert.equal(fs.readFileSync(path.join(candidate,'keep.txt'),'utf8'),'ORIGINAL');
  assert.equal(fs.readFileSync(path.join(candidate,'common/config/base.php'),'utf8'),'NEW');
});

test('protected env is production-only and provider delivery stays fail-closed',t=>{
  const {helper,dir}=loadHelper();
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const secrets={
    dbDsn:'mysql:host=127.0.0.1;dbname=main',dbUser:'main_user',dbPass:'FIXTURE_DB_SECRET',
    db2Dsn:'mysql:host=127.0.0.1;dbname=secondary',db2User:'secondary_user',db2Pass:'FIXTURE_DB2_SECRET',
    operationalEmail:'ops@example.test',senderEmail:'sender@example.test',senderName:'DrTarjomeh',
  };
  const rng=n=>Buffer.alloc(n,0x5a);
  const env=helper.buildProtectedEnv(secrets,rng);
  assert.equal(env.DRT_YII_ENV,'prod');
  assert.equal(env.DRT_YII_DEBUG,'0');
  assert.equal(env.DRT_BASE_SCHEME,'https');
  assert.equal(env.DRT_BASE_HOST,'drtarjomeh.ir');
  assert.equal(env.DRT_DB_PASS,'FIXTURE_DB_SECRET');
  assert.equal(env.DRT_DB2_PASS,'FIXTURE_DB2_SECRET');
  assert.equal(env.DRT_MAIL_DRIVER,'file');
  assert.equal(env.DRT_SMS_ENABLED,'0');
  assert.equal(env.DRT_SLACK_TOKEN,'');
  assert.equal(env.DRT_MAIL_PASSWORD,'');
  assert.match(env.DRT_APP_TOKEN,/^[a-f0-9]{64}$/);
  assert.match(env.DRT_COOKIE_VALIDATION_KEY,/^[a-f0-9]{64}$/);
  assert.match(env.DRT_API_COOKIE_VALIDATION_KEY,/^[a-f0-9]{64}$/);
  const rendered=helper.renderProtectedEnv(env);
  assert.match(rendered,/^DRT_YII_ENV='prod'$/m);
  assert.match(rendered,/^DRT_SMS_ENABLED='0'$/m);
});

test('env state gate rejects symlink, broad mode, unknown preimage, and unreadable runtime',t=>{
  const {helper,dir}=loadHelper();
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  assert.throws(()=>helper.assertEnvState({exists:true,isSymlink:true,isFile:true,mode:0o600,sha256:'a'.repeat(64)},'a'.repeat(64),true),/env_symlink/);
  assert.throws(()=>helper.assertEnvState({exists:true,isSymlink:false,isFile:true,mode:0o640,sha256:'a'.repeat(64)},'a'.repeat(64),true),/env_mode/);
  assert.throws(()=>helper.assertEnvState({exists:true,isSymlink:false,isFile:true,mode:0o600,sha256:'b'.repeat(64)},'a'.repeat(64),true),/env_preimage/);
  assert.throws(()=>helper.assertEnvState({exists:true,isSymlink:false,isFile:true,mode:0o600,sha256:'a'.repeat(64)},'a'.repeat(64),false),/env_runtime_unreadable/);
});

test('sanitized evidence cannot leak fixture credential values',t=>{
  const {helper,dir}=loadHelper();
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const secrets=['FIXTURE_DB_SECRET','FIXTURE_DB2_SECRET','SMTP_FIXTURE_SECRET'];
  const raw='failure FIXTURE_DB_SECRET / SMTP_FIXTURE_SECRET and FIXTURE_DB2_SECRET';
  const safe=helper.sanitizeText(raw,secrets);
  for(const secret of secrets) assert.equal(safe.includes(secret),false);
  assert.match(safe,/\[REDACTED\]/);
});
