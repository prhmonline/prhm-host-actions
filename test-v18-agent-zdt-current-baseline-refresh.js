'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const IMPL = path.join(
  __dirname,
  'bootstrap-host-actions-v18-agent-zdt-current-baseline-refresh.js'
);

const TRANSPORT_SHA =
  '049250921dda0aa98ade7cf3707634668590bd66163606de5906841f5ca34335';

const BOOTSTRAP_SHA =
  'd3be569a4fd63b8e0c78e370ad689a27aa2751ea772891cb6b7ffe7fbd49b35e';

const OLD_BASELINE = Object.freeze({
  base: 'c38bb88c5d7000eebedc5db758c7dd7d846b7b1a6df589c10f37237c3d1cce00',
  executor: 'edaf10ace464cb70ea1625cb7998b2bae0112b46b1d4f383334ceeaf5b6a5108',
  policy: '162bfa045d9b600a48989dd88e4b367beff1272cbb9b83e1dbc5cf6bc8d6adad',
  mcp: 'c7be9c315319c893ee821268507577f10cb001440899f670659b2c3c7b26b722',
  zdt: '04a1416e837b1ae47e0a0ae72b5c1547d03118022c6c9ff19f392572ff7d38b4',
});

const CURRENT_BASELINE = Object.freeze({
  base: '747c83ecf095fa381acb9ba9f12737b3530dcb3d2b68a64ee2a4354cf9c36a29',
  executor: 'd8db336881f80589b2ca30e953f8a7a3992d205dd79057ffc2fb0acd11d74c86',
  policy: '5b1e96a23d66ccb2017b0bb07c6cf19b8bc74fd34bcc9425ee737cfbecba2bc1',
  mcp: '1a06d026d04db622bd24f4b3d2df9211c8668d3e61e920f35cc7282a6662d588',
  zdt: '966d91c5af901f2f96e782c1f83915a49b9831f9b226000944a65e25b56e009b',
});

const STAGE_ARTIFACTS = Object.freeze({
  transport: Object.freeze({
    path:
      '/var/lib/prhm-agent-selfmaint-exec/root-of-trust-stage-v1/' +
      'control-plane-typed-bootstrap-transport-v1.js',
    sha256: TRANSPORT_SHA,
  }),
  bootstrap: Object.freeze({
    path:
      '/var/lib/prhm-agent-selfmaint-exec/root-of-trust-stage-v1/' +
      'bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js',
    sha256: BOOTSTRAP_SHA,
  }),
});

function load() {
  delete require.cache[require.resolve(IMPL)];
  return require(IMPL);
}

test('exports fixed current-baseline refresh contract', () => {
  const m = load();

  assert.equal(
    m.ACTION,
    'control_plane_typed_bootstrap_current_baseline_refresh_v1'
  );

  assert.deepEqual(m.STAGE_ARTIFACTS, STAGE_ARTIFACTS);
  assert.deepEqual(m.OLD_BASELINE, OLD_BASELINE);
  assert.deepEqual(m.CURRENT_BASELINE, CURRENT_BASELINE);

  assert.equal(typeof m.validateStageEvidence, 'function');
  assert.equal(typeof m.buildCurrentBaselineCandidate, 'function');
});

test('stage evidence is exact-SHA, regular-file and symlink guarded', () => {
  const m = load();

  const good = {
    transport: {
      path: STAGE_ARTIFACTS.transport.path,
      sha256: TRANSPORT_SHA,
      exists: true,
      regular: true,
      symlink: false,
    },
    bootstrap: {
      path: STAGE_ARTIFACTS.bootstrap.path,
      sha256: BOOTSTRAP_SHA,
      exists: true,
      regular: true,
      symlink: false,
    },
  };

  assert.doesNotThrow(() => m.validateStageEvidence(good));

  const badCases = [
    {
      ...good,
      transport: {...good.transport, sha256: '0'.repeat(64)},
    },
    {
      ...good,
      bootstrap: {...good.bootstrap, sha256: '0'.repeat(64)},
    },
    {
      ...good,
      transport: {...good.transport, exists: false},
    },
    {
      ...good,
      bootstrap: {...good.bootstrap, regular: false},
    },
    {
      ...good,
      transport: {...good.transport, symlink: true},
    },
    {
      ...good,
      bootstrap: {...good.bootstrap, path: '/tmp/bootstrap.js'},
    },
  ];

  for (const bad of badCases) {
    assert.throws(() => m.validateStageEvidence(bad));
  }
});

