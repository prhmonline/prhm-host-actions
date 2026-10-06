'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const HELPER='./installer-refresh-state-helper-rebase-v37-action.js';
const BOOTSTRAP='./bootstrap-host-actions-installer-refresh-state-helper-rebase-v37.js';
const SURFACE='./safeFiles-installer-refresh-l4-binding-repair-surface-v1.js';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');

function reviewedPair(){
  const h=require(HELPER);
  const src=fs.readFileSync(SURFACE,'utf8');
  const mark='const STATE_SCRIPT=String.raw'+String.fromCharCode(96);
  const start=src.indexOf(mark);
  assert.ok(start>=0,'state script start missing');
  const a=start+mark.length;
  const endMark=String.fromCharCode(96)+';\nfunction runState';
  const b=src.indexOf(endMark,a);
  assert.ok(b>a,'state script end missing');
  const target=src.slice(a,b);
  assert.equal(target.split(h.TARGET_TMP_EXPR).length-1,1);
  const current=target.replace(h.TARGET_TMP_EXPR,h.CURRENT_TMP_EXPR);
  assert.equal(sha(Buffer.from(current,'utf8')),h.CURRENT_STATE_SHA);
  assert.equal(sha(Buffer.from(target,'utf8')),h.TARGET_STATE_SHA);
  return {current,target};
}

test('manifest is fixed, zero-input and SHA-bound',()=>{
  const h=require(HELPER),m=h.manifest();
  assert.equal(m.action,'control_plane_installer_refresh_state_helper_rebase_v37');
  assert.equal(m.target,'/opt/prhm-agent-selfmaint-exec/actions/installer-refresh-l4-binding-repair-state-v1.js');
  assert.equal(m.current_sha256,'b3b99e33fccb9122bcb5155cce64e4a6e9c73ce2404860d43aaa0def2a12db1e');
  assert.equal(m.target_sha256,'b80f1f75e1794b7ffd21a432564454a5da42245b533e1b8cae09c4c73113c2cb');
  assert.equal(m.zero_input,true);
  assert.equal(m.arbitrary_command,false);
  assert.equal(m.arbitrary_path,false);
  assert.equal(m.production_mutation,false);
  assert.equal(m.database_mutation,false);
});

test('exact reviewed preimage transforms to exact reviewed target',()=>{
  const h=require(HELPER),p=reviewedPair();
  const r=h.__test.transformSource(p.current);
  assert.equal(r.old_sha256,h.CURRENT_STATE_SHA);
  assert.equal(r.new_sha256,h.TARGET_STATE_SHA);
  assert.equal(r.replacement_count,1);
  assert.equal(r.content,p.target);
});

test('transform fails closed on any preimage drift',()=>{
  const h=require(HELPER),p=reviewedPair();
  assert.throws(()=>h.__test.transformSource('X'+p.current.slice(1)),/current_state_sha_mismatch/);
});

test('bootstrap plan is fixed Level-4 critical registration metadata',()=>{
  const b=require(BOOTSTRAP),p=b.registrationPlan();
  assert.equal(p.action,'control_plane_installer_refresh_state_helper_rebase_v37');
  assert.equal(p.operation,'host_action.control_plane_installer_refresh_state_helper_rebase_v37');
  assert.equal(p.risk,'critical');
  assert.equal(p.level,4);
  assert.equal(p.zero_input,true);
  assert.equal(p.arbitrary_command,false);
  assert.equal(p.arbitrary_path,false);
});

test('fixture apply is transactional and idempotent',()=>{
  const h=require(HELPER),p=reviewedPair();
  const root=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'prhm-v37-success-'));
  try{
    const target=path.join(root,'state.js');
    fs.writeFileSync(target,p.current,{mode:0o600});
    const first=h.__test.applyToPath({target,backup_root:path.join(root,'backups')});
    assert.equal(first.ok,true);
    assert.equal(first.changed,true);
    assert.equal(sha(fs.readFileSync(target)),h.TARGET_STATE_SHA);
    const second=h.__test.applyToPath({target,backup_root:path.join(root,'backups')});
    assert.equal(second.ok,true);
    assert.equal(second.changed,false);
    assert.equal(second.already_current,true);
    assert.equal(sha(fs.readFileSync(target)),h.TARGET_STATE_SHA);
  }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('failure after rename restores exact preimage',()=>{
  const h=require(HELPER),p=reviewedPair();
  const root=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'prhm-v37-rollback-'));
  try{
    const target=path.join(root,'state.js');
    fs.writeFileSync(target,p.current,{mode:0o600});
    const before=sha(fs.readFileSync(target));
    const r=h.__test.applyToPath({target,backup_root:path.join(root,'backups'),inject_after_rename:true});
    assert.equal(r.ok,false);
    assert.equal(r.rollback_performed,true);
    assert.equal(sha(fs.readFileSync(target)),before);
    assert.equal(before,h.CURRENT_STATE_SHA);
  }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('public operational entrypoints accept no caller-controlled path or command',()=>{
  const h=require(HELPER);
  assert.equal(h.apply.length,0);
  assert.equal(h.preflight.length,0);
  assert.equal(h.manifest.length,0);
});
