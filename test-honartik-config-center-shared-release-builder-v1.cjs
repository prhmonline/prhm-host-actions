'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto'),fs=require('node:fs');
const builder=require('./honartik-config-center-shared-release-builder-v1.cjs');
const reg=require('./honartik-config-center-registration-candidate-v1.cjs');
const gateway=require('./prhm-action-registry-gateway-v1.cjs');
const legacy=require('./honartik-config-center-install-manifest-v1.json');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const COMMIT='a'.repeat(40);
function fixture(){
 const sources={},output_sha256={},input_sha256={};
 for(const key of builder.KEYS){
   sources[key]=('reviewed '+key+' postimage ').repeat(9);
   output_sha256[key]=sha(Buffer.from(sources[key]));
   input_sha256[key]=reg.LIVE[key].sha256;
 }
 const candidates={action:reg.ACTION,sources,output_sha256,input_sha256};
 let paths=[];
 const readPinnedSource=(commit,path)=>{
   assert.equal(commit,COMMIT);
   paths.push(path);
   return fs.readFileSync(path);
 };
 return {candidates,readPinnedSource,paths};
}
test('builds exact generic schema from five actual source blobs and four verified candidate hashes',()=>{
 const f=fixture();
 const x=builder.compose({sourceCommit:COMMIT,...f});
 assert.equal(gateway.assertManifest(x.manifest).action,reg.ACTION);
 assert.equal(x.manifest.git_path,builder.GIT_PATH);
 assert.equal(x.manifest.schema_version,'prhm.action-registry.release.v1');
 assert.equal(x.manifest.assets.length,legacy.assets.length);
 assert.equal(x.manifest.source_commit,COMMIT);
 for(const key of builder.KEYS){
   const rec=x.manifest.registry_owners[key];
   assert.equal(rec.before_sha256,reg.LIVE[key].sha256);
   assert.equal(rec.after_sha256,f.candidates.output_sha256[key]);
 }
 assert.equal(x.manifest_sha256,sha(x.bytes));
 assert.equal(x.manifest_commit,null);
 assert.equal(x.publish_required,true);
 assert.equal(x.level4_authorized,false);
 assert.equal(x.production_modified,false);
 assert.deepEqual(f.paths,legacy.assets.map(x=>x.source));
});
test('stale original owner digest or invented next SHA cannot produce release',()=>{
 for(const mode of ['old','new','bytes']){
   const f=fixture(),key='executor';
   if(mode==='old')f.candidates.input_sha256[key]='0'.repeat(64);
   if(mode==='new')f.candidates.output_sha256[key]='0'.repeat(64);
   if(mode==='bytes')f.candidates.sources[key]='tampered';
   assert.throws(()=>builder.compose({sourceCommit:COMMIT,...f}),
     /owner_preimage_mismatch|owner_postimage_unverified/);
 }
});
test('Git source bytes must match all five pinned SHA values, not only filenames',()=>{
 const f=fixture();
 const read=f.readPinnedSource;
 f.readPinnedSource=(commit,path)=>path===legacy.assets[2].source?
   Buffer.from('tampered'):read(commit,path);
 assert.throws(()=>builder.compose({sourceCommit:COMMIT,...f}),/git_asset_sha_mismatch/);
});
test('rejects mutable Git refs, arbitrary paths, absent readers and forged candidate action',()=>{
 const f=fixture();
 assert.throws(()=>builder.compose({sourceCommit:'main',...f}),/source_commit_unpinned/);
 assert.throws(()=>builder.compose({sourceCommit:COMMIT,candidates:f.candidates}),
   /trusted_git_blob_reader_missing/);
 assert.throws(()=>builder.compose({sourceCommit:COMMIT,
   ...f,candidates:{...f.candidates,action:'foreign'}}),/action_mismatch/);
});
test('trusted builder rejects incorrect live original bytes before reading any assets',()=>{
 let calls=0;
 const f=fixture();
 assert.throws(()=>builder.buildFromAttestedOriginals({
   sourceCommit:COMMIT,readOwner:()=>{calls++;return Buffer.alloc(120,42)},
   readPinnedSource:f.readPinnedSource
 }),/pinned_owner_sha_mismatch/);
 assert.equal(calls,1);
 assert.deepEqual(f.paths,[]);
});
test('there is no apply, deploy, request or token-minting API',()=>{
 for(const name of ['apply','deploy','authorize','request','writeOwner','runCommand'])
   assert.equal(Object.hasOwn(builder,name),false);
});
