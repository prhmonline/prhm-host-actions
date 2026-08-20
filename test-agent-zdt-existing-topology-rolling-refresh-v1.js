'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');

const implPath=path.join(__dirname,'agent-zdt-existing-topology-rolling-refresh-v1.js');
function implementation(){ delete require.cache[require.resolve(implPath)]; return require(implPath); }

const GOOD_API={
  kind:'api', pointer_regular:true, pointer_port:8100, router_active:true, router_enabled:true,
  topology_match:true, source_sha_match:true, public_health:true, public_ready:true,
  active_health:true, active_ready:true, candidate_active:false, candidate_enabled:false,
  candidate_contract:true, legacy_listening:true, reserved_8101_untouched:true
};
const GOOD_MCP={
  kind:'mcp', pointer_regular:true, pointer_port:8124, router_active:true, router_enabled:true,
  topology_match:true, source_sha_match:true, public_health:true, public_ready:true,
  active_health:true, active_ready:true, candidate_active:true, candidate_enabled:false,
  candidate_contract:true, legacy_listening:true, reserved_8101_untouched:true
};

class FakeAdapter {
  constructor({api={},mcp={},fail={}}={}){
    this.states={api:{...GOOD_API,...api},mcp:{...GOOD_MCP,...mcp}};
    this.fail=fail; this.calls=[]; this.evidence={status:'applied',api:null,mcp:null,finalized:false,rolled_back:false};
  }
  async inspectLane(kind){this.calls.push(`inspect:${kind}`);return {...this.states[kind]};}
  async captureLaneState(kind,state){this.calls.push(`capture:${kind}`);return {kind,previous_backend:state.pointer_port,candidate_backend:state.pointer_port===(kind==='api'?8100:8124)?(kind==='api'?8102:8125):(kind==='api'?8100:8124),pointer_bytes:Buffer.from(String(state.pointer_port)+'\\n'),candidate_pre_active:state.candidate_active,candidate_pre_enabled:state.candidate_enabled,backup_path:`/tmp/${kind}`};}
  async restartCandidate(kind){this.calls.push(`restart:${kind}`);if(this.fail[`${kind}_restart`])throw new Error(`${kind}_restart_failed`);}
  async candidateHealth(kind){this.calls.push(`candidateHealth:${kind}`);return !this.fail[`${kind}_candidate_health`];}
  async candidateReady(kind){this.calls.push(`candidateReady:${kind}`);return !this.fail[`${kind}_candidate_ready`];}
  async assertPointerUnchanged(kind){this.calls.push(`pointerUnchanged:${kind}`);if(this.fail[`${kind}_pointer_drift`])throw new Error('pointer_changed_before_cutover');return true;}
  async switchPointer(kind){this.calls.push(`switch:${kind}`);}
  async publicHealth(kind){this.calls.push(`publicHealth:${kind}`);return !this.fail[`${kind}_public_health`];}
  async publicReady(kind){this.calls.push(`publicReady:${kind}`);return !this.fail[`${kind}_public_ready`];}
  async persistLaneApply(kind,e){this.calls.push(`persistApply:${kind}`);return {...e,status:'applied'};}
  async restorePointer(kind){this.calls.push(`restorePointer:${kind}`);}
  async restoreCandidatePrestate(kind){this.calls.push(`restoreCandidate:${kind}`);}
  async persistLaneRollback(kind,e){this.calls.push(`persistRollback:${kind}`);return {...e,status:'rolled_back'};}
  async loadLatestEvidence(){this.calls.push('loadEvidence');return this.evidence;}
  async validateRollbackLane(kind,e){this.calls.push(`validateRollback:${kind}`);return e;}
  async validateFinalizeLane(kind,e){this.calls.push(`validateFinalize:${kind}`);return e;}
  async enableActive(kind){this.calls.push(`enableActive:${kind}`);}
  async disableOld(kind){this.calls.push(`disableOld:${kind}`);}
  async persistFinalize(kind,e){this.calls.push(`persistFinalize:${kind}`);return {...e,status:'finalized'};}
  async persistResult(result){this.calls.push('persistResult');this.evidence=result;}
}

test('implementation exists',()=>{assert.equal(fs.existsSync(implPath),true,'implementation must exist');});

test('fixed topology and modes',()=>{
  const {ACTION,PORTS,PATHS,parseMode}=implementation();
  assert.equal(ACTION,'agent_zdt_existing_topology_rolling_refresh_v1');
  assert.deepEqual(PORTS.api,{public:8099,blue:8100,green:8102,legacy:8110});
  assert.deepEqual(PORTS.mcp,{public:8123,blue:8124,green:8125,legacy:8130});
  assert.equal(JSON.stringify(PORTS).includes('8101'),false);
  assert.equal(PATHS.api.pointer,'/var/lib/prhm-agent-zdt/api-active');
  assert.equal(PATHS.mcp.pointer,'/var/lib/prhm-agent-zdt/mcp-active');
  for(const mode of ['--preflight-only','--apply','--rollback','--finalize'])assert.equal(parseMode([mode]),mode);
  assert.throws(()=>parseMode(['--bad']),/unexpected_arguments/);
});