test('candidate refreshes exactly the known stale baseline and nothing else', () => {
  const m = load();

  const stale =
    "prefix\n" +
    "const BASELINE=Object.freeze(" +
    JSON.stringify(OLD_BASELINE) +
    ");\n" +
    "suffix\n";

  const out = m.buildCurrentBaselineCandidate(stale);

  assert.equal(out.ok, true);
  assert.equal(out.production_mutation, false);
  assert.equal(out.replacement_count, 1);
  assert.match(out.sha256, /^[a-f0-9]{64}$/);

  for (const sha of Object.values(CURRENT_BASELINE)) {
    assert.ok(out.content.includes(sha));
  }

  for (const sha of Object.values(OLD_BASELINE)) {
    assert.equal(out.content.includes(sha), false);
  }

  assert.ok(out.content.startsWith('prefix\n'));
  assert.ok(out.content.endsWith('suffix\n'));
});

test('candidate generation fails closed on missing, duplicated or unexpected baseline', () => {
  const m = load();

  const anchor =
    "const BASELINE=Object.freeze(" +
    JSON.stringify(OLD_BASELINE) +
    ");";

  assert.throws(() =>
    m.buildCurrentBaselineCandidate('no baseline here')
  );

  assert.throws(() =>
    m.buildCurrentBaselineCandidate(anchor + '\n' + anchor)
  );

  const drifted = {
    ...OLD_BASELINE,
    mcp: '0'.repeat(64),
  };

  assert.throws(() =>
    m.buildCurrentBaselineCandidate(
      "const BASELINE=Object.freeze(" +
      JSON.stringify(drifted) +
      ");"
    )
  );
});

test('refresh module exposes no caller-controlled path or command surface', () => {
  const m = load();

  assert.equal(m.buildCurrentBaselineCandidate.length, 1);
  assert.equal(m.validateStageEvidence.length, 1);

  for (const forbidden of [
    'runPromotion',
    'runFixedBootstrap',
    'command',
    'exec',
    'spawn',
    'destinationPath',
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(m, forbidden),
      false
    );
  }
});

