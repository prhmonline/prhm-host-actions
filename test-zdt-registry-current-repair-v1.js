'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');

const ART='./artifacts/agent-mcp-registry-zdt-repair-v1.js';
const MAN='./agent-zdt-registry-current-repair-v1.json';
const source=fs.readFileSync(ART,'utf8');
const manifest=JSON.parse(fs.readFileSync(MAN,'utf8'));
const sha=s=>crypto.createHash('sha256').update(s,'utf8').digest('hex');

test('artifact is exact SHA-bound reviewed candidate',()=>{
  assert.equal(manifest.preimage_sha256,'7432741650ee5c5bc3bb72c1403050b27a665e9218153b40e58955da77b471a4');
  assert.equal(manifest.candidate_sha256,'dd3aa536f2f04f49a416b4e2cadda1858d524d92af645b28f66116df326b1517');
  assert.equal(sha(source),manifest.candidate_sha256);
  assert.equal(Buffer.byteLength(source,'utf8'),manifest.candidate_bytes);
});

test('registers exactly one action-specific rolling-refresh apply tool',()=>{
  assert.equal(source.split("'agent_zdt_existing_topology_rolling_refresh_apply_v1'").length-1,1);
  assert.equal(source.split("const result=base.registerPlugins(zdtCaptureMcp,context);").length-1,1);
  assert.equal(source.includes("const result=base.registerPlugins(withProjectSchemas(ticketingBridge.proxy),context);"),false);
});

test('delegates only to current Level-3 apply and status handlers',()=>{
  assert.ok(source.includes("host_action_v2_status"));
  assert.ok(source.includes("host_action_v2_apply_level3"));
  assert.ok(source.includes("zdtLevel3ApplyHandler(args)"));
  assert.equal(source.includes("CONFIRM_LEVEL_4_CRITICAL"),false);
  assert.equal(manifest.confirmation,'CONFIRM_LEVEL_3_PRODUCTION');
  assert.equal(manifest.level,3);
  assert.equal(manifest.risk,'high');
});

test('fail-closed checks bind request identity, action, hash, policy, scope and expiry',()=>{
  for(const needle of [
    'agent_zdt_request_not_pending',
    'agent_zdt_request_id_mismatch',
    'agent_zdt_request_action_mismatch',
    'agent_zdt_request_operation_mismatch',
    'agent_zdt_request_arguments_sha_mismatch',
    'agent_zdt_request_policy_mismatch',
    'agent_zdt_request_scope_mismatch',
    'agent_zdt_request_expired',
    '038cf86f8148bad455466dd7cc252805c56cded28f9ea1040a662db43f89d076'
  ]) assert.ok(source.includes(needle),needle);
});

test('manifest exposes no arbitrary mutation inputs',()=>{
  assert.equal(manifest.target_path,'/home/agent/ssh-mcp-server/src/core/registry.js');
  assert.equal(manifest.arbitrary_path,false);
  assert.equal(manifest.arbitrary_command,false);
  assert.equal(manifest.database_mutation,false);
  assert.equal(manifest.production_mutation_on_git_commit,false);
  assert.equal(manifest.runtime_mutation_on_git_commit,false);
});
