'use strict';
/**
 * Immutable v2 registry release audit. READ ONLY: no staging, approval,
 * runner invocation, target files, registry modifications, or Production.
 */
const test=require('node:test'),assert=require('node:assert/strict');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const path=require('node:path');
const G=require('./prhm-action-registry-gateway-v1.cjs');
const pin=require('./manifests/honartik-shared-registry-pinned-release-v2.json');
const v2=require('./manifests/honartik-config-center-registry-release-v2.json');
const v1=require('./manifests/honartik-config-center-registry-release-v1.json');
const OLD_SOURCE='868ec0251688e30f30691c91390589e80d4f34f9';
const OLD_GATEWAY='855218b5ae4acf7ab8752217c958d0623267f7de';
const NEW_GATEWAY='2c20453a91cb55c305a8901217e4b2d2cc22e9f9';
const sha256=b=>crypto.createHash('sha256').update(b).digest('hex');
const blobSha=b=>crypto.createHash('sha1')
 .update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
function git(args){
 const r=cp.spawnSync('git',args,{cwd:__dirname,timeout:15000,maxBuffer:5000000});
 assert.equal(r.status,0,'immutable_git_read_failed:'+args.join(' '));
 return r.stdout;
}
test('v2 Honartik has an independent reviewed source and manifest commit',()=>{
 assert.equal(pin.schema,'prhm.shared-registry.pinned-release.v2');
 assert.equal(pin.repo,'prhmonline/prhm-host-actions');
 assert.match(pin.source_commit,/^[a-f0-9]{40}$/);
 assert.match(pin.manifest_commit,/^[a-f0-9]{40}$/);
 assert.notEqual(pin.source_commit,pin.manifest_commit);
 assert.equal(git(['merge-base','--is-ancestor',pin.source_commit,pin.manifest_commit]).length,0);
 assert.equal(v2.source_commit,pin.source_commit);
 assert.equal(v2.git_path,pin.release_manifest_path);
 const onGit=git(['show',pin.manifest_commit+':'+pin.release_manifest_path]);
 assert.equal(sha256(onGit),pin.release_manifest_sha256);
 assert.deepEqual(JSON.parse(onGit.toString('utf8')),v2);
 assert.equal(G.assertManifest(v2).project,'honartik');
 const args={action:G.ACTION,project:'honartik',source_commit:pin.source_commit,
  manifest_commit:pin.manifest_commit,manifest_sha256:pin.release_manifest_sha256};
 assert.equal(G.approvalBindingSha(args),pin.approval_arguments_sha256);
 assert.equal(pin.approval_arguments_sha256.length,64);
});
test('new release changes only source SHA and manifest path, preserving observed owner bytes',()=>{
 const expected={...v1,source_commit:pin.source_commit,git_path:pin.release_manifest_path};
 assert.deepEqual(v2,expected);
 const old=JSON.parse(git(['show',pin.source_commit+':honartik-config-center-install-manifest-v1.json']));
 assert.deepEqual(Object.keys(old.control_plane_preimages).sort(),['base','executor','mcp','policy']);
 for(const [k,value] of Object.entries(old.control_plane_preimages)){
  assert.equal(v2.registry_owners[k].path,value.path);
  assert.equal(v2.registry_owners[k].before_sha256,value.sha256);
  assert.equal(v2.registry_owners[k].after_sha256,v1.registry_owners[k].after_sha256);
 }
 for(let i=0;i<v2.assets.length;i++){
  const a=v2.assets[i],b=old.assets[i];
  assert.deepEqual(a,{path:b.target,source_path:b.source,sha256:b.sha256});
  assert.equal(sha256(git(['show',pin.source_commit+':'+a.source_path])),a.sha256);
  // Files executed by the bounded Honartik installer did not change.
  assert.ok(git(['show',OLD_SOURCE+':'+a.source_path])
    .equals(git(['show',pin.source_commit+':'+a.source_path])));
 }
 for(const name of ['honartik-config-center-registration-candidate-v1.cjs',
   'honartik-config-center-atomic-registration-installer-v1.cjs']){
  assert.ok(git(['show',OLD_SOURCE+':'+name])
   .equals(git(['show',pin.source_commit+':'+name])));
 }
});
test('complete source closure pins the NEW rollback gateway without mutable HEAD refs',()=>{
 assert.equal(pin.assets.length,12);
 const paths=new Set(),destinations=new Set();
 for(const a of pin.assets){
  assert.deepEqual(Object.keys(a).sort(),
   ['destination','git_blob_sha1','git_commit','git_path']);
  assert.equal(a.git_commit,
   a.git_path===pin.release_manifest_path?pin.manifest_commit:pin.source_commit);
  assert.match(a.git_blob_sha1,/^[a-f0-9]{40}$/);
  assert.ok(a.destination.startsWith(pin.destination_root+'/'));
  assert.ok(!a.destination.includes('..'));
  assert.equal(a.destination,pin.destination_root+'/'+a.git_path);
  assert.equal(paths.has(a.git_path),false);
  assert.equal(destinations.has(a.destination),false);
  paths.add(a.git_path);destinations.add(a.destination);
  const content=git(['show',a.git_commit+':'+a.git_path]);
  assert.equal(blobSha(content),a.git_blob_sha1);
  assert.match(git(['ls-tree',a.git_commit,'--',a.git_path]).toString('utf8'),
   /^100644 blob [a-f0-9]{40}\t/);
 }
 const gw=pin.assets.find(x=>x.git_path==='prhm-action-registry-gateway-v1.cjs');
 assert.ok(gw);
 assert.equal(gw.git_blob_sha1,NEW_GATEWAY);
 assert.notEqual(gw.git_blob_sha1,OLD_GATEWAY);
 assert.ok(paths.has('prhm-action-registry-host-actions-v2-bridge-v1.cjs'));
 assert.ok(paths.has('honartik-config-center-atomic-registration-installer-v1.cjs'));
 const gatewayBytes=git(['show',pin.source_commit+':'+gw.git_path]).toString('utf8');
 assert.match(gatewayBytes,/originalAndUndiscoverable/);
 assert.match(gatewayBytes,/readInstalledTool\(release\.normalized\.action\)===false/);
 for(const a of pin.assets.filter(x=>x.git_path.endsWith('.cjs'))){
  const src=git(['show',a.git_commit+':'+a.git_path]).toString('utf8');
  for(const [,relative] of src.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)){
   if(relative.startsWith('node:'))continue;
   assert.ok(relative.startsWith('./'),'external_local_import:'+relative);
   const link=path.posix.normalize(path.posix.join(path.posix.dirname(a.git_path),relative));
   assert.ok(paths.has(link),'missing_dependency:'+a.git_path+'=>'+relative);
  }
 }
});
test('v2 is NOT a live runner bootstrap and has never received L4 authority',()=>{
 assert.deepEqual(pin.state,{
  source_reviewed:true,immutable_manifest_published:true,
  runner_rebound_to_v2:false,root_bootstrap_installed:false,
  five_field_signed_route_installed:false,production_staged:false,
  installation_authorized:false,level4_consumed:false
 });
 assert.equal(Object.hasOwn(pin,'approval_token'),false);
 assert.equal(Object.hasOwn(pin,'private_key'),false);
});
