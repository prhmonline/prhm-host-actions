const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const file='leadops-parscoders-selinux-exec-remediate-v1.js';

test('remediation helper exists and is exact-state-bound',()=>{
  assert.equal(fs.existsSync(file),true);
  const s=fs.readFileSync(file,'utf8');
  assert.match(s,/leadops_parscoders_selinux_exec_remediate_v1/);
  assert.match(s,/3d070b611850904e1be77ee037960f3a871baa9bd430eaab1adccaf8fe3a8760/);
  assert.match(s,/7526b70a11447858a8af2a8c2a4c324570c7635bd4d7554377026e527f34ada0/);
  assert.match(s,/15e8274230ff33a0a1572430a5928bdd6a54210f687569d8e1009db947432d14/);
  assert.match(s,/43876d21357f5294cf7190d79e37616caf2fd7800dc0ec72e270b782760b6154/);
});

test('remediation changes only exact fcontexts and uses systemd validation',()=>{
  const s=fs.readFileSync(file,'utf8');
  assert.match(s,/semanage/);assert.match(s,/restorecon/);assert.match(s,/systemd-run/);
  assert.match(s,/PARSCODERS_VALIDATE_ONLY/);
  assert.doesNotMatch(s,/setenforce|\bchcon\b|audit2allow/);
  assert.doesNotMatch(s,/runtime-v3\/\.\*/);
});

test('remediation restores timer state on success and rollback',()=>{
  const s=fs.readFileSync(file,'utf8');
  assert.match(s,/timer_before/);
  assert.match(s,/systemctl.*stop/s);
  assert.match(s,/restoreTimerState/);
  assert.match(s,/rollback/);
});

test('remediation treats absent BID_AUTO_SEND_ENABLED as schema-optional but rejects true',()=>{
  const s=fs.readFileSync(file,'utf8');
  assert.match(s,/hasOwnProperty\.call\(f,'BID_AUTO_SEND_ENABLED'\).*BID_AUTO_SEND_ENABLED!==false/);
  assert.doesNotMatch(s,/\['P0_DECISION_ENABLED','PROPOSAL_AUTO_SEND_ENABLED','AUTO_PROPOSAL_ENABLED','BID_AUTO_SEND_ENABLED'\]/);
});
