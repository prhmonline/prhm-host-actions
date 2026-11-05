'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const cp=require('node:child_process');
const P=require('./prhm-action-registry-v2-bootstrap-transaction-plan-v1.cjs');
const L=require('./prhm-action-registry-v2-bootstrap-exclusive-lock-v1.cjs');
const M=require('./manifests/honartik-shared-registry-v2-reviewed-runtime-stage-v1.json');
const ID='12345678-1234-4234-8234-123456789abc';
let cached;
function proposal(){
 if(cached)return cached;
 const data={};
 for(const f of M.files){
  const out=cp.spawnSync('git',['show',f.source_commit+':'+f.source_path],
   {cwd:__dirname,timeout:15000,maxBuffer:5000000});
  assert.equal(out.status,0,'pinned blob missing: '+f.source_path);
  data[f.source_path]=out.stdout;
 }
 const pin=P.immutablePlan(),observed={
  owners:{},directories:{},files:{},journal_absent:true,socket_absent:true
 };
 for(const [k,v] of Object.entries(pin.protected_owners))
  observed.owners[k]=v.sha256;
 for(const x of pin.dirs)observed.directories[x.path]='absent';
 for(const x of pin.files)observed.files[x.path]='absent';
 cached=P.proposal({request_id:ID,bundle:P.attestBundle(data),observed});
 return cached;
}
function fixture(){
 const files=new Map([[L.PARENT,{
  kind:'dir',mode:0o40700,uid:0,gid:0,dev:4,ino:4
 }]]);
 const handles=new Map();const flags=[];
 let fdCounter=10,syncs=0;
 const stat=x=>({
  mode:x.mode,uid:x.uid,gid:x.gid,dev:x.dev,ino:x.ino,
  size:x.bytes?.length??0,
  isDirectory:()=>x.kind==='dir',
  isFile:()=>x.kind==='file',
  isSymbolicLink:()=>x.kind==='symlink'
 });
 const io={
  lstatSync:p=>{
   if(!files.has(p))throw Object.assign(Error('ENOENT'),{code:'ENOENT'});
   return stat(files.get(p));
  },
  realpathSync:p=>p,
  openSync:(p,fl,mode)=>{
   flags.push(fl);
   if(files.has(p)&&fl&fs.constants.O_EXCL&&fl&fs.constants.O_CREAT)
     throw Object.assign(Error('EEXIST'),{code:'EEXIST'});
   if(!files.has(p)){
    if(!(fl&fs.constants.O_CREAT))throw Object.assign(Error('ENOENT'),{code:'ENOENT'});
    files.set(p,{kind:'file',mode:0o100000|(mode??0o600),
     uid:0,gid:0,dev:4,ino:9,bytes:Buffer.alloc(0)});
   }
   const fd=fdCounter++;handles.set(fd,p);return fd;
  },
  fstatSync:fd=>stat(files.get(handles.get(fd))),
  closeSync:fd=>{assert.ok(handles.delete(fd))},
  fsyncSync:fd=>{assert.ok(handles.has(fd));syncs++},
  writeSync:(fd,buffer,start,len)=>{
   const file=files.get(handles.get(fd));
   file.bytes=Buffer.concat([file.bytes,buffer.subarray(start,start+len)]);
   return len;
  },
  readFileSync:fd=>Buffer.from(files.get(handles.get(fd)).bytes)
 };
 return {files,io,handles,flags,syncs:()=>syncs};
}
test('single exact 0600 root lock requires O_EXCL, O_NOFOLLOW and two fsyncs',()=>{
 const f=fixture(),p=proposal(),lock=L.createSyntheticLock({io:f.io,proposal:p});
 const result=lock.acquire();
 assert.equal(result.production,false);
 assert.equal(result.authorization,false);
 assert.equal(result.bytes_verified,true);
 assert.equal(f.syncs(),2);
 assert.equal(f.handles.size,0);
 const b=f.files.get(L.LOCK);
 assert.equal(b.uid,0);
 assert.equal(b.gid,0);
 assert.equal(b.mode&0o777,0o600);
 assert.ok(f.flags.some(x=>(x&(fs.constants.O_EXCL|fs.constants.O_NOFOLLOW))===
   (fs.constants.O_EXCL|fs.constants.O_NOFOLLOW)));
 assert.ok(f.flags.some(x=>(x&(fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW))===
   (fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW)));
 assert.equal(lock.inspect().safe_to_resume,false);
 assert.equal(lock.inspect().authorized,false);
 assert.throws(()=>lock.acquire(),/same_process_lock_reused/);
 assert.throws(()=>L.createSyntheticLock({io:f.io,proposal:p}).acquire(),
   /existing_lock_needs_operator_review/);
});
test('stale lock, altered identity and owner drift always block without unlink',()=>{
 const p=proposal(),f=fixture();
 L.createSyntheticLock({io:f.io,proposal:p}).acquire();
 f.files.get(L.LOCK).bytes=Buffer.from('foreign-claim\n');
 assert.throws(()=>L.inspect({io:f.io,proposal:p}),
  /lock_file_unsafe_or_partial|lock_identity_or_bytes_mismatch/);
 assert.throws(()=>L.createSyntheticLock({io:f.io,proposal:p}).acquire(),
  /existing_lock_needs_operator_review/);
 assert.equal(f.files.has(L.LOCK),true);
 const g=fixture();g.files.get(L.PARENT).mode=0o40777;
 assert.throws(()=>L.createSyntheticLock({io:g.io,proposal:p}).acquire(),
  /parent_unsafe/);
 const h=fixture();h.files.get(L.PARENT).uid=65039;
 assert.throws(()=>L.createSyntheticLock({io:h.io,proposal:p}).acquire(),
  /parent_unsafe/);
 const j=fixture();j.files.get(L.PARENT).kind='symlink';
 assert.throws(()=>L.createSyntheticLock({io:j.io,proposal:p}).acquire(),
  /parent_unsafe/);
});
test('truncated O_EXCL lock write is indeterminate and never removed or reacquired',()=>{
 const p=proposal(),f=fixture();
 const original=f.io.writeSync;
 f.io.writeSync=(fd,b,start,len)=>{
  original(fd,b,start,len-1);return len-1;
 };
 assert.throws(()=>L.createSyntheticLock({io:f.io,proposal:p}).acquire(),
  /short_lock_write_indeterminate/);
 assert.equal(f.files.has(L.LOCK),true);
 f.io.writeSync=original;
 assert.throws(()=>L.createSyntheticLock({io:f.io,proposal:p}).acquire(),
  /existing_lock_needs_operator_review/);
 assert.equal(f.syncs(),0);
});
test('lock module has no production write, release, token, L4 approval or replay API',()=>{
 const p=proposal();
 assert.equal(L.PARENT,'/var/lib/prhm-agent-selfmaint-exec');
 assert.equal(L.LOCK,'/var/lib/prhm-agent-selfmaint-exec/registry-bootstrap-v2.lock');
 assert.equal(L.payload(p).state,'RESERVED_NOT_AN_APPROVAL');
 assert.throws(()=>L.createSyntheticLock({io:fs,proposal:p}),
  /production_lock_writer_not_authorized/);
 assert.deepEqual(Object.keys(L).sort(),
  ['LOCK','PARENT','MAX','payload','lockBytes','inspect','createSyntheticLock'].sort());
 for(const name of ['release','unlock','unlink','remove','approve',
 'consume','install','apply','execute','clearLock','restart','recover'])
  assert.equal(Object.hasOwn(L,name),false);
});
