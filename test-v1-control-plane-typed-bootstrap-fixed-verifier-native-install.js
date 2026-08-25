'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const m=require('./control-plane-typed-bootstrap-fixed-verifier-native-install-v1.js');

test('fixed native installer contract is zero-input and current-baseline bound',()=>{
  assert.equal(m.ACTION,'control_plane_typed_bootstrap_fixed_verifier_native_install_v1');
  assert.equal(m.TARGET_ACTION,'control_plane_typed_bootstrap_fixed_verifier_bootstrap_v1');
  assert.equal(m.VERIFIER_SHA,'f5e3cb6a9ce6c88229ffbd2fafd1e48742562f8c3edbc7aac113e2cb4f292b5a');
  assert.equal(m.LEVEL4_REQUIRED,true);
  assert.equal(m.ZERO_INPUT,true);
  assert.deepEqual(m.BASELINE_SHA,{
    base:'e186036e8efd9c9663b977a20f62fb90cedb70b48bfa0f1fb48cbc53a64020cd',
    executor:'1e683d0962bc1e0503b9deb1f0d266ad44d6fc5d3c1566dc87f2f7733d4802bd',
    mcp:'44520b67bb352ab243698c5cf50b39d09a65c833fee9cfd3ebc5a50379ecaa71',
    policy:'76cca4574708709c921d67e91068e9f25508c6769f4d150718c8b068f870233d'
  });
});
