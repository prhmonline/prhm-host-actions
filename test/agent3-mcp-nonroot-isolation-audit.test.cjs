'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const audit=require('../ops/agent3-universal-backup/mcp-nonroot-isolation-audit.cjs');
const cli=path.resolve(__dirname,'../ops/agent3-universal-backup/mcp-nonroot-isolation-audit.cjs');
function sample(){
 const paths={
  plugin:{uid:0,gid:0,mode:0o600,kind:'file'},
  workspace:{uid:0,gid:0,mode:0o710,kind:'directory'},
  runDirectory:{uid:0,gid:0,mode:0o750,kind:'directory'},
  socket:{uid:0,gid:0,mode:0o660,kind:'socket'}
 };
 const units={
  'prhm-agent-selfmaint-exec':{user:'root',active:true,no_new_privileges:true,workdir_matches:false},
  'prhm-agent-mcp-blue':{user:'root',active:true,no_new_privileges:true,workdir_matches:true},
  'prhm-agent-mcp-green':{user:'root',active:true,no_new_privileges:true,workdir_matches:true}
 };
 return {paths,units,account:{present:false,nonroot:false}};
}
test('current production-style root MCP shape is explicitly NO-GO',()=>{
 const out=audit.evaluate(sample());
 assert.equal(out.schema,'prhm.agent3.mcp-nonroot-readonly-audit.v1');
 assert.equal(out.production_mutation,false);
 assert.equal(out.nonroot_migration_ready,false);
 assert.equal(out.native_v3_registration_ready,false);
 assert.equal(out.approval_consumed,false);
 for(const id of ['ROOT_RUNNING_MCP','DEDICATED_MCP_ACCOUNT_ABSENT',
  'ROOT_ONLY_PLUGIN_READ','WORKSPACE_NONROOT_ACCESS_UNVERIFIED',
  'SOCKET_DIRECTORY_NONROOT_ACCESS_UNVERIFIED','ROOT_GROUP_ONLY_SOCKET']){
  assert.ok(out.blockers.includes(id),id);
 }
 assert.equal(out.service_users['prhm-agent-mcp-blue'],'root');
 assert.deepEqual(out.path_metadata.plugin,{uid:0,gid:0,mode:'600'});
});
test('permissive DAC, new account and non-root MCP still cannot assert authorization',()=>{
 const data=sample();
 data.account={present:true,nonroot:true};
 data.units['prhm-agent-mcp-blue'].user='prhm-mcp';
 data.units['prhm-agent-mcp-green'].user='prhm-mcp';
 data.paths.plugin.mode=0o640;
 data.paths.workspace.uid=1005;
 data.paths.workspace.mode=0o750;
 data.paths.runDirectory.uid=1005;
 data.paths.runDirectory.gid=1005;
 data.paths.socket.gid=1005;
 const out=audit.evaluate(data);
 assert.equal(out.blockers.length,0);
 assert.equal(out.nonroot_migration_ready,false);
 assert.equal(out.native_v3_registration_ready,false);
 assert.ok(out.mandatory_security_gates.some(x=>x.includes('SO_PEERCRED')));
});
test('fail closed on forged extra asset, missing service, incorrect kind and invalid permissions',()=>{
 let data=sample();
 data.paths.secret={uid:0,gid:0,mode:0o600,kind:'file'};
 assert.throws(()=>audit.evaluate(data),/fixed_scope_only/);
 data=sample();
 delete data.units['prhm-agent-mcp-green'];
 assert.throws(()=>audit.evaluate(data),/fixed_scope_only/);
 data=sample();
 data.paths.socket.kind='file';
 assert.throws(()=>audit.evaluate(data),/invalid_metadata:socket/);
 data=sample();
 data.paths.plugin.mode=0o1000;
 assert.throws(()=>audit.evaluate(data),/invalid_metadata:plugin/);
});
test('service status missing, bad workdir and missing NoNewPrivileges are explicit blockers',()=>{
 const data=sample();
 data.units['prhm-agent-mcp-blue'].active=false;
 data.units['prhm-agent-mcp-green'].workdir_matches=false;
 data.units['prhm-agent-mcp-blue'].no_new_privileges=false;
 const out=audit.evaluate(data);
 assert.ok(out.blockers.includes('SERVICE_NOT_ACTIVE'));
 assert.ok(out.blockers.includes('MCP_WORKDIR_DRIFT'));
 assert.ok(out.blockers.includes('MCP_NO_NEW_PRIVILEGES_MISSING'));
});
test('systemd output parser only selects fixed safe metadata, never environment',()=>{
 const out=audit.parseService([
  'User=', 'Group=', 'ActiveState=active','SubState=running',
  'NoNewPrivileges=yes','ProtectSystem=full',
  'WorkingDirectory=/home/agent/ssh-mcp-server',
  'Environment=SECRET=my-secret-value',
  'ExecStart=/usr/bin/node --password=verysecret'
 ].join('\n'));
 assert.equal(out.user,'root');
 assert.equal(out.group,'root');
 assert.equal(out.active,true);
 assert.equal(out.workdir_matches,true);
 assert.equal(JSON.stringify(out).includes('my-secret-value'),false);
 assert.equal(JSON.stringify(out).includes('verysecret'),false);
});
test('direct CLI rejects --apply without running an installation',()=>{
 const out=cp.spawnSync(process.execPath,[cli,'--apply'],{
  encoding:'utf8',timeout:10000
 });
 assert.equal(out.status,64);
 assert.match(out.stderr,/read-only --check only/);
});
