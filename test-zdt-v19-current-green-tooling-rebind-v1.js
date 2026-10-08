'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

const FILE='./zdt-v19-current-green-tooling-rebind-v1.js';

test('binds exact previous GREEN pins to the current 17/17 GREEN artifacts',()=>{
  const m=require(FILE);
  assert.equal(m.ACTION,'control_plane_agent_zdt_v19_current_green_tooling_rebind_v1');
  assert.equal(m.SOURCE_COMMIT,'16f728f8fb1156976f78ad8819b2ac21ce4b5701');
  assert.equal(m.OLD_IMPL_SHA,'338eb685cbb9e7613834c468c9591a83e5b6eb31bd4f65e74e8e31763b68baa3');
  assert.equal(m.NEW_IMPL_SHA,'9d0160917167a19038dcb3ffaaf7ed83638e0b124afffbb16962f6d27796e6fd');
  assert.equal(m.OLD_TEST_SHA,'0efebf24f901b309de5d612b71bbe3bbd7a215b266b8e1222f8706d258e80e75');
  assert.equal(m.NEW_TEST_SHA,'87eba07f79befccc7b47dd6a537ba9d4a0c4839da6ab40cdcbac797a8afa3722');
  assert.equal(m.production_mutation,false);
  assert.equal(m.database_mutation,false);
  assert.equal(m.directadmin_mutation,false);
  assert.equal(m.runtime_mutation,false);
});

test('rebinds exactly one implementation pin and one test pin',()=>{
  const m=require(FILE);
  const before=[
    'prefix',
    "const oldImpl='"+m.OLD_IMPL_SHA+"';",
    "const oldTest='"+m.OLD_TEST_SHA+"';",
    'suffix'
  ].join('\n');
  const out=m.patchToolingSource(before);
  assert.equal(out.ok,true);
  assert.equal(out.already_rebound,false);
  assert.equal(out.replacement_count,2);
  assert.equal(out.content.includes(m.OLD_IMPL_SHA),false);
  assert.equal(out.content.includes(m.OLD_TEST_SHA),false);
  assert.equal(out.content.split(m.NEW_IMPL_SHA).length-1,1);
  assert.equal(out.content.split(m.NEW_TEST_SHA).length-1,1);
});

test('is exact-idempotent only for the fully rebound post-state',()=>{
  const m=require(FILE);
  const post=m.NEW_IMPL_SHA+'\n'+m.NEW_TEST_SHA;
  const out=m.patchToolingSource(post);
  assert.equal(out.ok,true);
  assert.equal(out.already_rebound,true);
  assert.equal(out.replacement_count,0);
  assert.equal(out.content,post);
});

test('fails closed on missing, duplicate or mixed pin states',()=>{
  const m=require(FILE);
  assert.throws(()=>m.patchToolingSource('none'),/old_impl_pin_state/);
  assert.throws(()=>m.patchToolingSource(m.OLD_IMPL_SHA+'\n'+m.OLD_IMPL_SHA+'\n'+m.OLD_TEST_SHA),/old_impl_pin_state/);
  assert.throws(()=>m.patchToolingSource(m.OLD_IMPL_SHA+'\n'+m.NEW_TEST_SHA),/old_test_pin_state|new_test_pin_state/);
  assert.throws(()=>m.patchToolingSource(m.NEW_IMPL_SHA+'\n'+m.OLD_TEST_SHA),/old_impl_pin_state|new_impl_pin_state/);
});

test('exports no execution or mutation surface',()=>{
  const m=require(FILE);
  assert.equal(typeof m.patchToolingSource,'function');
  assert.equal(m.patchToolingSource.length,1);
  for(const forbidden of ['command','path','service','run','exec','spawn','apply','write','confirmation']){
    assert.equal(Object.hasOwn(m,forbidden),false);
  }
});
