'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const IMPL=path.join(__dirname,'bootstrap-host-actions-v27-park-bazar-delivery.js');
function load(){delete require.cache[require.resolve(IMPL)];return require(IMPL)}

test('exports fixed Park Bazar delivery Host Action contract',()=>{
  const m=load();
  assert.equal(m.ACTION,'park_bazar_delivery_patch_v1');
  assert.equal(m.OPERATION,'host_action.park_bazar_delivery_patch_v1');
  assert.equal(m.POLICY_SHA,'494e95e3173695407c84b6d082f09e57d971cb193518be813a53131cdb389a70');
  assert.equal(m.EXEC_SHA,'451c5a4762a4c7a04d64d526a79cf6e86b0cf7c978c559cf303d874e0f08fc48');
  assert.equal(m.MCP_SHA,'7c566cdb1dbc1dcb4ac9d6a1b0670acc98cbc366a663771937e365d700671510');
  assert.deepEqual(m.FIXED_FILES,[
    ['app/web/index.php','a66dfb4b4afa2affe8322e302718e0e9010edfd244b30153f88c44a923fa1a18'],
    ['app/yii','63dc92a76e44e9b71ccb28d8a57567d15206229b0fe6e39ebfa257b793bfc1c3'],
    ['app/modules/api/controllers/PublicController.php','7a1ca66ea128ef133b911bc0032a4ad39f8a5a8f2fb900fc60e304d1466bb0c1']
  ]);
});

test('policy candidate adds only one critical typed Park scope',()=>{
  const m=load();
  const base={schema_version:'prhm.approval-policy.v1',version:'2026-09-05.3-autonomous-operator-v1',operations:{},typed_scopes:[]};
  const out=m.buildPolicyCandidate(JSON.stringify(base,null,2));
  const p=JSON.parse(out);
  assert.equal(p.version,m.POLICY_VERSION);
  assert.deepEqual(p.operations[m.OPERATION],{
    level:4,risk:'critical',requires_second_confirmation:true,one_time_use:true,requested_approver:'mohammad',expires_seconds:180,policy_version:m.POLICY_VERSION,rollback_reference:'host-action-v2:park-bazar-delivery-patch-v1:file-and-git-rollback'
  });
  const scopes=p.typed_scopes.filter(s=>s.action===m.ACTION);
  assert.equal(scopes.length,1);
  assert.deepEqual(scopes[0],{
    tool:'host_action_v2_apply',project:'control_plane',environment:'production',action:m.ACTION,risk:'critical',operation:m.OPERATION,
    principals:[{principal_id:'mohammad',roles:['mcp-operator']}]
  });
  assert.throws(()=>m.buildPolicyCandidate(out),/already_present/);
});

test('MCP candidate adds only the fixed action to HostActionV2 enum',()=>{
  const m=load();
  const src="const HostActionV2=z.enum(['imotion_credential_bind_v1','control_plane_root_scripts_stage_transport_v1']);\n";
  const out=m.buildMcpCandidate(src);
  assert.equal((out.match(/park_bazar_delivery_patch_v1/g)||[]).length,1);
  assert.ok(out.includes("'control_plane_root_scripts_stage_transport_v1','park_bazar_delivery_patch_v1'"));
  assert.throws(()=>m.buildMcpCandidate(out),/already_present/);
});

test('executor candidate binds the fixed helper and does not expose arbitrary input',()=>{
  const m=load();
  const src=[
    "const ACTION_SPECS={control_plane_root_scripts_stage_transport_v1:{operation:'host_action.control_plane_root_scripts_stage_transport_v1',kind:'control_plane_root_scripts_stage_transport_v1'},};",
    "applyHostActionV2=async function(action){if(action==='control_plane_root_scripts_stage_transport_v1')return applyControlPlaneRootScriptsStageTransportV1();return applyHostActionV2Original(action);};"
  ].join('\n');
  const out=m.buildExecCandidate(src,'f'.repeat(64));
  assert.equal((out.match(/park_bazar_delivery_patch_v1/g)||[]).length>=3,true);
  assert.ok(out.includes("helperSha!=='"+'f'.repeat(64)+"'"));
  for(const forbidden of ['req.body.command','arbitrary_path','child_process.exec(','eval(']) assert.equal(out.includes(forbidden),false);
  assert.throws(()=>m.buildExecCandidate(out,'f'.repeat(64)),/already_present/);
});

test('helper contract is fixed to Park tenant, exact preimages, and no database mutation',()=>{
  const m=load();
  const helper=m.buildHelperSource();
  assert.ok(helper.includes("const ACTION='park_bazar_delivery_patch_v1'"));
  assert.ok(helper.includes("const SOURCE='/home/cfpark/domains/dashboard.cfpark.ir/public_html'"));
  assert.ok(helper.includes("const DEST='/home/cfpark/domains/dashboard.park.prhm.ir/public_html'"));
  assert.ok(helper.includes("const PLACE_ID=1"));
  assert.ok(helper.includes("const EVENT_IDS=Object.freeze([190,193,244])"));
  assert.ok(helper.includes("database_mutation:false"));
  assert.ok(helper.includes("rollback_performed"));
  assert.equal(/process\.argv\[[^\]]+\].*path|process\.env\.(TARGET|PATH_TO_WRITE)/.test(helper),false);
});
