'use strict';
/**
 * Immutable release gate for the fixed Honartik shared-registry enrollment.
 * Observed postimage SHA256s were computed in the authorized host's
 * READ-ONLY, zero-input preflight from live SHA-pinned owner source bytes
 * on 2026-10-14, using the exact reviewed 868ec0... source commit.
 *
 * CI cannot re-read Production: do not interpret this as a live attestation
 * of Production or a signed authorization to execute the release.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const fs=require('node:fs');
const crypto=require('node:crypto');
const G=require('./prhm-action-registry-gateway-v1.cjs');
const manifest=require('./manifests/honartik-config-center-registry-release-v1.json');
const SOURCE='868ec0251688e30f30691c91390589e80d4f34f9';
const MANIFEST_COMMIT='e269cb8ee6f6dc1010620134a8a3ffe57d248535';
const PATH='manifests/honartik-config-center-registry-release-v1.json';
const LIVE_POST={
  base:'22c792a7839bfb7e14337d8ce86d025671cb988735d5679875074a3a3fc25680',
  executor:'ec0df149440d24e2e03ade5fc3e847509ace672cea76b9bd9e726a8ea4209b62',
  policy:'117ee444c00008b52ea83c716e3c8b486b7e3237776f9d36a9ff30129a1f326d',
  mcp:'2b4b8748ab5a3a36a64ead158ee59dabe2b63ee2ebe5a899f10915e32c619e4d'
};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function pinnedBlob(commit,path){
 assert.match(commit,/^[a-f0-9]{40}$/);
 assert.match(path,/^[a-zA-Z0-9_.\/-]+$/);
 assert.ok(!path.includes('..'));
 return cp.execFileSync('git',['show',commit+':'+path],{
  cwd:__dirname,encoding:'buffer',timeout:15000,maxBuffer:4000000
 });
}
test('original and release manifest are pinned to two distinct immutable Git commits',()=>{
 assert.notEqual(SOURCE,MANIFEST_COMMIT);
 assert.equal(manifest.source_commit,SOURCE);
 assert.equal(manifest.git_path,PATH);
 assert.deepEqual(JSON.parse(pinnedBlob(MANIFEST_COMMIT,PATH).toString('utf8')),manifest);
 assert.equal(cp.spawnSync('git',['merge-base','--is-ancestor',SOURCE,MANIFEST_COMMIT],{
  cwd:__dirname,timeout:10000
 }).status,0);
});
test('shared manifest satisfies the generic registrar schema, not the legacy schema',()=>{
 assert.equal(manifest.schema_version,'prhm.action-registry.release.v1');
 const normalized=G.assertManifest(manifest);
 assert.equal(normalized.action,'honartik_config_center_readonly_enroll_v1');
 assert.equal(normalized.project,'honartik');
 assert.equal(manifest.approval_level,4);
 assert.equal(manifest.rollback_required,true);
 assert.deepEqual(normalized.health.services.slice().sort(),[
  'prhm-agent-selfmaint.service','prhm-agent-selfmaint-exec.service',
  'prhm-agent-mcp-blue.service','prhm-agent-mcp-green.service'
 ].sort());
});
test('four before image SHA and observed actual generated after SHA are immutable',()=>{
 const original=JSON.parse(pinnedBlob(SOURCE,'honartik-config-center-install-manifest-v1.json').toString('utf8'));
 for(const [key,pin] of Object.entries(original.control_plane_preimages)){
   assert.deepEqual(manifest.registry_owners[key],{
    path:pin.path,before_sha256:pin.sha256,after_sha256:LIVE_POST[key]
   });
 }
 assert.equal(Object.keys(manifest.registry_owners).length,4);
});
test('all five installer files are pinned to exact actual bytes at the source commit',()=>{
 const legacy=JSON.parse(pinnedBlob(SOURCE,'honartik-config-center-install-manifest-v1.json').toString('utf8'));
 assert.equal(manifest.assets.length,5);
 for(let i=0;i<manifest.assets.length;i++){
   const a=manifest.assets[i],before=legacy.assets[i];
   assert.deepEqual(a,{path:before.target,source_path:before.source,sha256:before.sha256});
   assert.equal(sha(pinnedBlob(SOURCE,a.source_path)),a.sha256);
 }
});
test('exact typed Level-4 binding is produced without authorizing or applying anything',()=>{
 const manifestBytes=fs.readFileSync(__dirname+'/'+PATH);
 const gitBytes=pinnedBlob(MANIFEST_COMMIT,PATH);
 assert.ok(manifestBytes.equals(gitBytes));
 const args={
  action:G.ACTION,project:manifest.project,
  source_commit:SOURCE,manifest_commit:MANIFEST_COMMIT,
  manifest_sha256:sha(manifestBytes)
 };
 assert.match(G.approvalBindingSha(args),/^[a-f0-9]{64}$/);
 assert.equal(G.assertManifest(manifest).source_commit,args.source_commit);
 console.log('IMMUTABLE_MANIFEST_SHA256='+args.manifest_sha256);
 console.log('APPROVAL_ARGS_SHA256='+G.approvalBindingSha(args));
});
