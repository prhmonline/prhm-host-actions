'use strict';
// Declarative Git-pinned node1 read-only probe bundle; no installer or executable apply.
const crypto=require('node:crypto');
const SOURCE_REVISION='4f723783b40f3dd97ea26d021d1a04b8879008b9';
const FILES=Object.freeze([
  {
    "path": "node1-live-vm-backup-v1.js",
    "sha": "3757f5d82886055435c4818d126d84c7c4d9dc26"
  },
  {
    "path": "node1-vm-geometry-readonly-v1.js",
    "sha": "1fe2518fd4dcc320815e46375d5f8ec4c3c69fce"
  },
  {
    "path": "node1-vm-geometry-runner-v1.js",
    "sha": "b0e96415aa6faa571a106fe75c678cfb3008fa88"
  },
  {
    "path": "node1-vm-geometry-agent-api-route-v1.js",
    "sha": "24f061abaa6412f971db10e31f096f52c8b3d8ee"
  },
  {
    "path": "node1-vm-geometry-registration-plan-v1.js",
    "sha": "04db9de53424c9a2f4b1ab65973acf82f326a117"
  },
  {
    "path": "node1-vm-geometry-trusted-executor-v1.js",
    "sha": "064f6188feb25a20a8aa4c85b11aa5cda289a9ab"
  },
  {
    "path": "node1-vm-geometry-attestor-v1.js",
    "sha": "96ef7c2d809468d9b82c2872ed6beff326b3d094"
  }
].map(x=>Object.freeze(x)));
const ROOT='/opt/prhm-node1-readonly/vm-geometry-v1';
const SIGNING_KEY='/etc/prhm-agent3/keys/node1-readonly-receipts-ed25519.pem';
const VERIFICATION_KEY='/etc/prhm-agent3/trust/node1-readonly-receipts-ed25519.pem';
const REQUIRED_HOST_GATES=Object.freeze([
 'node_runtime_verified',
 'libvirt_readonly_session_verified',
 'qemu_img_readonly_verified',
 'both_vm_identities_verified',
 'both_vm_sources_verified',
 'signing_key_root_only',
 'verification_key_out_of_band_pinned',
 'agent3_fixed_node1_transport_authorized',
 'agent_api_mcp_owner_sha_match',
 'rollback_snapshot_available',
 'logging_and_health_checks_enabled',
 'sha_bound_level4_approval'
]);
function gitBlobSha(bytes){
 if(!Buffer.isBuffer(bytes))throw Error('source_buffer_required');
 return crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
}
function inspectFiles(fileBuffers){
 const failures=[];
 if(!fileBuffers||typeof fileBuffers!=='object'||Array.isArray(fileBuffers)
   ||Object.keys(fileBuffers).sort().join('|')!==FILES.map(x=>x.path).sort().join('|'))
   failures.push('bundle_file_inventory_invalid');
 for(const f of FILES)
   if(!Buffer.isBuffer(fileBuffers?.[f.path])||gitBlobSha(fileBuffers[f.path])!==f.sha)
     failures.push('blob_mismatch:'+f.path);
 return Object.freeze({exact_blobs_match:failures.length===0,failures:Object.freeze(failures)});
}
function readiness(observed={}){
 const reasons=REQUIRED_HOST_GATES.filter(x=>observed?.[x]!==true);
 return Object.freeze({
  source_revision:SOURCE_REVISION,
  read_only:true,
  host:'server1.prhm.ir',
  source_files_verified:observed?.source_files_verified===true,
  host_prerequisites_pass:reasons.length===0&&observed?.source_files_verified===true,
  authorization_present:observed?.sha_bound_level4_approval===true,
  ready_to_apply:false,
  production_mutation:false,
  missing:Object.freeze([...reasons,...(observed?.source_files_verified===true?[]:['source_files_unverified'])])
 });
}
function plan(){
 return Object.freeze({
  schema_version:'prhm.node1-geometry-attested-bundle.v1',
  source_revision:SOURCE_REVISION,
  host:'server1.prhm.ir',
  node1_files:FILES,root:ROOT,
  signing_key_path:SIGNING_KEY,
  verifier_key_path:VERIFICATION_KEY,
  key_material_in_git:false,
  requires_level4_critical:true,
  trusted_agent3_only:true,
  existing_agent2_failover_unchanged:true,
  requires_signed_recovery:true,
  requires_sha_bound_deployment:true,
  requires_rollback_to_prior_healthy:true,
  must_not_reset_git_on_failure:true,
  required_gates:REQUIRED_HOST_GATES,
  approval_granted:false,
  installed:false,
  production_mutation:false
 });
}
module.exports={SOURCE_REVISION,FILES,ROOT,SIGNING_KEY,VERIFICATION_KEY,REQUIRED_HOST_GATES,gitBlobSha,inspectFiles,readiness,plan};
if(require.main===module)process.stdout.write(JSON.stringify(plan())+'\n');
