'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const p=require('../ops/agent3-universal-backup/four-owner-registration-patch-proposal.cjs');
const pins=require('../ops/agent3-universal-backup/production-registration-contract.json');
const A=p.ACTION,OP=p.OPERATION;
const base="  host_action_v2_installer_v1: { operation: 'host_action.host_action_v2_installer_v1', rollback: 'host-action-v2:host-action-v2-installer-v1:four-file-restore' }";
const exec="const HOST_ACTION_V2_SPECS = Object.freeze({\n  host_action_v2_installer_v1:{operation:'host_action.host_action_v2_installer_v1',kind:'host_action_v2_installer_v1'},\n});\napplyHostActionV2=async function(action){if(action==='host_action_v2_installer_v1')return applyHostActionV2InstallerV1();};\n";
const mcp="const HostActionV2=z.enum(['control_plane_current_owner_binding_refresh_v1']);\n";
function originalPolicy(){
 return JSON.stringify({operations:{'host_action.host_action_v2_installer_v1':{level:3}},
  typed_scopes:[{tool:'host_action_v2_apply',action:'host_action_v2_installer_v1',
   operation:'host_action.host_action_v2_installer_v1'}]},null,2)+'\n';
}
test('exact-anchor transforms make one additive registry entry each; no handler inserted',()=>{
 const b=p.baseTransform(base);
 const e=p.executorTransform(exec);
 const m=p.mcpTransform(mcp);
 const policy=JSON.parse(p.policyTransform(originalPolicy()));
 assert.match(b,new RegExp(A));
 assert.equal(b.split(A).length-1,1);
 assert.match(e,new RegExp("kind:'"+A+"'"));
 assert.ok(e.includes("if(action==='host_action_v2_installer_v1')"));
 assert.ok(!e.includes("if(action==='"+A+"')")); // no unverified dispatch
 assert.match(m,new RegExp(A));
 assert.deepEqual(policy.operations[OP],{level:4,risk:'critical'});
 const scopes=policy.typed_scopes.filter(s=>s.action===A);
 assert.equal(scopes.length,1);
 assert.deepEqual(scopes[0].principals,[{principal_id:'mohammad',roles:['mcp-operator']}]);
 assert.equal(policy.operations['host_action.host_action_v2_installer_v1'].level,3);
});
test('ambiguous or missing anchors and duplicate operation always abort',()=>{
 assert.throws(()=>p.baseTransform(base+'\n'+base),/anchor_missing_or_duplicate/);
 assert.throws(()=>p.executorTransform(exec.replace('applyHostActionV2InstallerV1','noFunction')),
  /executor_trusted_dispatch_anchor_missing/);
 assert.throws(()=>p.mcpTransform('not-an-enum'),/anchor_missing_or_duplicate/);
 const modified=JSON.parse(originalPolicy());
 modified.operations[OP]={level:3};
 assert.throws(()=>p.policyTransform(JSON.stringify(modified)),/duplicate_approval_operation/);
 assert.throws(()=>p.policyTransform('[]'),/policy_schema_mismatch/);
});
test('unreviewed bytes or fabricated owner files never bypass SHA preimage guard',()=>{
 const owners={base:Buffer.from(base),executor:Buffer.from(exec),
  policy:Buffer.from(originalPolicy()),mcp:Buffer.from(mcp)};
 assert.deepEqual(Object.keys(pins.preimage_sha256).sort(),p.KEYS.slice().sort());
 assert.throws(()=>p.propose(owners),/preimage_drift/);
 delete owners.policy;
 assert.throws(()=>p.propose(owners),/exact_four_owner_buffers_required/);
});
test('patch proposal forbids standalone production changes',()=>{
 const f=path.join(__dirname,'../ops/agent3-universal-backup/four-owner-registration-patch-proposal.cjs');
 const result=cp.spawnSync(process.execPath,[f,'--apply'],{encoding:'utf8',timeout:10000});
 assert.equal(result.status,78);
 assert.match(result.stderr,/no install or registry mutation/);
});
