'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const impl=require('./instant-delivery-mcp-candidate-refresh-v1.js');

const OLD='b2f95b97dfa7e26ca717dfbec7871bf2f64286952548fb4d6d8e99908aeaacc0';
const NEW='048e2db190c5548f47967447b3b564eefd0b7203cf6df84beb73c520d481633d';
const SERVICE='prhm-agent-mcp-instant-delivery-candidate.service';
const SOURCE='/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js';
const TARGET='/home/agent/candidates/agent3-instant-delivery-v1/mcp/src/plugins/hostActionsV2.js';
const BACKUP_ROOT='/var/lib/prhm-agent-instant-delivery-v1/mcp-candidate-refresh-bridge/backups';

function fake(options={}){
  const state={targetSha:options.targetSha||OLD,restarts:[],backup:null,restores:0,writeCount:0,healthy:options.healthy!==false};
  const adapter={
    stat(which){return {isFile:true,isSymlink:false,mode:0o644,uid:1000,gid:1000,path:which==='source'?SOURCE:TARGET}},
    sha256(which){return which==='source'?NEW:state.targetSha},
    nodeCheck(which){assert.equal(which,'source');return true},
    readTarget(){return Buffer.from('preimage')},
    readSource(){return Buffer.from('candidate')},
    backup(bytes){state.backup=Buffer.from(bytes);return 'backup-1'},
    atomicReplace(bytes){assert.equal(Buffer.from(bytes).toString(),'candidate');state.writeCount++;state.targetSha=NEW;return true},
    restore(bytes){assert.equal(Buffer.from(bytes).toString(),'preimage');state.restores++;state.targetSha=OLD;return true},
    restart(service){state.restarts.push(service);return true},
    serviceHealthy(service){assert.equal(service,SERVICE);return state.healthy},
  };
  return {adapter,state};
}

test('exports an immutable fixed-scope MCP candidate refresh contract',()=>{
  assert.equal(impl.ACTION,'agent_instant_delivery_mcp_candidate_refresh_v1');
  assert.equal(impl.SOURCE_PATH,SOURCE);
  assert.equal(impl.TARGET_PATH,TARGET);
  assert.equal(impl.SERVICE,SERVICE);
  assert.equal(impl.SOURCE_SHA256,NEW);
  assert.equal(impl.TARGET_PREIMAGE_SHA256,OLD);
  assert.equal(impl.BACKUP_ROOT,BACKUP_ROOT);
  assert.equal(typeof impl.createAction,'function');
  for(const forbidden of ['command','path','service','target','source','exec','spawn','run']){
    assert.equal(Object.prototype.hasOwnProperty.call(impl,forbidden),false);
  }
});

test('preflight is exact-SHA bound and accepts idempotent already-applied state',()=>{
  const a=fake();
  const action=impl.createAction(a.adapter);
  assert.deepEqual(action.preflight(),{ok:true,already_applied:false,before_sha256:OLD});

  const b=fake({targetSha:NEW});
  assert.deepEqual(impl.createAction(b.adapter).preflight(),{ok:true,already_applied:true,before_sha256:NEW});

  const c=fake({targetSha:'0'.repeat(64)});
  assert.throws(()=>impl.createAction(c.adapter).preflight(),/target_sha_mismatch/);

  const d=fake();
  d.adapter.sha256=which=>which==='source'?'1'.repeat(64):OLD;
  assert.throws(()=>impl.createAction(d.adapter).preflight(),/source_sha_mismatch/);

  const e=fake();
  e.adapter.stat=which=>({isFile:true,isSymlink:which==='target',mode:0o644,uid:1000,gid:1000});
  assert.throws(()=>impl.createAction(e.adapter).preflight(),/target_symlink/);
});

test('apply replaces only the MCP candidate, restarts only its service, verifies, and reports bounded mutation',()=>{
  const {adapter,state}=fake();
  const out=impl.createAction(adapter).apply();
  assert.equal(out.ok,true);
  assert.equal(out.action,impl.ACTION);
  assert.equal(out.before_sha256,OLD);
  assert.equal(out.after_sha256,NEW);
  assert.equal(out.backup_id,'backup-1');
  assert.equal(out.rollback_performed,false);
  assert.equal(out.mcp_candidate_mutation,true);
  assert.equal(out.api_candidate_mutation,false);
  assert.equal(out.router_mutation,false);
  assert.equal(out.database_mutation,false);
  assert.equal(out.production_application_mutation,false);
  assert.equal(state.writeCount,1);
  assert.deepEqual(state.restarts,[SERVICE]);
});

test('already-applied state is idempotent and does not restart',()=>{
  const {adapter,state}=fake({targetSha:NEW});
  const out=impl.createAction(adapter).apply();
  assert.equal(out.ok,true);
  assert.equal(out.already_applied,true);
  assert.equal(out.mutation,false);
  assert.equal(state.writeCount,0);
  assert.deepEqual(state.restarts,[]);
});

test('post-write health failure rolls back exact preimage and restarts only the same MCP service',()=>{
  const {adapter,state}=fake({healthy:false});
  let healthCalls=0;
  adapter.serviceHealthy=service=>{assert.equal(service,SERVICE);healthCalls++;return healthCalls>1};
  const out=impl.createAction(adapter).apply();
  assert.equal(out.ok,false);
  assert.equal(out.status,'FAILED_ROLLED_BACK');
  assert.equal(out.rollback_performed,true);
  assert.equal(out.after_sha256,OLD);
  assert.equal(state.restores,1);
  assert.deepEqual(state.restarts,[SERVICE,SERVICE]);
});
