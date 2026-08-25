import assert from 'node:assert/strict';
import { patchBaseSource, patchPolicyObject, patchRegistrySource, FIXED } from './root-scripts-fixed-stage-action-specific-request-bootstrap-v1.mjs';

const base=`const HOST_ACTION_V2_SPECS = Object.freeze({
  agent_zero_downtime_bootstrap_v1: { operation: 'host_action.agent_zero_downtime_bootstrap_v1', rollback: 'zdt' },
  imotion_credential_bind_v1: { operation: 'host_action.imotion_credential_bind_v1', rollback: 'host-action-v2:imotion-credential-bind-v1:remote-controller-backup-restore' }
});
`;
const patchedBase=patchBaseSource(base);
assert.match(patchedBase,/root_scripts_fixed_stage_v1: \{ operation: 'host_action\.root_scripts_fixed_stage_v1', rollback: 'root-stage-v1:invocation-bound-two-files' \}/);
assert.equal((patchedBase.match(/(^|\n)\s*root_scripts_fixed_stage_v1:/g)||[]).length,1);

const policy={schema_version:'prhm.approval-policy.v1',operations:{'host_action.agent_zero_downtime_bootstrap_v1':{level:4}},typed_scopes:[{tool:'host_action_v2_apply',project:'control_plane',environment:'production',action:'agent_zero_downtime_bootstrap_v1',risk:'critical',operation:'host_action.agent_zero_downtime_bootstrap_v1',principals:[{principal_id:'mohammad',roles:['mcp-operator']}]}]};
const patchedPolicy=patchPolicyObject(policy);
assert.deepEqual(patchedPolicy.operations[FIXED.operation],{level:4});
const scope=patchedPolicy.typed_scopes.find(x=>x.action===FIXED.action);
assert.deepEqual(scope,{tool:'host_action_v2_apply',project:'control_plane',environment:'production',action:FIXED.action,risk:'critical',operation:FIXED.operation,principals:[{principal_id:'mohammad',roles:['mcp-operator']}]});

const registry=`registerHostActionsPlugin(mcp, context);
{
    let zdtStatusHandler=null,zdtApplyHandler=null,zdtApplyConfig=null;
    const zdtMcp=new Proxy(mcp,{get(t,p){if(p==='registerTool'||p==='tool')return(n,...a)=>{const i=a.length-1,fn=a[i];if(n==='host_action_v2_status')zdtStatusHandler=fn;if(n==='host_action_v2_apply'){zdtApplyHandler=fn;zdtApplyConfig=a[0]}if(n==='host_action_v2_request'&&p==='registerTool'&&a[0]?.inputSchema){a[0]={...a[0],inputSchema:{...a[0].inputSchema,action:z.string().regex(/^[a-z][a-z0-9_]{0,127}$/)}}}return t[p](n,...a)};const v=t[p];return typeof v==='function'?v.bind(t):v}});
    registerHostActionsV2Plugin(zdtMcp, context);
    if(typeof zdtStatusHandler!=='function'||typeof zdtApplyHandler!=='function'||!zdtApplyConfig)throw new Error('agent_zdt_action_specific_handlers_missing');
}
registerHonartikIticketPreflightPlugin(mcp, context);`;
const patchedRegistry=patchRegistrySource(registry);
assert.match(patchedRegistry,/root_scripts_fixed_stage_request_v1/);
assert.match(patchedRegistry,/rootScriptsRequestHandler\(\{action:'root_scripts_fixed_stage_v1'\}\)/);
assert.match(patchedRegistry,/inputSchema:\{\}/);
assert.doesNotMatch(patchedRegistry,/root_scripts_fixed_stage_request_v1[^]*?path:/);
assert.doesNotMatch(patchedRegistry,/root_scripts_fixed_stage_request_v1[^]*?command:/);

assert.throws(()=>patchBaseSource('const HOST_ACTION_V2_SPECS = Object.freeze({});'),/base_anchor_missing/);
assert.throws(()=>patchRegistrySource('registerHostActionsV2Plugin(x);'),/registry_anchor_missing/);
assert.throws(()=>patchPolicyObject({operations:{},typed_scopes:[]}),/policy_schema_invalid|policy_reference_scope_missing/);
console.log('ROOT_SCRIPTS_ACTION_SPECIFIC_REQUEST_TDD=PASS');