test('RED4 builds fixed four-owner registration candidates for current-baseline promotion', () => {
  const m = load();

  assert.equal(
    m.PROMOTION_ACTION,
    'control_plane_typed_bootstrap_current_baseline_refresh_v1'
  );

  assert.equal(
    m.PROMOTION_SOURCE_SHA256,
    'd3be569a4fd63b8e0c78e370ad689a27aa2751ea772891cb6b7ffe7fbd49b35e'
  );

  assert.equal(
    m.PROMOTION_CANDIDATE_SHA256,
    '0adb6e91b006458da56566c2cdb2a903f945357b5bcf286cef7e5ce9cfcf1535'
  );

  assert.equal(typeof m.buildRegistrationCandidates, 'function');

  const input = {
    base: [
      "const HOST_ACTION_V2_SPECS = Object.freeze({",
      "  control_plane_typed_bootstrap_transport_v1: { operation: 'host_action.control_plane_typed_bootstrap_transport_v1', rollback: 'host-action-v2:control-plane-typed-bootstrap-transport-v1:journal-restore' },",
      "  selfmaint_exec_route_refresh_v1: { operation: 'host_action.selfmaint_exec_route_refresh_v1', rollback: 'host-action-v2:selfmaint-exec-route-refresh-v1:no-file-mutation' },",
      "});"
    ].join('\n'),

    exec: [
      "const HOST_ACTION_V2_SPECS = Object.freeze({",
      "  control_plane_typed_bootstrap_transport_v1:{operation:'host_action.control_plane_typed_bootstrap_transport_v1',kind:'control_plane_typed_bootstrap_transport_v1'},",
      "  selfmaint_exec_route_refresh_v1:{operation:'host_action.selfmaint_exec_route_refresh_v1',kind:'selfmaint_exec_route_refresh_v1'},",
      "});",
      "const applyHostActionV2Original=applyHostActionV2;",
      "applyHostActionV2=async function(action){if(action==='control_plane_typed_bootstrap_transport_v1')return applyControlPlaneTypedBootstrapTransportV1();if(action==='selfmaint_exec_route_refresh_v1')return applySelfmaintExecRouteRefreshV1();return applyHostActionV2Original(action);};"
    ].join('\n'),

    policy: JSON.stringify({
      operations: {
        'host_action.control_plane_typed_bootstrap_transport_v1': {
          level: 4
        }
      },
      typed_scopes: [
        {
          tool: 'host_action_v2_apply',
          project: 'control_plane',
          environment: 'production',
          action: 'control_plane_typed_bootstrap_transport_v1',
          risk: 'critical',
          operation: 'host_action.control_plane_typed_bootstrap_transport_v1',
          principals: [
            {
              principal_id: 'mohammad',
              roles: ['mcp-operator']
            }
          ]
        }
      ]
    }, null, 2) + '\n',

    mcp: [
      "const HostActionV2=z.enum([",
      "'control_plane_typed_bootstrap_transport_v1',",
      "'selfmaint_exec_route_refresh_v1'",
      "]);"
    ].join('\n')
  };

  const out = m.buildRegistrationCandidates(input);

  assert.equal(out.ok, true);
  assert.equal(out.production_mutation, false);
  assert.deepEqual(
    Object.keys(out.files).sort(),
    ['base', 'exec', 'mcp', 'policy']
  );

  for (const name of ['base', 'exec', 'mcp']) {
    assert.match(
      out.files[name],
      /control_plane_typed_bootstrap_current_baseline_refresh_v1/
    );
  }

  const policy = JSON.parse(out.files.policy);

  assert.equal(
    policy.operations[
      'host_action.control_plane_typed_bootstrap_current_baseline_refresh_v1'
    ].level,
    4
  );

  const scope = policy.typed_scopes.find(
    x =>
      x &&
      x.action ===
        'control_plane_typed_bootstrap_current_baseline_refresh_v1'
  );

  assert.ok(scope);
  assert.equal(scope.risk, 'critical');

  assert.match(
    out.files.exec,
    /d3be569a4fd63b8e0c78e370ad689a27aa2751ea772891cb6b7ffe7fbd49b35e/
  );

  assert.match(
    out.files.exec,
    /0adb6e91b006458da56566c2cdb2a903f945357b5bcf286cef7e5ce9cfcf1535/
  );

  assert.doesNotMatch(out.files.exec, /process\.argv/);
  assert.doesNotMatch(out.files.exec, /req\.body/);
});

test('RED4 registration builder fails closed on duplicate registration', () => {
  const m = load();

  const action =
    'control_plane_typed_bootstrap_current_baseline_refresh_v1';

  const duplicate = {
    base: action,
    exec: action,
    policy: JSON.stringify({
      operations: {
        ['host_action.' + action]: { level: 4 }
      },
      typed_scopes: []
    }),
    mcp: action
  };

  assert.throws(() => m.buildRegistrationCandidates(duplicate));
});

