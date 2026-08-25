const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const mod = require('./bootstrap-prhm-root-of-trust-fixed-seed-v1.js');

const ACTION = 'control_plane_root_scripts_stage_transport_v1';
const fixtureBase = "const HOST_ACTION_V2={\n  imotion_credential_bind_v1: { operation: 'host_action.imotion_credential_bind_v1', rollback: 'host-action-v2:imotion-credential-bind-v1:remote-controller-backup-restore' }\n});\n";
const fixtureExecutor = "const HOST_ACTION_V2_SPECS={\n  imotion_credential_bind_v1:{operation:'host_action.imotion_credential_bind_v1',kind:'imotion_credential_bind_v1'}\n});\nconst applyHostActionV2Original=applyHostActionV2;\napplyHostActionV2=async function(action){if(action==='imotion_credential_bind_v1')return applyImotionCredentialBindV1();return applyHostActionV2Original(action);};\n";
const fixturePolicy = JSON.stringify({
  version:'fixture',
  operations:{
    'host_action.control_plane_root_scripts_stage_transport_v1':{level:4},
    'host_action.imotion_credential_bind_v1':{level:4}
  },
  typed_scopes:[
    {tool:'control_plane_root_scripts_stage_transport_apply_v1',project:'control_plane',environment:'production',action:'control_plane_root_scripts_stage_transport_v1',risk:'critical',operation:'host_action.control_plane_root_scripts_stage_transport_v1',principals:[{principal_id:'mohammad',roles:['mcp-operator']}]},
    {tool:'host_action_v2_apply',project:'control_plane',environment:'production',action:'imotion_credential_bind_v1',risk:'critical',operation:'host_action.imotion_credential_bind_v1',principals:[{principal_id:'mohammad',roles:['mcp-operator']}]}
  ]
});

test('registers only the fixed root-scripts transport action in base, executor, and policy', () => {
  const out = mod.buildPatchedFrom({base: fixtureBase, executor: fixtureExecutor, policy: fixturePolicy});
  assert.match(out.base, new RegExp(ACTION));
  assert.match(out.executor, new RegExp(ACTION));
  const p = JSON.parse(out.policy);
  assert.equal(p.operations['host_action.' + ACTION].level, 4);
  assert.equal(p.typed_scopes.filter(x => x.action === ACTION).length, 1);
});

test('rejects missing or duplicate structural anchors', () => {
  assert.throws(() => mod.buildPatchedFrom({base:'const HOST_ACTION_V2={};\n', executor:fixtureExecutor, policy:fixturePolicy}), /base_imotion_anchor_missing/);
  assert.throws(() => mod.buildPatchedFrom({
    base:"const HOST_ACTION_V2={\n  imotion_credential_bind_v1: { operation: 'host_action.imotion_credential_bind_v1', rollback: 'x' },\n  imotion_credential_bind_v1: { operation: 'host_action.imotion_credential_bind_v1', rollback: 'x' }\n});\n",
    executor:fixtureExecutor,
    policy:fixturePolicy
  }), /base_imotion_anchor_duplicate/);
});

test('completes compatible policy-only partial registration without deleting action-specific scope', () => {
  const out = mod.buildPatchedFrom({base:fixtureBase, executor:fixtureExecutor, policy:fixturePolicy});
  const p = JSON.parse(out.policy);
  assert.equal(p.operations['host_action.' + ACTION].level, 4);
  assert.equal(p.typed_scopes.filter(x => x.action === ACTION && x.tool === 'control_plane_root_scripts_stage_transport_apply_v1').length, 1);
  assert.equal(p.typed_scopes.filter(x => x.action === ACTION && x.tool === 'host_action_v2_apply').length, 1);
});

test('rejects conflicting existing target policy operation', () => {
  const p = JSON.parse(fixturePolicy);
  p.operations['host_action.' + ACTION] = {level:3};
  assert.throws(() => mod.buildPatchedFrom({base:fixtureBase, executor:fixtureExecutor, policy:JSON.stringify(p)}), /conflicting_existing_registration/);
});

test('rejects any unexpected runtime argument surface', () => {
  assert.deepEqual(mod.RUNTIME_INPUTS, []);
});

test('pins the production baseline hashes and transport helper SHA', () => {
  assert.deepEqual(mod.BASELINE_SHA, {
    base: 'e186036e8efd9c9663b977a20f62fb90cedb70b48bfa0f1fb48cbc53a64020cd',
    executor: '1e683d0962bc1e0503b9deb1f0d266ad44d6fc5d3c1566dc87f2f7733d4802bd',
    policy: '76cca4574708709c921d67e91068e9f25508c6769f4d150718c8b068f870233d'
  });
  assert.equal(mod.TRANSPORT_HELPER_SHA, 'c64d2fb4c2ae2b048f7f57f6a5e4923588b76ae8a134a540e791b03285ff4d87');
});

test('seed contract excludes generic root inputs and production app/database capabilities', () => {
  const src = fs.readFileSync(require.resolve('./bootstrap-prhm-root-of-trust-fixed-seed-v1.js'),'utf8');
  for (const forbidden of ['process.argv.slice(2)','authorized_keys','ssh-rsa','BEGIN OPENSSH PRIVATE KEY','createServer(','mysql2','node:pg','/home/drtarjomeh/domains/']) {
    assert.equal(src.includes(forbidden), false, forbidden);
  }
});
