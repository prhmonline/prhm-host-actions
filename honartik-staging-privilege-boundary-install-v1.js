'use strict';
/**
 * Honartik signed host-staging handoff: exact immutable review of THREE
 * already-reviewed manifests, no fourth manifest and no mutable ref.
 *
 * This is a deterministic, non-executable candidate constructor. The installed
 * trusted Host Actions executor alone may perform signed root installation.
 * Never accept a caller-provided path, approval, runtime callback or script.
 */
const crypto=require('node:crypto');
const ROOT='/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v2';
const UNIT='/etc/systemd/system/prhm-shared-registry-approval-v2.service';
const REPO='prhmonline/prhm-host-actions';
const PINS=Object.freeze({
 runner:Object.freeze({path:'manifests/honartik-shared-registry-v2-independent-root-launcher-stage-v2.json',
  blob:'cdf622e7b2db4e098f667a522c483e0b02b24bed'}),
 sidecar:Object.freeze({path:'manifests/honartik-shared-registry-v2-root-capabilities-stage-v1.json',
  blob:'a5e1fae442085cdbc59c4dbc2b82b83d6c1efebd'}),
 unit:Object.freeze({path:'manifests/honartik-shared-registry-v2-sidecar-unit-stage-v1.json',
  blob:'68f0ebfe75e1f12466277b80ad356eb3fb130f56'})
});
const OWNERS=Object.freeze({
 base:'4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406',
 executor:'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0',
 policy:'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174',
 mcp:'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166'
});
const HEX40=/^[a-f0-9]{40}$/;
const REL=/^(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/;
const blocked=code=>{throw Error('honartik_fixed_staging_boundary_'+code)};
const expect=(c,code)=>{if(!c)blocked(code)};
function blob(bytes){
 return crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0'))
  .update(bytes).digest('hex');
}
function exact(o,keys,code){
 expect(o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).sort().join('|')===keys.slice().sort().join('|'),code);
}
function decodeManifest(key,bytes){
 expect(Object.hasOwn(PINS,key),'unknown_reviewed_manifest');
 expect(Buffer.isBuffer(bytes)&&bytes.length>100&&bytes.length<250000,
  'manifest_bytes_missing_'+key);
 expect(blob(bytes)===PINS[key].blob,'manifest_sha_drift_'+key);
 let obj;
 try{obj=JSON.parse(bytes.toString('utf8'))}catch{blocked('invalid_manifest_json_'+key)}
 expect(obj.repo===REPO&&obj.project==='honartik','manifest_identity_'+key);
 return obj;
}
function inspectReview({manifestBytes,observedOwnerSha256}={}){
 exact(manifestBytes,Object.keys(PINS),'manifest_set');
 exact(observedOwnerSha256,Object.keys(OWNERS),'owner_set');
 const manifests={};
 for(const k of Object.keys(PINS))manifests[k]=decodeManifest(k,manifestBytes[k]);
 const a=manifests.runner,b=manifests.sidecar,u=manifests.unit;
 expect(a.schema==='prhm.honartik.registry-v2.independent-root-launcher-stage.v2'&&
  a.root===ROOT&&a.status==='REVIEWED_SOURCE_ONLY_NOT_STAGED'&&
  a.declared_runtime_source_count===28&&a.reviewed_code?.length===28&&
  a.standalone_execution_authorized===false&&a.root_staged===false&&
  a.signed_l4_issued===false&&a.signed_l4_consumed===false,
  'runner_manifest_not_released');
 expect(b.schema==='prhm.honartik.shared-registry-v2.root-capability-provider-stage.v1'&&
  b.status==='NOT_STAGED'&&b.destination_root===ROOT&&
  b.files?.length===7&&b.installation_authorized===false&&
  b.requires_fresh_signed_l4===true,'sidecar_manifest_not_released');
 expect(u.schema==='prhm.honartik.shared-registry-v2.sidecar-unit-stage.v1'&&
  u.destination===UNIT&&u.status==='NOT_STAGED'&&
  u.installed===false&&u.l4_consumed===false&&
  u.non_installable_without_signed_five_field_bootstrap===true&&
  u.source_units?.[0]?.source_path===
   'systemd/prhm-shared-registry-approval-v2.service'&&
  u.source_units?.[0]?.git_blob_sha1===
   'dc87ad2937b63ab965944cef081f55a6a0984cdd',
  'systemd_unit_not_reviewed');
 const files=[...a.reviewed_code,...b.files];
 expect(files.length===35,'incomplete_root_bundle');
 const seen=new Set();
 const reviewed=files.map(f=>{
  expect(f&&typeof f.source_path==='string'&&REL.test(f.source_path)&&
   !f.source_path.includes('..')&&
   f.destination===ROOT+'/'+f.source_path&&
   HEX40.test(f.source_commit)&&HEX40.test(f.git_blob_sha1)&&
   !seen.has(f.destination),'runtime_file_not_pinned');
  seen.add(f.destination);
  return Object.freeze({source_path:f.source_path,
   source_commit:f.source_commit,git_blob_sha1:f.git_blob_sha1,
   destination:f.destination});
 });
 expect(seen.has(ROOT+'/prhm-action-registry-v2-independent-root-launcher-v1.cjs')&&
  seen.has(ROOT+'/prhm-action-registry-v2-isolated-socket-v1.cjs')&&
  seen.has(ROOT+'/prhm-action-registry-v2-root-consumed-receipt-v1.cjs')&&
  seen.has(ROOT+'/manifests/honartik-shared-registry-v2-unified-root-closure-v1.json')&&
  seen.has(ROOT+'/manifests/honartik-shared-registry-v2-reviewed-runtime-stage-v1.json'),
  'critical_root_source_missing');
 for(const [name,pin] of Object.entries(OWNERS))
  expect(observedOwnerSha256[name]===pin,'owner_sha_drift_'+name);
 // These bytes were supplied to a local review function. A trusted root
 // host must independently attest Git objects and exact current owner bytes.
 // An attacker can provide matching copies to this function, so a result
 // here is never evidence of root staging or an actual signed L4.
 return Object.freeze({
  schema:'prhm.honartik.staging-boundary-candidate.v1',
  source_repo:REPO,
  stage_sources:Object.freeze(reviewed),
  stage_source_count:35,
  signed_unit:Object.freeze({
   destination:UNIT,
   source_path:u.source_units[0].source_path,
   source_commit:u.source_units[0].source_commit,
   git_blob_sha1:u.source_units[0].git_blob_sha1
  }),
  owner_sha256:Object.freeze({...OWNERS}),
  reviewed_manifest_blobs:Object.freeze(Object.fromEntries(
   Object.entries(PINS).map(([k,v])=>[k,v.blob]))),
  trusted_host_attested:false,root_staged:false,
  signed_l4_approved:false,installation_authorized:false,
  action_registered:false,production_mutated:false,
  can_request_l4:false,can_execute:false,
  required_action:'prhm_action_registry_install_v1'
 });
}
function install(){blocked('trusted_signed_root_bootstrap_required')}
module.exports=Object.freeze({PINS,OWNERS,ROOT,UNIT,blob,inspectReview,install});
