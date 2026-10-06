'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

const FILE='./installer-refresh-state-helper-rebase-v37.js';

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
