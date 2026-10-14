'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const crypto=require('node:crypto');
const M=require('./manifests/honartik-shared-registry-v2-root-capabilities-stage-v1.json');
const R=require('./manifests/honartik-shared-registry-v2-reviewed-runtime-stage-v1.json');
const C=require('./prhm-action-registry-v2-trusted-base-capabilities-v1.cjs');
const B=require('./prhm-action-registry-v2-approval-http-adapter-v1.cjs');
const ROOT='/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v2';
function git(args){
 const r=cp.spawnSync('git',args,{cwd:__dirname,timeout:20000,maxBuffer:6000000});
 assert.equal(r.status,0,'immutable Git read failed: '+args.join(' '));
 return r.stdout;
}
const gitBlob=bytes=>crypto.createHash('sha1')
 .update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
test('seven separate root-sidecar files use immutable existing Git objects with no recursive manifest self-pin',()=>{
 assert.equal(M.schema,'prhm.honartik.shared-registry-v2.root-capability-provider-stage.v1');
 assert.equal(M.status,'NOT_STAGED');
 assert.equal(M.destination_root,ROOT);
 assert.equal(M.files.length,7);
 assert.equal(R.files.length,20);
 assert.equal(M.additional_root_files,7);
 assert.equal(M.expected_immutable_runtime_files,20);
 assert.equal(M.runtime_manifest,'manifests/honartik-shared-registry-v2-reviewed-runtime-stage-v1.json');
 const entries=new Map();
 for(const f of [...R.files,...M.files]){
  assert.match(f.source_commit,/^[0-9a-f]{40}$/);
  assert.match(f.git_blob_sha1,/^[0-9a-f]{40}$/);
  assert.equal(f.destination,ROOT+'/'+f.source_path);
  assert.equal(entries.has(f.source_path),false,'duplicate root path '+f.source_path);
  entries.set(f.source_path,f);
  assert.equal(gitBlob(git(['show',f.source_commit+':'+f.source_path])),
    f.git_blob_sha1,f.source_path);
  assert.match(git(['ls-tree',f.source_commit,'--',f.source_path]).toString('utf8'),
   /^100644 blob [a-f0-9]{40}\t/,f.source_path);
 }
 assert.equal(entries.size,27);
 assert.ok(entries.has('prhm-action-registry-v2-trusted-base-capabilities-v1.cjs'));
 assert.ok(entries.has('prhm-action-registry-v2-isolated-socket-v1.cjs'));
 assert.ok(entries.has('prhm-action-registry-v2-root-approval-transport-v1.cjs'));
 assert.ok(entries.has('prhm-action-registry-v2-root-sealed-token-vault-v1.cjs'));
 assert.ok(entries.has('prhm-action-registry-v2-root-attestation-v1.cjs'));
 assert.ok(entries.has('prhm-action-registry-v2-root-consumed-receipt-v1.cjs'));
 assert.ok(entries.has('manifests/honartik-shared-registry-v2-reviewed-runtime-stage-v1.json'));
 assert.deepEqual(C.CAPABILITIES,B.CAPABILITIES);
 // Every relative source dependency of the six added modules must live
 // inside the full 27-object fixed staging closure.
 for(const f of M.files.filter(x=>x.source_path.endsWith('.cjs'))){
  const source=git(['show',f.source_commit+':'+f.source_path]).toString('utf8');
  for(const found of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)){
    const dep=path.posix.normalize(path.posix.join(
      path.posix.dirname(f.source_path),found[1]));
    assert.ok(entries.has(dep),'missing pinned runtime dependency: '+f.source_path+' -> '+dep);
  }
 }
});
test('provider/test source SHA, separately committed, and explicit no-go flags',()=>{
 for(const f of [
  {source_path:M.source.path,source_commit:M.source.source_commit,git_blob_sha1:M.source.git_blob_sha1},
  {source_path:M.test.path,source_commit:M.test.source_commit,git_blob_sha1:M.test.git_blob_sha1},
  {source_path:M.consumed_receipt_test.path,source_commit:M.consumed_receipt_test.source_commit,git_blob_sha1:M.consumed_receipt_test.git_blob_sha1}
 ]){
  assert.equal(gitBlob(git(['show',f.source_commit+':'+f.source_path])),
    f.git_blob_sha1);
 }
 assert.equal(M.project,'honartik');
 for(const field of ['installation_authorized','production_mutation',
  'root_capabilities_installed','independent_sidecar_installed',
  'real_consumed_evidence_reader_installed','independent_root_launcher_installed',
  'dual_mcp_discovery_verified','real_recovery_verified'])
  assert.equal(M[field],false,field);
 assert.equal(M.requires_fresh_signed_l4,true);
 assert.equal(M.consumed_ledger_reader_implemented_in_source,true);
 assert.equal(M.consumed_ledger_reader_installed,false);
 assert.equal(C.readiness().can_register,false);
});
