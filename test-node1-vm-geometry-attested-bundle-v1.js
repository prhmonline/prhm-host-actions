'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const bundle=require('./node1-vm-geometry-attested-bundle-v1');
const files=()=>Object.fromEntries(bundle.FILES.map(x=>[x.path,fs.readFileSync(path.join(__dirname,x.path))]));
test('exact release bundle closes all runtime require dependencies',()=>{
 const expected=[
 'node1-live-vm-backup-v1.js','node1-vm-geometry-readonly-v1.js','node1-vm-geometry-runner-v1.js',
 'node1-vm-geometry-agent-api-route-v1.js','node1-vm-geometry-registration-plan-v1.js',
 'node1-vm-geometry-trusted-executor-v1.js','node1-vm-geometry-attestor-v1.js'].sort();
 assert.deepEqual(bundle.FILES.map(x=>x.path).sort(),expected);
 assert.equal(new Set(bundle.FILES.map(x=>x.sha)).size,expected.length);
 const result=bundle.inspectFiles(files());
 assert.equal(result.exact_blobs_match,true);
 assert.equal(result.failures.length,0);
});
test('preexisting source file change cannot pass manifest',()=>{
 const values=files();values['node1-vm-geometry-attestor-v1.js']=Buffer.from('tampered');
 const r=bundle.inspectFiles(values);
 assert.equal(r.exact_blobs_match,false);
 assert(r.failures.includes('blob_mismatch:node1-vm-geometry-attestor-v1.js'));
});
test('hidden extra file cannot pass manifest',()=>{
 const v=files();v['/etc/shadow']=Buffer.from('unexpected');
 assert(bundle.inspectFiles(v).failures.includes('bundle_file_inventory_invalid'));
});
test('all theoretical host prerequisites cannot self-authorize deployment',()=>{
 const o=Object.fromEntries(bundle.REQUIRED_HOST_GATES.map(k=>[k,true]));
 o.source_files_verified=true;
 const status=bundle.readiness(o);
 assert.equal(status.host_prerequisites_pass,true);
 assert.equal(status.ready_to_apply,false);
 assert.equal(status.production_mutation,false);
});
test('missing signing key, runtime or level4 blocks host prerequisite readiness',()=>{
 for(const k of ['node_runtime_verified','signing_key_root_only','verification_key_out_of_band_pinned','sha_bound_level4_approval']){
   const r=bundle.readiness({...Object.fromEntries(bundle.REQUIRED_HOST_GATES.map(key=>[key,true])),source_files_verified:true,[k]:false});
   assert.equal(r.host_prerequisites_pass,false);
   assert(r.missing.includes(k));
 }
});
test('deployment plan has no key material, no mutable runtime operation and keeps Git history',()=>{
 const p=bundle.plan();
 assert.equal(p.approval_granted,false);
 assert.equal(p.installed,false);
 assert.equal(p.key_material_in_git,false);
 assert.equal(p.must_not_reset_git_on_failure,true);
 assert.equal(p.requires_rollback_to_prior_healthy,true);
 assert.equal(p.trusted_agent3_only,true);
 assert.equal(p.existing_agent2_failover_unchanged,true);
 assert.equal(p.signing_key_path,'/etc/prhm-agent3/keys/node1-readonly-receipts-ed25519.pem');
 assert.equal(p.verifier_key_path,'/etc/prhm-agent3/trust/node1-readonly-receipts-ed25519.pem');
});
