'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const implPath=path.join(__dirname,'bootstrap-agent-mcp-green-rolling-refresh-v2.js');
function implementation(){
  assert.equal(fs.existsSync(implPath),true,'bootstrap implementation must exist');
  delete require.cache[require.resolve(implPath)];
  return require(implPath);
}
function source(){
  assert.equal(fs.existsSync(implPath),true,'bootstrap implementation must exist');
  return fs.readFileSync(implPath,'utf8');
}

const V3_SHA='92e6e279f10fe8561a9c986d9dc90d6bc0cd284009ed9984f51fefe202ac6252';
const V4_SHA='22dfb51356b3a89d0b6150b6e67e10ebc5464fb66cb67c9e2a75cb6d2e521481';
const GOOD_STATE=Object.freeze({
  hostname:'prhm-production.prhm.ir',
  server_sha_match:true,
  router_sha_match:true,
  safe_files_sha:V3_SHA,
  topology_match:true,
  router_active:true,
  router_enabled:true,
  blue_active:true,
  blue_enabled:true,
  green_active:true,
  green_disabled:true,
  public_health:true,
  public_ready:true,
  blue_health:true,
  blue_ready:true,
  green_health:true,
  green_ready:true,
  legacy_listening:true,
  pointer_regular:true,
  pointer_blue:true,
  disk_enough:true,
  dependencies:true
});

class FakeAdapter{
  constructor(overrides={}){this.state={...GOOD_STATE,...overrides};this.calls=[];this.latest={status:'applied',backup_path:'/var/backups/prhm-agent-mcp-green-rolling-refresh-v2/x',previous_backend:8124,active_backend:8125,green_pre_active:true,green_pre_enabled:false,finalized:false,rolled_back:false};}
  async inspect(){this.calls.push('inspect');return {...this.state};}
  async captureApplyState(){this.calls.push('captureApplyState');return {backup_path:'/var/backups/prhm-agent-mcp-green-rolling-refresh-v2/x',green_pre_active:true,green_pre_enabled:false,previous_backend:8124};}
  async restartGreen(){this.calls.push('restartGreen');}
  async healthGreen(){this.calls.push('healthGreen');return true;}
  async readyGreen(){this.calls.push('readyGreen');return true;}
  async switchToGreen(){this.calls.push('switchToGreen');}
  async healthPublic(){this.calls.push('healthPublic');return this.state.public_after!==false;}
  async readyPublic(){this.calls.push('readyPublic');return this.state.ready_after!==false;}
  async persistApply(){this.calls.push('persistApply');}
  async restoreApplyState(){this.calls.push('restoreApplyState');}
  async persistApplyFailure(){this.calls.push('persistApplyFailure');}
  async loadLatestApplyEvidence(){this.calls.push('loadLatestApplyEvidence');return {...this.latest};}
  async verifyRollbackState(){this.calls.push('verifyRollbackState');return true;}
  async restorePointerFromEvidence(){this.calls.push('restorePointerFromEvidence');}
  async restoreGreenPrestate(){this.calls.push('restoreGreenPrestate');}
  async persistRollback(){this.calls.push('persistRollback');}
  async verifyFinalizeState(){this.calls.push('verifyFinalizeState');return true;}
  async enableGreen(){this.calls.push('enableGreen');}
  async disableBlue(){this.calls.push('disableBlue');}
  async persistFinalize(){this.calls.push('persistFinalize');}
}

test('only four fixed CLI modes are accepted',()=>{
  const {parseMode}=implementation();
  for(const mode of ['--preflight-only','--apply','--rollback','--finalize']) assert.equal(parseMode([mode]),mode);
  for(const args of [[],['--apply','x'],['--force'],['--apply=true']]) assert.throws(()=>parseMode(args),/unexpected_arguments/);
});

test('fixed rolling-refresh identities are hard-bound and Agent API mutation scope is absent',()=>{
  const s=source();
  for(const literal of [
    'agent_mcp_green_rolling_refresh_v2','8123','8124','8125','8130',
    '/var/lib/prhm-agent-zdt/mcp-active','/var/backups/prhm-agent-mcp-green-rolling-refresh-v2',
    'prhm-agent-mcp-router.service','prhm-agent-mcp-blue.service','prhm-agent-mcp-green.service',
    '558ff55244f43ac60178a6fec0eddd4068223318b25308d42cdf79d92203098f',V3_SHA,V4_SHA,
    '53b904296da0e9d1490bfc7e3ef0b9c1fbad602a1e693141108f016764ebbe78'
  ]) assert.ok(s.includes(literal),literal);
  assert.equal(s.includes('/var/lib/prhm-agent-zdt/api-active'),false);
  assert.equal(s.includes('prhm-agent-api-blue.service'),false);
  assert.equal(s.includes('prhm-agent-api-green.service'),false);
  assert.equal(s.includes('prhm-agent-api-router.service'),false);
});

