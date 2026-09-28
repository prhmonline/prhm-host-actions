'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const b=require('./bootstrap-host-actions-v29-current-owner-binding-refresh.js');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');

test('v29 pins exact live Base Executor Policy MCP SHAs and fixed action identity',()=>{
  assert.equal(b.ACTION,'control_plane_current_owner_binding_refresh_v1');
  assert.equal(b.OPERATION,'host_action.control_plane_current_owner_binding_refresh_v1');
  assert.deepEqual(b.LIVE_PINS,{
    base:'de924f7319f3656d788ba5d3f89ef2910bf4b0e3f0b8b074e7cd3a534441d5ea',
    executor:'6bba46890db31abc8eca7e7681753a4788c46170033a555a1106e05d0a7a66f9',
    policy:'2fedd70a182aa351e269df95a1b9d829f5a0b18defe8871cb4045106948d711a',
    mcp:'b2f95b97dfa7e26ca717dfbec7871bf2f64286952548fb4d6d8e99908aeaacc0'
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

test('registration transforms are additive, reject missing/nonunique anchors and avoid generic shell',()=>{
  assert.throws(()=>b.buildBaseRegistration('x'),/anchor/);
  assert.throws(()=>b.buildExecutorRegistration('x'),/anchor/);
  assert.throws(()=>b.buildMcpRegistration('x'),/anchor/);
  const src=fs.readFileSync(require.resolve('./bootstrap-host-actions-v29-current-owner-binding-refresh.js'),'utf8');
  assert.doesNotMatch(src,/bash -c|sh -c|exec\(|spawn\([^)]*shell\s*:\s*true/);
  assert.doesNotMatch(src,/titan_front_handoff_deploy_v2|CONFIRM_DEPLOY_PRODUCTION/);
});

test('bootstrap contract reports registration-only application and rollback-safe four-file mutation',()=>{
  const c=b.contract();
  assert.equal(c.production_application_mutation,false);
  assert.equal(c.database_mutation,false);
  assert.equal(c.titan_cutover,false);
  assert.equal(c.rollback,'exact-preimage');
  assert.deepEqual(c.registration_targets,['base','executor','policy','mcp']);
  assert.equal(c.target_action,b.ACTION);
});
