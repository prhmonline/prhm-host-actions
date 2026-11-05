'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const cp=require('node:child_process');
const P=require('./prhm-action-registry-v2-bootstrap-transaction-plan-v1.cjs');
const LOCK=require('./prhm-action-registry-v2-bootstrap-exclusive-lock-v1.cjs');
const WAL=require('./prhm-action-registry-v2-bootstrap-wal-v1.cjs');
const S=require('./prhm-action-registry-v2-bootstrap-session-guard-v1.cjs');
const M=require('./manifests/honartik-shared-registry-v2-reviewed-runtime-stage-v1.json');
const ID='12345678-1234-4234-8234-123456789abc';
let memo;
function proposal(){
 if(memo)return memo;
 const source={};
 for(const file of M.files){
  const r=cp.spawnSync('git',['show',file.source_commit+':'+file.source_path],
   {cwd:__dirname,timeout:15000,maxBuffer:5000000});
  assert.equal(r.status,0);
  source[file.source_path]=r.stdout;
 }
 const plan=P.immutablePlan();
 const observed={owners:{},files:{},directories:{},journal_absent:true,socket_absent:true};
 for(const [key,v] of Object.entries(plan.protected_owners))observed.owners[key]=v.sha256;
 for(const f of plan.files)observed.files[f.path]='absent';
 for(const d of plan.dirs)observed.directories[d.path]='absent';
 memo=P.proposal({request_id:ID,bundle:P.attestBundle(source),observed});
 return memo;
}
function fixture(){
 const files=new Map([[WAL.PARENT,{kind:'dir',uid:0,gid:0,
  mode:0o40700,ino:1,dev:4,bytes:Buffer.alloc(0)}]]);
 const descriptors=new Map();let counter=10,fsyncs=0;
 const created=[],written=[];
 const st=v=>({
  size:v.bytes?.length??0,mode:v.mode,uid:v.uid,gid:v.gid,ino:v.ino,dev:v.dev,
  isDirectory:()=>v.kind==='dir',isFile:()=>v.kind==='file',
  isSymbolicLink:()=>v.kind==='link'
 });
 const io={
  lstatSync:p=>{
   if(!files.has(p))throw Object.assign(Error('ENOENT'),{code:'ENOENT'});
   return st(files.get(p))
  },
  realpathSync:p=>p,
  openSync:(p,flags,mode)=>{
   if(files.has(p)&&(flags&fs.constants.O_EXCL)&&(flags&fs.constants.O_CREAT))
    throw Object.assign(Error('EEXIST'),{code:'EEXIST'});
   if(!files.has(p)){
    if(!(flags&fs.constants.O_CREAT))
     throw Object.assign(Error('ENOENT'),{code:'ENOENT'});
    created.push(p);
    files.set(p,{kind:'file',uid:0,gid:0,mode:0o100000|(mode??0o600),
     ino:10+created.length,dev:4,bytes:Buffer.alloc(0)});
   }
   const fd=counter++;descriptors.set(fd,p);return fd
  },
  fstatSync:fd=>st(files.get(descriptors.get(fd))),
  closeSync:fd=>{assert.ok(descriptors.delete(fd))},
  readFileSync:fd=>Buffer.from(files.get(descriptors.get(fd)).bytes),
  fsyncSync:fd=>{assert.ok(descriptors.has(fd));fsyncs++},
  writeSync:(fd,b,off,len)=>{
   const path=descriptors.get(fd),file=files.get(path);
   written.push(path);
   file.bytes=Buffer.concat([file.bytes,b.subarray(off,off+len)]);
   return len
  }
 };
 return {io,files,created,written,fsyncs:()=>fsyncs};
}
test('session creates exclusive lock BEFORE WAL and fsyncs both',()=>{
 const f=fixture(),s=S.createSyntheticSession({io:f.io,proposal:proposal()});
 assert.throws(()=>s.inspect(),/session_not_started/);
 const info=s.initialize();
 assert.deepEqual(f.created,[LOCK.LOCK,WAL.JPATH]);
 assert.deepEqual(f.written,[LOCK.LOCK,WAL.JPATH]);
 assert.equal(f.fsyncs(),4); // each file and parent
 assert.equal(info.status,'SYNTHETIC_EXCLUSIVE_HEADER_DURABLE');
 assert.equal(info.lock_present,true);
 assert.equal(info.wal_header_durable,true);
 assert.equal(info.simulated_only,true);
 assert.equal(info.can_start_production,false);
 assert.equal(info.install_authorized,false);
 assert.equal(info.approval_consumed,false);
 assert.throws(()=>s.initialize(),/session_reused/);
});
test('stale journal blocks BEFORE writing a new lock',()=>{
 const f=fixture();
 f.files.set(WAL.JPATH,{kind:'file',uid:0,gid:0,mode:0o100600,
  ino:40,dev:4,bytes:Buffer.from('stale\n')});
 const s=S.createSyntheticSession({io:f.io,proposal:proposal()});
 assert.throws(()=>s.initialize(),/foreign_lock_or_journal_present/);
 assert.deepEqual(f.created,[]);
 assert.equal(f.files.has(LOCK.LOCK),false);
});
test('power loss on first journal write keeps lock and uncertain header, never auto-cleans',()=>{
 const f=fixture(),old=f.io.writeSync;
 f.io.writeSync=(fd,bytes,start,length)=>{
  if(f.written.length===1){ // first lock write already completed
   old(fd,bytes,start,length-1);return length-1;
  }
  return old(fd,bytes,start,length)
 };
 const s=S.createSyntheticSession({io:f.io,proposal:proposal()});
 assert.throws(()=>s.initialize(),/short_write_unknown_state/);
 assert.equal(f.files.has(LOCK.LOCK),true);
 assert.equal(f.files.has(WAL.JPATH),true);
 assert.throws(()=>s.initialize(),/session_reused/);
 const next=S.createSyntheticSession({io:f.io,proposal:proposal()});
 assert.throws(()=>next.initialize(),/foreign_lock_or_journal_present/);
});
test('cannot use real fs, live approval, arbitrary operation or unlock',()=>{
 assert.throws(()=>S.createSyntheticSession({io:fs,proposal:proposal()}),
  /production_session_not_authorized/);
 assert.deepEqual(Object.keys(S),['createSyntheticSession']);
 const f=fixture(),s=S.createSyntheticSession({io:f.io,proposal:proposal()});
 assert.deepEqual(Object.keys(s).sort(),['initialize','inspect']);
});
