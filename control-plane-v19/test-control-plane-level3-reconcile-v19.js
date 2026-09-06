'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = __dirname;
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')
);

function sha256(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
}

if (
  manifest.schema_version !==
  'prhm.control-plane-reconciliation.v1'
) {
  throw new Error('manifest_schema_invalid');
}

for (const record of manifest.files) {
  const file = path.join(root, record.source);

  if (!fs.statSync(file).isFile()) {
    throw new Error(`source_not_regular:${record.source}`);
  }

  const actual = sha256(file);

  if (actual !== record.sha256) {
    throw new Error(
      `sha_mismatch:${record.source}:${actual}:${record.sha256}`
    );
  }
}

const policy = JSON.parse(
  fs.readFileSync(
    path.join(root, 'runtime/approval-policy.json'),
    'utf8'
  )
);

const mcp = fs.readFileSync(
  path.join(root, 'runtime/hostActionsV2.js'),
  'utf8'
);

const base = fs.readFileSync(
  path.join(root, 'runtime/agent-selfmaint-server.js'),
  'utf8'
);

if (!mcp.includes('host_action_v2_apply_level3')) {
  throw new Error('level3_apply_tool_missing');
}

if (!mcp.includes('CONFIRM_LEVEL_3_PRODUCTION')) {
  throw new Error('level3_confirmation_missing');
}

if (!base.includes('HOST_ACTION_V2_LEVEL3')) {
  throw new Error('level3_classifier_missing');
}

const requiredLevel3 = [
  'host_action.control_plane_typed_bootstrap_transport_v1',
  'host_action.selfmaint_exec_route_refresh_v1',
  'host_action.agent_zdt_existing_topology_rolling_refresh_v1'
];

for (const operation of requiredLevel3) {
  const rule = policy.operations?.[operation];

  if (!rule || rule.level !== 3) {
    throw new Error(`policy_level3_missing:${operation}`);
  }

  const scopes = Array.isArray(policy.typed_scopes)
    ? policy.typed_scopes.filter(
        x =>
          x &&
          x.operation === operation &&
          x.project === 'control_plane' &&
          x.environment === 'production' &&
          x.tool === 'host_action_v2_apply'
      )
    : [];

  if (scopes.length !== 1) {
    throw new Error(
      `policy_scope_count_invalid:${operation}:${scopes.length}`
    );
  }

  if (scopes[0].risk !== 'high') {
    throw new Error(`policy_scope_risk_invalid:${operation}`);
  }
}

console.log('CONTROL_PLANE_LEVEL3_RECONCILIATION_V19=PASS');
