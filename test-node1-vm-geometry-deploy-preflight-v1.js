'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const p=require('./node1-vm-geometry-deploy-preflight-v1');
const plan=require('./node1-vm-geometry-registration-plan-v1');
const owner=f=>({path:f.path,sha256:f.sha256,isFile:true,isSymlink:false,size:1024,writableByOther:false,writableByGroup:false});
const observed=()=>Object.fromEntries(p.OWNERS.map(x=>[x.key,owner(x)]));
const sources=()=>Object.fromEntries(plan.FILES.map(x=>[x.path,p.inspectSourceFile(x.path)]));
test('production owner pin set is exact two and metadata-only',()=>{
 assert.equal(p.OWNERS.length,2);
 assert.deepEqual(p.OWNERS.map(x=>x.key),['agent_api','agent_mcp']);
 assert(p.OWNERS.every(x=>x.sha256.length===64&&x.path.startsWith('/home/agent/')));
 assert(p.OWNERS.every(Object.isFrozen));
});
test('node code release baseline and staged actual repo blobs can match safely',()=>{
 const a=p.validateObserved(observed()),b=p.verifySourceBlobs(sources());
 assert.equal(a.ok,true);
 assert.equal(b.ok,true);
 const r=p.preflight(f=>owner(p.OWNERS.find(x=>x.path===f)));
 assert.equal(r.preflight_pass,true);
 assert.equal(r.owner_files_verified,true);
 assert.equal(r.git_source_blobs_verified,true);
 assert.equal(r.approved_for_deployment,false);
 assert.equal(r.registered,false);
 assert.equal(r.service_restarted,false);
 assert.equal(r.production_backup_performed,false);
});
test('wrong deployed MCP owner SHA cannot pass',()=>{
 const o=observed();o.agent_mcp.sha256='0'.repeat(64);
 const r=p.validateObserved(o);
 assert.equal(r.ok,false);
 assert(r.errors.includes('owner_baseline_mismatch:agent_mcp'));
});
test('wrong API path or symlink or writable status cannot pass',()=>{
 const fields=[
  ['path','/tmp/malicious.js'],['isSymlink',true],
  ['isFile',false],['writableByOther',true],['writableByGroup',true]
 ];
 for(const [k,v] of fields){
  const o=observed();o.agent_api[k]=v;
  assert.equal(p.validateObserved(o).ok,false);
 }
});
test('unknown extra owner and omitted owner fail closed',()=>{
 const a=observed();a.surprise=owner(p.OWNERS[0]);
 assert(p.validateObserved(a).errors.includes('owner_cardinality_or_identity_mismatch'));
 const b=observed();delete b.agent_api;
 assert.equal(p.validateObserved(b).ok,false);
});
test('literal Git SHA-1 blob format is verified',()=>{
 const bytes=Buffer.from('a\n');
 const expected=crypto.createHash('sha1').update(Buffer.from('blob 2\0a\n')).digest('hex');
 assert.equal(p.blobSha(bytes),expected);
 assert.throws(()=>p.blobSha('text'),/blob_bytes_required/);
});
test('mutated staged runner bytes always break exact Git blob pin',()=>{
 const a=sources();const name='node1-vm-geometry-runner-v1.js';
 a[name]=Buffer.concat([a[name],Buffer.from('\nmodified')]);
 const v=p.verifySourceBlobs(a);
 assert.equal(v.ok,false);
 assert(v.errors.includes('source_blob_mismatch:'+name));
});
test('unexpected extra staged artifact cannot silently pass',()=>{
 const a=sources();a['/etc/shadow']=Buffer.from('sample');
 assert.equal(p.verifySourceBlobs(a).ok,false);
});
test('only readonly CLI is exposed; neither main nor test triggers services',()=>{
 for(const a of [[],['--install'],['--preflight-only','--apply']])
  assert.throws(()=>p.main(a),/only_readonly_preflight_allowed/);
});
test('missing remote baseline cannot pass release even when source matches',()=>{
 const r=p.preflight(()=>{throw Error('readonly connector not available')});
 assert.equal(r.preflight_pass,false);
 assert(r.blockers.includes('owner_unreadable:agent_api'));
 assert(r.blockers.includes('owner_unreadable:agent_mcp'));
 assert.equal(r.git_source_blobs_verified,true);
});
test('drifted source content blocks release even with observed owner hashes',()=>{
 const r=p.preflight(path=>owner(p.OWNERS.find(x=>x.path===path)),f=>{
  if(f==='node1-vm-geometry-mcp-plugin-v1.mjs')return Buffer.from('bad');
  return p.inspectSourceFile(f);
 });
 assert.equal(r.owner_files_verified,true);
 assert.equal(r.git_source_blobs_verified,false);
 assert.equal(r.preflight_pass,false);
});