test('RED5 promotion handler performs exact SHA-bound atomic staged bootstrap refresh', () => {
  const m = load();

  const input = {
    base: [
      "const HOST_ACTION_V2_SPECS = Object.freeze({",
      "  control_plane_typed_bootstrap_transport_v1: { operation: 'host_action.control_plane_typed_bootstrap_transport_v1', rollback: 'host-action-v2:control-plane-typed-bootstrap-transport-v1:journal-restore' },",
      "  selfmaint_exec_route_refresh_v1: { operation: 'host_action.selfmaint_exec_route_refresh_v1', rollback: 'host-action-v2:selfmaint-exec-route-refresh-v1:no-file-mutation' },",
      "});"
    ].join('\n'),

    exec: [
      "const HOST_ACTION_V2_SPECS = Object.freeze({",
      "  control_plane_typed_bootstrap_transport_v1:{operation:'host_action.control_plane_typed_bootstrap_transport_v1',kind:'control_plane_typed_bootstrap_transport_v1'},",
      "  selfmaint_exec_route_refresh_v1:{operation:'host_action.selfmaint_exec_route_refresh_v1',kind:'selfmaint_exec_route_refresh_v1'},",
      "});",
      "const applyHostActionV2Original=applyHostActionV2;",
      "applyHostActionV2=async function(action){if(action==='control_plane_typed_bootstrap_transport_v1')return applyControlPlaneTypedBootstrapTransportV1();if(action==='selfmaint_exec_route_refresh_v1')return applySelfmaintExecRouteRefreshV1();return applyHostActionV2Original(action);};"
    ].join('\n'),

    policy: JSON.stringify({
      operations: {
        'host_action.control_plane_typed_bootstrap_transport_v1': {
          level: 4
        }
      },
      typed_scopes: [
        {
          tool: 'host_action_v2_apply',
          project: 'control_plane',
          environment: 'production',
          action: 'control_plane_typed_bootstrap_transport_v1',
          risk: 'critical',
          operation: 'host_action.control_plane_typed_bootstrap_transport_v1',
          principals: [
            {
              principal_id: 'mohammad',
              roles: ['mcp-operator']
            }
          ]
        }
      ]
    }, null, 2) + '\n',

    mcp: [
      "const HostActionV2=z.enum([",
      "'control_plane_typed_bootstrap_transport_v1',",
      "'selfmaint_exec_route_refresh_v1'",
      "]);"
    ].join('\n')
  };

  const out = m.buildRegistrationCandidates(input);
  const exec = out.files.exec;

  assert.match(
    exec,
    /d3be569a4fd63b8e0c78e370ad689a27aa2751ea772891cb6b7ffe7fbd49b35e/
  );

  assert.match(
    exec,
    /0adb6e91b006458da56566c2cdb2a903f945357b5bcf286cef7e5ce9cfcf1535/
  );

  assert.match(
    exec,
    /const BASELINE=Object\.freeze/
  );

  assert.match(
    exec,
    /current_baseline_refresh_candidate_sha_mismatch/
  );

  assert.match(
    exec,
    /current_baseline_refresh_backup/
  );

  assert.match(
    exec,
    /writeFileSync/
  );

  assert.match(
    exec,
    /renameSync/
  );

  assert.match(
    exec,
    /--check/
  );

  assert.match(
    exec,
    /rollback_performed/
  );

  assert.match(
    exec,
    /production_mutation:true/
  );

  assert.doesNotMatch(
    exec,
    /promotion_ready:true/
  );

  assert.doesNotMatch(exec, /process\.argv/);
  assert.doesNotMatch(exec, /req\.body/);
  assert.doesNotMatch(exec, /destinationPath/);
});

test('RED5 promotion handler is bound to one fixed source path and no caller content', () => {
  const source = require('node:fs').readFileSync(IMPL, 'utf8');

  assert.equal(
    (
      source.match(
        /bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1\.js/g
      ) || []
    ).length >= 1,
    true
  );

  assert.doesNotMatch(source, /promotionPath/);
  assert.doesNotMatch(source, /promotionContent/);
  assert.doesNotMatch(source, /callerPath/);
  assert.doesNotMatch(source, /callerContent/);
});

test('RED6 promotion rollback binding restores staged bootstrap, not registration owners', () => {
  const m = load();

  const input = {
    base: [
      "const HOST_ACTION_V2_SPECS = Object.freeze({",
      "  control_plane_typed_bootstrap_transport_v1: { operation: 'host_action.control_plane_typed_bootstrap_transport_v1', rollback: 'host-action-v2:control-plane-typed-bootstrap-transport-v1:journal-restore' },",
      "  selfmaint_exec_route_refresh_v1: { operation: 'host_action.selfmaint_exec_route_refresh_v1', rollback: 'host-action-v2:selfmaint-exec-route-refresh-v1:no-file-mutation' },",
      "});"
    ].join('\n'),

    exec: [
      "const HOST_ACTION_V2_SPECS = Object.freeze({",
      "  control_plane_typed_bootstrap_transport_v1:{operation:'host_action.control_plane_typed_bootstrap_transport_v1',kind:'control_plane_typed_bootstrap_transport_v1'},",
      "  selfmaint_exec_route_refresh_v1:{operation:'host_action.selfmaint_exec_route_refresh_v1',kind:'selfmaint_exec_route_refresh_v1'},",
      "});",
      "const applyHostActionV2Original=applyHostActionV2;",
      "applyHostActionV2=async function(action){if(action==='control_plane_typed_bootstrap_transport_v1')return applyControlPlaneTypedBootstrapTransportV1();if(action==='selfmaint_exec_route_refresh_v1')return applySelfmaintExecRouteRefreshV1();return applyHostActionV2Original(action);};"
    ].join('\n'),

    policy: JSON.stringify({
      operations: {
        'host_action.control_plane_typed_bootstrap_transport_v1': {
          level: 4
        }
      },
      typed_scopes: [{
        tool: 'host_action_v2_apply',
        project: 'control_plane',
        environment: 'production',
        action: 'control_plane_typed_bootstrap_transport_v1',
        risk: 'critical',
        operation: 'host_action.control_plane_typed_bootstrap_transport_v1',
        principals: [{
          principal_id: 'mohammad',
          roles: ['mcp-operator']
        }]
      }]
    }, null, 2) + '\n',

    mcp: [
      "const HostActionV2=z.enum([",
      "'control_plane_typed_bootstrap_transport_v1',",
      "'selfmaint_exec_route_refresh_v1'",
      "]);"
    ].join('\n')
  };

  const out = m.buildRegistrationCandidates(input);

  assert.match(
    out.files.base,
    /staged-bootstrap-source-restore/
  );

  const policy = JSON.parse(out.files.policy);

  const rollback =
    policy.operations[
      'host_action.control_plane_typed_bootstrap_current_baseline_refresh_v1'
    ].rollback_reference;

  assert.match(
    rollback,
    /staged-bootstrap-source-restore/
  );

  assert.doesNotMatch(
    out.files.base,
    /four-file-registration-restore/
  );

  assert.doesNotMatch(
    rollback,
    /four-file-registration-restore/
  );
});

