const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const file='bootstrap-host-actions-v12-2-parscoders-selinux-exec-remediate.js';

test('v12.2 bootstrap registers a Level-4 critical remediation action',()=>{
  assert.equal(fs.existsSync(file),true);
  const s=fs.readFileSync(file,'utf8');
  assert.match(s,/leadops_parscoders_selinux_exec_remediate_v1/);
  assert.match(s,/host_action\.leadops_parscoders_selinux_exec_remediate_v1/);
  assert.match(s,/risk:'critical'/);
  assert.match(s,/level:4/);
});

test('v12.2 bootstrap embeds exact source bytes and protects current state',()=>{
  const s=fs.readFileSync(file,'utf8');
  assert.match(s,/15e8274230ff33a0a1572430a5928bdd6a54210f687569d8e1009db947432d14/);
  assert.match(s,/HELPER_B64/);
  assert.match(s,/REMEDIATION_B64/);
  assert.match(s,/sha_mismatch/);
});

test('v12.2 bootstrap embeds final helper and remediation bytes exactly',()=>{
  const s=fs.readFileSync(file,'utf8');
  const hm=s.match(/const HELPER_B64='([^']+)'/);
  const rm=s.match(/const REMEDIATION_B64='([^']+)'/);
  assert.ok(hm);assert.ok(rm);
  assert.deepEqual(Buffer.from(hm[1],'base64'),fs.readFileSync('leadops-parscoders-runtime-v3-restore-v1.js'));
  assert.deepEqual(Buffer.from(rm[1],'base64'),fs.readFileSync('leadops-parscoders-selinux-exec-remediate-v1.js'));
});

test('v12.2 apply validator rejects unsafe remediation results',()=>{
  const s=fs.readFileSync(file,'utf8');
  for(const token of [
    "result.committed_database_mutation!==false",
    "result.business_mutation!==false",
    "result.external_send!==false",
    "result.p0_live!==false",
    "result.p0_decision!==false",
    "result.proposal_send!==false",
    "result.bid_send!==false",
    "result.auto_send!==false",
    "result.validation_avc_denials!==0",
    "result.timer_state_restored!==true"
  ]) assert.ok(s.includes(token),token);
});
