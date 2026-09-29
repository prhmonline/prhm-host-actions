'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const modulePath=path.join(__dirname,'bootstrap-host-actions-v29-moeinshow-wallet-cutover.js');
function load(){
  assert.equal(fs.existsSync(modulePath),true,'v29 bootstrap module must exist');
  return require(modulePath);
}

test('v29 bootstrap module exists',()=>{
  assert.equal(fs.existsSync(modulePath),true,'v29 bootstrap module must exist');
});

test('identity, target commit, and live preimage SHA pins are fixed',()=>{
  const m=load();
  assert.equal(m.PREFLIGHT_ACTION,'moeinshow_wallet_cutover_preflight_v1');
  assert.equal(m.APPLY_ACTION,'moeinshow_wallet_cutover_apply_v1');
  assert.equal(m.PREFLIGHT_OPERATION,'host_action.moeinshow_wallet_cutover_preflight_v1');
  assert.equal(m.APPLY_OPERATION,'host_action.moeinshow_wallet_cutover_apply_v1');
  assert.equal(m.MOEINSHOW_TARGET_SHA,'cc8f68d8c8da7be4b122daf2c002a5f45c36eaa4');
  assert.equal(m.BASE_SHA,'de924f7319f3656d788ba5d3f89ef2910bf4b0e3f0b8b074e7cd3a534441d5ea');
  assert.equal(m.EXEC_SHA,'6bba46890db31abc8eca7e7681753a4788c46170033a555a1106e05d0a7a66f9');
  assert.equal(m.POLICY_SHA,'2fedd70a182aa351e269df95a1b9d829f5a0b18defe8871cb4045106948d711a');
  assert.equal(m.MCP_SHA,'b2f95b97dfa7e26ca717dfbec7871bf2f64286952548fb4d6d8e99908aeaacc0');
});

test('policy makes preflight Level-3 and apply Level-4 critical one-time',()=>{
  const m=load();
  const src=JSON.stringify({schema_version:'prhm.approval-policy.v1',version:'x',operations:{},typed_scopes:[]});
  const p=JSON.parse(m.buildPolicyCandidate(src));
  assert.equal(p.operations[m.PREFLIGHT_OPERATION].level,3);
  assert.equal(p.operations[m.PREFLIGHT_OPERATION].risk,'high');
  assert.equal(p.operations[m.APPLY_OPERATION].level,4);
  assert.equal(p.operations[m.APPLY_OPERATION].risk,'critical');
  assert.equal(p.operations[m.APPLY_OPERATION].requires_second_confirmation,true);
  assert.equal(p.operations[m.APPLY_OPERATION].one_time_use,true);
  assert.equal(p.typed_scopes.filter(x=>x.action===m.PREFLIGHT_ACTION).length,1);
  assert.equal(p.typed_scopes.filter(x=>x.action===m.APPLY_ACTION).length,1);
});

test('base, MCP, and executor expose exactly the two fixed actions',()=>{
  const m=load();
  const base="const HOST_ACTION_V2_SPECS = Object.freeze({\n  mcp_candidate_schema_compare_v1: { operation: 'host_action.mcp_candidate_schema_compare_v1', rollback: 'host-action-v2:mcp-candidate-schema-compare-v1:auto-backup' },\n});\nconst HOST_ACTION_V2_LEVEL3 = new Set([\"mcp_candidate_schema_compare_v1\"]);";
  const baseOut=m.buildBaseCandidate(base);
  assert.match(baseOut,/moeinshow_wallet_cutover_preflight_v1/);
  assert.match(baseOut,/moeinshow_wallet_cutover_apply_v1/);
  const level3=baseOut.slice(baseOut.indexOf('const HOST_ACTION_V2_LEVEL3'),baseOut.indexOf(';',baseOut.indexOf('const HOST_ACTION_V2_LEVEL3'))+1);
  assert.equal(level3.includes(m.PREFLIGHT_ACTION),true);
  assert.equal(level3.includes(m.APPLY_ACTION),false);

  const mcpOut=m.buildMcpCandidate("const HostActionV2=z.enum(['mcp_candidate_schema_compare_v1']);");
  assert.match(mcpOut,/moeinshow_wallet_cutover_preflight_v1/);
  assert.match(mcpOut,/moeinshow_wallet_cutover_apply_v1/);

  const exec="const HOST_ACTION_V2_SPECS = Object.freeze({\n  mcp_candidate_schema_compare_v1:{operation:'host_action.mcp_candidate_schema_compare_v1',kind:'mcp_candidate_schema_compare_v1'},\n});\nasync function applyHostActionV2(action){if(action==='mcp_candidate_schema_compare_v1')return applyMcpCandidateSchemaCompareV1();return applyHostActionV2Original(action);}";
  const execOut=m.buildExecCandidate(exec);
  assert.match(execOut,/applyMoeinshowWalletCutoverPreflightV1/);
  assert.match(execOut,/applyMoeinshowWalletCutoverV1/);
  assert.match(execOut,/ProtectSystem=strict/);
  assert.match(execOut,/ProtectHome=read-only/);
  assert.doesNotMatch(execOut,/bash -lc|sh -c/);
});

