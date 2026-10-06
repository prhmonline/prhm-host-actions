'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');

const H='./installer-refresh-state-helper-rebase-v37-host-action.js';
const B='./bootstrap-host-actions-installer-refresh-state-helper-rebase-v37.js';
const PURE='./installer-refresh-state-helper-rebase-v37.js';
const SURFACE='./safeFiles-installer-refresh-l4-binding-repair-surface-v1.js';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');

function reviewedPair(){
  const src=fs.readFileSync(SURFACE,'utf8');
  const tick=String.fromCharCode(96);
  const mark='const STATE_SCRIPT=String.raw'+tick;
  const a=src.indexOf(mark)+mark.length;
  const b=src.indexOf(tick+';\nfunction runState',a);
  assert.ok(a>=mark.length&&b>a,'reviewed state script anchor missing');
  const target=src.slice(a,b);
  const targetExpr="const p='/run/prhm-installer-refresh-l4-binding-repair-v1-'+process.pid+'.js';";
  const currentExpr="const p=path.join(ROOT,'prhm-installer-refresh-l4-binding-repair-v1-'+process.pid+'.js');";
  assert.equal(target.split(targetExpr).length-1,1);
  const current=target.replace(targetExpr,currentExpr);
  return {current,target};
}

test('host action binds exactly the reviewed V37 transform',()=>{
  const h=require(H),p=require(PURE);
  assert.equal(h.ACTION,p.ACTION);
  assert.equal(h.CURRENT_SHA,p.CURRENT_STATE_SHA);
  assert.equal(h.TARGET_SHA,p.TARGET_STATE_SHA);
  assert.equal(h.CURRENT_EXPR,p.CURRENT_TMP_EXPR);
  assert.equal(h.TARGET_EXPR,p.TARGET_TMP_EXPR);
  assert.equal(h.TARGET,'/opt/prhm-agent-selfmaint-exec/actions/installer-refresh-l4-binding-repair-state-v1.js');
});

test('candidate transforms exact current state helper and is idempotent on target',()=>{
  const h=require(H),pair=reviewedPair();
  assert.equal(sha(Buffer.from(pair.current,'utf8')),h.CURRENT_SHA);
  assert.equal(sha(Buffer.from(pair.target,'utf8')),h.TARGET_SHA);
  const a=h.buildCandidate(pair.current);
  assert.equal(a.changed,true);
  assert.equal(a.sha256,h.TARGET_SHA);
  assert.equal(a.bytes.toString('utf8'),pair.target);
  const b=h.buildCandidate(pair.target);
  assert.equal(b.changed,false);
  assert.equal(b.sha256,h.TARGET_SHA);
});

test('candidate fails closed on any unknown preimage',()=>{
  const h=require(H);
  assert.throws(()=>h.buildCandidate('not-the-live-helper'),/v37_current_state_sha_mismatch/);
});

test('manifest and registration plan are fixed Level-4 zero-input',()=>{
  const h=require(H),m=h.manifest(),b=require(B).registrationPlan();
  for(const x of [m,b]){
    assert.equal(x.action,'control_plane_installer_refresh_state_helper_rebase_v37');
    assert.equal(x.level,4);
    assert.equal(x.risk,'critical');
    assert.equal(x.zero_input,true);
    assert.equal(x.arbitrary_command,false);
    assert.equal(x.arbitrary_path,false);
    assert.equal(x.database_mutation,false);
  }
  assert.equal(m.target,'/opt/prhm-agent-selfmaint-exec/actions/installer-refresh-l4-binding-repair-state-v1.js');
  assert.equal(b.helper_file,'installer-refresh-state-helper-rebase-v37-host-action.js');
});

test('public production entrypoints accept no caller input',()=>{
  const h=require(H);
  assert.equal(h.preflight.length,0);
  assert.equal(h.apply.length,0);
  assert.equal(h.manifest.length,0);
});
