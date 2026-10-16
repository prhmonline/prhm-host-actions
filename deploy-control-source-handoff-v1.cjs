'use strict';
/*
 * NON-EXECUTABLE SOURCE HANDOFF, not a gateway registration manifest parser.
 * This never authorizes registration/install, cannot access the host, and must
 * fail if the handoff claims a callable action or a completed trust bootstrap.
 */
const crypto=require('node:crypto');
const SHA40=/^[a-f0-9]{40}$/;
const SHA64=/^[a-f0-9]{64}$/;
const REPO='prhmonline/prhm-host-actions';
const MANIFEST_PATH='manifests/deploy-control-l4-source-handoff-20261015.json';
const ACTION='deploy_control_cutover_install_v1';
const SOURCES=Object.freeze([
  'deploy-control-cutover-contract-v1.cjs',
  'deploy-control-cutover-fixture-v1.cjs',
  'deploy-control-cutover-temp-installer-v1.cjs',
  'deploy-control-l4-registration-readiness-v1.cjs',
  'deploy-control-l4-owner-preinstall-v1.cjs'
]);
const OWNERS=Object.freeze({
  '/opt/prhm-agent-selfmaint/server.js':'4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406',
  '/opt/prhm-agent-selfmaint-exec/server.js':'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0',
  '/opt/prhm-company-control-plane/config/approval-policy.json':'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174',
  '/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js':'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166'
});
const BLOCKERS=Object.freeze([
  'runtime_dispatcher_issuer_preconsumption_gate_not_wired',
  'root_installer_not_reviewed_or_registered',
  'effective_sudo_and_external_hooks_not_attested',
  'critical_approval_not_authorized_or_consumed'
]);
const POLICY=Object.freeze({
  repository:'prhmonline/prhm-company-control-plane',
  commit:'acffc7f9e02073f7aaf6ba92777f7acff6481f81',
  path:'config/approval-policy.json',
  git_blob_sha:'702fbed1d0a9936e6fc0e42694f3e1ce6941f4bc',
  raw_sha256:'ed527c12ee330b8e1f5616fcb0c712eb89dddd9395197b2d855f00d3deea0678',
  object_sha256:'732c21b15a54b47dced724e1f5be1c70aa1bd6c41cc5f94c5d2f600e45c36acb'
});
const CENTRAL=Object.freeze({
  repository:'prhmonline/deploy-control',
  commit:'e9d4b435a8bb73a507b2a7dd4affc4caa455d524',
  issuer_preconsumption_check_wired:false
});
const hex256=b=>crypto.createHash('sha256').update(b).digest('hex');
const hexBlob=b=>crypto.createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
const fail=c=>{throw new Error('source_handoff_'+c)};
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const ownKeys=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).sort().join('|')===keys.slice().sort().join('|');
function verify({manifestBytes,manifestSha256,sourceCommit,manifestCommit,
  readManifestAtCommit,readSourceAtCommit,readGitComparison}){
  if(!SHA64.test(manifestSha256||'')||!Buffer.isBuffer(manifestBytes)||
     manifestBytes.length<500||manifestBytes.length>25000||
     hex256(manifestBytes)!==manifestSha256)
    fail('manifest_sha_drift');
  if(!SHA40.test(sourceCommit||'')||!SHA40.test(manifestCommit||'')||
     sourceCommit===manifestCommit)fail('two_commit_identity_required');
  if(typeof readManifestAtCommit!=='function'||typeof readSourceAtCommit!=='function'||
     typeof readGitComparison!=='function')
    fail('trusted_git_readers_required');
  // Merely having two different 40-character IDs never proves chronological
  // ancestry or a manifest-only second commit. A trusted read-only Git compare
  // adapter must attest that the source is the exact parent of the manifest.
  const comparison=readGitComparison(REPO,sourceCommit,manifestCommit);
  if(!comparison||comparison.status!=='ahead'||comparison.ahead_by!==1||
     comparison.behind_by!==0||comparison.total_commits!==1||
     comparison.base_commit?.sha!==sourceCommit||
     comparison.merge_base_commit?.sha!==sourceCommit||
     !Array.isArray(comparison.commits)||comparison.commits.length!==1||
     comparison.commits[0]?.sha!==manifestCommit||
     !Array.isArray(comparison.files)||comparison.files.length!==1||
     comparison.files[0]?.filename!==MANIFEST_PATH||
     comparison.files[0]?.status!=='added')
    fail('git_ancestry_or_manifest_only_commit_not_proven');
  const exact=readManifestAtCommit(manifestCommit,REPO,MANIFEST_PATH);
  if(!Buffer.isBuffer(exact)||!exact.equals(manifestBytes))fail('manifest_git_commit_mismatch');
  let m;
  try{m=JSON.parse(manifestBytes.toString('utf8'))}catch{fail('manifest_invalid_json')}
  if(!ownKeys(m,['schema_version','source_repository','source_commit','action','operation',
    'kind','production_executable','registered','approved','gateway_manifest_compatible',
    'policy','central_dispatcher','owner_preimages','evidence_sources','blockers']))
    fail('manifest_schema');
  if(m.schema_version!=='prhm.deploy-control.source-handoff.v1'||
     m.source_repository!==REPO||m.source_commit!==sourceCommit||
     m.action!==ACTION||m.operation!=='host_action.'+ACTION||
     m.kind!=='review_only_nonexecuting'||m.production_executable!==false||
     m.registered!==false||m.approved!==false||
     m.gateway_manifest_compatible!==false)fail('manifest_claims_runtime_authority');
  if(!eq(m.policy,POLICY)||!eq(m.central_dispatcher,CENTRAL)||
     !eq(m.owner_preimages,OWNERS)||!eq(m.blockers,BLOCKERS))
    fail('trusted_preimages_or_blockers_drift');
  if(!Array.isArray(m.evidence_sources)||m.evidence_sources.length!==SOURCES.length)
    fail('source_count');
  for(let i=0;i<SOURCES.length;i++){
    const rec=m.evidence_sources[i];
    if(!ownKeys(rec,['source_path','git_blob_sha','sha256'])||
       rec.source_path!==SOURCES[i]||
       !SHA40.test(rec.git_blob_sha||'')||!SHA64.test(rec.sha256||''))
      fail('source_entry_invalid');
    const bytes=readSourceAtCommit(sourceCommit,REPO,rec.source_path);
    if(!Buffer.isBuffer(bytes)||hexBlob(bytes)!==rec.git_blob_sha||
       hex256(bytes)!==rec.sha256)fail('source_blob_sha_mismatch');
  }
  return Object.freeze({
    ok:true,kind:'source_review_evidence_only',source_commit:sourceCommit,
    manifest_commit:manifestCommit,git_manifest_commit_distance:1,
    verified_source_blobs:SOURCES.length,
    verified_owner_preimage_pins:Object.keys(OWNERS).length,
    can_register:false,can_install:false,can_request_level4:false,
    can_consume_level4:false,production_modified:false,
    missing_runtime_gates:Object.freeze([...BLOCKERS])
  });
}
module.exports=Object.freeze({REPO,MANIFEST_PATH,ACTION,SOURCES,OWNERS,BLOCKERS,POLICY,CENTRAL,verify});
