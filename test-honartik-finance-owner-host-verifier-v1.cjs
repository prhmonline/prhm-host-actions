'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const c=require('./honartik-finance-owner-host-verifier-v1.cjs');
const gate=require('./honartik-finance-owner-oidc-identity-v1.cjs');

test('host verifier pins privileged paths, never exports application cutover',()=>{
  assert.equal(c.STATE,'/var/lib/prhm-honartik-finance-owner');
  assert.equal(c.CONFIG,'/etc/prhm-honartik-finance-owner/identity.json');
  assert.equal(c.API_TOKEN,'/etc/prhm-honartik-finance-owner/github-api-read.token');
  assert.equal(c.ROOT_RELEASE_EXPORTED,false);
  assert.equal(c.DEPLOY_AUTHORIZED,false);
  for(const name of ['deploy','installRoot','executeRelease','apply','creditWallet','migrate','reset'])
    assert.equal(c[name],undefined,name);
});
test('host verifier rejects unapproved network endpoints before fetch',()=>{
  assert.throws(
    ()=>c.githubJSON('https://attacker.example/api/run','bogus'),
    /endpoint_not_allowlisted/
  );
  assert.throws(
    ()=>c.githubJSON('http://api.github.com/repos/prhmonline/prhm-host-actions/actions/runs/1','bogus'),
    /endpoint_not_allowlisted/
  );
});
test('root-owned directory guard refuses mode, UID and symlink drift',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'honartik-finance-host-unit-'));
  const alias=tmp+'-alias';
  try{
    fs.chmodSync(tmp,0o700);
    // This test runs on an unprivileged GitHub-hosted runner.
    if(process.getuid()!==0)
      assert.throws(()=>c.rootDir(tmp),/untrusted_directory/);
    fs.chmodSync(tmp,0o755);
    assert.throws(()=>c.rootDir(tmp),/untrusted_directory/);
    fs.symlinkSync(tmp,alias);
    assert.throws(()=>c.rootDir(alias),/untrusted_directory/);
  }finally{
    fs.rmSync(alias,{force:true});
    fs.rmSync(tmp,{recursive:true,force:true});
  }
});
test('root-owned token/file guard rejects absent secret and symlink',()=>{
  assert.throws(()=>c.rootFile('/etc/prhm-honartik-finance-owner/does-not-exist'),
    /ENOENT/);
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'honartik-finance-host-file-'));
  const f=path.join(tmp,'a'),link=path.join(tmp,'link');
  try{
    fs.writeFileSync(f,'synthetic identity evidence',{mode:0o600});
    fs.symlinkSync(f,link);
    assert.throws(()=>c.rootFile(link),/untrusted_file/);
    fs.chmodSync(f,0o644);
    assert.throws(()=>c.rootFile(f),/untrusted_file/);
  }finally{fs.rmSync(tmp,{recursive:true,force:true})}
});
test('no root key derivation or manual token input in source',()=>{
  const src=fs.readFileSync(path.join(__dirname,
    'honartik-finance-owner-host-verifier-v1.cjs'),'utf8');
  assert.match(src,/private_pkcs8_der_b64/);
  assert.match(src,/randomBytes\(32\)/);
  assert.match(src,/fence\.consumeVerifiedFinanceIdentity/);
  assert.match(src,/verifyFinanceOwnerIdentity/);
  assert.match(src,/can_admins_bypass=true/);
  assert.doesNotMatch(src,/(?:sudo\s+-S|git\s+reset|git\s+push|migrate\/up|deploy-project|child_process|execSync|spawnSync)/);
});
test('existing protected-environment gate STILL refuses admin bypass',()=>{
  const env={
    name:gate.W.environment,can_admins_bypass:true,
    deployment_branch_policy:{custom_branch_policies:true,protected_branches:false},
    protection_rules:[{type:'branch_policy'}]
  };
  const branches={branch_policies:[{name:'main',type:'branch'}]};
  assert.throws(()=>gate.verifyProtectedEnvironment(env,branches),
    /environment_admin_bypass_enabled/);
  assert.equal(gate.INTENT.source_sha,
    'd1a64e640c9c2cf4788d55566c17728be5813941');
});
test('command line is restricted to issue / consume; no deployment verbs',()=>{
  const src=fs.readFileSync(path.join(__dirname,
    'honartik-finance-owner-host-verifier-v1.cjs'),'utf8');
  assert.match(src,/cmd==='issue'/);
  assert.match(src,/cmd==='consume'/);
  assert.match(src,/unsupported_operator_command/);
});
