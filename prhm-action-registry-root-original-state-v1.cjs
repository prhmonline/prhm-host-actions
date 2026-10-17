'use strict';
/**
 * Exact original-state postcondition for shared Honartik registration.
 * Read-only: four fixed owner content digests + absence of five new assets.
 * A result of true is REQUIRED after verified rollback; it cannot validate
 * MCP discovery, consume an approval, or authorize a write.
 */
const fs=require('node:fs');
const crypto=require('node:crypto');
const gateway=require('./prhm-action-registry-gateway-v1.cjs');
const releaseManifest=require('./manifests/honartik-config-center-registry-release-v1.json');
const pinned=require('./prhm-action-registry-root-pinned-readers-v1.cjs');
const EXPECTED_SOURCE='868ec0251688e30f30691c91390589e80d4f34f9';
const EXPECTED_MANIFEST='e269cb8ee6f6dc1010620134a8a3ffe57d248535';
const EXPECTED_SHA='111c2c38b6ad48e69a6f72974855b38d0932790335931fc5b128a3c37c3f5e49';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=x=>{throw Error('registry_original_'+x)};
function check(x,code){if(!x)fail(code)}
function assertRelease(got){
 const N=got?.normalized;
 const approved=gateway.assertManifest(releaseManifest);
 check(got.source_commit===EXPECTED_SOURCE&&
  got.manifest_commit===EXPECTED_MANIFEST&&
  got.manifest_sha256===EXPECTED_SHA&&
  N?.project===approved.project&&N?.action===approved.action&&
  N?.source_commit===EXPECTED_SOURCE,
  'unbound_release');
 const ownerKeys=Object.keys(gateway.OWNER_PATHS);
 check(ownerKeys.length===4&&
  Object.keys(N.owners||{}).sort().join('|')===ownerKeys.sort().join('|'),
  'owner_set');
 for(const key of ownerKeys) {
  const a=N.owners[key],b=approved.owners[key];
  check(a?.path===b.path&&a.before_sha256===b.before_sha256&&
    a.after_sha256===b.after_sha256,'owner_pin_mismatch_'+key);
 }
 check(Array.isArray(N.assets)&&N.assets.length===approved.assets.length,
   'assets_count');
 const seen=new Set();
 for(const asset of N.assets){
  const ref=approved.assets.find(x=>x.path===asset.path);
  check(ref&&ref.source_path===asset.source_path&&
   ref.sha256===asset.sha256&&!seen.has(asset.path),'asset_pin_mismatch');
  seen.add(asset.path);
 }
 return approved;
}
function fromProbes(release,{readOwner,assetAbsent}){
 const approved=assertRelease(release);
 check(typeof readOwner==='function'&&typeof assetAbsent==='function',
  'trusted_read_only_callbacks_missing');
 for(const key of Object.keys(gateway.OWNER_PATHS)){
  const rec=approved.owners[key];
  const bytes=readOwner(rec.path);
  check(Buffer.isBuffer(bytes)&&sha(bytes)===rec.before_sha256,
    'original_owner_unverified_'+key);
 }
 for(const a of approved.assets)
  check(assetAbsent(a.path)===true,'new_asset_still_present');
 return true;
}
function productionVerifyOriginalState(release){
 check(process.getuid?.()===0,'root_required');
 const io=pinned.readers();
 return fromProbes(release,{
  readOwner:io.readLiveOwner,
  assetAbsent:filename=>{
   // Exact target filenames come only from the immutable release manifest.
   try{fs.lstatSync(filename);return false}
   catch(e){if(e?.code==='ENOENT')return true;throw e}
  }
 });
}
module.exports=Object.freeze({assertRelease,fromProbes,productionVerifyOriginalState});
