'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');

const IMPL=path.join(__dirname,'installer-refresh-current-binding-rebind-v1.js');

test('rebinds only the exact stale SafeFiles base while preserving Level-4 surface',()=>{
  const m=require(IMPL);
  const source=[
    "const BASE_SHA='41416010bd28f7eb38c57d5e0482a56d782c0f8fca42a961a8480e6f0c88a6d5';",
    "const CONFIRM='CONFIRM_LEVEL_4_CRITICAL';",
    "const REQUEST_TOOL='control_plane_installer_refresh_l4_binding_repair_request_v1';",
    "const STATUS_TOOL='control_plane_installer_refresh_l4_binding_repair_status_v1';",
    "const APPLY_TOOL='control_plane_installer_refresh_l4_binding_repair_apply_v1';"
  ].join('\n');
  const out=m.patchSurface(source);
  assert.equal(out.ok,true);
  assert.equal(out.production_mutation,false);
  assert.equal(out.database_mutation,false);
  assert.equal(out.replacement_count,1);
  assert.equal(out.content.includes(m.OLD_SAFEFILES_SHA),false);
  assert.equal(out.content.includes(m.LIVE_SAFEFILES_SHA),true);
  assert.equal(out.content.includes('CONFIRM_LEVEL_4_CRITICAL'),true);
  assert.equal(out.content.includes('CONFIRM_LEVEL_3_PRODUCTION'),false);
  for(const name of [
    'control_plane_installer_refresh_l4_binding_repair_request_v1',
    'control_plane_installer_refresh_l4_binding_repair_status_v1',
    'control_plane_installer_refresh_l4_binding_repair_apply_v1'
  ]) assert.equal(out.content.includes(name),true);
});

test('rebinds the exact V19 builder preimages to the current GREEN 17/17 artifacts',()=>{
  const m=require(IMPL);
  const source=[
    "const EXPECTED_IMPL='3eefb2281cd850208b0dff6d69f0211d54efa566b89b440d99da79a560c812dd';",
    "const EXPECTED_TEST='fbbd56bd5decfc9a714f03cfff4b571e2fd36a9e130ac12c4a63f586156987e8';",
    "const CONFIRM='CONFIRM_LEVEL_4_CRITICAL';"
  ].join('\n');
  const out=m.patchBuilder(source);
  assert.equal(out.ok,true);
  assert.equal(out.replacement_count,2);
  assert.equal(out.content.includes(m.OLD_V19_IMPL_SHA),false);
  assert.equal(out.content.includes(m.OLD_V19_TEST_SHA),false);
  assert.equal(out.content.includes(m.CURRENT_V19_IMPL_SHA),true);
  assert.equal(out.content.includes(m.CURRENT_V19_TEST_SHA),true);
  assert.equal(out.content.includes('CONFIRM_LEVEL_4_CRITICAL'),true);
  assert.equal(out.content.includes('CONFIRM_LEVEL_3_PRODUCTION'),false);
});

test('fails closed on missing, duplicate, or already-current anchors',()=>{
  const m=require(IMPL);
  assert.throws(()=>m.patchSurface('no base anchor'),/surface_base_anchor_count:0/);
  const s="const BASE_SHA='"+m.OLD_SAFEFILES_SHA+"';";
  assert.throws(()=>m.patchSurface(s+'\n'+s),/surface_base_anchor_count:2/);
  assert.throws(()=>m.patchSurface("const BASE_SHA='"+m.LIVE_SAFEFILES_SHA+"';"),/surface_already_current/);

  assert.throws(()=>m.patchBuilder('no builder anchors'),/builder_impl_anchor_count:0/);
  const b="const EXPECTED_IMPL='"+m.OLD_V19_IMPL_SHA+"';\nconst EXPECTED_TEST='"+m.OLD_V19_TEST_SHA+"';";
  assert.throws(()=>m.patchBuilder(b+'\n'+b),/builder_impl_anchor_count:2/);
  assert.throws(()=>m.patchBuilder(
    "const EXPECTED_IMPL='"+m.CURRENT_V19_IMPL_SHA+"';\nconst EXPECTED_TEST='"+m.CURRENT_V19_TEST_SHA+"';"
  ),/builder_already_current/);
});

test('exports no caller-controlled command, path, service, confirmation, or arbitrary write surface',()=>{
  const m=require(IMPL);
  assert.equal(m.patchSurface.length,1);
  assert.equal(m.patchBuilder.length,1);
  for(const forbidden of ['command','path','service','confirmation','run','exec','spawn','apply','write'])
    assert.equal(Object.prototype.hasOwnProperty.call(m,forbidden),false);
  assert.equal(m.CONFIRM,'CONFIRM_LEVEL_4_CRITICAL');
});