test('embedded helper is Wallet-only, config-read-only, and never returns token',()=>{
  const m=load();
  const h=m.helperSource();
  assert.match(h,/payments\.wallet/);
  assert.match(h,/config:read/);
  assert.doesNotMatch(h,/secrets:read/);
  assert.match(h,/moeinshow/);
  assert.match(h,/cc8f68d8c8da7be4b122daf2c002a5f45c36eaa4/);
  assert.match(h,/app\/_env\/prod\.php/);
  assert.match(h,/PRHM_CONFIG_CENTER_BOOTSTRAP_V1/);
  assert.match(h,/rollback/);
  assert.match(h,/token_redacted:true/);
  assert.doesNotMatch(h,/result\.token\s*=|token:\s*plainToken|plainToken\s*[,}]/);
});

test('preflight is read-only and apply is rollback-capable',()=>{
  const m=load();
  const h=m.helperSource();
  assert.match(h,/function preflight/);
  assert.match(h,/function apply/);
  assert.match(h,/worktree_clean/);
  assert.match(h,/remote_target_match/);
  assert.match(h,/wallet_catalog_found/);
  assert.match(h,/bootstrap_file_safe/);
  assert.match(h,/rollback_performed/);
  assert.match(h,/saman_untouched/);
  assert.match(h,/mediana_untouched/);
});

test('rollback deletes only the audit row for the published revision',()=>{
  const m=load();
  const h=m.helperSource();
  assert.match(h,/after_json->revision/);
  assert.match(h,/meta\['revision'\]/);
});

test('bootstrap file is installed with application ownership and restrictive readable mode',()=>{
  const m=load();
  const h=m.helperSource();
  assert.match(h,/appOwner/);
  assert.match(h,/0o640/);
  assert.match(h,/chownSync/);
});

test('selftest passes',()=>{
  const m=load();
  const r=m.selftest();
  assert.equal(r.ok,true);
  assert.equal(r.target_sha,m.MOEINSHOW_TARGET_SHA);
  assert.match(r.helper_sha256,/^[a-f0-9]{64}$/);
});

test('installer follows the live 8132/8134 candidate topology and patches every MCP source',()=>{
  const m=load();
  const s=fs.readFileSync(modulePath,'utf8');
  assert.match(s,/agent3-fast-launch-v1\/mcp\/src\/plugins\/hostActionsV2\.js/);
  assert.match(s,/agent3-instant-delivery-v1\/mcp\/src\/plugins\/hostActionsV2\.js/);
  assert.match(s,/prhm-agent-mcp-fast-launch-candidate\.service/);
  assert.match(s,/prhm-agent-mcp-instant-delivery-candidate\.service/);
  assert.match(s,/mcp-active/);
  assert.match(s,/8132/);
  assert.match(s,/8134/);
  assert.doesNotMatch(s,/restart\(['"]prhm-agent-mcp\.service['"]\)/);
});

test('candidate refresh is zero-downtime and rollback restores the original router pointer',()=>{
  const s=fs.readFileSync(modulePath,'utf8');
  assert.match(s,/standby.*8132|8132.*standby/s);
  assert.match(s,/active.*8134|8134.*active/s);
  assert.match(s,/\/health/);
  assert.match(s,/\/ready/);
  assert.match(s,/restore.*pointer|pointer.*rollback|rollback.*pointer/s);
  assert.match(s,/8123/);
});
