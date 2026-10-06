'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');

const HELPER='./installer-refresh-state-helper-installer-v37.js';
const BOOTSTRAP='./bootstrap-host-actions-installer-refresh-state-helper-installer-v37.js';
const SURFACE='./safeFiles-installer-refresh-l4-binding-repair-surface-v1.js';
const sha=s=>crypto.createHash('sha256').update(s,'utf8').digest('hex');

function reviewedPair(){
  const src=fs.readFileSync(SURFACE,'utf8');
  const mark='const STATE_SCRIPT=String.raw\`';
  const a=src.indexOf(mark)+mark.length;
  const b=src.indexOf('\`;\nfunction runState',a);
  assert.ok(a>=mark.length&&b>a,'reviewed state script anchor missing');
  const target=src.slice(a,b);
  const targetExpr="const p='/run/prhm-installer-refresh-l4-binding-repair-v1-'+process.pid+'.js';";
  const currentExpr="const p=path.join(ROOT,'prhm-installer-refresh-l4-binding-repair-v1-'+process.pid+'.js');";
  assert.equal(target.split(targetExpr).length-1,1);
  const current=target.replace(targetExpr,currentExpr);
  return {current,target};
}

test('manifest is fixed zero-input exact-target Level-4 metadata',()=>{
  const h=require(HELPER),m=h.manifest();
  assert.equal(m.action,'control_plane_installer_refresh_state_helper_install_v37');
  assert.equal(m.target,'/opt/prhm-agent-selfmaint-exec/actions/installer-refresh-l4-binding-repair-state-v1.js');
  assert.equal(m.current_sha256,'b3b99e33fccb9122bcb5155cce64e4a6e9c73ce2404860d43aaa0def2a12db1e');
  assert.equal(m.target_sha256,'b80f1f75e1794b7ffd21a432564454a5da42245b533e1b8cae09c4c73113c2cb');
  assert.equal(m.zero_input,true);
  assert.equal(m.arbitrary_path,false);
  assert.equal(m.arbitrary_command,false);
  assert.equal(m.database_mutation,false);
});

test('candidate is exactly the reviewed repo state helper and idempotent',()=>{
  const h=require(HELPER),{current,target}=reviewedPair();
  assert.equal(sha(current),h.manifest().current_sha256);
  assert.equal(sha(target),h.manifest().target_sha256);
  const a=h.buildCandidate(current),b=h.buildCandidate(target);
  assert.equal(a.changed,true);
  assert.equal(a.sha256,h.manifest().target_sha256);
  assert.equal(a.content,target);
  assert.equal(b.changed,false);
  assert.equal(b.sha256,h.manifest().target_sha256);
  assert.equal(b.content,target);
});

test('candidate fails closed on unreviewed preimage',()=>{
  const h=require(HELPER);
  assert.throws(()=>h.buildCandidate('drift'),/v37_installer_preimage_mismatch/);
});

test('public production functions take no caller input',()=>{
  const h=require(HELPER);
  assert.equal(h.preflight.length,0);
  assert.equal(h.apply.length,0);
  assert.equal(h.manifest.length,0);
});

test('fixture rollback restores exact preimage after injected post-rename failure',()=>{
  const h=require(HELPER),r=h.__test.rollbackFixture();
  assert.equal(r.ok,false);
  assert.equal(r.rollback_performed,true);
  assert.equal(r.target_restored,true);
});

test('fixture success changes once and second run is idempotent',()=>{
  const h=require(HELPER),r=h.__test.successFixture();
  assert.equal(r.first.ok,true);
  assert.equal(r.first.changed,true);
  assert.equal(r.first.rollback_performed,false);
  assert.equal(r.second.ok,true);
  assert.equal(r.second.changed,false);
  assert.equal(r.first_sha,r.target_sha256);
  assert.equal(r.second_sha,r.target_sha256);
});

test('bootstrap plan is critical, zero-input and non-executing',()=>{
  const b=require(BOOTSTRAP),p=b.registrationPlan();
  assert.equal(p.action,'control_plane_installer_refresh_state_helper_install_v37');
  assert.equal(p.operation,'host_action.control_plane_installer_refresh_state_helper_install_v37');
  assert.equal(p.level,4);
  assert.equal(p.risk,'critical');
  assert.equal(p.zero_input,true);
  assert.equal(p.arbitrary_path,false);
  assert.equal(p.arbitrary_command,false);
  assert.equal(p.production_mutation,false);
  assert.equal(p.database_mutation,false);
});
