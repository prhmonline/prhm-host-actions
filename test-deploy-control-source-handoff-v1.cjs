'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const h=require('./deploy-control-source-handoff-v1.cjs');
const manifestFile=process.env.PRHM_HANDOFF_MANIFEST_FIXTURE;
const sourceCommit=process.env.PRHM_HANDOFF_SOURCE_COMMIT;
const manifestCommit=process.env.PRHM_HANDOFF_MANIFEST_COMMIT;
const sourceRoot=process.env.PRHM_HANDOFF_SOURCE_ROOT;
const clone=x=>structuredClone(x);
function inputs(){
  const bytes=fs.readFileSync(manifestFile);
  return {
    manifestBytes:bytes,
    manifestSha256:require('node:crypto').createHash('sha256').update(bytes).digest('hex'),
    sourceCommit,manifestCommit,
    readManifestAtCommit:(sha,repo,path)=>{
      assert.equal(sha,manifestCommit);
      assert.equal(repo,h.REPO);assert.equal(path,h.MANIFEST_PATH);
      return fs.readFileSync(manifestFile);
    },
    readSourceAtCommit:(sha,repo,path)=>{
      assert.equal(sha,sourceCommit);
      assert.equal(repo,h.REPO);
      assert.ok(h.SOURCES.includes(path));
      return fs.readFileSync(require('node:path').join(sourceRoot,path));
    }
  };
}
test('source-only handoff is not a runtime installer or approval requester',()=>{
  assert.deepEqual(Object.keys(h).sort(),
    ['REPO','MANIFEST_PATH','ACTION','SOURCES','OWNERS','BLOCKERS','POLICY','CENTRAL','verify'].sort());
  assert.equal(h.ACTION,'deploy_control_cutover_install_v1');
  assert.equal(h.SOURCES.length,5);
  assert.equal(h.CENTRAL.issuer_preconsumption_check_wired,false);
  assert.equal(Object.keys(h.OWNERS).length,4);
});
test('missing signed release identity and blob readers fail closed',()=>{
  assert.throws(()=>h.verify({}),/manifest_sha_drift/);
  assert.throws(()=>h.verify({manifestBytes:Buffer.alloc(1000),
    manifestSha256:'a'.repeat(64)}),/manifest_sha_drift/);
});
if(![manifestFile,sourceCommit,manifestCommit,sourceRoot].every(Boolean)){
  test('real two-commit Git manifest and source fixtures required',
    {skip:'fetch from exact GitHub source and manifest commits and provide four env vars'},()=>{});
}else{
  test('actual two-commit manifest and five immutable source blobs authenticate',()=>{
    const r=h.verify(inputs());
    assert.equal(r.ok,true);assert.equal(r.kind,'source_review_evidence_only');
    assert.equal(r.verified_source_blobs,5);
    assert.equal(r.verified_owner_preimage_pins,4);
    for(const k of ['can_register','can_install','can_request_level4',
      'can_consume_level4','production_modified'])assert.equal(r[k],false);
    assert.deepEqual(r.missing_runtime_gates,[...h.BLOCKERS]);
  });
  test('manifest must reference source commit strictly before manifest commit',()=>{
    const x=inputs();
    x.sourceCommit=x.manifestCommit;
    assert.throws(()=>h.verify(x),/two_commit_identity_required/);
  });
  test('manifest drift, wrong Git blob and wrong source file SHA are denied',()=>{
    const x=inputs();
    x.manifestBytes=Buffer.from(x.manifestBytes);x.manifestBytes[35]^=1;
    assert.throws(()=>h.verify(x),/manifest_sha_drift/);
    const y=inputs();y.readManifestAtCommit=()=>Buffer.from('other');
    assert.throws(()=>h.verify(y),/manifest_git_commit_mismatch/);
    const z=inputs();z.readSourceAtCommit=()=>Buffer.from('tampered');
    assert.throws(()=>h.verify(z),/source_blob_sha_mismatch/);
  });
  test('a review manifest cannot claim approval, executable artifact or compatibility',()=>{
    for(const [k,v] of [['approved',true],['registered',true],
       ['production_executable',true],['gateway_manifest_compatible',true],
       ['kind','release'],['operation','host_action.some_other_action']]){
      const x=inputs(),manifest=JSON.parse(x.manifestBytes);
      manifest[k]=v;
      x.manifestBytes=Buffer.from(JSON.stringify(manifest));
      x.manifestSha256=require('node:crypto').createHash('sha256').update(x.manifestBytes).digest('hex');
      x.readManifestAtCommit=()=>x.manifestBytes;
      assert.throws(()=>h.verify(x),/manifest_claims_runtime_authority/,k);
    }
  });
  test('provenance drift, extra sudo-like capabilities and altered blocker list denied',()=>{
    for(const mutate of [
      o=>{o.policy.object_sha256='0'.repeat(64)},
      o=>{o.central_dispatcher.issuer_preconsumption_check_wired=true},
      o=>{o.owner_preimages['/etc/sudoers']='0'.repeat(64)},
      o=>{o.blockers=[]},
      o=>{o.source_commit='a'.repeat(40)},
      o=>{o.unreviewed_field={permissions:['ALL']}}
    ]){
      const x=inputs(),m=JSON.parse(x.manifestBytes);mutate(m);
      x.manifestBytes=Buffer.from(JSON.stringify(m));
      x.manifestSha256=require('node:crypto').createHash('sha256').update(x.manifestBytes).digest('hex');
      x.readManifestAtCommit=()=>x.manifestBytes;
      assert.throws(()=>h.verify(x),/trusted_preimages_or_blockers_drift|manifest_claims_runtime_authority|manifest_schema/);
    }
  });
  test('missing or duplicate source evidence is denied',()=>{
    const x=inputs(),m=JSON.parse(x.manifestBytes);
    m.evidence_sources.pop();
    x.manifestBytes=Buffer.from(JSON.stringify(m));
    x.manifestSha256=require('node:crypto').createHash('sha256').update(x.manifestBytes).digest('hex');
    x.readManifestAtCommit=()=>x.manifestBytes;
    assert.throws(()=>h.verify(x),/source_count/);
  });
}
