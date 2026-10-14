'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const P=require('./prhm-action-registry-v2-bootstrap-transaction-plan-v1.cjs');
const runtime=require('./manifests/honartik-shared-registry-v2-reviewed-runtime-stage-v1.json');
const validId='12345678-1234-4234-8234-123456789abc';
function blobs(){
 const o={};
 for(const f of runtime.files){
  const r=cp.spawnSync('git',['show',f.source_commit+':'+f.source_path],
    {cwd:__dirname,timeout:15000,maxBuffer:5000000});
  assert.equal(r.status,0,'required Git source unavailable: '+f.source_path);
  o[f.source_path]=r.stdout;
 }
 return o;
}
const originals=P.immutablePlan();
function observed(dirState='absent'){
 const o={owners:{},directories:{},files:{},
   journal_absent:true,socket_absent:true};
 for(const [key,item] of Object.entries(originals.protected_owners))
    o.owners[key]=item.sha256;
 for(const d of originals.dirs)o.directories[d.path]=dirState;
 for(const f of originals.files)o.files[f.path]='absent';
 return o;
}
function evidence(txn,completed){
 const o={owners:{},directories:{},files:{},
   journal_persisted:true,stale_lock_absent:true};
 for(const [k,p] of Object.entries(originals.protected_owners))
   o.owners[k]=p.sha256;
 const recorded=txn.operations.slice(0,completed);
 const doneFiles=new Map(recorded.filter(x=>x.kind==='create_file')
     .map(x=>[x.path,x]));
 const doneDirs=new Set(recorded.filter(x=>x.kind==='mkdir').map(x=>x.path));
 for(const f of originals.files){
   const s=doneFiles.get(f.path);
   o.files[f.path]=s?{type:'file',sha256:s.sha256,uid:0,gid:0,mode:0o600}:'absent';
 }
 for(const d of originals.dirs){
   o.directories[d.path]=
     doneDirs.has(d.path)||txn.existing_directory_paths.includes(d.path)?
     {exists:true,uid:0,gid:0,mode:0o700,empty:false}:'absent';
 }
 return o;
}
test('fixed V2 transaction does not modify protected owner paths or expose an installer',()=>{
 const p=P.immutablePlan();
 assert.equal(p.files.length,20);
 assert.equal(p.dirs.length,10);
 assert.deepEqual(Object.keys(p.protected_owners).sort(),['base','executor','mcp','policy']);
 assert.equal(p.safe_to_execute,false);
 assert.equal(p.independently_signed_root_launcher_installed,false);
 assert.equal(p.five_field_route_installed,false);
 assert.equal(p.trusted_capabilities_provider_installed,false);
 assert.equal(p.production_staged,false);
 assert.equal(p.journal_path,'/var/lib/prhm-agent-selfmaint-exec/registry-bootstrap-v2-journal.json');
 for(const f of p.files){
   assert.ok(f.path.startsWith('/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v2/'));
   assert.ok(!Object.values(p.protected_owners).some(x=>x.path===f.path));
   assert.equal(f.mode,0o600);
 }
 assert.deepEqual(Object.keys(P).sort(),
 ['JPATH','FILE_MODE','immutablePlan','attestBundle','proposal','rollbackCandidate'].sort());
});
test('real immutable Git blobs generate a 20-file SHA-bound proposal and reverse-only rollback',()=>{
 const bundle=P.attestBundle(blobs());
 assert.equal(bundle.count,20);
 assert.ok(bundle.total_bytes>10000);
 const txn=P.proposal({request_id:validId,bundle,observed:observed()});
 assert.equal(txn.phase,'PROPOSAL_NOT_AUTHORIZED');
 assert.equal(txn.operation_count,30);
 assert.equal(txn.operations.filter(x=>x.kind==='mkdir').length,10);
 assert.equal(txn.operations.filter(x=>x.kind==='create_file').length,20);
 assert.equal(txn.approved,false);
 assert.equal(txn.consumed,false);
 assert.equal(txn.mutated,false);
 assert.equal(txn.rollback_requires_original_request_and_review,true);
 const steps=P.rollbackCandidate({transaction:txn,completed:30,live:evidence(txn,30)});
 assert.equal(steps.steps.length,30);
 assert.equal(steps.steps[0].kind,'unlink_if_exact_sha256');
 assert.equal(steps.steps[29].kind,'rmdir_only_if_verified_empty');
 assert.equal(steps.auto_execute,false);
 assert.equal(steps.approval_replayed,false);
});
test('tampered Git blob, missing file, extra key and forged attestation cannot pass',()=>{
 const data=blobs(),key=runtime.files[0].source_path;
 const altered={...data,[key]:Buffer.from(data[key])};
 altered[key][0]^=1;
 assert.throws(()=>P.attestBundle(altered),/git_blob_sha_mismatch/);
 const missing={...data};delete missing[key];
 assert.throws(()=>P.attestBundle(missing),/exact_git_bundle_required/);
 assert.throws(()=>P.attestBundle({...data,extra:Buffer.from('x')}),/exact_git_bundle_required/);
 const proof=P.attestBundle(data);
 const forged={...proof};
 assert.throws(()=>P.proposal({request_id:validId,bundle:forged,observed:observed()}),
   /bundle_untrusted/);
});
test('refuse journal replay, occupied socket/file, owner drift, weak existing directory',()=>{
 const bundle=P.attestBundle(blobs());
 const a=observed();a.journal_absent=false;
 assert.throws(()=>P.proposal({request_id:validId,bundle,observed:a}),
   /journal_or_socket_existing/);
 const b=observed();b.socket_absent=false;
 assert.throws(()=>P.proposal({request_id:validId,bundle,observed:b}),
   /journal_or_socket_existing/);
 const c=observed();c.files[originals.files[0].path]='occupied';
 assert.throws(()=>P.proposal({request_id:validId,bundle,observed:c}),
   /stage_target_already_occupied/);
 const d=observed();d.owners.mcp='0'.repeat(64);
 assert.throws(()=>P.proposal({request_id:validId,bundle,observed:d}),/owner_drift_mcp/);
 const e=observed();e.directories[originals.dirs[0].path]='world-writable';
 assert.throws(()=>P.proposal({request_id:validId,bundle,observed:e}),
   /insecure_existing_directory/);
 const f=observed('secure-root-0700');
 const p=P.proposal({request_id:validId,bundle,observed:f});
 assert.equal(p.operation_count,20);
 assert.equal(p.existing_directory_paths.length,10);
});
test('partial crash recovery refuses any unrecorded file or foreign SHA',()=>{
 const bundle=P.attestBundle(blobs());
 const txn=P.proposal({request_id:validId,bundle,observed:observed()});
 const firstFile=txn.operations.findIndex(x=>x.kind==='create_file');
 const partial=evidence(txn,firstFile+2);
 const rec=P.rollbackCandidate({transaction:txn,completed:firstFile+2,live:partial});
 assert.equal(rec.steps.length,firstFile+2);
 const i=originals.files[3].path;
 partial.files[i]={type:'file',sha256:'a'.repeat(64),uid:0,gid:0,mode:0o600};
 assert.throws(()=>P.rollbackCandidate({transaction:txn,completed:firstFile+2,live:partial}),
   /unrecorded_or_foreign_file/);
 const bad=evidence(txn,firstFile+2);
 const x=originals.files[0].path;
 bad.files[x].sha256='b'.repeat(64);
 assert.throws(()=>P.rollbackCandidate({transaction:txn,completed:firstFile+2,live:bad}),
   /untrusted_created_file/);
});
test('rollback refuses forged out-of-scope journal steps, unsafe directories and stale locks',()=>{
 const bundle=P.attestBundle(blobs());
 const txn=P.proposal({request_id:validId,bundle,observed:observed()});
 const live=evidence(txn,1);
 const clone={...txn,operations:[...txn.operations]};
 clone.operations[0]={...clone.operations[0],path:'/etc/ssh'};
 assert.throws(()=>P.rollbackCandidate({transaction:clone,completed:1,live}),
   /journal_mkdir_target_invalid/);
 const spoof={...txn,operations:[...txn.operations]};
 spoof.operations[10]={...spoof.operations[10],sha256:'x'.repeat(64)};
 assert.throws(()=>P.rollbackCandidate({transaction:spoof,completed:1,live}),
   /journal_file_target_invalid/);
 const stale=evidence(txn,1);stale.stale_lock_absent=false;
 assert.throws(()=>P.rollbackCandidate({transaction:txn,completed:1,live:stale}),
  /durable_journal_or_lock_missing/);
 const unsafe=evidence(txn,1);unsafe.directories[originals.dirs[0].path].mode=0o777;
 assert.throws(()=>P.rollbackCandidate({transaction:txn,completed:1,live:unsafe}),
  /recovery_directory_drift/);
 const owner=evidence(txn,1);owner.owners.policy='0'.repeat(64);
 assert.throws(()=>P.rollbackCandidate({transaction:txn,completed:1,live:owner}),
  /recovery_owner_drift_policy/);
});
