'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const IMPL=path.join(__dirname,'installer-refresh-l4-current-rebind-v1.js');

test('implementation exists and pins the current reviewed bindings',()=>{
  assert.equal(fs.existsSync(IMPL),true,'current rebind implementation is missing');
  const m=require(IMPL);
  assert.equal(m.OLD_SAFEFILES_SHA,'c2a5fe6c67190d5b22464803ca8dfa98cb54d701611b80515d9ec5fa16b90c90');
  assert.equal(m.CURRENT_SAFEFILES_SHA,'41416010bd28f7eb38c57d5e0482a56d782c0f8fca42a961a8480e6f0c88a6d5');
  assert.equal(m.OLD_V19_IMPL_SHA,'33b14dff259393cbc1b989ca4721204845a742ce4912a139586e3af71faf85e6');
  assert.equal(m.CURRENT_V19_IMPL_SHA,'3eefb2281cd850208b0dff6d69f0211d54efa566b89b440d99da79a560c812dd');
  assert.equal(m.OLD_V19_TEST_SHA,'cd70da0dbf9e9b58d8bf2e66d1284eb4460863e95cc0156e9922f472562a64d1');
  assert.equal(m.CURRENT_V19_TEST_SHA,'fbbd56bd5decfc9a714f03cfff4b571e2fd36a9e130ac12c4a63f586156987e8');
  assert.equal(m.CONFIRM,'CONFIRM_LEVEL_4_CRITICAL');
});

test('rebindSurface replaces only the exact stale SafeFiles parent and preserves L4 semantics',()=>{
  const m=require(IMPL);
  const source=[
    "const BASE_SHA='"+m.OLD_SAFEFILES_SHA+"';",
    "const CONFIRM='CONFIRM_LEVEL_4_CRITICAL';",
    "const REQUEST_TOOL='control_plane_installer_refresh_l4_binding_repair_request_v1';",
    "const APPLY_TOOL='control_plane_installer_refresh_l4_binding_repair_apply_v1';"
  ].join('\n');
  const out=m.rebindSurface(source);
  assert.equal(out.replacement_count,1);
  assert.equal(out.production_mutation,false);
  assert.equal(out.content.includes(m.OLD_SAFEFILES_SHA),false);
  assert.equal(out.content.includes(m.CURRENT_SAFEFILES_SHA),true);
  assert.match(out.content,/CONFIRM_LEVEL_4_CRITICAL/);
  assert.doesNotMatch(out.content,/CONFIRM_LEVEL_3_PRODUCTION/);
});

test('rebindV19 replaces exactly the reviewed implementation and test preimages',()=>{
  const m=require(IMPL);
  const source=[
    "const EXPECTED_IMPL='"+m.OLD_V19_IMPL_SHA+"';",
    "const EXPECTED_TEST='"+m.OLD_V19_TEST_SHA+"';",
    "const RISK='critical';",
    "const CONFIRM='CONFIRM_LEVEL_4_CRITICAL';"
  ].join('\n');
  const out=m.rebindV19(source);
  assert.equal(out.replacement_count,2);
  assert.equal(out.production_mutation,false);
  assert.equal(out.content.includes(m.OLD_V19_IMPL_SHA),false);
  assert.equal(out.content.includes(m.OLD_V19_TEST_SHA),false);
  assert.equal(out.content.includes(m.CURRENT_V19_IMPL_SHA),true);
  assert.equal(out.content.includes(m.CURRENT_V19_TEST_SHA),true);
  assert.match(out.content,/critical/);
  assert.match(out.content,/CONFIRM_LEVEL_4_CRITICAL/);
});

test('rebinds fail closed on ambiguity and expose no execution surface',()=>{
  const m=require(IMPL);
  assert.throws(()=>m.rebindSurface('no stale parent'),/safeFiles_anchor_count:0/);
  assert.throws(()=>m.rebindSurface(m.OLD_SAFEFILES_SHA+'\n'+m.OLD_SAFEFILES_SHA),/safeFiles_anchor_count:2/);
  assert.throws(()=>m.rebindV19('no v19 pins'),/v19_impl_anchor_count:0/);
  assert.throws(()=>m.rebindV19(m.OLD_V19_IMPL_SHA+'\n'+m.OLD_V19_TEST_SHA+'\n'+m.OLD_V19_TEST_SHA),/v19_test_anchor_count:2/);
  assert.equal(m.rebindSurface.length,1);
  assert.equal(m.rebindV19.length,1);
  for(const forbidden of ['command','path','service','run','exec','spawn','apply','write']) {
    assert.equal(Object.hasOwn(m,forbidden),false);
  }
});
