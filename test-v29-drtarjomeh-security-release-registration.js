'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const bootstrap=require('./bootstrap-host-actions-v29-drtarjomeh-security-release-deploy.js');

test('pins the exact live Agent 3 four-file baseline captured before registration work',()=>{
  assert.equal(bootstrap.BASE_SHA,'de924f7319f3656d788ba5d3f89ef2910bf4b0e3f0b8b074e7cd3a534441d5ea');
  assert.equal(bootstrap.EXEC_SHA,'6bba46890db31abc8eca7e7681753a4788c46170033a555a1106e05d0a7a66f9');
  assert.equal(bootstrap.POLICY_SHA,'2fedd70a182aa351e269df95a1b9d829f5a0b18defe8871cb4045106948d711a');
  assert.equal(bootstrap.MCP_SHA,'b2f95b97dfa7e26ca717dfbec7871bf2f64286952548fb4d6d8e99908aeaacc0');
});

test('baseline drift fails before any candidate transformation',()=>{
  assert.doesNotThrow(()=>bootstrap.assertLiveBaseline({base:bootstrap.BASE_SHA,exec:bootstrap.EXEC_SHA,policy:bootstrap.POLICY_SHA,mcp:bootstrap.MCP_SHA}));
  assert.throws(()=>bootstrap.assertLiveBaseline({base:'0'.repeat(64),exec:bootstrap.EXEC_SHA,policy:bootstrap.POLICY_SHA,mcp:bootstrap.MCP_SHA}),/baseline_sha_mismatch:base/);
});

test('policy candidate adds exactly one critical one-time typed scope',()=>{
  const base={schema_version:'prhm.approval-policy.v1',version:'2026-09-05.3-autonomous-operator-v1',operations:{'host_action.titan_parallel_v1':{level:4}},typed_scopes:[{action:'titan_parallel_v1'}]};
  const out=JSON.parse(bootstrap.buildPolicyCandidate(JSON.stringify(base,null,2)));
  const rule=out.operations['host_action.drtarjomeh_security_release_deploy_v1'];
  assert.equal(rule.level,4);
  assert.equal(rule.risk,'critical');
  assert.equal(rule.requires_second_confirmation,true);
  assert.equal(rule.one_time_use,true);
  assert.equal(rule.requested_approver,'mohammad');
  assert.equal(rule.expires_seconds,180);
  assert.match(rule.rollback_reference,/drtarjomeh-security-release-deploy-v1/);
  const scopes=out.typed_scopes.filter(x=>x.action==='drtarjomeh_security_release_deploy_v1');
  assert.equal(scopes.length,1);
  assert.equal(out.operations['host_action.titan_parallel_v1'].level,4);
  assert.equal(out.typed_scopes.some(x=>x.action==='titan_parallel_v1'),true);
  assert.throws(()=>bootstrap.buildPolicyCandidate(JSON.stringify(out)),/(already_present|policy_baseline_mismatch)/);
});

test('base registry adds v29 as Level-4 without touching Level-3 or existing actions',()=>{
  const src=[
    'const HOST_ACTION_V2_SPECS = Object.freeze({',
    "  drtarjomeh_security_containment_v1: { operation: 'host_action.drtarjomeh_security_containment_v1', rollback: 'host-action-v2:drtarjomeh-security-containment-v1:backup-restore' },",
    "  titan_parallel_v1: { operation: 'host_action.titan_parallel_v1', rollback: 'host-action-v2:titan-parallel:rollback' },",
    "  agent_zdt_source_sha_refresh_publisher_v1: { operation: 'host_action.agent_zdt_source_sha_refresh_publisher_v1', rollback: 'host-action-v2:agent-zdt-source-sha-refresh-publisher-v1:action-backup-restore' }",
    '});',
    'const HOST_ACTION_V2_LEVEL3 = new Set(["control_plane_root_scripts_stage_transport_v1"]);',
  ].join('\n');
  const out=bootstrap.buildBaseCandidate(src);
  assert.match(out,/drtarjomeh_security_release_deploy_v1/);
  assert.match(out,/titan_parallel_v1/);
  const level3=out.match(/HOST_ACTION_V2_LEVEL3 = new Set\((\[[^;]+\])\)/)?.[1]||'';
  assert.equal(level3.includes('drtarjomeh_security_release_deploy_v1'),false);
  assert.throws(()=>bootstrap.buildBaseCandidate(out),/already_present/);
});

test('MCP candidate appends only fixed action and preserves current actions',()=>{
  const src="const HostActionV2=z.enum(['drtarjomeh_security_containment_v1','titan_parallel_v1','control_plane_root_scripts_stage_transport_v1']);";
  const out=bootstrap.buildMcpCandidate(src);
  assert.equal((out.match(/drtarjomeh_security_release_deploy_v1/g)||[]).length,1);
  assert.match(out,/titan_parallel_v1/);
  assert.throws(()=>bootstrap.buildMcpCandidate(out),/already_present/);
});

test('executor candidate binds exact helper SHA in a fixed sandbox with no arbitrary input',()=>{
  const helperSha='f'.repeat(64);
  const src=[
    "const ACTION_SPECS={control_plane_root_scripts_stage_transport_v1:{operation:'host_action.control_plane_root_scripts_stage_transport_v1',kind:'control_plane_root_scripts_stage_transport_v1'},};",
    'const applyHostActionV2Original=applyHostActionV2;',
    "applyHostActionV2=async function(action){if(action==='control_plane_root_scripts_stage_transport_v1')return applyControlPlaneRootScriptsStageTransportV1();if(action==='titan_parallel_v1')return applyTitanParallelV1();return applyHostActionV2Original(action);};",
  ].join('\n');
  const out=bootstrap.buildExecCandidate(src,helperSha);
  assert.match(out,/drtarjomeh_security_release_deploy_v1/);
  assert.match(out,/helperSha!==['"]ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff['"]/);
  assert.match(out,/ProtectSystem=strict/);
  assert.match(out,/ProtectHome=read-only/);
  assert.match(out,/NoNewPrivileges=true/);
  assert.match(out,/ReadWritePaths=\/home\/drtarjomeh\/domains\/drtarjomeh\.ir\/releases \/etc\/drtarjomeh/);
  assert.match(out,/titan_parallel_v1/);
  assert.doesNotMatch(out,/bash -lc|sh -c|req\.body\.command|arbitrary_path|eval\(/);
  assert.throws(()=>bootstrap.buildExecCandidate(out,helperSha),/already_present/);
});
