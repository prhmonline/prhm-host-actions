'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const reg=require('./honartik-config-center-registration-candidate-v1.cjs');
const {CONTRACT}=require('./honartik-config-center-enrollment-action-v1.cjs');
const base='const HOST_ACTION_V2_SPECS = Object.freeze({\n  example: { operation: \'host_action.example\' },\n});';
const executor='const HOST_ACTION_V2_SPECS = Object.freeze({\n  example:{operation:\'host_action.example\',kind:\'example\'},\n});\napplyHostActionV2=async function(action){return action;}\nconst result=await applyHostActionV2(action);';
const mcp="const HostActionV2=z.enum(['control_plane_current_owner_binding_refresh_v1']);";
const policy=JSON.stringify({schema_version:'prhm.approval-policy.v1',version:reg.BASE_POLICY_VERSION,
 default_deny:true,operations:{'host_action.example':{level:3}},typed_scopes:[{action:'example'}]});
test('adds exactly one site-bound action in all registration planes',()=>{
 const b=reg.patchBase(base),e=reg.patchExecutor(executor),m=reg.patchMcp(mcp),p=JSON.parse(reg.patchPolicy(policy));
 for(const s of [b,e,m,JSON.stringify(p)])assert.ok(s.includes(reg.ACTION));
 assert.ok(b.includes(reg.OPERATION));assert.ok(e.includes(reg.OPERATION));
 assert.equal(p.operations[reg.OPERATION].level,4);
 assert.equal(p.operations[reg.OPERATION].one_time_use,true);
 assert.equal(p.operations[reg.OPERATION].requires_second_confirmation,true);
 assert.equal(p.operations[reg.OPERATION].expires_seconds,180);
 assert.equal(p.typed_scopes.at(-1).project,'control_plane');
 assert.equal(p.typed_scopes.at(-1).action,reg.ACTION);
 assert.equal(p.typed_scopes.at(-1).principals[0].principal_id,'mohammad');
 assert.equal(p.operations['host_action.example'].level,3);
 assert.equal(p.default_deny,true);
 assert.equal(CONTRACT.site,'honartik');assert.equal(CONTRACT.scope,'config:read');
});
test('code cannot accidentally enroll without separately attested runner and installer',()=>{
 const out=reg.patchExecutor(executor);
 assert.ok(out.includes('honartik_untrusted_dispatch'));
 assert.ok(out.includes('honartik_module_sha_mismatch'));
 assert.ok(out.includes('sha256'));
 assert.ok(out.includes('approvalConsumed:consumed===true'));
 assert.ok(out.includes('scriptGitSha'));
 assert.ok(out.includes('runAfterTrustedApproval(receipt)'));
 for(const forbidden of ['chmodSync(', 'writeFileSync(', 'spawnSync(', 'execSync(', 'curl '])assert.equal(out.includes(forbidden),false);
});
test('second insertion is refused at every plane',()=>{
 for(const [f,s] of [[reg.patchBase,base],[reg.patchExecutor,executor],[reg.patchMcp,mcp],[reg.patchPolicy,policy]])
   assert.throws(()=>f(f(s)),/duplicate|mismatch|invalid/);
});
test('no matching anchor or malformed JSON must fail closed',()=>{
 assert.throws(()=>reg.patchBase(''),/anchor_mismatch/);
 assert.throws(()=>reg.patchExecutor(''),/anchor_mismatch/);
 assert.throws(()=>reg.patchExecutor(base),/executor_dispatch_anchor_mismatch/);
 assert.throws(()=>reg.patchMcp(''),/anchor_mismatch/);
 assert.throws(()=>reg.patchPolicy('{}'),/structure_or_version/);
 assert.throws(()=>reg.patchPolicy('{'),/json_invalid/);
});
test('owner preimages require exact SHA for every current live component',()=>{
 const fake={};
 for(const {path} of Object.values(reg.LIVE))fake[path]=Buffer.from('x'.repeat(120));
 let n=0;
 assert.throws(()=>reg.buildCandidates(path=>(n++,fake[path])),/pinned_owner_sha_mismatch/);
 assert.equal(n,1,'must reject first drift before reading another owner');
 assert.throws(()=>reg.buildCandidates(),/trusted_readonly_owner_required/);
});
test('immutably pins all four independently attested Production SHA256 snapshots',()=>{
 const expected={
 base:'4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406',
 executor:'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0',
 policy:'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174',
 mcp:'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166'};
 for(const [kind,sha] of Object.entries(expected))assert.equal(reg.LIVE[kind].sha256,sha);
});
test('policy remains default deny and allows no secret-reading or arbitrary project scope',()=>{
 const p=JSON.parse(reg.patchPolicy(policy)),rule=p.operations[reg.OPERATION],scope=p.typed_scopes.at(-1);
 assert.equal(rule.risk,'critical');assert.equal(rule.requested_approver,'mohammad');
 assert.equal(scope.project,'control_plane');assert.equal(scope.environment,'production');
 assert.equal(scope.risk,'critical');assert.equal(scope.operation,reg.OPERATION);
 assert.equal(JSON.stringify(scope).includes('secrets:read'),false);
});

test('generated executor compiles and cannot bypass proof or module pins',()=>{
 const out=reg.patchExecutor(executor);
 assert.doesNotThrow(()=>new Function('return async function(){'+out+'}'));
 assert.ok(out.includes("receipt.approvalConsumed!==true"));
 assert.ok(out.includes("receipt.scriptGitSha"));
 assert.ok(out.includes("Object.freeze({action,operation:"));
 assert.ok(out.includes("fs.constants.O_NOFOLLOW"));
 assert.ok(out.includes("honartik_module_sha_mismatch"));
 assert.ok(out.includes("return runner.runAfterTrustedApproval(receipt)"));
 const missing=executor.replace('const result=await applyHostActionV2(action);','');
 assert.throws(()=>reg.patchExecutor(missing),/executor_trusted_dispatch_call_anchor_mismatch/);
});
