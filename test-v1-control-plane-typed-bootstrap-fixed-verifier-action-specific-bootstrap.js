'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const b=require('./control-plane-typed-bootstrap-fixed-verifier-action-specific-bootstrap-v1.js');

test('bootstrap contract is fixed and bound to current control-plane baselines',()=>{
 assert.equal(b.ACTION,'control_plane_typed_bootstrap_fixed_verifier_bootstrap_v1');
 assert.equal(b.TARGET_TOOL,'control_plane_typed_bootstrap_embedded_payload_integrity_verify_v1');
 assert.equal(b.VERIFIER_SHA,'f5e3cb6a9ce6c88229ffbd2fafd1e48742562f8c3edbc7aac113e2cb4f292b5a');
 assert.deepEqual(b.BASELINE_SHAS,{base:'e186036e8efd9c9663b977a20f62fb90cedb70b48bfa0f1fb48cbc53a64020cd',executor:'1e683d0962bc1e0503b9deb1f0d266ad44d6fc5d3c1566dc87f2f7733d4802bd',mcp:'44520b67bb352ab243698c5cf50b39d09a65c833fee9cfd3ebc5a50379ecaa71',policy:'76cca4574708709c921d67e91068e9f25508c6769f4d150718c8b068f870233d'});
 assert.equal(b.CONTRACT.level4Required,true);
 assert.equal(b.CONTRACT.zeroInput,true);
 assert.equal(b.CONTRACT.arbitraryCommand,false);
 assert.equal(b.CONTRACT.arbitraryPath,false);
 assert.equal(b.CONTRACT.parkProductionMutation,false);
});

test('planner fails closed on any baseline drift',()=>{
 const good={...b.BASELINE_SHAS};
 for(const k of Object.keys(good)){const bad={...good,[k]:'0'.repeat(64)};assert.throws(()=>b.planRegistration(bad),new RegExp('baseline_sha_mismatch:'+k));}
});

test('planner emits only the fixed action registration contract',()=>{
 const p=b.planRegistration({...b.BASELINE_SHAS});
 assert.equal(p.ok,true); assert.equal(p.action,b.ACTION); assert.equal(p.target_tool,b.TARGET_TOOL);
 assert.deepEqual(Object.keys(p.inputs),[]); assert.equal(p.level4_required,true); assert.equal(p.production_application_mutation,false);
});
