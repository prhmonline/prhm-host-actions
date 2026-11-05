'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const fs=require('node:fs');
const P=require('./prhm-action-registry-v2-bootstrap-transaction-plan-v1.cjs');
const W=require('./prhm-action-registry-v2-bootstrap-wal-v1.cjs');
const M=require('./manifests/honartik-shared-registry-v2-reviewed-runtime-stage-v1.json');
const requestId='12345678-1234-4234-8234-123456789abc';
function proposal(){
 const sources={};
 for(const f of M.files){
   const r=cp.spawnSync('git',['show',f.source_commit+':'+f.source_path],
     {cwd:__dirname,encoding:null,maxBuffer:5000000,timeout:15000});
   assert.equal(r.status,0,'unavailable pinned Git object: '+f.source_path);
   sources[f.source_path]=r.stdout;
 }
 const bundle=P.attestBundle(sources);
 const fixed=P.immutablePlan();
 const observed={owners:{},directories:{},files:{},
  journal_absent:true,socket_absent:true};
 for(const [k,v] of Object.entries(fixed.protected_owners))
   observed.owners[k]=v.sha256;
 for(const d of fixed.dirs)observed.directories[d.path]='absent';
 for(const f of fixed.files)observed.files[f.path]='absent';
 return P.proposal({request_id:requestId,bundle,observed});
}
let memo;
function prepared(){return memo??(memo=proposal())}
function fixture(){
 const ROOT={kind:'dir',uid:0,gid:0,mode:0o40700,ino:1,dev:3};
 const files=new Map([[W.PARENT,ROOT]]);
 let currentFd=10;const handles=new Map();let syncs=0;
 const fileStat=x=>({
   uid:x.uid,gid:x.gid,mode:x.mode,ino:x.ino,dev:x.dev,
   size:x.bytes?.length??0,
   isFile:()=>x.kind==='file',
   isDirectory:()=>x.kind==='dir',
   isSymbolicLink:()=>false
 });
 const io={
   lstatSync:p=>{
     if(!files.has(p))throw Object.assign(Error('ENOENT'),{code:'ENOENT'});
     return fileStat(files.get(p));
   },
   realpathSync:p=>p,
   openSync:(path,flags,mode)=>{
     if(!files.has(path)){
       if(!(flags&fs.constants.O_CREAT))throw Object.assign(Error('ENOENT'),{code:'ENOENT'});
       files.set(path,{kind:'file',uid:0,gid:0,mode:0o100000|(mode??0o600),
          ino:2,dev:3,bytes:Buffer.alloc(0)});
     } else if((flags&fs.constants.O_CREAT)&&(flags&fs.constants.O_EXCL)){
       throw Object.assign(Error('EEXIST'),{code:'EEXIST'});
     }
     const fd=currentFd++;handles.set(fd,{path,flags});return fd;
   },
   fstatSync:fd=>fileStat(files.get(handles.get(fd).path)),
   closeSync:fd=>{assert.ok(handles.delete(fd))},
   fsyncSync:fd=>{assert.ok(handles.has(fd));syncs++},
   readFileSync:fd=>Buffer.from(files.get(handles.get(fd).path).bytes),
   writeSync:(fd,buf,offset,length)=>{
     const h=handles.get(fd);
     assert.ok(h,'file handle needed');
     const f=files.get(h.path);
     const next=buf.subarray(offset,offset+length);
     f.bytes=Buffer.concat([f.bytes,next]);
     return length;
   }
 };
 return {io,files,syncs:()=>syncs,handles};
}
test('header/intent/done chain is durable after every step, and never authorizes install',()=>{
 const txn=prepared(),f=fixture();
 const w=W.createSyntheticWriter({io:f.io,proposal:txn});
 let s=w.begin();
 assert.equal(s.completed,0);
 assert.equal(s.pending,null);
 assert.equal(f.syncs(),2); // fd + trusted parent dir
 s=w.intent(0);
 assert.equal(s.pending,0);
 assert.equal(s.indeterminate,true);
 assert.equal(s.safe_to_resume,false);
 s=w.done(0);
 assert.equal(s.pending,null);
 assert.equal(s.completed,1);
 assert.equal(s.authorization,false);
 assert.equal(s.production_mutation,false);
 assert.equal(f.syncs(),6);
 assert.equal(f.handles.size,0);
 assert.equal(f.files.get(W.JPATH).mode&0o777,0o600);
});
test('SIGKILL after intent leaves an indeterminate log; new writer cannot replay or reinitialize',()=>{
 const txn=prepared(),f=fixture();
 const one=W.createSyntheticWriter({io:f.io,proposal:txn});
 one.begin();
 one.intent(0);
 const after=W.scan(f.files.get(W.JPATH).bytes,txn);
 assert.equal(after.indeterminate,true);
 assert.equal(after.pending,0);
 const other=W.createSyntheticWriter({io:f.io,proposal:txn});
 assert.throws(()=>other.begin(),/EEXIST/);
 assert.throws(()=>other.intent(0),/durable_header_required/);
 assert.throws(()=>one.intent(0),/intent_not_next_step/);
});
test('never accept torn/forged/reordered/doubled/foreign journal records',()=>{
 const txn=prepared(),f=fixture(),w=W.createSyntheticWriter({io:f.io,proposal:txn});
 w.begin();w.intent(0);w.done(0);
 const good=Buffer.from(f.files.get(W.JPATH).bytes);
 assert.equal(W.scan(good,txn).completed,1);
 assert.throws(()=>W.scan(good.subarray(0,good.length-1),txn),/torn_or_unterminated_journal/);
 const rows=good.toString('utf8').trim().split('\n');
 const altered=rows.map(x=>JSON.parse(x));
 altered[1].step_sha256='0'.repeat(64);
 assert.throws(()=>W.scan(Buffer.from(altered.map(x=>JSON.stringify(x)).join('\n')+'\n'),txn),
  /journal_digest_invalid/);
 const doubled=Buffer.from(rows.concat(rows[2]).join('\n')+'\n');
 assert.throws(()=>W.scan(doubled,txn),/journal_binding_or_chain_invalid|done_without_durable_intent/);
 const reordered=Buffer.from([rows[0],rows[2],rows[1]].join('\n')+'\n');
 assert.throws(()=>W.scan(reordered,txn),/journal_binding_or_chain_invalid|done_without_durable_intent/);
 const p={...txn,request_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
 assert.throws(()=>W.scan(good,p),/journal_binding_or_chain_invalid/);
});
test('reject unsafe root metadata and partial writes without cleaning uncertain journal',()=>{
 const txn=prepared(),f=fixture();
 f.files.get(W.PARENT).uid=65039;
 assert.throws(()=>W.createSyntheticWriter({io:f.io,proposal:txn}).begin(),
 /journal_parent_not_root_private/);
 f.files.get(W.PARENT).uid=0;
 const w=W.createSyntheticWriter({io:f.io,proposal:txn});
 const original=f.io.writeSync;
 f.io.writeSync=(fd,bytes,start,n)=>{original(fd,bytes,start,n-1);return n-1};
 assert.throws(()=>w.begin(),/short_write_unknown_state/);
 assert.equal(f.files.has(W.JPATH),true);
 f.io.writeSync=original;
 assert.throws(()=>w.begin(),/EEXIST/);
});
test('trusted root source has no Production write entrypoint, arbitrary path or reapproval API',()=>{
 const p=prepared();
 assert.match(W.digestProposal(p),/^[0-9a-f]{64}$/);
 assert.throws(()=>W.createSyntheticWriter({io:fs,proposal:p}),
   /production_writer_not_authorized/);
 assert.deepEqual(Object.keys(W).sort(),[
  'JPATH','PARENT','ZERO','MAX','digestProposal','makeRecord',
  'scan','createSyntheticWriter'
 ].sort());
 for(const name of ['apply','install','execute','startProduction','request',
  'approve','consume','clearLock','unlink','rollback','recover'])
  assert.equal(Object.hasOwn(W,name),false);
});
