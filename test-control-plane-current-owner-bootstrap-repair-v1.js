'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');

const HELPER='./control-plane-current-owner-bootstrap-repair-v1.js';
const BOOTSTRAP='./bootstrap-host-actions-control-plane-current-owner-bootstrap-repair-v1.js';
const ACTION='control_plane_current_owner_bootstrap_repair_v1';
const INSTALLER='/opt/prhm-agent-selfmaint-exec/actions/host-action-v2-installer-v1.js';
const OWNERS=Object.freeze({
  base:['/opt/prhm-agent-selfmaint/server.js','ad2f0fc6924238e7bb7bff6d69a517c366ce82fbafb116bb0a2d31d78c5ed32f'],
  exec:['/opt/prhm-agent-selfmaint-exec/server.js','a988dfcd706d3a032bd4d0d60a85c78b7fd6cdbea4e81b5e6c21212a6cd754a4'],
  policy:['/opt/prhm-company-control-plane/config/approval-policy.json','aad8b3262a86c31f6d746f0bcfbd3eada6187c4e671b51ca79957b6ca6c3340c'],
  mcp:['/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js','8f24b6ed70644c1eda7b255a47ccf0d4fabfe03ac7c73dd8799ff9aeb5294075']
});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const sources=()=>Object.fromEntries(Object.entries(OWNERS).map(([k,[p]])=>[k,fs.readFileSync(p,'utf8')]));
test('manifest is exact, zero-input and current-owner bound',()=>{
  const h=require(HELPER),m=h.manifest();
  assert.equal(m.action,ACTION);
  assert.equal(m.installer_path,INSTALLER);
  assert.equal(m.arbitrary_command,false);
  assert.equal(m.arbitrary_path,false);
  assert.equal(m.production_mutation,false);
  assert.equal(m.database_mutation,false);
  assert.deepEqual(m.owner_sha256,Object.fromEntries(Object.entries(OWNERS).map(([k,v])=>[k,v[1]])));
  assert.deepEqual(m.owner_paths,Object.fromEntries(Object.entries(OWNERS).map(([k,v])=>[k,v[0]])));
});

test('preflight is read-only and sees exact live owners',()=>{
  const h=require(HELPER);
  const beforeInstaller=sha(fs.readFileSync(INSTALLER));
  const beforeOwners=Object.fromEntries(Object.entries(OWNERS).map(([k,[p]])=>[k,sha(fs.readFileSync(p))]));
  const r=h.preflight();
  assert.equal(r.ok,true); assert.equal(r.preflight_only,true); assert.equal(r.changed,false);
  assert.equal(sha(fs.readFileSync(INSTALLER)),beforeInstaller);
  assert.deepEqual(Object.fromEntries(Object.entries(OWNERS).map(([k,[p]])=>[k,sha(fs.readFileSync(p))])),beforeOwners);
});
test('candidate is deterministic, syntax-valid and free of forbidden historical actions',()=>{
  const h=require(HELPER),s=sources();
  const a=h.buildInstallerCandidate(s),b=h.buildInstallerCandidate(s);
  assert.ok(Buffer.isBuffer(a.bytes));
  assert.equal(a.sha256,sha(a.bytes));
  assert.equal(a.sha256,b.sha256);
  assert.deepEqual(a.bytes,b.bytes);
  assert.equal(a.metadata.syntax_valid,true);
  const text=a.bytes.toString('utf8');
  for(const [,expected] of Object.values(OWNERS))assert.equal(text.includes(expected),true);
  assert.equal(text.includes('rahekomak_production_deploy_v1'),false);
  assert.equal(text.includes('prhm_config_center_edge_helper_binding_repair_v1'),false);
});

test('one-byte owner drift fails before candidate construction',()=>{
  const h=require(HELPER),s=sources();
  s.base='X'+s.base.slice(1);
  assert.throws(()=>h.buildInstallerCandidate(s),/owner_sha_mismatch:base/);
});

test('bootstrap registration plan is fixed and critical',()=>{
  const b=require(BOOTSTRAP),p=b.registrationPlan();
  assert.equal(p.action,ACTION); assert.equal(p.risk,'critical'); assert.equal(p.level,4);
  assert.equal(p.zero_input,true); assert.equal(p.arbitrary_path,false); assert.equal(p.arbitrary_command,false);
});
test('failure after first rename restores installer preimage and leaves owners unchanged',()=>{
  const h=require(HELPER),r=h.__test.rollbackFixture();
  assert.equal(r.ok,false); assert.equal(r.rollback_performed,true);
  assert.equal(r.installer_restored,true); assert.equal(r.owners_unchanged,true);
});

test('public apply takes no caller input',()=>{
  const h=require(HELPER);
  assert.equal(h.apply.length,0);
  assert.equal(h.preflight.length,0);
  assert.equal(h.manifest.length,0);
});

test('transactional test apply changes only installer and second apply is idempotent',()=>{
  const h=require(HELPER),r=h.__test.successFixture();
  assert.equal(r.first.ok,true); assert.equal(r.first.changed,true); assert.equal(r.first.rollback_performed,false);
  assert.equal(r.second.ok,true); assert.equal(r.second.changed,false);
  assert.equal(r.second.candidate_sha256,r.first.candidate_sha256);
  assert.equal(r.first_installer_sha,r.first.candidate_sha256);
  assert.equal(r.second_installer_sha,r.first.candidate_sha256);
  assert.equal(r.owners_unchanged,true);
  assert.equal(h.__test.applyToPaths,undefined);
  assert.equal(h.__test.rollbackFixture.length,0); assert.equal(h.__test.successFixture.length,0);
});
