'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const M=require('./manifests/honartik-shared-registry-original-state-stage-v1.json');
const P=require('./manifests/honartik-config-center-registry-release-v1.json');
test('root original-state verifier is a reviewed, immutable source blob, NOT an installed tool',()=>{
 assert.equal(M.schema,'prhm.shared-registry.original-state-stage.v1');
 assert.equal(M.repo,'prhmonline/prhm-host-actions');
 assert.match(M.source_commit,/^[a-f0-9]{40}$/);
 assert.equal(M.asset.git_path,'prhm-action-registry-root-original-state-v1.cjs');
 assert.equal(M.asset.destination,'/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v1/'+M.asset.git_path);
 const r=cp.spawnSync('git',['show',M.source_commit+':'+M.asset.git_path],{
  cwd:__dirname,maxBuffer:1000000,timeout:15000});
 assert.equal(r.status,0);
 const buf=r.stdout;
 const digest=crypto.createHash('sha1').update(Buffer.from('blob '+buf.length+'\0')).update(buf).digest('hex');
 assert.equal(digest,M.asset.git_blob_sha1);
 assert.equal(M.status,'NOT_STAGED');
 assert.equal(M.source_only,true);
 assert.equal(M.production_mutation,false);
 assert.equal(M.requires_fresh_l4,true);
 assert.equal(M.live_original_state_verified_this_turn,false);
 assert.equal(M.mcp_discovery,'PENDING');
 assert.equal(P.action,'honartik_config_center_readonly_enroll_v1');
});
