'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const impl = require('./bootstrap-host-actions-v19-agent-zdt-source-sha-refresh-registration.js');

const ACTION = 'agent_zdt_source_sha_refresh_publisher_v1';
const OPERATION = 'host_action.agent_zdt_source_sha_refresh_publisher_v1';
const PUBLISHER_SHA = '35273ffc75f7c08ef68797945426ab4108e03b09e66122d398b51a7fab79658f';

test('registration contract is fixed to current reviewed baselines and publisher', () => {
  assert.equal(impl.ACTION, ACTION);
  assert.equal(impl.OPERATION, OPERATION);
  assert.deepEqual(impl.BASELINE, {
    base: '981a430f5448a1b0dc3c25886756ecf7cd655352660bb49905ab2650a131d764',
    executor: '451c5a4762a4c7a04d64d526a79cf6e86b0cf7c978c559cf303d874e0f08fc48',
    policy: 'd7b7270f32d90cd55515ffb8337c08481bf58865c2e34858e3ebdf0056362cb7'
  });
  assert.equal(impl.PUBLISHER.path, '/home/agent/ssh-agent-api/bootstrap-agent-zdt-source-sha-refresh-v19.sh');
  assert.equal(impl.PUBLISHER.sha256, PUBLISHER_SHA);
});

test('base patch registers exactly one fixed Level-3 action', () => {
  const before = `const HOST_ACTION_V2_SPECS = Object.freeze({\n  existing: { operation: 'host_action.existing', rollback: 'x' }\n});\nconst HOST_ACTION_V2_LEVEL3 = new Set(["existing"]);\n`;
  const out = impl.patchBase(before);
  assert.equal((out.match(new RegExp(`\\b${ACTION}: \{`, 'g')) || []).length, 1);
  assert.equal((out.match(new RegExp(`\"${ACTION}\"`, 'g')) || []).length, 1);
  assert.match(out, new RegExp(`operation: '${OPERATION}'`));
  assert.match(out, /rollback: 'host-action-v2:agent-zdt-source-sha-refresh-publisher-v1:action-backup-restore'/);
  assert.match(out, new RegExp(`new Set\\(\\["existing","${ACTION}"\\]\\)`));
});

test('executor patch registers a fixed SHA-checked zero-input publisher and dispatch', () => {
  const before = `const HOST_ACTION_V2_SPECS = Object.freeze({\n  existing:{operation:'host_action.existing',kind:'existing'}\n});\nconst applyHostActionV2Original=applyHostActionV2;\napplyHostActionV2=async function(action){return applyHostActionV2Original(action);};\n`;
  const out = impl.patchExecutor(before);
  assert.match(out, new RegExp(`${ACTION}:\\{operation:'${OPERATION}',kind:'${ACTION}'\\}`));
  assert.match(out, new RegExp(PUBLISHER_SHA));
  assert.match(out, /bootstrap-agent-zdt-source-sha-refresh-v19\.sh/);
  assert.match(out, /if\(action==='agent_zdt_source_sha_refresh_publisher_v1'\)return applyAgentZdtSourceShaRefreshPublisherV1\(\)/);
  assert.doesNotMatch(out, /exec\s*\(|spawn\s*\(.*shell\s*:/);
});

test('policy patch adds one high-risk Level-3 typed scope and preserves unrelated policy', () => {
  const before = JSON.stringify({
    operations: {'host_action.existing': {level: 4}},
    typed_scopes: [{tool:'other', project:'x', environment:'y', action:'z', risk:'low', operation:'other', principals:[]}],
    marker: 'preserve'
  }, null, 2) + '\n';
  const out = JSON.parse(impl.patchPolicy(before));
  assert.deepEqual(out.operations[OPERATION], {level: 3});
  const scopes = out.typed_scopes.filter(x => x.action === ACTION);
  assert.equal(scopes.length, 1);
  assert.deepEqual(scopes[0], {
    tool: 'host_action_v2_apply', project: 'control_plane', environment: 'production',
    action: ACTION, risk: 'high', operation: OPERATION,
    principals: [{principal_id:'mohammad', roles:['mcp-operator']}]
  });
  assert.equal(out.marker, 'preserve');
});

test('patchers fail closed on duplicate registration or missing anchors', () => {
  assert.throws(() => impl.patchBase('no anchors'), /anchor/);
  assert.throws(() => impl.patchExecutor('no anchors'), /anchor/);
  const policy = JSON.stringify({operations:{[OPERATION]:{level:3}}, typed_scopes:[]});
  assert.throws(() => impl.patchPolicy(policy), /already/);
});
