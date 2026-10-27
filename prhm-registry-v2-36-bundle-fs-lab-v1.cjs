'use strict';
/**
 * Exact 35-runtime-object + 1-systemd-unit Git-pinned stage/rollback LAB.
 *
 * All effects are forcibly mapped into an isolated user-owned 0700 mkdtemp
 * child of os.tmpdir(). There is NO Production path, service, Approval Center,
 * token or privileged API. This module does not issue/consume L4 permission.
 *
 * Intent WAL and fsync precede EVERY stage/undo write. A torn record,
 * unmatched intent, modified path, unexpected occupant or interrupted undo
 * remains indeterminate. It NEVER resumes, replays or clears a stale lock.
 */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const candidate=require('./prhm-registry-v2-bootstrap-authorization-boundary-v1.cjs');
const PREFIX='prhm-registry-v2-36-lab-';
const BASE='/var/lib/prhm-agent-selfmaint-exec';
const LOCK=BASE+'/registry-bootstrap-v2-36-lab.lock';
const FORWARD=BASE+'/registry-bootstrap-v2-36-lab-wal.jsonl';
const UNDO=BASE+'/registry-bootstrap-v2-36-lab-undo.jsonl';
const C=fs.constants,MAX=4000000;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const blob=b=>crypto.createHash('sha1')
 .update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
