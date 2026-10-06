'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

const helper=require('./drtarjomeh-email-suppression-v30-helper-builder.js');

test('cutover payload has ten exact files and four additive shared control-plane surfaces',()=>{
  assert.deepEqual(helper.EXACT_DESTINATIONS,[
    '/home/agent/ssh-agent-api/leadopsCampaignEmailCore.js',
    '/home/agent/ssh-agent-api/leadopsCampaignEmailRoutes.js',
    '/home/agent/ssh-agent-api/leadopsCampaignEmailService.js',
    '/home/agent/ssh-agent-api/leadopsCampaignEmailStore.js',
    '/home/agent/ssh-agent-api/leadopsRoutes.js',
    '/home/agent/ssh-agent-api/leadopsRoutesLegacy.js',
    '/home/agent/ssh-mcp-server/src/core/registry.js',
    '/home/agent/ssh-mcp-server/src/plugins/leadops.js',
    '/opt/prhm-company-control-plane/ops/leadops-email-suppression/leadops-email-suppression-foundation-v1.js',
    '/opt/prhm-company-control-plane/ops/company-os-email-suppression/company-os-email-suppression-reporting-v1.js'
  ]);
  assert.deepEqual(helper.SEMANTIC_DESTINATIONS,[
    '/opt/prhm-agent-selfmaint/server.js',
    '/opt/prhm-agent-selfmaint-exec/server.js',
    '/opt/prhm-company-control-plane/config/approval-policy.json',
    '/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js'
  ]);
});

test('semantic policy merge preserves unrelated current rules and adds only suppression foundation/reporting',()=>{
  const input=JSON.stringify({
    schema_version:'prhm.approval-policy.v1',
    version:'current',
    operations:{
      'host_action.drtarjomeh_email_suppression_release_bootstrap_v1':{level:4,risk:'critical'},
      'host_action.future_action_v99':{level:4,risk:'critical'}
    },
    typed_scopes:[
      {tool:'host_action_v2_apply',project:'control_plane',environment:'production',action:'future_action_v99',risk:'critical',operation:'host_action.future_action_v99',principals:[{principal_id:'mohammad',roles:['mcp-operator']}]}
    ]
  },null,2);
  const out=JSON.parse(helper.mergePolicy(input));
  assert.equal(out.operations['host_action.future_action_v99'].level,4);
  assert.equal(out.operations['host_action.drtarjomeh_email_suppression_release_bootstrap_v1'].level,4);
  assert.equal(out.operations['host_action.leadops_email_suppression_foundation_v1'].level,3);
  assert.equal(out.operations['host_action.company_os_email_suppression_reporting_v1'].level,3);
  assert.equal(out.typed_scopes.some(x=>x.action==='future_action_v99'),true);
  assert.equal(out.typed_scopes.filter(x=>x.action==='leadops_email_suppression_foundation_v1').length,1);
  assert.equal(out.typed_scopes.filter(x=>x.action==='company_os_email_suppression_reporting_v1').length,1);
});

test('semantic MCP/base/exec merges preserve bootstrap and future actions',()=>{
  const mcp="const HostActionV2=z.enum(['future_action_v99','drtarjomeh_email_suppression_release_bootstrap_v1']);";
  const mcpOut=helper.mergeMcp(mcp);
  for(const x of ['future_action_v99','drtarjomeh_email_suppression_release_bootstrap_v1','leadops_email_suppression_foundation_v1','company_os_email_suppression_reporting_v1'])assert.match(mcpOut,new RegExp(x));

  const base=[
    'const HOST_ACTION_V2_SPECS = Object.freeze({',
    "  future_action_v99:{operation:'host_action.future_action_v99',rollback:'future:rollback'},",
    "  drtarjomeh_email_suppression_release_bootstrap_v1:{operation:'host_action.drtarjomeh_email_suppression_release_bootstrap_v1',rollback:'bootstrap:rollback'}",
    '});',
    'const HOST_ACTION_V2_LEVEL3 = new Set(["existing_l3"]);'
  ].join('\n');
  const baseOut=helper.mergeBase(base);
  assert.match(baseOut,/future_action_v99/);
  assert.match(baseOut,/drtarjomeh_email_suppression_release_bootstrap_v1/);
  assert.match(baseOut,/leadops_email_suppression_foundation_v1/);
  assert.match(baseOut,/company_os_email_suppression_reporting_v1/);
  const level3=baseOut.match(/HOST_ACTION_V2_LEVEL3 = new Set\((\[[^;]+\])\)/)?.[1]||'';
  assert.match(level3,/leadops_email_suppression_foundation_v1/);
  assert.match(level3,/company_os_email_suppression_reporting_v1/);

  const exec=[
    'const HOST_ACTION_V2_SPECS = Object.freeze({',
    "  future_action_v99:{operation:'host_action.future_action_v99',kind:'future_action_v99'},",
    "  drtarjomeh_email_suppression_release_bootstrap_v1:{operation:'host_action.drtarjomeh_email_suppression_release_bootstrap_v1',kind:'drtarjomeh_email_suppression_release_bootstrap_v1'}",
    '});',
    'const applyHostActionV2Original=applyHostActionV2;',
    "applyHostActionV2=async function(action){if(action==='future_action_v99')return applyFuture();if(action==='drtarjomeh_email_suppression_release_bootstrap_v1')return applyBootstrap();return applyHostActionV2Original(action);};"
  ].join('\n');
  const execOut=helper.mergeExec(exec);
  assert.match(execOut,/future_action_v99/);
  assert.match(execOut,/drtarjomeh_email_suppression_release_bootstrap_v1/);
  assert.match(execOut,/leadops_email_suppression_foundation_v1/);
  assert.match(execOut,/company_os_email_suppression_reporting_v1/);
  assert.doesNotMatch(execOut,/bash -lc|sh -c|req\.body\.command|eval\(/);
});
