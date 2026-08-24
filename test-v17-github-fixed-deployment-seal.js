const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const generatorPath=path.join(__dirname,'generate-github-fixed-deployment-channel-v1.js');
const deployKey='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZm deploy-fixture';
const hostKey='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGdnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dn host-fixture';
const input={deployPublicKey:deployKey,sshHost:'agent.prhm.ir',sshPort:40222,hostPublicKey:hostKey};
function sha(s){return crypto.createHash('sha256').update(Buffer.from(s,'utf8')).digest('hex');}
test('sealing generator exists and rejects unsafe build-time identities',()=>{
  assert.equal(fs.existsSync(generatorPath),true,'sealing generator must exist');
  const g=require(generatorPath);
  for(const bad of [
    {...input,deployPublicKey:'ssh-rsa AAAA bad'},
    {...input,deployPublicKey:deployKey+'\nssh-ed25519 AAAA injected'},
    {...input,sshHost:''},
    {...input,sshHost:'agent.prhm.ir;id'},
    {...input,sshPort:0},
    {...input,sshPort:65536},
    {...input,hostPublicKey:'ssh-rsa AAAA bad'},
    {...input,hostPublicKey:hostKey+'\nextra'}
  ]) assert.throws(()=>g.validateSealInput(bad));
  assert.doesNotThrow(()=>g.validateSealInput(input));
});
test('generator is deterministic and emits fixed forced-command restrictions',()=>{
  const g=require(generatorPath);
  const a=g.generate(input); const b=g.generate(input); assert.deepEqual(a,b);
  const prefix='no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty,command="/usr/local/bin/prhm-node /usr/local/libexec/prhm-host-actions-github-fixed-dispatcher-v1.js" ';
  assert.equal(a.authorizedKeysLine,prefix+deployKey);
  assert.match(a.bootstrapSource,/prhm-host-actions-deploy/);
  assert.match(a.bootstrapSource,/\/usr\/local\/libexec\/prhm-host-actions-github-fixed-dispatcher-v1\.js/);
  assert.match(a.bootstrapSource,/--preflight-only/);
  assert.match(a.bootstrapSource,/rollback/i);
  assert.doesNotMatch(a.bootstrapSource,/--user|--path|--key|--host|--command|--file/);
  assert.equal(a.manifest.schema_version,'prhm.github-fixed-deployment-seal.v1');
  assert.equal(a.manifest.dispatcher_sha256,sha(fs.readFileSync(path.join(__dirname,'prhm-host-actions-github-fixed-dispatcher-v1.js'),'utf8')));
  assert.equal(a.manifest.authorized_keys_line_sha256,sha(a.authorizedKeysLine+'\n'));
  assert.equal(a.manifest.bootstrap_sha256,sha(a.bootstrapSource));
});