function fail(x){throw Error('registry_v2_36_lab_'+x)}
function need(b,x){if(!b)fail(x)}
function absent(p){try{fs.lstatSync(p);return false}catch(e){if(e.code==='ENOENT')return true;throw e}}
function jail(root){
 need(typeof root==='string'&&path.isAbsolute(root)&&
   path.normalize(root)===root&&path.dirname(root)===path.resolve(os.tmpdir())&&
   /^prhm-registry-v2-36-lab-[a-zA-Z0-9]{6,}$/.test(path.basename(root)),
   'non_lab_root_denied');
 const st=fs.lstatSync(root);
 need(st.isDirectory()&&!st.isSymbolicLink()&&
  fs.realpathSync(root)===root&&st.uid===process.getuid()&&
  st.gid===process.getgid()&&(st.mode&0o777)===0o700,
  'unsafe_lab_root');
 return root;
}
function mapped(root,dest){
 jail(root);
 need(typeof dest==='string'&&dest.startsWith('/')&&
  path.posix.normalize(dest)===dest&&
  /^\/[A-Za-z0-9_.\/-]+$/.test(dest)&&
  !dest.split('/').includes('..')&&!dest.split('/').includes('.'),
  'noncanonical_destination');
 const p=path.join(root,dest.slice(1));
 need(p.startsWith(root+'/'),'escaped_lab_root');
 return p;
}
function secureDir(root,dest){
 jail(root);
 need(dest===root||dest.startsWith(root+'/'),'dir_outside_lab');
 let cur=root;
 const parts=path.relative(root,dest).split(path.sep).filter(Boolean);
 for(const part of parts){
  cur=path.join(cur,part);
  const st=fs.lstatSync(cur);
  need(st.isDirectory()&&!st.isSymbolicLink()&&
   fs.realpathSync(cur)===cur&&st.uid===process.getuid()&&
   st.gid===process.getgid()&&(st.mode&0o777)===0o700,
   'unsafe_stage_directory');
 }
 return true;
}
function syncDir(root,d){
 secureDir(root,d);
 const fd=fs.openSync(d,C.O_RDONLY|C.O_NOFOLLOW|C.O_DIRECTORY);
 try{need(fs.fstatSync(fd).isDirectory(),'dir_fd_changed');fs.fsyncSync(fd)}
 finally{fs.closeSync(fd)}
}
function read(root,file,max=MAX){
 secureDir(root,path.dirname(file));
 const st=fs.lstatSync(file);
 need(st.isFile()&&!st.isSymbolicLink()&&
  fs.realpathSync(file)===file&&st.uid===process.getuid()&&
  st.gid===process.getgid()&&(st.mode&0o777)===0o600&&
  st.size>0&&st.size<=max,'untrusted_file');
 const fd=fs.openSync(file,C.O_RDONLY|C.O_NOFOLLOW);
 let b;
 try{
  const s=fs.fstatSync(fd);
  need(s.isFile()&&s.dev===st.dev&&s.ino===st.ino&&
   s.size===st.size&&s.mode===st.mode&&s.uid===st.uid&&
   s.gid===st.gid,'file_changed_during_read');
  b=fs.readFileSync(fd);
 }finally{fs.closeSync(fd)}
 need(Buffer.isBuffer(b)&&b.length===st.size,'short_file_read');
 return b;
}
function writeExclusive(root,file,bytes){
 need(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=MAX,'bad_write_bytes');
 const d=path.dirname(file);secureDir(root,d);
 const fd=fs.openSync(file,C.O_WRONLY|C.O_CREAT|C.O_EXCL|C.O_NOFOLLOW,0o600);
 try{
  need(fs.writeSync(fd,bytes,0,bytes.length)===bytes.length,
   'short_write_indeterminate');
  fs.fsyncSync(fd);
 }finally{fs.closeSync(fd)}
 syncDir(root,d);
 need(read(root,file).equals(bytes),'created_file_drift');
}
function append(root,file,record){
 const b=Buffer.from(JSON.stringify(record)+'\n');
 need(b.length>10&&b.length<4000,'record_size');
 read(root,file,150000);
 const fd=fs.openSync(file,C.O_WRONLY|C.O_APPEND|C.O_NOFOLLOW);
 try{need(fs.writeSync(fd,b,0,b.length)===b.length,'short_append_indeterminate');
  fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
 syncDir(root,path.dirname(file));
}
function digest(o){return sha(Buffer.from(JSON.stringify(o)))}
function proposalFor({requestId,bytes}={}){
 const spec=candidate.immutableCandidate();
 need(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId||''),
  'request_id_invalid');
 need(bytes&&typeof bytes==='object'&&!Array.isArray(bytes)&&
  Object.keys(bytes).length===36,'exact_36_byte_set_required');
 const operations=[];
 const dirs=[candidate.ROOT,candidate.ROOT+'/manifests'];
 need(spec.artifacts.length===36&&
  spec.artifacts.at(-1).destination===candidate.UNIT,'invalid_reviewed_closure');
 for(const d of dirs)operations.push(Object.freeze({kind:'mkdir',path:d}));
 const copied={};
 for(const f of spec.artifacts){
  need(Object.hasOwn(bytes,f.destination),'source_bytes_missing');
  const b=bytes[f.destination];
  need(Buffer.isBuffer(b)&&b.length>0&&b.length<=MAX&&
   blob(b)===f.git_blob_sha1,'git_object_mismatch');
  copied[f.destination]=Buffer.from(b);
  operations.push(Object.freeze({
   kind:'file',path:f.destination,git_blob_sha1:f.git_blob_sha1,
   sha256:sha(b)
  }));
 }
 need(Object.keys(bytes).every(x=>Object.hasOwn(copied,x)),
  'foreign_blob_provided');
 const digestIdentity=digest({
  action:spec.action,manifest_sha256:spec.manifest_sha256,
  source_paths:spec.artifacts,
  request_id:requestId,operations
 });
 return Object.freeze({
  requestId,manifest_sha256:spec.manifest_sha256,
  identity_sha256:digestIdentity,
  operations:Object.freeze(operations),
  stage_count:36,created_dir_count:2,authorized:false,
  payload:copied
 });
}
function scan(root,file,p){
 const b=read(root,file,150000);
 need(b.at(-1)===10,'torn_wal');
 let rows;
 try{rows=b.toString('utf8').slice(0,-1).split('\n').map(JSON.parse)}
 catch{fail('invalid_wal_json')}
 need(rows.length>=1&&rows.length<=80,'wal_length');
 let last='0'.repeat(64),completed=0,pending=null;
 for(let i=0;i<rows.length;i++){
  const rec=rows[i],plain={schema:rec.schema,kind:rec.kind,
   index:rec.index,request_id:rec.request_id,
   identity_sha256:rec.identity_sha256,prev_hash:rec.prev_hash};
  need(Object.keys(rec).sort().join('|')===
   [...Object.keys(plain),'hash'].sort().join('|')&&
   rec.schema==='prhm.registry-v2.36-lab-wal.v1'&&
   rec.request_id===p.requestId&&rec.identity_sha256===p.identity_sha256&&
   rec.prev_hash===last&&rec.hash===digest(plain),'wal_chain_drift');
  if(i===0)need(rec.kind==='header'&&rec.index===-1,'wal_header_drift');
  else if(rec.kind==='intent'){
   need(pending===null&&rec.index===completed&&
    completed<p.operations.length,'wal_intent_out_of_order');
   pending=completed;
  }else if(rec.kind==='done'){
   need(pending!==null&&rec.index===pending,'wal_done_without_intent');
   pending=null;completed++;
  }else fail('wal_kind_unknown');
  last=rec.hash;
 }
 return Object.freeze({completed,pending,last,indeterminate:pending!==null,
  safe_to_resume:false});
}
function record(p,kind,index,prev){
 const bare={schema:'prhm.registry-v2.36-lab-wal.v1',kind,index,
  request_id:p.requestId,identity_sha256:p.identity_sha256,prev_hash:prev};
 return Object.freeze({...bare,hash:digest(bare)});
}
function stageEnvironment(root){
 jail(root);
 const roots=['/var','/var/lib',BASE,'/etc','/etc/systemd','/etc/systemd/system',
  '/opt','/opt/prhm-agent-selfmaint-exec','/opt/prhm-agent-selfmaint-exec/actions'];
 for(const abs of roots){
  const dest=mapped(root,abs);
  if(absent(dest)){
   secureDir(root,path.dirname(dest));
   fs.mkdirSync(dest,{mode:0o700});
  }else secureDir(root,dest);
 }
}
function createLab({root,proposal}={}){
 jail(root);
 need(proposal?.stage_count===36&&proposal.operations?.length===38&&
  proposal.authorized===false,'plan_not_review_only');
 const spec=candidate.immutableCandidate();
 need(proposal.manifest_sha256===spec.manifest_sha256,'plan_manifest_drift');
 let mode='NEW';
 const lock=mapped(root,LOCK),wal=mapped(root,FORWARD),undo=mapped(root,UNDO);
 const lockContent=Buffer.from(JSON.stringify({
  request_id:proposal.requestId,identity_sha256:proposal.identity_sha256,
  authorized:false,production:false})+'\n');
 const dirs=proposal.operations.filter(x=>x.kind==='mkdir');
 const targets=proposal.operations.filter(x=>x.kind==='file');
 need(dirs.length===2&&dirs[0].path===candidate.ROOT&&
  dirs[1].path===candidate.ROOT+'/manifests'&&targets.length===36,
  'invalid_directory_operation_set');
 for(let i=0;i<36;i++){
  const s=targets[i],f=spec.artifacts[i],b=proposal.payload[f.destination];
  need(s.path===f.destination&&s.git_blob_sha1===f.git_blob_sha1&&
   Buffer.isBuffer(b)&&blob(b)===f.git_blob_sha1&&sha(b)===s.sha256,
   'plan_source_not_attested');
 }
 function existing(){
  need(read(root,lock,4096).equals(lockContent),'lock_drift');
  return scan(root,wal,proposal);
 }
 function begin(){
  need(mode==='NEW','session_reused');mode='INDETERMINATE';
  stageEnvironment(root);
  need(absent(mapped(root,candidate.ROOT))&&absent(undo)&&absent(wal),
   'preexisting_staged_or_journal');
  writeExclusive(root,lock,lockContent);
  writeExclusive(root,wal,Buffer.from(JSON.stringify(record(proposal,'header',-1,
   '0'.repeat(64)))+'\n'));
  const state=existing();
  need(state.completed===0&&state.pending===null,'bad_initial_wal');
  mode='ACTIVE';
  return state;
 }
 function step(i,{afterIntent,afterPhysical}={}){
  need(mode==='ACTIVE','stage_not_active');
  const before=existing();
  need(Number.isInteger(i)&&i===before.completed&&before.pending===null&&
   i<proposal.operations.length,'wrong_next_operation');
  mode='INDETERMINATE';
  const op=proposal.operations[i],file=mapped(root,op.path);
  append(root,wal,record(proposal,'intent',i,before.last));
  if(typeof afterIntent==='function')afterIntent(i);
  secureDir(root,path.dirname(file));
  if(op.kind==='mkdir'){
   fs.mkdirSync(file,{mode:0o700});
   syncDir(root,path.dirname(file));
   secureDir(root,file);
  }else{
   need(op.kind==='file','unexpected_kind');
   writeExclusive(root,file,proposal.payload[op.path]);
   need(sha(read(root,file))===op.sha256,'stage_postcondition_drift');
  }
  if(typeof afterPhysical==='function')afterPhysical(i);
  const now=existing();
  need(now.pending===i&&now.completed===i,'wal_pending_changed');
  append(root,wal,record(proposal,'done',i,now.last));
  const after=existing();
  need(after.completed===i+1&&after.pending===null,'wal_done_drift');
  mode='ACTIVE';
  return after;
 }
 function previewRecovery(){
  jail(root);
  const progress=existing();
  need(progress.completed>0&&progress.pending===null&&absent(undo),
   'incomplete_forward_wal_or_existing_undo');
  const used=proposal.operations.slice(0,progress.completed);
  const present=new Set(used.map(x=>x.path));
  for(const op of proposal.operations){
   const file=mapped(root,op.path);
   if(!present.has(op.path))need(absent(file),'unrecorded_file_or_directory');
   else if(op.kind==='mkdir')secureDir(root,file);
   else {
    const b=read(root,file);
    need(sha(b)===op.sha256&&blob(b)===op.git_blob_sha1,
     'stage_bytes_or_git_drift');
   }
  }
  for(const op of used.filter(x=>x.kind==='mkdir')){
   const dir=mapped(root,op.path);
   for(const name of fs.readdirSync(dir)){
    need(present.has(op.path+'/'+name),'foreign_staged_child');
   }
  }
  return Object.freeze({completed:progress.completed,wal_hash:progress.last,
   reversed:Object.freeze([...used].reverse()),approved:false});
 }
 function rollback({afterIntent,afterPhysical}={}){
  need(mode!=='ROLLBACK_USED','undo_already_attempted');
  mode='ROLLBACK_USED';
  const pre=previewRecovery(),steps=pre.reversed;
  const rows=[{kind:'start',request_id:proposal.requestId,
   identity_sha256:proposal.identity_sha256,forward_wal_hash:pre.wal_hash,
   steps:steps.length,production:false}];
  writeExclusive(root,undo,Buffer.from(JSON.stringify(rows[0])+'\n'));
  for(let i=0;i<steps.length;i++){
   const op=steps[i],file=mapped(root,op.path);
   const progress=existing();
   need(progress.pending===null&&progress.completed===pre.completed&&
    progress.last===pre.wal_hash,'forward_wal_changed_during_undo');
   if(op.kind==='file'){
    const b=read(root,file);
    need(sha(b)===op.sha256&&blob(b)===op.git_blob_sha1,
      'recovery_target_changed');
   }else{
    secureDir(root,file);
    need(fs.readdirSync(file).length===0,'recovery_directory_nonempty');
   }
   append(root,undo,{kind:'intent',index:i,path:op.path});
   if(typeof afterIntent==='function')afterIntent(i);
   if(op.kind==='file')fs.unlinkSync(file);
   else fs.rmdirSync(file);
   syncDir(root,path.dirname(file));
   if(typeof afterPhysical==='function')afterPhysical(i);
   need(absent(file),'rollback_postcondition');
   append(root,undo,{kind:'done',index:i,path:op.path});
  }
  for(const op of proposal.operations)
   need(absent(mapped(root,op.path)),'rollback_incomplete');
  existing(); // lock and forward WAL evidence preserved
  append(root,undo,{kind:'complete',count:steps.length,
   request_id:proposal.requestId,forward_wal_preserved:true,
   lock_preserved:true});
  return Object.freeze({
   result:'LAB_36_ROLLBACK_VERIFIED',reversed:steps.length,
   lock_preserved:true,forward_wal_preserved:true,
   production_changed:false,signed_approval_consumed:false
  });
 }
 return Object.freeze({begin,step,inspect:existing,previewRecovery,rollback,
  count:proposal.operations.length,production_install_enabled:false});
}
module.exports=Object.freeze({
 PREFIX,BASE,LOCK,FORWARD,UNDO,jail,mapped,stageEnvironment,
 proposalFor,createLab
});
