'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const b=require('./bootstrap-host-actions-v29-current-owner-binding-refresh.js');

test('v30 pins exact 2026-10-06 live Base Executor Policy MCP SHAs and fixed action identity',()=>{
  assert.equal(b.ACTION,'control_plane_current_owner_binding_refresh_v1');
  assert.equal(b.OPERATION,'host_action.control_plane_current_owner_binding_refresh_v1');
  assert.deepEqual(b.LIVE_PINS,{
    base:'e972d8955dca6b07f8d0a716482ddfa16d3c8efeafbda170bb75c14af3627e3b',
    executor:'206dce4e9df48c540d9a261ffa2c6aec4dceb302614eaf495f299ef41a8260e6',
    policy:'452a2768c2a43021072b07918273dbaa9ff3618957525daddbe54c83c7ab8c3e',
    mcp:'a673e0633da79dc75b7171c01e67f194b751755116dfcc1f723acbf1202208b4'
  });
  assert.equal(JSON.stringify(b.LIVE_PINS).includes('TODO'),false);
});

test('policy registration is Level-4 critical, second-confirmation, one-time and action is not Level-3',()=>{
  const p=b.buildPolicyRegistration();
  assert.equal(p.operation,b.OPERATION);
  assert.equal(p.risk,'critical');
  assert.equal(p.requires_second_confirmation,true);
  assert.equal(p.one_time_use,true);
  const base=b.buildBaseRegistration("const HOST_ACTION_V2_SPECS = Object.freeze({\n  existing:{operation:'host_action.existing',rollback:'r'}\n});\nconst HOST_ACTION_V2_LEVEL3 = new Set([\"existing\"]);\n");
  assert.match(base,new RegExp(b.ACTION));
  const level3=base.match(/HOST_ACTION_V2_LEVEL3 = new Set\((\[[^;]+\])\)/s);
  assert.ok(level3);
  assert.equal(level3[1].includes(b.ACTION),false);
});

test('policy source transform adds exactly one Level-4 operation and one typed scope',()=>{
  const source=JSON.stringify({schema_version:'prhm.approval-policy.v1',operations:{existing:{level:3}},typed_scopes:[{action:'existing'}]});
  const out=JSON.parse(b.buildPolicySourceRegistration(source));
  const op=out.operations[b.OPERATION];
  assert.equal(op.level,4);
  assert.equal(op.risk,'critical');
  assert.equal(op.requires_second_confirmation,true);
  assert.equal(op.one_time_use,true);
  const scopes=out.typed_scopes.filter(x=>x.action===b.ACTION);
  assert.equal(scopes.length,1);
  assert.equal(scopes[0].tool,'host_action_v2_apply');
  assert.equal(scopes[0].project,'control_plane');
  assert.equal(scopes[0].operation,b.OPERATION);
});

test('MCP enum adds action exactly once and executor dispatch accepts no caller arguments',()=>{
  const m=b.buildMcpRegistration("const HostActionV2=z.enum(['existing']);\n");
  assert.equal((m.match(new RegExp(b.ACTION,'g'))||[]).length,1);
  const e=b.buildExecutorRegistration("const HOST_ACTION_V2_SPECS={existing:{operation:'host_action.existing',kind:'existing'}};\napplyHostActionV2=async function(action){return applyHostActionV2Original(action);};\n");
  assert.match(e,new RegExp(b.ACTION));
  assert.match(e,/--apply/);
  assert.doesNotMatch(e,/caller|arbitrary_command|process\.argv\.slice\(2\).*content/);
});

test('executor sandbox keeps strict hardening and only exact writable roots',()=>{
  const props=b.EXECUTOR_SYSTEMD_PROPERTIES;
  for(const required of ['ProtectSystem=strict','ProtectHome=read-only','NoNewPrivileges=true','PrivateTmp=true'])assert.ok(props.includes(required),required);
  assert.ok(props.includes('ReadWritePaths=/home/agent/ssh-agent-api /home/agent/ssh-mcp-server/src/core /opt/prhm-agent-selfmaint-exec/actions /var/lib/prhm-agent-selfmaint-exec/current-owner-binding-v1 /var/backups/prhm-current-owner-binding-refresh-v1 /etc/systemd/system/prhm-agent-selfmaint-exec.service.d'));
  assert.equal(props.some(x=>x==='ReadWritePaths=/var/backups'||x.includes(' /var/backups ')),false);
});

test('module install manifest is fixed, SHA-bound and contains exactly four implementation modules',()=>{
  const names=Object.keys(b.MODULE_INSTALLS);
  assert.deepEqual(names,['current-owner-binding-manifest-v1.js','current-owner-binding-adapters-v1.js','current-owner-binding-systemd-v1.js','current-owner-binding-refresh-v1.js']);
  for(const [name,spec] of Object.entries(b.MODULE_INSTALLS)){
    assert.match(spec.sha256,/^[a-f0-9]{64}$/);
    assert.equal(spec.source_path,name);
    assert.equal(spec.destination_path,'/opt/prhm-agent-selfmaint-exec/actions/current-owner-binding-v1/'+name);
  }
});

test('module source bytes match every pinned SHA',()=>{
  const verified=b.verifyModuleSources(__dirname);
  for(const [name,spec] of Object.entries(b.MODULE_INSTALLS))assert.equal(verified[name].sha256,spec.sha256,name);
});

test('registration transforms are additive, reject missing/nonunique anchors and avoid generic shell',()=>{
  assert.throws(()=>b.buildBaseRegistration('x'),/anchor/);
  assert.throws(()=>b.buildExecutorRegistration('x'),/anchor/);
  assert.throws(()=>b.buildMcpRegistration('x'),/anchor/);
  const src=fs.readFileSync(require.resolve('./bootstrap-host-actions-v29-current-owner-binding-refresh.js'),'utf8');
  assert.doesNotMatch(src,/bash -c|sh -c|(?:child_process|cp)\.exec\(|execSync\(|spawn\([^)]*shell\s*:\s*true/);
  assert.doesNotMatch(src,/titan_front_handoff_deploy_v2|CONFIRM_DEPLOY_PRODUCTION/);
});

test('bootstrap contract reports registration-only application, four-file rollback, and no Titan deploy surface',()=>{
  const c=b.contract();
  assert.equal(c.production_application_mutation,false);
  assert.equal(c.database_mutation,false);
  assert.equal(c.titan_cutover,false);
  assert.equal(c.rollback,'exact-preimage');
  assert.deepEqual(c.registration_targets,['base','executor','policy','mcp']);
  assert.equal(c.target_action,b.ACTION);
});
