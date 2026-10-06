'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

const bootstrap=require('./bootstrap-host-actions-v30-drtarjomeh-email-suppression-release.js');

test('suppression bootstrap registers exactly one fixed Level-4 Host Action without widening Level-3',()=>{
  assert.equal(bootstrap.ACTION,'drtarjomeh_email_suppression_release_bootstrap_v1');
  assert.equal(bootstrap.OPERATION,'host_action.drtarjomeh_email_suppression_release_bootstrap_v1');

  const policy=JSON.stringify({
    schema_version:'prhm.approval-policy.v1',
    version:'test',
    operations:{'host_action.existing_v1':{level:3,risk:'high'}},
    typed_scopes:[{action:'existing_v1',operation:'host_action.existing_v1'}]
  },null,2);
  const policyOut=JSON.parse(bootstrap.buildPolicyCandidate(policy));
  const rule=policyOut.operations[bootstrap.OPERATION];
  assert.equal(rule.level,4);
  assert.equal(rule.risk,'critical');
  assert.equal(rule.requires_second_confirmation,true);
  assert.equal(rule.one_time_use,true);
  assert.equal(rule.requested_approver,'mohammad');
  assert.equal(policyOut.operations['host_action.existing_v1'].level,3);
  assert.equal(policyOut.typed_scopes.some(x=>x.action==='existing_v1'),true);
  assert.equal(policyOut.typed_scopes.filter(x=>x.action===bootstrap.ACTION).length,1);

  const base=[
    'const HOST_ACTION_V2_SPECS = Object.freeze({',
    "  existing_v1: { operation: 'host_action.existing_v1', rollback: 'existing:rollback' }",
    '});',
    'const HOST_ACTION_V2_LEVEL3 = new Set(["existing_v1"]);'
  ].join('\n');
  const baseOut=bootstrap.buildBaseCandidate(base);
  assert.match(baseOut,/drtarjomeh_email_suppression_release_bootstrap_v1/);
  const level3=baseOut.match(/HOST_ACTION_V2_LEVEL3 = new Set\((\[[^;]+\])\)/)?.[1]||'';
  assert.equal(level3.includes(bootstrap.ACTION),false);
  assert.match(baseOut,/existing_v1/);

  const mcp="const HostActionV2=z.enum(['existing_v1']);";
  const mcpOut=bootstrap.buildMcpCandidate(mcp);
  assert.equal((mcpOut.match(/drtarjomeh_email_suppression_release_bootstrap_v1/g)||[]).length,1);
  assert.match(mcpOut,/existing_v1/);

  const helperSha='f'.repeat(64);
  const exec=[
    "const HOST_ACTION_V2_SPECS = Object.freeze({ existing_v1:{operation:'host_action.existing_v1',kind:'existing_v1'} });",
    'const applyHostActionV2Original=applyHostActionV2;',
    "applyHostActionV2=async function(action){if(action==='existing_v1')return applyExistingV1();return applyHostActionV2Original(action);};"
  ].join('\n');
  const execOut=bootstrap.buildExecCandidate(exec,helperSha);
  assert.match(execOut,/drtarjomeh_email_suppression_release_bootstrap_v1/);
  assert.match(execOut,/ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff/);
  assert.match(execOut,/ProtectSystem=strict/);
  assert.match(execOut,/ProtectHome=read-only/);
  assert.match(execOut,/NoNewPrivileges=true/);
  assert.match(execOut,/ReadWritePaths=\/home\/agent\/ssh-agent-api \/home\/agent\/ssh-mcp-server \/opt\/prhm-company-control-plane/);
  assert.doesNotMatch(execOut,/bash -lc|sh -c|req\.body\.command|eval\(/);
});

test('registration builders fail closed on duplicate action',()=>{
  const policy=JSON.stringify({schema_version:'prhm.approval-policy.v1',version:'test',operations:{[bootstrap.OPERATION]:{level:4}},typed_scopes:[]});
  assert.throws(()=>bootstrap.buildPolicyCandidate(policy),/already_present/);
  assert.throws(()=>bootstrap.buildBaseCandidate("const HOST_ACTION_V2_SPECS = Object.freeze({ drtarjomeh_email_suppression_release_bootstrap_v1:{} });\nconst HOST_ACTION_V2_LEVEL3 = new Set([]);"),/already_present/);
  assert.throws(()=>bootstrap.buildMcpCandidate("const HostActionV2=z.enum(['drtarjomeh_email_suppression_release_bootstrap_v1']);"),/already_present/);
});
