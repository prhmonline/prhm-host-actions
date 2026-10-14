'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const P=require('./prhm-action-registry-bootstrap-root-preflight-v1.cjs');
const runner=require('./prhm-action-registry-independent-runner-contract-v1.cjs');
const EXPECTED=[
 '/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v1',
 '/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v1/manifests',
 '/opt/prhm-agent-selfmaint-exec/staged',
 '/opt/prhm-agent-selfmaint-exec/staged/honartik-config-center-v1',
 '/var/backups/prhm-honartik-config-center-registration-v1',
 '/var/lib/prhm-agent-selfmaint-exec/registry-one-time-v1',
 '/var/lib/prhm-agent-selfmaint-exec/registry-recovery-lock-v1',
 '/var/lib/prhm-agent-selfmaint-exec/registry-audit-v1'
];
function fixture(populated=false){
 const live=new Map();
 const add=(p,mode=0o755,owner=0)=>live.set(p,{uid:owner,gid:owner,mode:0o40000|mode,
   isDirectory:()=>true,isSymbolicLink:()=>false});
 add('/opt/prhm-agent-selfmaint-exec/actions');
 add('/opt/prhm-agent-selfmaint-exec');
 add('/var/backups');
 add('/var/lib/prhm-agent-selfmaint-exec',0o700);
 if(populated)for(const p of EXPECTED)add(p,0o700);
 const io={
  lstatSync:p=>{
   if(!live.has(p))throw Object.assign(Error('not found'),{code:'ENOENT'});
   return live.get(p);
  },
  realpathSync:p=>p
 };
 return {live,io,check:()=>P.inspect({io,getuid:()=>0})};
}
test('all 8 directories are fixed root-only 0700 and within exactly nine narrow runner RW paths',()=>{
 const p=P.immutablePlan();
 assert.equal(p.schema,'prhm.registry.bootstrap.preflight.v1');
 assert.equal(p.preflight_only,true);
 assert.equal(p.creates_directories,false);
 assert.equal(p.production_mutation,false);
 assert.equal(p.requires_fresh_l4,true);
 assert.deepEqual(p.required_dirs.map(x=>x.path),EXPECTED);
 assert.equal(new Set(EXPECTED).size,8);
 assert.ok(p.required_dirs.every(x=>x.uid===0&&x.gid===0&&x.mode===0o700));
 assert.equal(runner.sandboxPlan().systemd_properties.ReadWritePaths.split(' ').length,9);
});
test('actual observed missing-directory arrangement is GO=FALSE and distinguishes parent dependency',()=>{
 const f=fixture(false);const r=f.check();
 assert.equal(r.ready,false);assert.equal(r.checked,8);
 assert.deepEqual(r.blockers,[
  'runtime:MISSING','runtime_manifests:PARENT_NOT_STAGED',
  'staged_parent:MISSING','staged_release:PARENT_NOT_STAGED',
  'backup:MISSING','once:MISSING','recovery_lock:MISSING','audit:MISSING'
 ]);
 assert.equal(r.production_mutation,false);
 assert.equal(r.approval_consumed,false);
});
test('all root-owned secure provisioned dirs yield ready with NO mutation',()=>{
 const f=fixture(true),before=f.live.size;
 const r=f.check();
 assert.equal(r.ready,true);
 assert.deepEqual(r.blockers,[]);
 assert.equal(r.items.length,8);
 assert.equal(f.live.size,before);
});
test('wrong mode rejects readiness; symlink/writable/non-root scope fail closed',()=>{
 const f=fixture(true);
 const item=EXPECTED[5],old=f.live.get(item);
 f.live.set(item,{...old,mode:0o40750});
 assert.equal(f.check().blockers.includes('once:UNEXPECTED_MODE'),true);
 f.live.set(item,{...old,mode:0o40777});
 assert.throws(()=>f.check(),/unsafe_dir_/);
 f.live.set(item,{...old,uid:65039});
 assert.throws(()=>f.check(),/unsafe_dir_/);
 f.live.set(item,{...old,isSymbolicLink:()=>true});
 assert.throws(()=>f.check(),/unsafe_dir_/);
});
test('missing existing parent is not silently provisioned and altered parent owner blocks preflight',()=>{
 const f=fixture(true);
 f.live.delete('/var/backups');
 assert.equal(f.check().blockers.includes('backup:PARENT_NOT_STAGED'),true);
 f.live.set('/var/backups',{uid:1000,gid:1000,mode:0o40755,
  isDirectory:()=>true,isSymbolicLink:()=>false});
 assert.throws(()=>f.check(),/unsafe_dir_/);
});
test('provenance-only surface has no create, chmod, chown, exec, signing, install or approval methods',()=>{
 assert.deepEqual(Object.keys(P).sort(),['PATHS','immutablePlan','inspect'].sort());
 for(const key of ['mkdir','chmod','chown','exec','stage','install','approve','sign',
  'consume','restart','writeFile','spawn','fix'])assert.equal(Object.hasOwn(P,key),false);
 const f=fixture(true);
 assert.throws(()=>P.inspect({io:f.io,getuid:()=>1000}),/root_readonly_preflight_required/);
});
