'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const p=require('./deploy-control-l4-registration-root-survey-v1.cjs');
test('fixed target set is exactly four pinned owners and reviewed repaired helper',()=>{
 assert.deepEqual(p.CHECKED.map(x=>x.role),['base','executor','policy','mcp','helper']);
 assert.equal(new Set(p.CHECKED.map(x=>x.path)).size,5);
 for(const x of p.CHECKED){assert.match(x.sha,/^[a-f0-9]{64}$/);assert.equal(x.path.startsWith('/'),true);}
});
test('registration anchors are count-only and include both new action identities',()=>{
 for(const r of ['base','executor','mcp']){
  assert.ok(p.ANCHORS[r].includes('deploy_control_cutover_install_v1'));
  assert.ok(p.ANCHORS[r].includes('prhm_action_registry_install_v1'));
 }
 assert.equal(p.count('host_action host_action','host_action'),2);
 assert.equal(p.count('none','host_action'),0);
 assert.throws(()=>p.count('abc',''),/input_invalid/);
});
test('custom target is not accepted by exact read path',()=>{
 assert.throws(()=>p.readFixed({path:'/etc/shadow'}),/target_not_allowlisted/);
});
test('untrusted reader emits no source file, secrets, token or body',()=>{
 const b=p.summarize(()=>Buffer.from('EXAMPLE_PRIVATE_TOKEN_SHOULD_NOT_APPEAR'));
 assert.equal(b.ok,false);
 assert.equal(b.read_only,true);
 assert.equal(b.production_mutation,false);
 assert.equal(b.approval_consumed,false);
 assert.equal(b.may_install,false);
 const printed=JSON.stringify(b);
 assert.doesNotMatch(printed,/EXAMPLE_PRIVATE_TOKEN_SHOULD_NOT_APPEAR/);
 assert.equal(b.checks.length,5);
});
test('reader and registry survey do not export any installer or approval authority',()=>{
 for(const k of ['install','apply','register','shell','approve','consume','write'])
  assert.equal(typeof p[k],'undefined',k);
});
test('CLI denies install mode without reading privileged host files',()=>{
 const x=cp.spawnSync(process.execPath,['deploy-control-l4-registration-root-survey-v1.cjs','--install'],
  {cwd:__dirname,encoding:'utf8',timeout:4000});
 assert.equal(x.status,3);
 assert.match(x.stderr,/root_read_only_flag_required/);
 assert.equal(x.stdout,'');
});
