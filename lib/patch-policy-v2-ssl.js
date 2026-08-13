#!/usr/bin/env node
'use strict';

const fs = require('fs');

const ACTION = 'repair_node1_ssl_deploy_v1';
const OPERATION = 'host_action.repair_node1_ssl_deploy_v1';

function fail(message) { throw new Error(message); }
function transform(text) {
  let p;
  try { p = JSON.parse(text); } catch (e) { fail('policy_json_invalid:' + e.message); }
  if (!p || p.schema_version !== 'prhm.approval-policy.v1') fail('unexpected_policy_schema');
  if (!p.operations || typeof p.operations !== 'object' || Array.isArray(p.operations)) fail('policy_operations_invalid');
  if (!Array.isArray(p.typed_scopes)) fail('policy_typed_scopes_invalid');

  const existingOp = p.operations[OPERATION];
  if (existingOp !== undefined && JSON.stringify(existingOp) !== JSON.stringify({ level: 4 })) {
    fail('conflicting_ssl_operation');
  }
  p.version = '2026-08-13.3-host-actions-v2-ssl';
  p.operations[OPERATION] = { level: 4 };

  const matches = p.typed_scopes.filter(x => x &&
    x.tool === 'host_action_v2_apply' &&
    x.project === 'control_plane' &&
    x.environment === 'production' &&
    x.action === ACTION &&
    x.risk === 'critical' &&
    x.operation === OPERATION
  );
  if (matches.length > 1) fail('duplicate_ssl_typed_scope');
  if (matches.length === 1) {
    const principals = matches[0].principals;
    if (!Array.isArray(principals) || principals.length !== 1 ||
        principals[0]?.principal_id !== 'mohammad' ||
        !Array.isArray(principals[0]?.roles) || principals[0].roles.length !== 1 || principals[0].roles[0] !== 'mcp-operator') {
      fail('conflicting_ssl_typed_scope_principal');
    }
  } else {
    p.typed_scopes.push({
      tool: 'host_action_v2_apply',
      project: 'control_plane',
      environment: 'production',
      action: ACTION,
      risk: 'critical',
      operation: OPERATION,
      principals: [{ principal_id: 'mohammad', roles: ['mcp-operator'] }]
    });
  }

  const allActionScopes = p.typed_scopes.filter(x => x && x.action === ACTION);
  if (allActionScopes.length !== 1) fail('ssl_action_scope_cardinality_invalid:' + allActionScopes.length);
  return JSON.stringify(p, null, 2) + '\n';
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file || process.argv.length !== 3) fail('usage: patch-policy.js FILE');
  process.stdout.write(transform(fs.readFileSync(file, 'utf8')));
}
module.exports = { transform };
