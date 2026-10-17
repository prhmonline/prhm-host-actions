'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const x = require('./honartik-iticket-root-installer-four-owner-review-v1.cjs');

const keyOrder = ['base','exec','policy','mcp'];
const fixture = () => {
  const pins = keyOrder.map((key, index) =>
    (index % 2 === 0 ? '"' + key + '"' : key) + ":'" + x.OWNERS[key].old + "'"
  ).join(',');
  return "'use strict';\nconst EXPECTED=Object.freeze({" + pins + "});\n" +
    "function validate(actual){for(const key of Object.keys(EXPECTED))" +
    "if(actual[key]!==EXPECTED[key]) throw Error('baseline_drift:'+key)}\n" +
    "// Synthetic fixture: source-only, never use as privileged installer\n";
};

test('contract has all four owner names with observed old and live SHA256', () => {
  assert.deepEqual(x.ORDER, keyOrder);
  assert.deepEqual(Object.keys(x.OWNERS), keyOrder);
  for (const key of keyOrder) {
    assert.match(x.OWNERS[key].old, /^[a-f0-9]{64}$/);
    assert.match(x.OWNERS[key].live, /^[a-f0-9]{64}$/);
    assert.notEqual(x.OWNERS[key].old,x.OWNERS[key].live);
  }
  assert.equal(x.OWNERS.exec.old,'6bba46890db31abc8eca7e7681753a4788c46170033a555a1106e05d0a7a66f9');
  assert.equal(x.OWNERS.exec.live,'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0');
});

test('four property SHA values change with byte-exact four-token reverse proof',()=>{
  const s=fixture(), after=x.rebindForReview(s);
  assert.equal(after.length,s.length);
  assert.notEqual(after,s);
  let reverted=after;
  for (const key of keyOrder) {
    assert.equal(after.split(x.OWNERS[key].live).length-1,1);
    assert.equal(after.includes(x.OWNERS[key].old),false);
    reverted=reverted.replace(x.OWNERS[key].live,x.OWNERS[key].old);
  }
  assert.equal(reverted,s);
  assert.ok(after.includes("baseline_drift:"));
});

test('rejects unknown or duplicate SHA properties',()=>{
  assert.throws(()=>x.rebindForReview(fixture()+"\nfoo:'"+'a'.repeat(64)+"'"),/four_sha_properties_required/);
  const dupe=fixture().replace("mcp:'"+x.OWNERS.mcp.old+"'", "exec:'"+x.OWNERS.mcp.old+"'");
  assert.throws(()=>x.rebindForReview(dupe),/owner_key_set_invalid/);
});

test('rejects wrongly paired expected SHA even when all four names exist',()=>{
  const s=fixture().replace(x.OWNERS.exec.old,x.OWNERS.base.old);
  assert.throws(()=>x.rebindForReview(s),/expected_owner_pin_drift_exec/);
});

test('rejects unexpected duplicate old pin or premature new SHA',()=>{
  assert.throws(()=>x.rebindForReview(fixture()+"\n// old "+x.OWNERS.base.old),/duplicate_expected_owner_pin_base/);
  assert.throws(()=>x.rebindForReview(fixture()+"\n// new "+x.OWNERS.policy.live),/new_owner_pin_already_present_policy/);
});

test('rejects missing keys, wrong format and missing source',()=>{
  assert.throws(()=>x.rebindForReview(fixture().replace('mcp:', 'unrelated:')),/owner_key_set_invalid/);
  assert.throws(()=>x.rebindForReview(fixture().replace(x.OWNERS.policy.old,'X'.repeat(64))),/four_sha_properties_required/);
  assert.throws(()=>x.rebindForReview(''),/source_size_or_type/);
});

test('refuses review candidate if original installer or owner bytes were not SHA verified',()=>{
  assert.throws(()=>x.makeReview(),/inputs_required/);
  assert.throws(()=>x.makeReview({installerBytes:Buffer.from(fixture()),liveOwnerBytes:{}}),/installer_source_sha_drift/);
});

test('cannot directly mutate server or claim signoff',()=>{
  const names=Object.keys(x).sort();
  assert.deepEqual(names, ['INSTALLER_SHA256','ORDER','OWNERS','makeReview','rebindForReview','sha256'].sort());
  const source=fs.readFileSync(require.resolve('./honartik-iticket-root-installer-four-owner-review-v1.cjs'),'utf8');
  for(const forbidden of [
    "require('node:fs')", "require('node:child_process')", "process.argv",
    "systemctl restart", "execSync(", "spawnSync(", "writeFileSync(",
    "chmodSync(", "unlinkSync(", "process.env.", "eval("
  ]) assert.equal(source.includes(forbidden), false, 'forbidden side-effect primitive '+forbidden);
  assert.equal(source.includes('install_authorized: false'),true);
  assert.equal(source.includes('pending_signed_one_time_level4_authorization: true'),true);
});
