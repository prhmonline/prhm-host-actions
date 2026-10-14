'use strict';
/**
 * Fixed read-only I/O for a separately authorized PRHM shared-registry runner.
 * No dynamic repo/commit/path input; only the exact two immutable Git commits.
 * Does NOT stage files, issue/consume approval or execute installation.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const closure=require('./manifests/honartik-shared-registry-bootstrap-source-closure-v1.json');
const release=require('./manifests/honartik-config-center-registry-release-v1.json');
const gateway=require('./prhm-action-registry-gateway-v1.cjs');
const SOURCE='868ec0251688e30f30691c91390589e80d4f34f9';
const MANIFEST='e269cb8ee6f6dc1010620134a8a3ffe57d248535';
const STAGED='/opt/prhm-agent-selfmaint-exec/staged/honartik-config-center-v1';
const RUNTIME='/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v1';
const RELEASE_LOCAL=STAGED+'/shared-registry-release-v1.json';
const ORIGINAL_MANIFEST='honartik-config-center-install-manifest-v1.json';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const gitBlob=b=>crypto.createHash('sha1')
  .update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
function fail(code){throw new Error('registry_pinned_reader_'+code)}
function check(ok,code){if(!ok)fail(code)}
const assetByTarget=new Map(release.assets.map(a=>[a.path,a]));
const assetBySource=new Map(release.assets.map(a=>[a.source_path,a]));
const legacy=closure.assets.find(a=>a.git_path===ORIGINAL_MANIFEST);
check(legacy&&legacy.destination===RUNTIME+'/'+ORIGINAL_MANIFEST,
  'legacy_manifest_not_pinned');
check(closure.source_commit===SOURCE&&closure.release_manifest_commit===MANIFEST&&
 closure.release_manifest_sha256===sha(Buffer.from(JSON.stringify(release,null,2)+'\n'))&&
 release.source_commit===SOURCE,'immutable_release_identity_changed');
check(assetByTarget.size===5&&assetBySource.size===5,'source_asset_set_changed');
function secureRead(io,filename,{sha256=null,gitBlobSha=null,maxBytes=4000000}={}){
 check(typeof filename==='string'&&filename.startsWith('/')&&
  !filename.includes('..')&&typeof io?.lstatSync==='function'&&
  typeof io?.realpathSync==='function','invalid_read_contract');
 const parent=path.posix.dirname(filename);
 const pd=io.lstatSync(parent);
 check(pd.isDirectory()&&!pd.isSymbolicLink()&&io.realpathSync(parent)===parent&&
  pd.uid===0&&(pd.mode&0o022)===0,'parent_not_root_owned_or_unsafe');
 const st=io.lstatSync(filename);
 check(st.isFile()&&!st.isSymbolicLink()&&io.realpathSync(filename)===filename&&
  st.uid===0&&(st.mode&0o022)===0&&st.size>0&&st.size<=maxBytes,
  'file_not_root_owned_or_unsafe');
 const fd=io.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 let b;
 try{
   const post=io.fstatSync(fd);
   check(post.isFile()&&!post.isSymbolicLink()&&
     post.dev===st.dev&&post.ino===st.ino&&post.size===st.size&&
     post.uid===st.uid&&post.gid===st.gid&&post.mode===st.mode,
     'file_replaced_during_read');
   b=io.readFileSync(fd);
 }finally{io.closeSync(fd)}
 check(Buffer.isBuffer(b)&&b.length===st.size,'read_content_changed');
 if(sha256!==null)check(sha(b)===sha256,'pinned_sha256_drift');
 if(gitBlobSha!==null)check(gitBlob(b)===gitBlobSha,'pinned_git_object_drift');
 return b;
}
function readers(io=fs){
 // Injection only supports isolated offline tests. Real Production reads are
 // confined to the root process with pre-provisioned trusted staged files.
 if(io===fs)check(process.getuid?.()===0,'trusted_root_reader_required');
 function readPinnedGitManifest(req){
   check(req&&req.repo===closure.repo&&req.source_commit===SOURCE&&
    req.manifest_commit===MANIFEST&&req.project==='honartik'&&
    Number.isInteger(req.max_bytes)&&req.max_bytes>=release.assets.length,
    'manifest_request_untrusted');
   const bytes=secureRead(io,RELEASE_LOCAL,{
     sha256:closure.release_manifest_sha256,maxBytes:160000});
   return Object.freeze({path:closure.release_manifest_path,bytes});
 }
 function readPinnedGitSource(req){
   check(req&&req.repo===closure.repo&&req.source_commit===SOURCE&&
    typeof req.source_path==='string'&&
    Number.isInteger(req.max_bytes)&&req.max_bytes<=4000000,
    'source_request_untrusted');
   if(req.source_path===ORIGINAL_MANIFEST)
     return secureRead(io,RUNTIME+'/'+ORIGINAL_MANIFEST,{
       gitBlobSha:legacy.git_blob_sha1,maxBytes:160000});
   const entry=assetBySource.get(req.source_path);
   check(!!entry,'source_not_allowlisted');
   return secureRead(io,STAGED+'/'+entry.source_path,{
     sha256:entry.sha256,maxBytes:4000000});
 }
 function readLiveOwner(filename){
   const pin=Object.values(release.registry_owners)
     .find(x=>x.path===filename);
   check(!!pin,'owner_not_allowlisted');
   return secureRead(io,filename,{sha256:pin.before_sha256,maxBytes:3000000});
 }
 function readStagedAsset(filename){
   const entry=assetByTarget.get(filename);
   check(!!entry,'asset_not_allowlisted');
   return secureRead(io,STAGED+'/'+entry.source_path,{
     sha256:entry.sha256,maxBytes:4000000});
 }
 return Object.freeze({readPinnedGitManifest,readPinnedGitSource,
   readLiveOwner,readStagedAsset});
}
module.exports=Object.freeze({STAGED,RUNTIME,RELEASE_LOCAL,
 SOURCE,MANIFEST,secureRead,readers});
