'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const path=require('node:path');
const stage=require('./manifests/honartik-shared-registry-root-recovery-stage-v1.json');
const existing=require('./manifests/honartik-shared-registry-bootstrap-source-closure-v1.json');
const trusted=require('./manifests/honartik-shared-registry-trusted-host-io-stage-v1.json');
const original=require('./manifests/honartik-shared-registry-original-state-stage-v1.json');
const evidence=require('./manifests/honartik-shared-registry-root-evidence-stage-v1.json');
function pinnedSource(){
 const cmd=cp.spawnSync('git',['show',stage.source_commit+':'+stage.asset.git_path],{
  cwd:__dirname,timeout:15000,maxBuffer:2000000});
 assert.equal(cmd.status,0,'immutable source Git object inaccessible');
 return cmd.stdout;
}
test('root recovery source pin resolves to exact immutable Git object and fixed staging target',()=>{
 assert.equal(stage.schema,'prhm.shared-registry.root-recovery-stage.v1');
 assert.match(stage.source_commit,/^[0-9a-f]{40}$/);
 assert.equal(stage.asset.destination,
  '/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v1/'+stage.asset.git_path);
 const bytes=pinnedSource();
 const h=crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
 assert.equal(h,stage.asset.git_blob_sha1);
});
test('every local runtime dependency is in an independently pinned reviewed stage',()=>{
 const root='/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v1/';
 const all=new Set([
  ...existing.assets.map(a=>a.destination),
  ...trusted.assets.map(a=>a.destination),
  original.asset.destination,evidence.asset.destination,
  stage.asset.destination
 ]);
 const imports=[...pinnedSource().toString().matchAll(/\brequire\(['"](\.[^'"]+)['"]\)/g)]
  .map(m=>m[1]);
 assert.equal(imports.length,6);
 for(const imp of imports){
  const name=path.posix.normalize(imp.slice(2));
  assert.ok(all.has(root+name),'unreviewed runtime module: '+name);
 }
 const expected=stage.dependencies.map(a=>root+a);
 assert.equal(expected.length,6);
 assert.deepEqual(new Set(expected),new Set(imports.map(a=>root+a.slice(2))));
});
test('actual consumed ledger owner is pinned but all four recovery writable directories absent',()=>{
 assert.deepEqual(stage.actual_approval_center_consumed_dir,{
  path:'/var/lib/prhm-company-approval/consumed',
  uid:65039,gid:65039,mode:'0700',read_only:true
 });
 assert.equal(stage.root_only_dirs_not_yet_provisioned.length,4);
 for(const name of stage.root_only_dirs_not_yet_provisioned){
  assert.match(name,/^\/(?:var\/lib\/prhm-agent-selfmaint-exec|var\/backups)\//);
 }
 assert.equal(stage.status,'NOT_STAGED');
 assert.equal(stage.production_mutation,false);
 assert.equal(stage.requires_fresh_l4,true);
 assert.equal(stage.live_recovery_status,'NOT_EXECUTED');
 assert.equal(stage.read_only_preflight_status,'UNIT_TESTED_NOT_RUN_ON_SERVER');
 assert.equal(stage.signed_five_field_route,'NOT_INSTALLED');
 assert.equal(stage.mcp_discovery_status,'NOT_PROVEN');
});
