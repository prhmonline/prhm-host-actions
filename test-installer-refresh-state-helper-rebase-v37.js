'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');

const FILE='./installer-refresh-state-helper-rebase-v37.js';
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

test('binds exact live state helper to reviewed sandbox-path target',()=>{
  const m=require(FILE);
  assert.equal(m.ACTION,'control_plane_installer_refresh_state_helper_rebase_v37');
  assert.equal(m.CURRENT_STATE_SHA,'b3b99e33fccb9122bcb5155cce64e4a6e9c73ce2404860d43aaa0def2a12db1e');
  assert.equal(m.TARGET_STATE_SHA,'b80f1f75e1794b7ffd21a432564454a5da42245b533e1b8cae09c4c73113c2cb');
  assert.equal(m.CURRENT_TMP_EXPR,"const p=path.join(ROOT,'prhm-installer-refresh-l4-binding-repair-v1-'+process.pid+'.js');");
  assert.equal(m.TARGET_TMP_EXPR,"const p='/run/prhm-installer-refresh-l4-binding-repair-v1-'+process.pid+'.js';");
  assert.equal(m.production_mutation,false);
  assert.equal(m.database_mutation,false);
});

test('reviewed repo surface proves exact b3b99e33 to b80f1f75 transform',()=>{
  const m=require(FILE);
  const {current,target}=reviewedPair();
  assert.equal(sha(current),m.CURRENT_STATE_SHA);
  assert.equal(sha(target),m.TARGET_STATE_SHA);
  const out=m.patchStateHelper(current);
  assert.equal(out.old_sha256,m.CURRENT_STATE_SHA);
  assert.equal(out.new_sha256,m.TARGET_STATE_SHA);
  assert.equal(out.replacement_count,1);
  assert.equal(out.content,target);
});

test('exports only a pure exact-preimage source transformer',()=>{
  const m=require(FILE);
  assert.equal(typeof m.patchStateHelper,'function');
  assert.equal(m.patchStateHelper.length,1);
  for(const forbidden of ['apply','write','command','path','exec','spawn','service','confirmation']){
    assert.equal(Object.hasOwn(m,forbidden),false);
  }
});

test('fails closed on any source other than exact live preimage',()=>{
  const m=require(FILE);
  assert.throws(()=>m.patchStateHelper('not-current-state-helper'),/v37_current_state_sha_mismatch/);
});
