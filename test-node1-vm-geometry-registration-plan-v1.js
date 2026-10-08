'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const p=require('./node1-vm-geometry-registration-plan-v1.js');
test('fixed registration plan never performs installation or grants authorization',()=>{
 const a=p.plan();
 assert.equal(a.schema_version,'prhm.node1-readonly-registration-plan.v1');
 assert.equal(a.tool,'node1_vm_geometry_readonly_v1');
 assert.equal(a.route,'/node1/vm-geometry/read-only');
 assert.equal(a.source_repo,'prhmonline/prhm-host-actions');
 assert.equal(a.source_commit,'8b2b7077d760bc0aaccf21f8ce503903bb19ff61');
 assert.equal(a.zero_input,true);
 assert.equal(a.read_only,true);
 assert.equal(a.registered,false);
 assert.equal(a.installed,false);
 assert.equal(a.request_created,false);
 assert.equal(a.deploy_approved,false);
 assert.equal(a.ready_for_deployment,false);
 assert.equal(a.required_change_approval,'CONFIRM_LEVEL_4_CRITICAL');
 assert.equal(a.fixed_node1_transport_required,true);
 assert.equal(a.sha_pinned_agent_api_and_mcp_baselines_required,true);
});
test('only five unique source files and exact Git blob identities may be staged',()=>{
 const files=p.FILES;
 assert.equal(files.length,5);
 assert.equal(new Set(files.map(x=>x.path)).size,5);
 for(const f of files){
  assert(/^[a-f0-9]{40}$/.test(f.sha));
  assert(/^node1-[a-z0-9.-]+$/.test(f.path));
  assert(Object.isFrozen(f));
 }
 assert(Object.isFrozen(files));
 const staged=Object.fromEntries(files.map(x=>[x.path,x.sha]));
 assert.deepEqual(p.verifyStagedBlobs(staged),{
  exact_blobs_match:true,ready_for_production:false,level4_required:true
 });
});
test('missing, mismatched, or additional source file blocks registration release',()=>{
 const staged=Object.fromEntries(p.FILES.map(x=>[x.path,x.sha]));
 delete staged[p.FILES[0].path];
 assert.throws(()=>p.verifyStagedBlobs(staged),/staged_file_count_mismatch/);
 const wrong=Object.fromEntries(p.FILES.map(x=>[x.path,x.sha]));
 wrong[p.FILES[2].path]='f'.repeat(40);
 assert.throws(()=>p.verifyStagedBlobs(wrong),/staged_blob_mismatch/);
 const extra=Object.fromEntries(p.FILES.map(x=>[x.path,x.sha]));
 extra['/etc/shadow']='0'.repeat(40);
 assert.throws(()=>p.verifyStagedBlobs(extra),/staged_file_count_mismatch/);
});
test('readonly registration does not include root-script execution or deployment authority',()=>{
 const x=p.plan();
 assert(!JSON.stringify(x).includes('approval_token'));
 assert(!JSON.stringify(x).includes('ssh_password'));
 assert(!JSON.stringify(x).includes('can_apply:true'));
 assert.equal(x.production_mutation,false);
});
