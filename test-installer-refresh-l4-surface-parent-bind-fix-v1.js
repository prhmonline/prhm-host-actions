'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const IMPL=path.join(__dirname,'installer-refresh-l4-surface-parent-bind-fix-v1.js');

test('rebinds installer-refresh transient unit to existing parent writable paths only',()=>{
  const m=require(IMPL);
  const old=`function runState(args,apply=false){const w=apply?[STATE_ROOT,'/opt/prhm-company-control-plane','/var/backups/prhm-installer-refresh-l4-binding-repair-v1','/run']:[STATE_ROOT],u='prhm-installer-refresh-l4-surface-'+Date.now()+'-'+process.pid,a=['--wait','--pipe','--quiet','--unit='+u`;
  const source=[
    `const STATE_ROOT='/var/lib/prhm-agent-selfmaint-exec/installer-refresh-l4-binding-repair-v1',CONFIRM='CONFIRM_LEVEL_4_CRITICAL';`,
    old,
    `mcp.registerTool('control_plane_installer_refresh_l4_binding_repair_request_v1',{});`,
    `mcp.registerTool('control_plane_installer_refresh_l4_binding_repair_status_v1',{});`,
    `mcp.registerTool('control_plane_installer_refresh_l4_binding_repair_apply_v1',{});`
  ].join('\n');
  const out=m.patchSource(source);
  assert.equal(out.replacement_count,1);
  assert.equal(out.production_mutation,false);
  assert.match(out.content,/apply\?\['\/var\/lib\/prhm-agent-selfmaint-exec','\/opt\/prhm-company-control-plane','\/var\/backups','\/run'\]:\['\/var\/lib\/prhm-agent-selfmaint-exec'\]/);
  assert.doesNotMatch(out.content,/ReadWritePaths=.*installer-refresh-l4-binding-repair-v1/);
  assert.doesNotMatch(out.content,/\['\/var\/lib\/prhm-agent-selfmaint-exec\/installer-refresh-l4-binding-repair-v1'\]/);
  for(const fixed of [
    'CONFIRM_LEVEL_4_CRITICAL',
    'control_plane_installer_refresh_l4_binding_repair_request_v1',
    'control_plane_installer_refresh_l4_binding_repair_status_v1',
    'control_plane_installer_refresh_l4_binding_repair_apply_v1'
  ]) assert.equal(out.content.includes(fixed),true);
});

test('fails closed if the exact old runState anchor is missing or duplicated',()=>{
  const m=require(IMPL);
  assert.throws(()=>m.patchSource('no anchor'),/anchor_count:0/);
  const anchor=m.OLD_ANCHOR;
  assert.throws(()=>m.patchSource(anchor+'\n'+anchor),/anchor_count:2/);
});

test('exports no command, path, service or confirmation input surface',()=>{
  const m=require(IMPL);
  assert.equal(m.patchSource.length,1);
  for(const k of ['command','path','service','confirmation','run','exec','spawn']) assert.equal(Object.hasOwn(m,k),false);
});
