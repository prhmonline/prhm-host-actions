'use strict';
/**
 * Source-only transactional root bootstrap plan for the exact Honartik V2 release.
 * No operator-facing executable, FS writes, approval requests, credential reads,
 * service control or production staging. A separately SHA-bound and signed root
 * launcher must durably persist the journal BEFORE creating any directory/file,
 * persist each completion, fsync, and verify postconditions independently.
 *
 * A crash with an unrecorded write is INDETERMINATE, never auto-retry / replay.
 */
const crypto=require('node:crypto');
const layout=require('./prhm-action-registry-v2-root-bootstrap-layout-v1.cjs');
const stage=require('./manifests/honartik-shared-registry-v2-reviewed-runtime-stage-v1.json');
const release=require('./manifests/honartik-config-center-registry-release-v2.json');
const JPATH='/var/lib/prhm-agent-selfmaint-exec/registry-bootstrap-v2-journal.json';
const FILE_MODE=0o600;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const blob=b=>crypto.createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=s=>{throw Error('registry_v2_txn_'+s)};
const need=(c,s)=>{if(!c)fail(s)};
function exact(x,keys,code){
 need(x&&typeof x==='object'&&!Array.isArray(x)&&
   Object.keys(x).sort().join('|')===keys.slice().sort().join('|'),code);
}
function immutablePlan(){
 const p=layout.immutablePlan();
 need(p.required_dirs.length===10&&
   stage.files.length===20&&stage.destination_root===
   '/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v2'&&
   stage.status==='NOT_STAGED'&&stage.installation_authorized===false&&
   release.action==='honartik_config_center_readonly_enroll_v1',
   'release_or_stage_drift');
 const files=stage.files.map(f=>{
   need(f.destination===stage.destination_root+'/'+f.source_path&&
     /^[a-f0-9]{40}$/.test(f.git_blob_sha1)&&
     /^[a-f0-9]{40}$/.test(f.source_commit)&&
     !f.destination.includes('..'),'untrusted_file_path_or_git_pin');
   return Object.freeze({path:f.destination,git_path:f.source_path,
     git_commit:f.source_commit,git_blob_sha1:f.git_blob_sha1,uid:0,gid:0,
     mode:FILE_MODE});
 });
 need(new Set(files.map(f=>f.path)).size===20,'duplicate_file_target');
 const paths=p.required_dirs.map(x=>x.path);
 for(const file of files)need(paths.includes(
   require('node:path').posix.dirname(file.path)),
   'file_parent_not_in_allowlist');
 for(const file of files){
   need(!Object.values(release.registry_owners).some(o=>o.path===file.path),
     'protected_owner_target_forbidden');
   need(!release.assets.some(a=>a.path===file.path),'registered_asset_target_forbidden');
 }
 need(!paths.includes(JPATH)&&
   !files.some(f=>f.path===JPATH),'journal_destination_conflict');
 return Object.freeze({schema:'prhm.registry-v2.bootstrap-transaction-plan.v1',
   release_source_commit:stage.project_source_commit,
   release_manifest_commit:stage.release_manifest_commit,
   release_manifest_sha256:stage.release_manifest_sha256,
   approval_arguments_sha256:stage.approval_arguments_sha256,
   journal_path:JPATH,
   dirs:Object.freeze(p.required_dirs),
   files:Object.freeze(files),
   protected_owners:Object.freeze(Object.fromEntries(
     Object.entries(release.registry_owners)
       .map(([k,v])=>[k,Object.freeze({path:v.path,sha256:v.before_sha256})]))),
   // These are real gating deficiencies, never substitute source CI for trust.
   independently_signed_root_launcher_installed:false,
   five_field_route_installed:false,
   trusted_capabilities_provider_installed:false,
   production_staged:false,
   safe_to_execute:false
 });
}
function attestBundle(blobs){
 const p=immutablePlan();
 exact(blobs,p.files.map(x=>x.git_path),'exact_git_bundle_required');
 const digest={};
 let total=0;
 for(const f of p.files){
   const b=blobs[f.git_path];
   need(Buffer.isBuffer(b)&&b.length>0&&b.length<=4000000,
      'missing_or_oversize_bytes_'+f.git_path);
   total+=b.length;need(total<=24000000,'bundle_size_limit');
   need(blob(b)===f.git_blob_sha1,'git_blob_sha_mismatch_'+f.git_path);
   digest[f.path]=sha(b);
 }
 return Object.freeze({schema:'prhm.registry-v2.attested-bundle.v1',
   count:p.files.length,total_bytes:total,source_sha256:Object.freeze(digest),
   bound_to_immutable_git_objects:true,producer_authorized:false});
}
function proposal({request_id,bundle,observed}={}){
 const p=immutablePlan();
 need(UUID.test(request_id||''),'request_id_invalid');
 exact(bundle,['schema','count','total_bytes','source_sha256',
   'bound_to_immutable_git_objects','producer_authorized'],'bundle_shape');
 need(bundle.schema==='prhm.registry-v2.attested-bundle.v1'&&
   bundle.count===20&&bundle.bound_to_immutable_git_objects===true&&
   bundle.producer_authorized===false,'bundle_untrusted');
 exact(bundle.source_sha256,p.files.map(x=>x.path),'bundle_file_set_mismatch');
 need(Object.values(bundle.source_sha256).every(x=>/^[a-f0-9]{64}$/.test(x)),
    'bundle_sha_invalid');
 exact(observed,['owners','directories','files','journal_absent','socket_absent'],
   'observations_shape');
 need(observed.journal_absent===true&&observed.socket_absent===true,
   'journal_or_socket_existing');
 exact(observed.owners,Object.keys(p.protected_owners),'owner_set_mismatch');
 for(const [key,o] of Object.entries(p.protected_owners))
   need(observed.owners[key]===o.sha256,'owner_drift_'+key);
 exact(observed.directories,p.dirs.map(x=>x.path),'directory_set_drift');
 exact(observed.files,p.files.map(x=>x.path),'file_set_drift');
 for(const f of p.files)
   need(observed.files[f.path]==='absent','stage_target_already_occupied');
 const newDirs=[];
 for(const d of p.dirs){
   need(['absent','secure-root-0700'].includes(observed.directories[d.path]),
     'insecure_existing_directory_'+d.key);
   if(observed.directories[d.path]==='absent')newDirs.push(d.path);
 }
 const allDirs=new Set(p.dirs.map(x=>x.path));
 // Explicit topological order: parent before child, never an arbitrary path.
 newDirs.sort((a,b)=>a.split('/').length-b.split('/').length||
   p.dirs.findIndex(x=>x.path===a)-p.dirs.findIndex(x=>x.path===b));
 for(const d of newDirs){
   const parent=require('node:path').posix.dirname(d);
   need(allDirs.has(parent)?
       (newDirs.includes(parent)||observed.directories[parent]==='secure-root-0700'):
       true,'missing_stage_parent');
 }
 const operations=[
  ...newDirs.map(path=>Object.freeze({kind:'mkdir',path,uid:0,gid:0,mode:0o700})),
  ...p.files.map(f=>Object.freeze({kind:'create_file',path:f.path,
    sha256:bundle.source_sha256[f.path],git_blob_sha1:f.git_blob_sha1,
    uid:0,gid:0,mode:FILE_MODE}))
 ];
 return Object.freeze({
   schema:'prhm.registry-v2.bootstrap-proposal.v1',
   request_id,source_commit:p.release_source_commit,
   manifest_commit:p.release_manifest_commit,
   manifest_sha256:p.release_manifest_sha256,
   arguments_sha256:p.approval_arguments_sha256,
   journal_path:JPATH,phase:'PROPOSAL_NOT_AUTHORIZED',
   approved:false,consumed:false,mutated:false,
   independent_root_launcher_required:true,
   operation_count:operations.length,
   operations:Object.freeze(operations),
   existing_directory_paths:Object.freeze(p.dirs.filter(d=>
      observed.directories[d.path]==='secure-root-0700').map(x=>x.path)),
   rollback_requires_original_request_and_review:true
 });
}
function rollbackCandidate({transaction,completed,live}={}){
 const p=immutablePlan();
 exact(transaction,['schema','request_id','source_commit','manifest_commit',
   'manifest_sha256','arguments_sha256','journal_path','phase','approved',
   'consumed','mutated','independent_root_launcher_required','operation_count',
   'operations','existing_directory_paths',
   'rollback_requires_original_request_and_review'],'proposal_shape');
 need(transaction.schema==='prhm.registry-v2.bootstrap-proposal.v1'&&
   UUID.test(transaction.request_id)&&transaction.phase==='PROPOSAL_NOT_AUTHORIZED'&&
   transaction.journal_path===JPATH&&
   transaction.source_commit===p.release_source_commit&&
   transaction.manifest_commit===p.release_manifest_commit&&
   transaction.manifest_sha256===p.release_manifest_sha256&&
   transaction.arguments_sha256===p.approval_arguments_sha256,
   'journal_identity_drift');
 need(transaction.approved===false&&transaction.consumed===false&&
   transaction.mutated===false&&transaction.independent_root_launcher_required===true&&
   transaction.rollback_requires_original_request_and_review===true,
   'not_a_source_only_proposal');
 const expected=transaction.operations;
 need(Array.isArray(expected)&&expected.length===transaction.operation_count&&
   transaction.operation_count>=20&&transaction.operation_count<=30,
   'operation_count_invalid');
 need(Number.isSafeInteger(completed)&&completed>=0&&completed<=expected.length,
   'completed_count_invalid');
 exact(live,['files','directories','owners','journal_persisted','stale_lock_absent'],
   'recovery_observation_shape');
 need(live.journal_persisted===true&&live.stale_lock_absent===true,
   'durable_journal_or_lock_missing');
 exact(live.owners,Object.keys(p.protected_owners),'recovery_owner_set_invalid');
 for(const [key,o] of Object.entries(p.protected_owners))
   need(live.owners[key]===o.sha256,'recovery_owner_drift_'+key);
 exact(live.files,p.files.map(f=>f.path),'recovery_file_set_invalid');
 exact(live.directories,p.dirs.map(d=>d.path),'recovery_directory_set_invalid');
 const used=expected.slice(0,completed);
 const createdFiles=new Map(used.filter(s=>s.kind==='create_file').map(s=>[s.path,s]));
 const createdDirs=new Set(used.filter(s=>s.kind==='mkdir').map(s=>s.path));
 for(const f of p.files){
   const state=live.files[f.path];
   if(createdFiles.has(f.path)){
     exact(state,['type','sha256','uid','gid','mode'],'recovery_file_metadata_invalid');
     const recorded=createdFiles.get(f.path);
     need(state.type==='file'&&state.sha256===recorded.sha256&&
       state.uid===0&&state.gid===0&&state.mode===FILE_MODE,
       'untrusted_created_file_'+f.git_path);
   } else need(state==='absent','unrecorded_or_foreign_file');
 }
 for(const d of p.dirs){
   const state=live.directories[d.path];
   exact(state,['exists','uid','gid','mode','empty'],'recovery_dir_shape');
   need(state.exists===true&&state.uid===0&&state.gid===0&&state.mode===0o700,
     'recovery_directory_drift');
   if(createdDirs.has(d.path)){
     // A newly created parent may still contain planned children.
     // Only independently verified emptiness AFTER file/child cleanup
     // can authorize rmdir. Never infer emptiness from this proposal.
     need(typeof state.empty==='boolean','recovery_dir_empty_unknown');
   }
 }
 const steps=[...used].reverse().map(s=>Object.freeze(
   s.kind==='create_file'?
     {kind:'unlink_if_exact_sha256',path:s.path,sha256:s.sha256}:
     {kind:'rmdir_only_if_verified_empty',path:s.path}
 ));
 return Object.freeze({schema:'prhm.registry-v2.rollback-candidate.v1',
   request_id:transaction.request_id,review_required:true,
   independently_signed_recovery_required:true,auto_execute:false,
   approval_replayed:false,steps:Object.freeze(steps)});
}
module.exports=Object.freeze({JPATH,FILE_MODE,immutablePlan,attestBundle,proposal,rollbackCandidate});
