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

test('generated workflow is manual, zero-input, least-privilege and uses strict host verification',()=>{
  const g=require(generatorPath);
  const sealed=g.generate(input);
  const yaml=sealed.workflowYaml;
  assert.match(yaml,/workflow_dispatch:\s*\n/);
  assert.doesNotMatch(yaml,/workflow_dispatch:[\s\S]*?inputs:/);
  assert.match(yaml,/permissions:\s*\{\}/);
  assert.doesNotMatch(yaml,/pull_request_target:|\npush:|\nschedule:/);
  assert.match(yaml,/secrets\.PRHM_HOST_ACTIONS_DEPLOY_KEY/);
  assert.match(yaml,/BatchMode=yes/);
  assert.match(yaml,/IdentitiesOnly=yes/);
  assert.match(yaml,/StrictHostKeyChecking=yes/);
  assert.match(yaml,/UserKnownHostsFile="\$known_hosts"/);
  assert.doesNotMatch(yaml,/StrictHostKeyChecking=no|UserKnownHostsFile=\/dev\/null/);
  assert.doesNotMatch(yaml,/\bscp\s|\bsftp\s|\brsync\s/);
  assert.doesNotMatch(yaml,/\$\{\{\s*inputs\./);
  const sshLine=yaml.split('\n').find(line=>line.trim().startsWith('ssh '));
  assert.ok(sshLine,'ssh invocation must exist');
  assert.match(sshLine,/prhm-host-actions-deploy@agent\.prhm\.ir\s*$/);
  assert.doesNotMatch(sshLine,/\s(?:bash|sh|node|sudo|id|cat|cp|mv|rm)\s/);
  assert.match(yaml,/\[agent\.prhm\.ir\]:40222 ssh-ed25519 /);
  assert.match(yaml,/if:\s*always\(\)/);
  assert.equal(sealed.manifest.workflow_sha256,sha(yaml));
});