test('RED7 exports fixed SHA-bound four-owner registration installer contract', () => {
  const m = load();

  assert.equal(
    typeof m.buildRegistrationInstallerSource,
    'function'
  );

  assert.equal(
    m.buildRegistrationInstallerSource.length,
    0
  );

  assert.deepEqual(
    m.REGISTRATION_BASELINE_SHA256,
    {
      "base": "a23b4fec52123f8ad484f31576281c2f1933f24a3c811cd98c28e764a292e315",
      "exec": "451c5a4762a4c7a04d64d526a79cf6e86b0cf7c978c559cf303d874e0f08fc48",
      "policy": "494e95e3173695407c84b6d082f09e57d971cb193518be813a53131cdb389a70",
      "mcp": "597701ccc1a6c39d54aef9bd22d1c8732c88536e36e12251511a509bde439b46"
}
  );

  assert.deepEqual(
    m.REGISTRATION_CANDIDATE_SHA256,
    {
    "base": "aa6f3ed4f682dd4f50f56483edad435fc05454310449a21e9bc7a412b57efb60",
    "exec": "90df17530735b3b340c2bc5ea0b8826b22ee1a6a184bd6e8a491b070ff52941c",
    "policy": "fcaee257f33cfaf5035eb97ada018af3f9115df9ac7afbd5ba55ce5961913574",
    "mcp": "5b5bfe6ec8ee867b3ecfd20328be522bd67040c1cbfc8e066c40a8f9114922cb"
}
  );
});

