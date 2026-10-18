'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const mod=require('./honartik-iticket-root-installer-semantics-audit-v1.cjs');
const owners=require('./honartik-iticket-root-installer-four-owner-review-v1.cjs');

const make=()=>"const EXPECTED={"+owners.ORDER.map(k=>k+":'"+owners.OWNERS[k].old+"'").join(',')+"};\n"+
  "function main(){ const rollback='saved'; return EXPECTED.base; }\n"+
  "// DO NOT RUN IN PRODUCTION, synthetic source-only contract fixture.\n";

test('synthetic valid original and four-pin candidate are both JS syntax PASS',()=>{
  const src=make(),rebound=owners.rebindForReview(src);
  const r=mod.staticReview(src,rebound);
  assert.equal(r.syntax_before,'PASS');
  assert.equal(r.syntax_after,'PASS');
  assert.equal(r.safe_to_install,false);
  assert.equal(r.production_mutation,false);
  assert.equal(r.source_exposed,false);
  assert.equal(r.requires_review_of_actual_write_targets,true);
  assert.notEqual(r.source_sha256,r.candidate_sha256);
});
test('refuses invalid original JavaScript syntax',()=>{
  assert.throws(()=>mod.staticReview('function {','function {'),/original_syntax_invalid/);
});
test('refuses invalid candidate JavaScript syntax',()=>{
  assert.throws(()=>mod.staticReview(make(), 'function {'),/candidate_syntax_invalid/);
});
test('refuses changes in side-effect operation references',()=>{
  assert.throws(()=>mod.staticReview(make(),make()+"\nfs.writeFileSync('/tmp/x','x');"),/operation_reference_changed_filesystem_write/);
  assert.throws(()=>mod.staticReview(make(),make()+"\nspawnSync('whoami');"),/operation_reference_changed_process_control/);
});
test('candidate cannot be trusted if current owner bytes are absent',()=>{
  assert.throws(()=>mod.audit({}),/inputs_required/);
  assert.throws(()=>mod.audit({installerBytes:Buffer.from(make()),liveOwnerBytes:{}}),/installer_source_sha_drift/);
});
test('pure module does not import filesystem or spawn executables',()=>{
  assert.deepEqual(Object.keys(mod).sort(),['HAZARDS','staticReview','audit'].sort());
  const src=fs.readFileSync(require.resolve('./honartik-iticket-root-installer-semantics-audit-v1.cjs'),'utf8');
  for(const x of ["require('node:fs')","require('node:child_process')","process.argv","process.env","writeFileSync(","execSync(","spawnSync(","runInNewContext(","runInThisContext("])
    assert.equal(src.includes(x),false,'should have no privileged path '+x);
});
test('auditor never reports installation approved',()=>{
  const a=mod.staticReview(make(),owners.rebindForReview(make()));
  assert.equal(a.safe_to_install,false);
  assert.equal(a.requires_approved_rollback,true);
  assert.equal(a.requires_fresh_signed_authorization,true);
});
