'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const launcher=require('./prhm-action-registry-v2-independent-root-launcher-v1.cjs');
const manifest=require('./manifests/honartik-shared-registry-v2-unified-root-closure-v1.json');
const cgroup='0::/system.slice/prhm-shared-registry-bootstrap-v2-abc123.service\n';
const ROOT=launcher.ROOT;
function fakeIO(){
 const files=new Map(),fds=new Map();
 let next=80;
 const contents={
  [ROOT+'/'+launcher.MANIFEST]:fs.readFileSync(
   path.join(__dirname,launcher.MANIFEST))
 };
 for(const f of manifest.files)contents[f.destination]=fs.readFileSync(
  path.join(__dirname,f.source_path));
 for(const [name,bytes] of Object.entries(contents)){
  files.set(name,{bytes,stat:{
   ino:++next,dev:3,uid:0,gid:0,mode:0o100644,
   size:bytes.length,isFile:()=>true,isSymbolicLink:()=>false
  }});
 }
 const dirs=[ROOT,ROOT+'/manifests'];
 const dirStat=(p)=>({
  ino:10,dev:3,uid:0,gid:0,
  mode:0o40700,isDirectory:()=>true,isSymbolicLink:()=>false
 });
 const io={
  readFileSync:(p,encoding)=>{
   if(p==='/proc/self/cgroup')return cgroup;
   if(Number.isInteger(p))return Buffer.from(files.get(fds.get(p)).bytes);
   throw Error('unreviewed file '+p);
  },
  realpathSync:p=>p,
  lstatSync:p=>{
   if(dirs.includes(p))return dirStat(p);
   if(files.has(p))return files.get(p).stat;
   throw Object.assign(Error('missing'),{code:'ENOENT'});
  },
  openSync:(p,flags)=>{
   assert.ok(flags&fs.constants.O_NOFOLLOW,'missing O_NOFOLLOW');
   if(!files.has(p))throw Error('file not pinned');
   const fd=++next;fds.set(fd,p);return fd;
  },
  fstatSync:fd=>files.get(fds.get(fd)).stat,
  closeSync:fd=>{assert.equal(fds.delete(fd),true)}
 };
 return {io,files};
}
test('staged 26-file trust boundary attests authentic SHA1 and fixed independent root',()=>{
 const f=fakeIO();
 const r=launcher.attestation({io:f.io,getuid:()=>0});
 assert.equal(r.ok,true);
 assert.equal(r.verified_files,26);
 assert.match(r.unit,/^prhm-shared-registry-bootstrap-v2-/);
 assert.equal(r.manifest_git_blob,launcher.MANIFEST_BLOB);
 assert.equal(launcher.blob(fs.readFileSync(
  path.join(__dirname,launcher.MANIFEST))),launcher.MANIFEST_BLOB);
});
test('one-byte injected JS fails before any dynamic require or signed credential read',()=>{
 const f=fakeIO();
 const record=f.files.get(ROOT+'/prhm-action-registry-v2-root-complete-capabilities-v1.cjs');
 record.bytes=Buffer.from(record.bytes);
 record.bytes[0]^=1;
 assert.throws(()=>launcher.attestation({io:f.io,getuid:()=>0}),
  /runtime_git_blob_drift/);
});
test('root ownership, symlink and file mode preflight is fail-closed',()=>{
 for(const type of ['uid','mode','symlink']){
  const f=fakeIO();
  const rec=f.files.get(ROOT+'/prhm-action-registry-v2-root-runner-bindings-v1.cjs');
  if(type==='uid')rec.stat.uid=1000;
  if(type==='mode')rec.stat.mode=0o100666;
  if(type==='symlink')rec.stat.isSymbolicLink=()=>true;
  assert.throws(()=>launcher.attestation({io:f.io,getuid:()=>0}),
   /untrusted_runtime_file/,type);
 }
});
test('launcher refuses unrelated users, service cgroups and duplicate registry units',()=>{
 const f=fakeIO();
 assert.throws(()=>launcher.attestation({io:f.io,getuid:()=>1000}),/root_required/);
 for(const text of [
  '0::/system.slice/prhm-agent-selfmaint-exec.service\n',
  '0::/system.slice/prhm-shared-registry-bootstrap-v2-a.service/'+
   'prhm-shared-registry-bootstrap-v2-b.service\n'
 ]){
  const changed={...f.io,readFileSync:(p,enc)=>
   p==='/proc/self/cgroup'?text:f.io.readFileSync(p,enc)};
  assert.throws(()=>launcher.attestation({io:changed,getuid:()=>0}),
   /untrusted_cgroup|independent_transient_unit_required/);
 }
});
test('wrong manifest bytes, unsupported closure mode and missing dependencies fail closed',()=>{
 const f=fakeIO();
 const rec=f.files.get(ROOT+'/'+launcher.MANIFEST);
 rec.bytes=Buffer.from(rec.bytes);
 rec.bytes[0]^=1;
 assert.throws(()=>launcher.attestation({io:f.io,getuid:()=>0}),/runtime_git_blob_drift/);
 const g=fakeIO();
 g.files.delete(ROOT+'/prhm-action-registry-v2-durable-recovery-locksafe-v1.cjs');
 assert.throws(()=>launcher.attestation({io:g.io,getuid:()=>0}),/missing/);
});
test('current process cannot run authenticated production launcher in CI',async()=>{
 await assert.rejects(()=>launcher.execute(),/no_cli_arguments|node_injection_not_allowed|root_required|untrusted_cgroup|independent_transient_unit_required/);
});
