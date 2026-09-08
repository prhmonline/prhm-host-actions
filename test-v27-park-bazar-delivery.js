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
  assert.equal(m.MCP_SHA,'001619fc2485202162da5c20fe1348cc430d4d8f119b41d38d0be4dbf8bdb8b4');
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
    level:3,risk:'high',requires_second_confirmation:false,one_time_use:true,requested_approver:'mohammad',expires_seconds:180,policy_version:m.POLICY_VERSION,rollback_reference:'host-action-v2:park-bazar-delivery-patch-v1:file-rollback'
  });
  const scopes=p.typed_scopes.filter(s=>s.action===m.ACTION);
  assert.equal(scopes.length,1);
  assert.deepEqual(scopes[0],{
    tool:'host_action_v2_apply',project:'control_plane',environment:'production',action:m.ACTION,risk:'high',operation:m.OPERATION,
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
  assert.ok(helper.includes("const RELEASE_COMMIT='451501c30fb4fcb71ce4220cacb0bee169796399'"));
  assert.ok(helper.includes("const DEST='/home/cfpark/domains/dashboard.park.prhm.ir/public_html/app'"));
  assert.ok(helper.includes("const PREIMAGE=Object.freeze"));
  assert.ok(helper.includes("const RELEASE=Object.freeze"));
  assert.ok(helper.includes("database_mutation:false"));
  assert.ok(helper.includes("rollback_performed"));
  assert.equal(/process\.argv\[[^\]]+\].*path|process\.env\.(TARGET|PATH_TO_WRITE)/.test(helper),false);
});


test('helper deploys exact Git-published release bytes with no runtime Git mutation',()=>{
  const m=load();
  const helper=m.buildHelperSource();
  assert.ok(helper.includes("const RELEASE_COMMIT='451501c30fb4fcb71ce4220cacb0bee169796399'"));
  for(const digest of [
    'f065f436e934c4b5f13d35012bc5e94099cc2879fd8f2f3a8128e70ebe48d755',
    '6dbc336c45ab3157b39050c78077a254f3229bba89983e06380cc2acc29d587e',
    '0f4aaee23daba71468f3780fd85e0d63de5ba87854f527141cacdc03d2f730ce'
  ]) assert.ok(helper.includes(digest));
  assert.ok(helper.includes('destination_sha_parity:true'));
  assert.ok(helper.includes('php_lint_failed'));
  assert.ok(helper.includes('runtime_probe_failed'));
  assert.equal(helper.includes("'/usr/bin/git'"),false);
  assert.equal(helper.includes('worktree'),false);
  assert.equal(helper.includes('push --force'),false);
});


test('base candidate registers Park in fixed specs and Level-3 set',()=>{
  const m=load();
  assert.equal(m.BASE_SHA,'a23b4fec52123f8ad484f31576281c2f1933f24a3c811cd98c28e764a292e315');
  const src=[
    "const HOST_ACTION_V2_SPECS = Object.freeze({",
    "  control_plane_root_scripts_stage_transport_v1: { operation: 'host_action.control_plane_root_scripts_stage_transport_v1', rollback: 'host-action-v2:control-plane-root-scripts-stage-transport-v1:registration-only' },",
    "  imotion_credential_bind_v1: { operation: 'host_action.imotion_credential_bind_v1', rollback: 'host-action-v2:imotion-credential-bind-v1:remote-controller-backup-restore' }",
    "});",
    "const HOST_ACTION_V2_LEVEL3 = new Set([\"control_plane_root_scripts_stage_transport_v1\"]);"
  ].join('\n');
  const out=m.buildBaseCandidate(src);
  assert.ok(out.includes("park_bazar_delivery_patch_v1: { operation: 'host_action.park_bazar_delivery_patch_v1', rollback: 'host-action-v2:park-bazar-delivery-patch-v1:file-rollback' }"));
  const level3=out.match(/HOST_ACTION_V2_LEVEL3 = new Set\((\[[^;]+\])\)/)?.[1]||'';
  assert.equal(level3.includes('park_bazar_delivery_patch_v1'),true);
  assert.throws(()=>m.buildBaseCandidate(out),/already_present/);
});

test('executor runs Park helper only in fixed transient sandbox with bounded writable paths',()=>{
  const m=load();
  const src=[
    "const ACTION_SPECS={control_plane_root_scripts_stage_transport_v1:{operation:'host_action.control_plane_root_scripts_stage_transport_v1',kind:'control_plane_root_scripts_stage_transport_v1'},};",
    "applyHostActionV2=async function(action){if(action==='control_plane_root_scripts_stage_transport_v1')return applyControlPlaneRootScriptsStageTransportV1();return applyHostActionV2Original(action);};"
  ].join('\n');
  const out=m.buildExecCandidate(src,'f'.repeat(64));
  assert.ok(out.includes("'/usr/bin/systemd-run'"));
  assert.ok(out.includes("'--property=ProtectSystem=strict'"));
  assert.ok(out.includes("'--property=ProtectHome=read-only'"));
  assert.ok(out.includes("'--property=ReadWritePaths=/home/cfpark/domains/dashboard.park.prhm.ir/public_html/app /var/backups/park-bazar-delivery-v27 /var/lib/prhm-agent-selfmaint-exec/park-bazar-delivery-patch-v1'"));
  assert.ok(out.includes("'--property=NoNewPrivileges=true'"));
  assert.ok(out.includes("'--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6'"));
  assert.ok(out.includes("PARK_BAZAR_DELIVERY_RESULT"));
});

test('installer plan is fixed, SHA-bound, syntax-checkable, and rollback-capable',()=>{
  const m=load();
  assert.equal(typeof m.buildInstallPlan,'function');
  assert.equal(typeof m.preflight,'function');
  assert.equal(typeof m.install,'function');
  assert.deepEqual(m.PATHS,{
    base:'/opt/prhm-agent-selfmaint/server.js',
    exec:'/opt/prhm-agent-selfmaint-exec/server.js',
    policy:'/opt/prhm-company-control-plane/config/approval-policy.json',
    mcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
    helper:'/opt/prhm-agent-selfmaint-exec/actions/park-bazar-delivery-patch-v1.js'
  });
  const source=m.install.toString();
  assert.ok(source.includes('buildInstallPlan'));
  assert.ok(source.includes('backup'));
  assert.ok(source.includes('rollback'));
  assert.ok(source.includes('restart'));
  assert.equal(source.includes('process.argv['),false);
});
