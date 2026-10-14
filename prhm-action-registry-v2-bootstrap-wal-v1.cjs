'use strict';
/**
 * Fixed Honartik V2 root-bootstrap write-ahead journal contract.
 *
 * SOURCE ONLY / deliberately non-executable: real Production fs is explicitly
 * refused by the synthetic writer. A separately signed root launcher, bounded
 * real-I/O adapter, O_EXCL owner lock, Ed25519 verification and durable one-time
 * approval route are still REQUIRED before Production staging.
 *
 * Journal order: header fsync, intent fsync, physical operation (external),
 * completion fsync. Any unmatched intent or torn/tampered write is INDETERMINATE,
 * never eligible for replay or automatic cleanup.
 */
const fs=require('node:fs');
const crypto=require('node:crypto');
const plan=require('./prhm-action-registry-v2-bootstrap-transaction-plan-v1.cjs');
const JPATH=plan.JPATH;
const PARENT='/var/lib/prhm-agent-selfmaint-exec';
const ZERO='0'.repeat(64);
const HEX=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX=120000;
function fail(code){throw Error('registry_v2_bootstrap_wal_'+code)}
function check(ok,code){if(!ok)fail(code)}
function exact(x,fields,code){
 check(x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join('|')===fields.slice().sort().join('|'),code);
}
function sha(bytes){return crypto.createHash('sha256').update(bytes).digest('hex')}
function digestProposal(proposal){
 const p=plan.immutablePlan();
 check(proposal?.schema==='prhm.registry-v2.bootstrap-proposal.v1'&&
 UUID.test(proposal?.request_id||'')&&
 proposal.source_commit===p.release_source_commit&&
 proposal.manifest_commit===p.release_manifest_commit&&
 proposal.manifest_sha256===p.release_manifest_sha256&&
 proposal.arguments_sha256===p.approval_arguments_sha256&&
 proposal.journal_path===JPATH&&
 proposal.phase==='PROPOSAL_NOT_AUTHORIZED'&&
 proposal.approved===false&&proposal.consumed===false&&
 proposal.mutated===false&&proposal.independent_root_launcher_required===true&&
 proposal.rollback_requires_original_request_and_review===true,
 'proposal_identity_invalid');
 check(Array.isArray(proposal.operations)&&
 proposal.operations.length===proposal.operation_count&&
 proposal.operation_count>=20&&proposal.operation_count<=30,
 'operation_count_invalid');
 // Canonical policy order and file destinations cannot be caller supplied.
 const f=proposal.operations.filter(x=>x.kind==='create_file');
 const d=proposal.operations.filter(x=>x.kind==='mkdir');
 check(f.length===20&&d.length<=10&&d.length+f.length===proposal.operation_count,
 'operation_set_invalid');
 for(let i=0;i<20;i++){
   const a=f[i],pinned=p.files[i];
   exact(a,['kind','path','sha256','git_blob_sha1','uid','gid','mode'],
     'untrusted_file_step');
   check(a.path===pinned.path&&a.git_blob_sha1===pinned.git_blob_sha1&&
     HEX.test(a.sha256)&&a.uid===0&&a.gid===0&&a.mode===0o600,
     'file_step_drift');
 }
 const dirs=new Set(p.dirs.map(x=>x.path)),seen=new Set();
 for(const entry of d){
   exact(entry,['kind','path','uid','gid','mode'],'untrusted_dir_step');
   check(dirs.has(entry.path)&&!seen.has(entry.path)&&
     entry.uid===0&&entry.gid===0&&entry.mode===0o700,
     'directory_step_drift');
   seen.add(entry.path);
 }
 check(d.every((entry,i)=>proposal.operations[i]===entry)&&
 f.every((entry,i)=>proposal.operations[i+d.length]===entry),
 'operation_order_invalid');
 check(Array.isArray(proposal.existing_directory_paths)&&
 new Set(proposal.existing_directory_paths).size===proposal.existing_directory_paths.length&&
 proposal.existing_directory_paths.length+d.length===p.dirs.length&&
 proposal.existing_directory_paths.every(x=>dirs.has(x)&&!seen.has(x)),
 'directory_partition_invalid');
 exact(proposal,[
  'schema','request_id','source_commit','manifest_commit','manifest_sha256',
  'arguments_sha256','journal_path','phase','approved','consumed','mutated',
  'independent_root_launcher_required','operation_count','operations',
  'existing_directory_paths','rollback_requires_original_request_and_review'
 ],'proposal_shape_invalid');
 // Never let JSON.stringify silently serialize undefined, functions or NaN.
 const bytes=JSON.stringify(proposal);
 check(typeof bytes==='string'&&Buffer.byteLength(bytes)<=60000&&
 JSON.stringify(JSON.parse(bytes))===bytes,'proposal_non_json_value');
 return sha(Buffer.from(bytes));
}
function stepDigest(op){
 check(op&&typeof op==='object','step_invalid');
 const b=JSON.stringify(op);
 check(typeof b==='string'&&JSON.stringify(JSON.parse(b))===b,'step_not_json');
 return sha(Buffer.from(b));
}
function makeRecord(kind,index,step,previous,proposal){
 check(['header','intent','done'].includes(kind),'kind_not_allowlisted');
 check(HEX.test(previous),'previous_hash_invalid');
 check(kind==='header'?index===-1:Number.isSafeInteger(index)&&index>=0&&
 index<proposal.operation_count,'index_invalid');
 const record={
  schema:'prhm.registry-v2.bootstrap-wal-record.v1',
  kind,index,
  request_id:proposal.request_id,
  proposal_sha256:digestProposal(proposal),
  step_sha256:kind==='header'?null:stepDigest(step),
  previous_sha256:previous
 };
 return Object.freeze({...record,record_sha256:sha(Buffer.from(JSON.stringify(record)))});
}
function scan(bytes,proposal){
 const proposalSha=digestProposal(proposal);
 check(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=MAX,
   'journal_size_invalid');
 check(bytes[bytes.length-1]===10,'torn_or_unterminated_journal');
 let rows;
 try{
  const str=bytes.toString('utf8');
  check(Buffer.from(str).equals(bytes),'non_utf8_bytes');
  rows=str.trimEnd().split('\n').map(x=>JSON.parse(x));
 }catch(e){fail('journal_not_valid_utf8_json')}
 check(rows.length>=1&&rows.length<=61,'journal_row_count_invalid');
 let prev=ZERO,completed=0,pending=null;
 for(let i=0;i<rows.length;i++){
  const r=rows[i];
  exact(r,['schema','kind','index','request_id','proposal_sha256',
    'step_sha256','previous_sha256','record_sha256'],'journal_fields_invalid');
  check(r.schema==='prhm.registry-v2.bootstrap-wal-record.v1'&&
    r.request_id===proposal.request_id&&
    r.proposal_sha256===proposalSha&&r.previous_sha256===prev,
    'journal_binding_or_chain_invalid');
  const core={schema:r.schema,kind:r.kind,index:r.index,
    request_id:r.request_id,proposal_sha256:r.proposal_sha256,
    step_sha256:r.step_sha256,previous_sha256:r.previous_sha256};
  check(HEX.test(r.record_sha256)&&
    sha(Buffer.from(JSON.stringify(core)))===r.record_sha256,
    'journal_digest_invalid');
  if(i===0){
   check(r.kind==='header'&&r.index===-1&&r.step_sha256===null,
      'journal_header_invalid');
  }else if(r.kind==='intent'){
   check(pending===null&&r.index===completed&&
    r.index<proposal.operation_count&&
    r.step_sha256===stepDigest(proposal.operations[r.index]),
    'intent_order_or_step_invalid');
   pending=r.index;
  }else if(r.kind==='done'){
   check(pending!==null&&r.index===pending&&
    r.step_sha256===stepDigest(proposal.operations[r.index]),
    'done_without_durable_intent');
   completed++;pending=null;
  }else fail('duplicate_header_or_kind');
  prev=r.record_sha256;
 }
 return Object.freeze({
  schema:'prhm.registry-v2.bootstrap-wal-inspection.v1',
  request_id:proposal.request_id,completed,
  total:proposal.operation_count,
  pending,
  safe_to_resume:false,
  // Even a fully completed journal is evidence, not installer authorization.
  ready_for_external_review:pending===null,
  indeterminate:pending!==null,
  last_sha256:prev,authorization:false,production_mutation:false
 });
}
function checkParent(io){
 const st=io.lstatSync(PARENT);
 check(st.isDirectory()&&!st.isSymbolicLink()&&
  io.realpathSync(PARENT)===PARENT&&st.uid===0&&st.gid===0&&
  (st.mode&0o777)===0o700,'journal_parent_not_root_private');
 return st;
}
function writeFull(io,fd,bytes){
 check(typeof io.writeSync==='function'&&typeof io.fsyncSync==='function',
  'writer_missing');
 check(io.writeSync(fd,bytes,0,bytes.length)===bytes.length,
  'short_write_unknown_state');
 io.fsyncSync(fd);
}
function syncParent(io){
 const fd=io.openSync(PARENT,fs.constants.O_RDONLY|
  fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
 try{
  const st=io.fstatSync(fd);
  check(st.isDirectory()&&st.uid===0&&st.gid===0,'parent_fd_unsafe');
  io.fsyncSync(fd);
 }finally{io.closeSync(fd)}
}
/**
 * Test-only I/O implementation (a supplied synthetic IO object).
 * Production fs is unconditionally rejected; this deliberately does NOT
 * implement the root executable / signed authority. The caller must not
 * mistake a successful CI simulation for an installed journal writer.
 */
function createSyntheticWriter({io,proposal}={}){
 check(io&&io!==fs&&typeof io.openSync==='function'&&
  typeof io.readFileSync==='function'&&typeof io.fstatSync==='function',
  'production_writer_not_authorized');
 const digest=digestProposal(proposal);
 let started=false;
 function load(){
  const parent=checkParent(io);
  const st=io.lstatSync(JPATH);
  check(st.isFile()&&!st.isSymbolicLink()&&st.uid===0&&st.gid===0&&
    (st.mode&0o777)===0o600&&st.size<=MAX&&st.size>0&&
    io.realpathSync(JPATH)===JPATH,'journal_file_unsafe');
  const fd=io.openSync(JPATH,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  let bytes;
  try{
   const post=io.fstatSync(fd);
   check(post.isFile()&&post.ino===st.ino&&post.dev===st.dev&&
    post.uid===st.uid&&post.gid===st.gid&&post.mode===st.mode&&
    post.size===st.size,'journal_file_race');
   bytes=io.readFileSync(fd);
  }finally{io.closeSync(fd)}
  check(Buffer.isBuffer(bytes)&&bytes.length===st.size,
    'journal_short_read');
  check(parent.ino===checkParent(io).ino&&
    parent.dev===checkParent(io).dev,'journal_parent_swapped');
  return {bytes,progress:scan(bytes,proposal)};
 }
 function append(rec){
  const current=load();
  check(current.progress.pending===null||
    rec.kind==='done','pending_intent_must_resolve');
  check(rec.previous_sha256===current.progress.last_sha256,
    'last_record_drift');
  const bytes=Buffer.from(JSON.stringify(rec)+'\n');
  const fd=io.openSync(JPATH,fs.constants.O_WRONLY|
    fs.constants.O_APPEND|fs.constants.O_NOFOLLOW);
  try{
   const st=io.fstatSync(fd);
   check(st.isFile()&&st.uid===0&&st.gid===0&&
     (st.mode&0o777)===0o600&&st.size===current.bytes.length,
     'append_concurrent_or_metadata_drift');
   writeFull(io,fd,bytes);
  }finally{io.closeSync(fd)}
  syncParent(io);
  return load().progress;
 }
 function begin(){
  check(!started,'session_already_started');
  checkParent(io);
  const rec=makeRecord('header',-1,null,ZERO,proposal);
  const bytes=Buffer.from(JSON.stringify(rec)+'\n');
  const fd=io.openSync(JPATH,fs.constants.O_WRONLY|
    fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{
   writeFull(io,fd,bytes);
   const st=io.fstatSync(fd);
   check(st.isFile()&&st.uid===0&&st.gid===0&&
     (st.mode&0o777)===0o600&&st.size===bytes.length,
     'journal_create_metadata_invalid');
  }finally{io.closeSync(fd)}
  syncParent(io);
  started=true;
  return load().progress;
 }
 function intent(index){
  check(started,'durable_header_required');
  const p=load().progress;
  check(p.pending===null&&p.completed===index&&
    index<proposal.operation_count,'intent_not_next_step');
  return append(makeRecord('intent',index,proposal.operations[index],
    p.last_sha256,proposal));
 }
 function done(index){
  check(started,'durable_header_required');
  const p=load().progress;
  check(p.pending===index&&index===p.completed,'uncommitted_intent_missing');
  return append(makeRecord('done',index,proposal.operations[index],
    p.last_sha256,proposal));
 }
 return Object.freeze({begin,intent,done,inspect:()=>load().progress});
}
module.exports=Object.freeze({JPATH,PARENT,ZERO,MAX,digestProposal,
 makeRecord,scan,createSyntheticWriter});