test('preflight accepts exact V3 prepatch state, reports patch required, and stays read-only',async()=>{
  const {preflight}=implementation();
  const a=new FakeAdapter();
  const out=await preflight(a);
  assert.equal(out.ok,true);
  assert.equal(out.preflight_only,true);
  assert.equal(out.production_mutation,false);
  assert.equal(out.current_backend,8124);
  assert.equal(out.candidate_backend,8125);
  assert.equal(out.source_state,'v3_prepatch');
  assert.equal(out.source_patch_required,true);
  assert.equal(out.apply_ready,false);
  assert.equal(out.green_health,true);
  assert.deepEqual(a.calls,['inspect']);
});

test('preflight accepts exact V4 ready state and fails closed on source or topology drift',async()=>{
  const {preflight}=implementation();
  const a=new FakeAdapter({safe_files_sha:V4_SHA});
  const out=await preflight(a);
  assert.equal(out.source_state,'v4_ready');
  assert.equal(out.source_patch_required,false);
  assert.equal(out.apply_ready,true);
  const badSha=new FakeAdapter({safe_files_sha:'0'.repeat(64)});
  await assert.rejects(()=>preflight(badSha),/safe_files_sha_mismatch/);
  const badPointer=new FakeAdapter({pointer_blue:false});
  await assert.rejects(()=>preflight(badPointer),/pointer_not_blue/);
  const badGreen=new FakeAdapter({green_active:false});
  await assert.rejects(()=>preflight(badGreen),/green_state_invalid/);
});

test('apply refuses V3 before any mutation and restarts only Green when V4 is ready',async()=>{
  const {runApply}=implementation();
  const prepatch=new FakeAdapter();
  await assert.rejects(()=>runApply(prepatch),/source_v4_not_ready/);
  assert.deepEqual(prepatch.calls,['inspect']);
  const a=new FakeAdapter({safe_files_sha:V4_SHA});
  const out=await runApply(a);
  assert.equal(out.ok,true);
  assert.equal(out.active_backend,8125);
  assert.equal(out.green_restarted,true);
  assert.equal(out.rollback_performed,false);
  assert.deepEqual(a.calls,['inspect','captureApplyState','restartGreen','healthGreen','readyGreen','switchToGreen','healthPublic','readyPublic','persistApply']);
  for(const forbidden of ['stopBlue','restartBlue','restartRouter','stopRouter','enableGreen','disableBlue']) assert.equal(a.calls.includes(forbidden),false);
});

test('apply automatically restores exact pointer and Green pre-state after post-mutation failure',async()=>{
  const {runApply}=implementation();
  const a=new FakeAdapter({safe_files_sha:V4_SHA,public_after:false});
  await assert.rejects(()=>runApply(a),/public_health_failed/);
  assert.ok(a.calls.includes('restoreApplyState'));
  assert.ok(a.calls.includes('persistApplyFailure'));
  assert.equal(a.calls.includes('persistApply'),false);
});

test('explicit rollback requires apply evidence and restores pointer before Green pre-state',async()=>{
  const {runRollback}=implementation();
  const a=new FakeAdapter({safe_files_sha:V4_SHA});
  const out=await runRollback(a);
  assert.equal(out.ok,true);
  assert.equal(out.rollback_performed,true);
  assert.deepEqual(a.calls,['loadLatestApplyEvidence','verifyRollbackState','restorePointerFromEvidence','healthPublic','readyPublic','restoreGreenPrestate','persistRollback']);
  const b=new FakeAdapter({safe_files_sha:V4_SHA});b.latest.status='preflight';
  await assert.rejects(()=>runRollback(b),/apply_evidence_invalid/);
});

test('finalize enables Green and disables Blue without stopping either backend',async()=>{
  const {runFinalize}=implementation();
  const a=new FakeAdapter({safe_files_sha:V4_SHA});
  const out=await runFinalize(a);
  assert.equal(out.ok,true);
  assert.equal(out.finalized,true);
  assert.deepEqual(a.calls,['loadLatestApplyEvidence','verifyFinalizeState','healthPublic','readyPublic','enableGreen','disableBlue','healthPublic','readyPublic','persistFinalize']);
  for(const forbidden of ['stopBlue','stopGreen','restartBlue','restartRouter']) assert.equal(a.calls.includes(forbidden),false);
});

test('state-file mutation contract is atomic, fsync-backed, and cuts only to Green',()=>{
  const s=source();
  assert.match(s,/fs\.fsyncSync/);
  assert.match(s,/fs\.renameSync/);
  assert.ok(s.includes('8125\\n'));
  assert.ok(s.includes('mcp-active.before'));
});

test('evidence redaction removes sensitive keys and values',()=>{
  const {redactEvidence}=implementation();
  const out=redactEvidence({ok:true,token:'abc',authorization:'Bearer verylongsecretvalue123456',nested:{password:'x',safe:'yes'}});
  assert.deepEqual(out,{ok:true,nested:{safe:'yes'}});
});