test('candidate selection is active-pointer aware and rejects legacy',()=>{
  const {candidateFor}=implementation();
  assert.equal(candidateFor('api',8100),8102); assert.equal(candidateFor('api',8102),8100);
  assert.equal(candidateFor('mcp',8124),8125); assert.equal(candidateFor('mcp',8125),8124);
  assert.throws(()=>candidateFor('api',8110),/active_pointer_not_blue_green/);
  assert.throws(()=>candidateFor('mcp',8130),/active_pointer_not_blue_green/);
});

test('preflight is read-only and reports independent lanes',async()=>{
  const {preflight}=implementation(); const a=new FakeAdapter(); const out=await preflight(a);
  assert.equal(out.ok,true); assert.equal(out.preflight_only,true); assert.equal(out.production_mutation,false);
  assert.equal(out.api.current_backend,8100); assert.equal(out.api.candidate_backend,8102);
  assert.equal(out.mcp.current_backend,8124); assert.equal(out.mcp.candidate_backend,8125);
  assert.equal(out.reserved_8101_untouched,true); assert.equal(out.apply_ready,true);
  assert.deepEqual(a.calls,['inspect:api','inspect:mcp']);
});

test('preflight fails closed on malformed pointer, source, router, endpoint, legacy or reserved-port drift',async()=>{
  const {preflight}=implementation();
  const cases=[
    [{api:{pointer_regular:false}},/pointer_invalid/],
    [{api:{pointer_port:8110}},/active_pointer_not_blue_green/],
    [{api:{source_sha_match:false}},/source_sha_mismatch/],
    [{api:{router_active:false}},/router_state_invalid/],
    [{api:{public_health:false}},/public_health_failed/],
    [{api:{active_ready:false}},/active_ready_failed/],
    [{api:{legacy_listening:false}},/legacy_listener_missing/],
    [{api:{candidate_contract:false}},/candidate_contract_invalid/],
    [{api:{reserved_8101_untouched:false}},/reserved_8101_contract_failed/]
  ];
  for(const [cfg,re] of cases)await assert.rejects(()=>preflight(new FakeAdapter(cfg)),re);
});

test('apply refreshes API before MCP and only candidate path',async()=>{
  const {runApply}=implementation(); const a=new FakeAdapter(); const out=await runApply(a);
  assert.equal(out.api.status,'applied'); assert.equal(out.mcp.status,'applied');
  const apiSwitch=a.calls.indexOf('switch:api'),mcpRestart=a.calls.indexOf('restart:mcp');
  assert.ok(apiSwitch>=0&&mcpRestart>apiSwitch);
  assert.equal(a.calls.some(x=>/restart:router|restart:legacy|stop:router|stop:legacy/.test(x)),false);
});

test('API failure prevents MCP mutation and pointer-first rollback is used',async()=>{
  const {runApply}=implementation(); const a=new FakeAdapter({fail:{api_public_health:true}});
  await assert.rejects(()=>runApply(a),/api_public_health_failed/);
  assert.equal(a.calls.some(x=>x==='restart:mcp'||x==='switch:mcp'),false);
  const restore=a.calls.indexOf('restorePointer:api'),pub=a.calls.lastIndexOf('publicHealth:api'),candidate=a.calls.indexOf('restoreCandidate:api');
  assert.ok(restore>=0&&pub>restore&&candidate>pub);
});

test('MCP failure rolls back MCP and leaves API applied',async()=>{
  const {runApply}=implementation(); const a=new FakeAdapter({fail:{mcp_public_health:true}});
  const out=await runApply(a);
  assert.equal(out.api.status,'applied'); assert.equal(out.mcp.status,'rolled_back'); assert.equal(out.partial_success,true);
});

test('rollback and finalize require evidence and preserve old backend running contract',async()=>{
  const {runRollback,runFinalize}=implementation();
  const a=new FakeAdapter(); a.evidence={status:'applied',api:{status:'applied',previous_backend:8100,active_backend:8102},mcp:{status:'applied',previous_backend:8124,active_backend:8125},finalized:false,rolled_back:false};
  const rb=await runRollback(a); assert.equal(rb.rollback_performed,true); assert.ok(a.calls.indexOf('restorePointer:api')<a.calls.indexOf('restoreCandidate:api'));
  const b=new FakeAdapter(); b.evidence={status:'applied',api:{status:'applied',previous_backend:8100,active_backend:8102},mcp:{status:'applied',previous_backend:8124,active_backend:8125},finalized:false,rolled_back:false};
  const fin=await runFinalize(b); assert.equal(fin.finalized,true); assert.ok(b.calls.includes('enableActive:api')); assert.ok(b.calls.includes('disableOld:mcp'));
});

test('source contains no router/legacy restart or reserved 8101 mutation contract',()=>{
  const s=fs.readFileSync(implPath,'utf8');
  assert.equal(/systemctl\(['\"](?:restart|stop)['\"],[^\n]*(?:router|legacy)/.test(s),false);
  assert.equal(/(?:candidate|switch|write)[^\n]*8101/i.test(s),false);
});
