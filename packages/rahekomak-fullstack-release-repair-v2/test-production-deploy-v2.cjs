'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const test=require('node:test');
const helper=path.join(__dirname,'production-deploy-v2.cjs');
const src=fs.readFileSync(helper,'utf8');
const root='/home/prhm/projects/generated/rahekomak';
const baseline='d61140507300b4e2fc6650f2fc5e4b769543d9937dd2ff58574827af9c40696f';
const required=['emergency','mental-health','violence','addiction','medical',
  'social-support','legal','child-youth','medicine-poisoning','hiv-sexual-health'];
function parseViaIsolatedSmoke(input){
  // No network, writes or application deploy. Extract only the categories
  // validation expression and evaluate in an isolated VM against fixture data.
  const vm=require('node:vm');
  const start=src.indexOf('  const required = [');
  const end=src.indexOf('  return { public: web.status',start);
  assert.ok(start>0 && end>start);
  let validator=src.slice(start,end);
  validator=validator.replace(/fail\('([^']+)'\)/g,"(()=>{throw Error('$1')})()");
  const context={data:input,Set};
  vm.runInNewContext(validator,context,{timeout:700});
}
test('source identity is SHA-bound and no legacy 8-category comparison remains',()=>{
  assert.match(src,new RegExp(baseline));
  assert.match(src,/13917a36df76c0dfdd75f4a84111ba68391f166e/);
  assert.doesNotMatch(src,/data\.data\.length\s*!==\s*8/);
  assert.match(src,/expected_head_missing_or_invalid/);
  assert.match(src,/git_worktree_not_clean/);
  assert.match(src,/deploy_failed_rolled_back/);
});
test('all ten expected categories pass',()=>{
  assert.doesNotThrow(()=>parseViaIsolatedSmoke({data:required.map(slug=>({slug}))}));
});
test('additive new category does not break future deploys',()=>{
  assert.doesNotThrow(()=>parseViaIsolatedSmoke({data:required.concat('future-approved-route').map(slug=>({slug}))}));
});
test('missing any required safety/help category fails closed',()=>{
  for(const missing of required)
    assert.throws(()=>parseViaIsolatedSmoke({data:required.filter(s=>s!==missing).map(slug=>({slug}))}),/api_smoke_categories/);
});
test('duplicate category, missing slug and malformed schema all fail closed',()=>{
  for(const data of [
    {data:required.concat(required[0]).map(slug=>({slug}))},
    {data:required.slice(0,9).map(slug=>({slug})).concat({})},
    {data:'not an array'}, {}, null
  ])assert.throws(()=>parseViaIsolatedSmoke(data),/api_smoke_categories/);
});
test('deployment helper has no import-time apply, and is deliberately not registered',()=>{
  const helperMod=require('./production-deploy-v2.cjs');
  assert.equal(typeof helperMod.apply,'function');
  assert.equal(helperMod.ROOT,root);
  assert.ok(!src.includes('RAHEKOMAK_RELEASE_APPROVAL_MODE=approved_web_only'));
});