test('RED7 installer source is fixed, transactional and fail-closed', () => {
  const m = load();

  const source = m.buildRegistrationInstallerSource();

  for (const path of [
    '/opt/prhm-agent-selfmaint/server.js',
    '/opt/prhm-agent-selfmaint-exec/server.js',
    '/opt/prhm-company-control-plane/config/approval-policy.json',
    '/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js'
  ]) {
    assert.ok(source.includes(path));
  }

  for (const sha of Object.values(m.REGISTRATION_BASELINE_SHA256)) {
    assert.ok(source.includes(sha));
  }

  for (const sha of Object.values(m.REGISTRATION_CANDIDATE_SHA256)) {
    assert.ok(source.includes(sha));
  }

  assert.match(source, /baseline_drift/);
  assert.match(source, /candidate_sha_mismatch/);

  assert.match(source, /backup/i);
  assert.match(source, /renameSync/);
  assert.match(source, /rollback/i);

  assert.match(source, /--check/);
  assert.match(source, /JSON\.parse/);

  assert.match(
    source,
    /prhm-company-approval\.service/
  );

  assert.match(
    source,
    /prhm-agent-selfmaint\.service/
  );

  assert.match(
    source,
    /prhm-agent-selfmaint-exec\.service/
  );

  assert.match(
    source,
    /prhm-agent-mcp\.service/
  );

  assert.match(source, /is-active/);

  assert.doesNotMatch(source, /process\.argv\[[23]/);
  assert.doesNotMatch(source, /destinationPath/);
  assert.doesNotMatch(source, /callerContent/);
});


test('RED8 exports fixed registration-installer stage transport contract', () => {
  const m = load();

  assert.equal(
    m.REGISTRATION_STAGE_TRANSPORT_ACTION,
    'control_plane_current_baseline_refresh_registration_installer_stage_v1'
  );

  assert.equal(
    m.REGISTRATION_INSTALLER_SOURCE_SHA256,
    'f72d40820188da43746ba5759ce9e9e7f3e811c0f3c1739a732cef9a78366f82'
  );

  assert.equal(
    m.REGISTRATION_INSTALLER_DESTINATION,
    '/opt/prhm-agent-selfmaint-exec/actions/current-baseline-refresh-registration-installer-v1.js'
  );

  assert.equal(
    typeof m.buildRegistrationStageTransportSource,
    'function'
  );

  assert.equal(
    m.buildRegistrationStageTransportSource.length,
    0
  );
});

test('RED8 stage transport is fixed, SHA-bound, atomic and rollback-safe', () => {
  const m = load();

  const source = m.buildRegistrationStageTransportSource();

  assert.match(
    source,
    /control_plane_current_baseline_refresh_registration_installer_stage_v1/
  );

  assert.match(
    source,
    /\/opt\/prhm-agent-selfmaint-exec\/actions\/current-baseline-refresh-registration-installer-v1\.js/
  );

  assert.match(
    source,
    /f72d40820188da43746ba5759ce9e9e7f3e811c0f3c1739a732cef9a78366f82/
  );

  /*
   * The installer is 226837 bytes, so V19 must not accept the
   * installer body from a caller or depend on selfmaint new_content.
   * It must deterministically obtain/reconstruct the fixed artifact
   * and verify its frozen SHA.
   */
  assert.doesNotMatch(source, /new_content/);
  assert.doesNotMatch(source, /callerContent/);
  assert.doesNotMatch(source, /destinationPath/);
  assert.doesNotMatch(source, /callerPath/);
  assert.doesNotMatch(source, /req\.body/);

  assert.match(source, /source_sha_mismatch/);
  assert.match(source, /candidate_sha_mismatch|installer_sha_mismatch/);

  assert.match(source, /lstatSync/);
  assert.match(source, /isSymbolicLink/);
  assert.match(source, /realpathSync/);

  assert.match(source, /--check/);
  assert.match(source, /renameSync/);
  assert.match(source, /backup/i);
  assert.match(source, /rollback/i);

  assert.match(source, /--preflight-only/);
  assert.match(source, /--apply/);

  assert.match(source, /production_owner_mutation:false/);
  assert.match(source, /database_mutation:false/);
});

test('RED8 stage transport embeds immutable installer bytes and has no runtime generator dependency', () => {
  const m = load();

  const source =
    m.buildRegistrationStageTransportSource();

  assert.match(
    source,
    /INSTALLER_B64/
  );

  assert.match(
    source,
    /f72d40820188da43746ba5759ce9e9e7f3e811c0f3c1739a732cef9a78366f82/
  );

  assert.doesNotMatch(
    source,
    /GENERATOR_SHA/
  );

  assert.doesNotMatch(
    source,
    /buildRegistrationInstallerSource/
  );

  assert.doesNotMatch(
    source,
    /bootstrap-host-actions-v18-agent-zdt-current-baseline-refresh\.js/
  );
});

test('RED9 stage transport uses immutable embedded installer artifact, not mutable generator', () => {

  const m = load();

  const source =
    m.buildRegistrationStageTransportSource();

  assert.match(
    source,
    /INSTALLER_B64/
  );

  assert.match(
    source,
    /f72d40820188da43746ba5759ce9e9e7f3e811c0f3c1739a732cef9a78366f82/
  );

  assert.doesNotMatch(
    source,
    /GENERATOR_SHA/
  );

  assert.doesNotMatch(
    source,
    /buildRegistrationInstallerSource/
  );

  assert.doesNotMatch(
    source,
    /5e04c7854796828846c5d88440ac3088c4cce9d200b4f939f1008b232820cbed/
  );

  assert.match(
    source,
    /source_sha_mismatch/
  );
});
