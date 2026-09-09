const test=require('node:test');
const assert=require('node:assert/strict');
const mod=require('./central-offsite-manifest-validator-repair-v1.js');
const OLD="function manifest(s){const root=path.join(SNAP_ROOT,s),f=path.join(root,'MANIFEST');const r=cp.spawnSync('/usr/bin/sha256sum',['-c','MANIFEST'],{cwd:root,encoding:'utf8',timeout:180000,maxBuffer:400000});if(r.status!==0)throw Error('central_offsite_manifest_verify_failed');return sh(f)}";
test('replaces exactly the legacy sha256sum validator with strict eight-key metadata validation',()=>{
  assert.equal(typeof mod.buildCandidateFromText,'function');
  const source="'use strict';\n"+OLD+"\nmodule.exports={};\n";
  const out=mod.buildCandidateFromText(source);
  assert.equal(out.replacement_count,1);
  assert.equal(out.text.includes("sha256sum'),['-c','MANIFEST']"),false);
  assert.match(out.text,/central_offsite_manifest_keyset_invalid/);
  assert.match(out.text,/central_offsite_manifest_snapshot_mismatch/);
  assert.match(out.text,/central_offsite_manifest_created_utc_invalid/);
  assert.match(out.text,/central_offsite_manifest_exclusion_flag_invalid/);
  assert.match(out.text,/shifa_managed_separately/);
  assert.match(out.text,/drtarjomeh_customer_files_excluded/);
  assert.match(out.text,/source_code_excluded/);
  assert.match(out.text,/secret_config_excluded/);
});
test('fails closed on anchor drift',()=>{
  assert.throws(()=>mod.buildCandidateFromText("function manifest(s){return 'different'}"),/central_offsite_manifest_validator_anchor_mismatch/);
});
