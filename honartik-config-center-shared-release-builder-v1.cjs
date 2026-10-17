'use strict';
/**
 * SOURCE ONLY: construct the generic shared-registry release from the fixed
 * Honartik manifest and independently SHA-verified registration output.
 * This never writes, installs, approves, stages or authorizes anything.
 * The returned JSON still requires a separate immutable manifest Git commit.
 */
const crypto=require('node:crypto');
const legacy=require('./honartik-config-center-install-manifest-v1.json');
const reg=require('./honartik-config-center-registration-candidate-v1.cjs');
const gateway=require('./prhm-action-registry-gateway-v1.cjs');
const KEYS=Object.freeze(['base','executor','policy','mcp']);
const GIT_PATH='manifests/honartik-config-center-registry-release-v1.json';
const SERVICES=Object.freeze([
  'prhm-agent-selfmaint.service','prhm-agent-selfmaint-exec.service',
  'prhm-agent-mcp-blue.service','prhm-agent-mcp-green.service'
]);
const SHA=/^[a-f0-9]{64}$/;
const COMMIT=/^[a-f0-9]{40}$/;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function check(ok,reason){if(!ok)throw Error('honartik_release_'+reason)}
function compose({sourceCommit,candidates,readPinnedSource}={}){
 check(COMMIT.test(sourceCommit||''),'source_commit_unpinned');
 check(typeof readPinnedSource==='function','trusted_git_blob_reader_missing');
 check(candidates?.action===reg.ACTION&&legacy.action===reg.ACTION,
   'action_mismatch');
 check(candidates.input_sha256&&candidates.output_sha256&&candidates.sources,
   'candidate_not_attested');
 const owners={};
 for(const key of KEYS){
   const live=reg.LIVE[key];
   const original=legacy.control_plane_preimages[key];
   const bytes=candidates.sources[key];
   const after=candidates.output_sha256[key];
   check(live&&original?.path===live.path&&original.sha256===live.sha256&&
     candidates.input_sha256[key]===live.sha256,
     'owner_preimage_mismatch_'+key);
   check(typeof bytes==='string'&&Buffer.byteLength(bytes)>100&&
     Buffer.byteLength(bytes)<3000000&&SHA.test(after||'')&&
     after===hash(Buffer.from(bytes,'utf8'))&&after!==live.sha256,
     'owner_postimage_unverified_'+key);
   owners[key]={path:live.path,before_sha256:live.sha256,after_sha256:after};
 }
 check(Array.isArray(legacy.assets)&&legacy.assets.length===5,
   'legacy_asset_set_changed');
 const seen=new Set();
 const assets=legacy.assets.map(entry=>{
   check(!seen.has(entry.target)&&
     entry.target==='/opt/prhm-agent-selfmaint-exec/actions/'+
       entry.source.split('/').at(-1)&&SHA.test(entry.sha256),
     'asset_path_or_pin_mismatch');
   seen.add(entry.target);
   const buf=readPinnedSource(sourceCommit,entry.source);
   check(Buffer.isBuffer(buf)&&buf.length>0&&
     hash(buf)===entry.sha256,'git_asset_sha_mismatch_'+entry.source);
   return {path:entry.target,source_path:entry.source,sha256:entry.sha256};
 });
 const manifest={
   schema_version:'prhm.action-registry.release.v1',
   project:'honartik',
   action:reg.ACTION,
   source_commit:sourceCommit,
   risk:'critical',approval_level:4,registry_owners:owners,assets,
   rollback_required:true,
   health:{services:[...SERVICES],tool:reg.ACTION},
   git_path:GIT_PATH
 };
 gateway.assertManifest(manifest);
 const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
 return Object.freeze({
   schema:'prhm.honartik.shared-registry.build-output.v1',
   manifest,bytes,manifest_sha256:hash(bytes),
   source_commit:sourceCommit,
   manifest_commit:null, // must be created in a distinct reviewed commit
   publish_required:true,level4_authorized:false,
   production_modified:false
 });
}
function buildFromAttestedOriginals({sourceCommit,readOwner,readPinnedSource}={}){
 check(typeof readOwner==='function','trusted_original_reader_missing');
 const candidates=reg.buildCandidates(readOwner);
 return compose({sourceCommit,candidates,readPinnedSource});
}
module.exports=Object.freeze({KEYS,GIT_PATH,SERVICES,compose,buildFromAttestedOriginals});
