'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const gate=require('./prhm-action-registry-gateway-v1.cjs');
const fence=require('./prhm-action-registry-one-time-fence-v1.cjs');
function fixture(opts={}){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prhm-registry-once-'));
 fs.chmodSync(temp,0o700);
 const base={
   action:gate.ACTION,project:'honartik',source_commit:'a'.repeat(40),
   manifest_commit:'b'.repeat(40),manifest_sha256:'c'.repeat(64)
 };
 const approval={
   action:gate.ACTION,operation:gate.OPERATION,level:4,risk:'critical',
   request_id:'44444444-4444-4444-8444-444444444444',
   arguments_sha256:gate.approvalBindingSha(base)
 };
 const remap=p=>{
   assert.ok(p===fence.DIR||p.startsWith(fence.DIR+path.sep),'untrusted_path');
   return temp+p.slice(fence.DIR.length);
 };
 const io={
   lstatSync(p){
     const s=fs.lstatSync(remap(p));
     return new Proxy(s,{get(o,k){
       if(k==='uid'||k==='gid')return opts.unsafeDirUid&&p===fence.DIR?1000:0;
       if(k==='isSymbolicLink'&&opts.symlinkDir&&p===fence.DIR)return()=>true;
       return Reflect.get(o,k,o);
     }});
   },
   realpathSync(p){fs.realpathSync(remap(p));return p},
   openSync(p,flags,mode){return fs.openSync(remap(p),flags,mode)},
   fstatSync(fd){
     const s=fs.fstatSync(fd);
     return new Proxy(s,{get(o,k){
       if(k==='uid'||k==='gid')return 0;
       return Reflect.get(o,k,o);
     }});
   },
   writeSync:(fd,b,off,len)=>opts.shortWrite?fs.writeSync(fd,b,off,Math.min(len,5)):
     fs.writeSync(fd,b,off,len),
   fsyncSync(fd){
     if(opts.fsyncFails)throw Error('simulated_fsync_loss');
     fs.fsyncSync(fd);
   },
   closeSync:fd=>fs.closeSync(fd)
 };
 return {temp,io,approval,args:base,cleanup:()=>fs.rmSync(temp,{recursive:true,force:true})};
}
test('real O_EXCL on an isolated directory persists the claim across fresh process state',()=>{
 const f=fixture();
 try{
   const result=fence.reserve({approval:f.approval,args:f.args,io:f.io});
   assert.equal(result.durable,true);assert.equal(result.exclusive,true);
   const file=path.join(f.temp,f.approval.request_id+'.json');
   const data=JSON.parse(fs.readFileSync(file,'utf8'));
   assert.equal(data.request_id,f.approval.request_id);
   assert.equal(data.arguments_sha256,f.approval.arguments_sha256);
   assert.equal(fs.statSync(file).mode&0o777,0o600);
   // Subsequent invocation has no in-memory dependency; the inode exists.
   assert.throws(()=>fence.reserve({approval:f.approval,args:f.args,io:f.io}),
     /already_reserved_or_replayed/);
 }finally{f.cleanup()}
});
test('a different request ID creates its own separate durable reservation',()=>{
 const f=fixture();
 try{
   fence.reserve({approval:f.approval,args:f.args,io:f.io});
   const approval={...f.approval,request_id:'55555555-5555-4555-8555-555555555555'};
   const next=fence.reserve({approval,args:f.args,io:f.io});
   assert.equal(next.request_id,approval.request_id);
   assert.equal(fs.readdirSync(f.temp).length,2);
 }finally{f.cleanup()}
});
test('partial write, fsync failure retain a poisonous reservation and block replay',()=>{
 for(const opt of [{shortWrite:true},{fsyncFails:true}]){
   const f=fixture(opt);
   try{
     assert.throws(()=>fence.reserve({approval:f.approval,args:f.args,io:f.io}),
       /partial_write|simulated_fsync_loss/);
     assert.ok(fs.existsSync(path.join(f.temp,f.approval.request_id+'.json')));
     assert.throws(()=>fence.reserve({approval:f.approval,args:f.args,io:f.io}),
       /already_reserved_or_replayed/);
   }finally{f.cleanup()}
 }
});
test('untrusted directory owner or symlink aborts before any reservation',()=>{
 for(const opt of [{unsafeDirUid:true},{symlinkDir:true}]){
   const f=fixture(opt);
   try{
     assert.throws(()=>fence.reserve({approval:f.approval,args:f.args,io:f.io}),
       /private_directory_not_ready/);
     assert.equal(fs.readdirSync(f.temp).length,0);
   }finally{f.cleanup()}
 }
});
test('forged scope, missing source pin or altered request hash cannot reserve',()=>{
 const f=fixture();
 try{
   for(const change of [
     {...f.approval,level:3},
     {...f.approval,arguments_sha256:'0'.repeat(64)},
     {...f.approval,request_id:'../escape'},
     {...f.approval,operation:'host_action.foreign'}
   ])assert.throws(()=>fence.reserve({approval:change,args:f.args,io:f.io}),
      /signed_request_binding_invalid/);
   assert.equal(fs.readdirSync(f.temp).length,0);
 }finally{f.cleanup()}
});
test('source-only fence has no arbitrary command or approval minting function',()=>{
 assert.equal(typeof fence.reserveFromVerifiedApproval,'function');
 assert.equal(Object.hasOwn(fence,'executeShell'),false);
 assert.equal(Object.hasOwn(fence,'authorize'),false);
});
