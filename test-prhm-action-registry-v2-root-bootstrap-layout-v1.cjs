'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const P=require('./prhm-action-registry-v2-root-bootstrap-layout-v1.cjs');
const runner=require('./prhm-action-registry-v2-independent-runner-contract-v1.cjs');
const expected=[
 '/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v2',
 '/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v2/manifests',
 '/opt/prhm-agent-selfmaint-exec/staged',
 '/opt/prhm-agent-selfmaint-exec/staged/honartik-config-center-v1',
 '/var/backups/prhm-honartik-config-center-registration-v1',
 '/var/lib/prhm-agent-selfmaint-exec/registry-one-time-v1',
 '/var/lib/prhm-agent-selfmaint-exec/registry-recovery-lock-v1',
 '/var/lib/prhm-agent-selfmaint-exec/registry-audit-v1',
 '/var/lib/prhm-agent-selfmaint-exec/registry-approval-v2',
 '/run/prhm-shared-registry-v2'
];
function fixture(fill=false){
 const entries=new Map();
 function add(p,mode=0o755,uid=0,gid=uid){
   entries.set(p,{isDirectory:()=>true,isSymbolicLink:()=>false,
      uid,gid,mode:0o40000|mode});
 }
 for(const p of new Set(Object.values(P.PARENTS))){
   if(!expected.includes(p))add(p,p==='/var/lib/prhm-agent-selfmaint-exec'?0o700:0o755);
 }
 if(fill)for(const p of expected)add(p,0o700);
 const io={
   lstatSync:p=>{
     if(!entries.has(p))throw Object.assign(Error('absent'),{code:'ENOENT'});
     return entries.get(p);
   },
   realpathSync:p=>p
 };
 return {entries,add,io,read:()=>P.inspect({io,getuid:()=>0})};
}
test('exact V2 root bootstrap plan has ten approved dirs and nine narrow runner writes',()=>{
 const p=P.immutablePlan();
 assert.equal(p.schema,'prhm.registry-v2.root-bootstrap-layout.v1');
 assert.deepEqual(p.required_dirs.map(x=>x.path),expected);
 assert.ok(p.required_dirs.every(x=>x.uid===0&&x.gid===0&&x.mode===0o700));
 assert.equal(p.runner_writepath_count,9);
 const paths=runner.sandboxPlan().systemd_properties.ReadWritePaths.split(' ');
 for(const bad of ['/','/opt','/home','/var/lib','/etc/systemd/system',
  '/opt/prhm-agent-selfmaint-exec/staged',
  '/var/lib/prhm-agent-selfmaint-exec/registry-approval-v2',
  '/run/prhm-shared-registry-v2']){
   assert.equal(paths.includes(bad),false,bad);
 }
 assert.equal(p.requires_new_signed_l4,true);
 assert.equal(p.installs,false);
 assert.equal(p.mutable_server_state,false);
 assert.match(p.rollback_rule,/journaled_new_empty_directories/);
});
test('missing V2 runtime, vault, and socket roots are reported and never provisioned',()=>{
 const f=fixture();
 const before=f.entries.size,r=f.read();
 assert.equal(f.entries.size,before);
 assert.equal(r.checked,10);
 assert.equal(r.ready_for_directory_stage,false);
 assert.equal(r.ready_for_install,false);
 assert.ok(r.blockers.includes('runtime:MISSING'));
 assert.ok(r.blockers.includes('runtime_manifests:PARENT_NOT_READY'));
 assert.ok(r.blockers.includes('approval_vault:MISSING'));
 assert.ok(r.blockers.includes('approval_socket:MISSING'));
 assert.equal(r.approval_consumed,false);
 assert.equal(r.production_mutation,false);
});
test('secure synthetic stage layout passes directory check, not installation authorization',()=>{
 const f=fixture(true),r=f.read();
 assert.equal(r.ready_for_directory_stage,true);
 assert.equal(r.ready_for_install,false);
 assert.deepEqual(r.blockers,[]);
 assert.equal(r.checked,10);
});
test('socket collision fails closed without unlinking existing endpoint',()=>{
 const f=fixture(true);
 f.entries.set('/run/prhm-shared-registry-v2/registry.sock',{
   isFile:()=>true,isSymbolicLink:()=>false,uid:0,gid:0,mode:0o140600
 });
 const r=f.read();
 assert.deepEqual(r.blockers,['APPROVAL_SOCKET_ALREADY_EXISTS']);
 assert.equal(r.ready_for_directory_stage,false);
 assert.equal(f.entries.has('/run/prhm-shared-registry-v2/registry.sock'),true);
});
test('root-only, symlink, owner, group-writable, and wrong-mode refusals',()=>{
 const f=fixture(true),p=expected[8],original=f.entries.get(p);
 assert.throws(()=>P.inspect({io:f.io,getuid:()=>1000}),/root_readonly_probe_required/);
 f.entries.set(p,{...original,mode:0o40750});
 assert.ok(f.read().blockers.includes('approval_vault:UNEXPECTED_MODE'));
 for(const update of [{uid:65039},{gid:65039},{mode:0o40777},
   {isSymbolicLink:()=>true}]){
   f.entries.set(p,{...original,...update});
   assert.throws(()=>f.read(),/unsafe_directory_/);
 }
 f.entries.set(p,original);
 f.entries.delete('/run');
 assert.ok(f.read().blockers.includes('approval_socket:PARENT_NOT_READY'));
});
test('no writable production API, transport, approval, shell, restore or install',()=>{
 const actual=Object.keys(P).sort();
 assert.deepEqual(actual,['PARENTS','immutablePlan','inspect','required'].sort());
 for(const op of ['mkdir','chown','chmod','apply','stage','install','approve',
   'consume','restart','run','exec','write','unlink','rollback','clearLock'])
   assert.equal(Object.hasOwn(P,op),false,op);
 assert.ok(P.required.every(x=>Object.isFrozen(x)));
});
