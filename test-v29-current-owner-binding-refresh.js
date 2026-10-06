'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const b=require('./bootstrap-host-actions-v29-current-owner-binding-refresh.js');

test('v31 pins exact live owner SHAs and fixed action identity',()=>{
  assert.equal(b.ACTION,'control_plane_current_owner_binding_refresh_v1');
  assert.equal(b.OPERATION,'host_action.control_plane_current_owner_binding_refresh_v1');
  assert.equal(b.INSTALLER_ACTION,'control_plane_current_owner_binding_registration_installer_v31');
  assert.equal(b.VERSION,'v31-runtime-installer');
  assert.deepEqual(b.LIVE_PINS,{
    base:'e972d8955dca6b07f8d0a716482ddfa16d3c8efeafbda170bb75c14af3627e3b',
    executor:'206dce4e9df48c540d9a261ffa2c6aec4dceb302614eaf495f299ef41a8260e6',
    policy:'452a2768c2a43021072b07918273dbaa9ff3618957525daddbe54c83c7ab8c3e',
    mcp:'a673e0633da79dc75b7171c01e67f194b751755116dfcc1f723acbf1202208b4'
  });
});

test('policy registration remains Level-4 critical, second-confirmation and one-time',()=>{
  const p=b.buildPolicyRegistration();
  assert.equal(p.operation,b.OPERATION);
  assert.equal(p.level,4);
  assert.equal(p.risk,'critical');
  assert.equal(p.requires_second_confirmation,true);
  assert.equal(p.one_time_use,true);
  assert.equal(p.policy_version,'2026-10-06.2-current-owner-binding-refresh-v1');
});

test('registration transforms are additive and target action never enters Level-3',()=>{
  const base=b.buildBaseRegistration("const HOST_ACTION_V2_SPECS = Object.freeze({existing:{operation:'host_action.existing'}});\nconst HOST_ACTION_V2_LEVEL3 = new Set(['existing']);\n");
  assert.match(base,new RegExp(b.ACTION));
  const l3=base.match(/HOST_ACTION_V2_LEVEL3\s*=\s*new Set\((\[[\s\S]*?\])\);/);
  assert.ok(l3);
  assert.equal(l3[1].includes(b.ACTION),false);

  const executor=b.buildExecutorRegistration("const HOST_ACTION_V2_SPECS={existing:{operation:'host_action.existing',kind:'existing'}};\napplyHostActionV2=async function(action){return applyHostActionV2Original(action);};\n");
  assert.match(executor,new RegExp(b.ACTION));
  assert.match(executor,/--apply/);
  assert.match(executor,/systemd-run/);

  const mcp=b.buildMcpRegistration("const HostActionV2=z.enum(['existing']);\n");
  assert.equal((mcp.match(new RegExp(b.ACTION,'g'))||[]).length,1);

  const policy=JSON.parse(b.buildPolicySourceRegistration(JSON.stringify({operations:{existing:{level:3}},typed_scopes:[{action:'existing'}]})));
  assert.equal(policy.operations[b.OPERATION].level,4);
  assert.equal(policy.typed_scopes.filter(x=>x.action===b.ACTION).length,1);
});

test('installer embeds exactly five SHA-bound runtime artifacts',()=>{
  const names=Object.keys(b.MODULE_INSTALLS);
  assert.deepEqual(names,[
    'current-owner-binding-manifest-v1.js',
    'current-owner-binding-adapters-v1.js',
    'current-owner-binding-systemd-v1.js',
    'current-owner-binding-refresh-v1.js',
    'current-owner-binding-runtime-v1.js'
  ]);
  const modules=b.embeddedModules();
  for(const [name,spec] of Object.entries(b.MODULE_INSTALLS)){
    assert.match(spec.sha256,/^[a-f0-9]{64}$/);
    assert.ok(Buffer.isBuffer(modules[name]));
    assert.equal(require('node:crypto').createHash('sha256').update(modules[name]).digest('hex'),spec.sha256,name);
  }
  assert.equal(b.MODULE_INSTALLS['current-owner-binding-runtime-v1.js'].destination_path,b.ACTION_PATH);
  assert.equal(b.MODULE_INSTALLS['current-owner-binding-runtime-v1.js'].mode,0o750);
});

test('executor sandbox is narrow and excludes Agent API plus inactive MCP service',()=>{
  const props=b.EXECUTOR_SYSTEMD_PROPERTIES;
  for(const required of ['ProtectSystem=strict','ProtectHome=read-only','NoNewPrivileges=true','PrivateTmp=true','RestrictAddressFamilies=AF_UNIX'])assert.ok(props.includes(required),required);
  const rw=props.find(x=>x.startsWith('ReadWritePaths='));
  assert.ok(rw);
  assert.doesNotMatch(rw,/ssh-agent-api/);
  assert.doesNotMatch(rw,/ReadWritePaths=\/var\/backups(?:\s|$)/);
  assert.deepEqual(b.SERVICES,[
    'prhm-company-approval.service',
    'prhm-agent-selfmaint.service',
    'prhm-agent-selfmaint-exec.service',
    'prhm-agent-mcp-green.service'
  ]);
  assert.equal(b.SERVICES.includes('prhm-agent-mcp.service'),false);
});

test('selftest is no-mutation and validates embedded builders/modules',()=>{
  const out=b.selftest();
  assert.equal(out.ok,true);
  assert.equal(out.selftest_only,true);
  assert.equal(out.production_mutation,false);
  assert.equal(out.production_application_mutation,false);
  assert.equal(out.database_mutation,false);
  assert.equal(Object.keys(out.module_sha256).length,5);
});

test('contract is registration-only and exact-preimage rollback',()=>{
  const c=b.contract();
  assert.equal(c.installer_action,b.INSTALLER_ACTION);
  assert.equal(c.target_action,b.ACTION);
  assert.equal(c.module_count,5);
  assert.deepEqual(c.registration_targets,['base','executor','policy','mcp']);
  assert.equal(c.production_application_mutation,false);
  assert.equal(c.database_mutation,false);
  assert.equal(c.titan_cutover,false);
  assert.equal(c.rollback,'exact-preimage');
});

test('installer exposes no generic shell, arbitrary path/command or app/database mutation',()=>{
  const src=fs.readFileSync(require.resolve('./bootstrap-host-actions-v29-current-owner-binding-refresh.js'),'utf8');
  assert.doesNotMatch(src,/bash\s+-c|sh\s+-c|execSync\(|(?:child_process|cp)\.exec\(|shell\s*:\s*true/);
  assert.doesNotMatch(src,/callerPath|destinationPath|arbitrary_command|arbitrary_path|CONFIRM_DEPLOY_PRODUCTION/);
  assert.match(src,/production_application_mutation:false/);
  assert.match(src,/database_mutation:false/);
  assert.match(src,/prhm-agent-mcp-green\.service/);
  assert.doesNotMatch(src,/['"]prhm-agent-mcp\.service['"]/);
});

test('CLI accepts only selftest, preflight and apply fixed modes',()=>{
  const src=fs.readFileSync(require.resolve('./bootstrap-host-actions-v29-current-owner-binding-refresh.js'),'utf8');
  assert.match(src,/\['--selftest-only','--preflight-only','--apply'\]/);
  assert.doesNotMatch(src,/process\.argv\.slice\(2\).*path|process\.argv\.slice\(2\).*command/);
});
