'use strict';
/**
 * Issue #217 — SOURCE-ONLY read-only durable journal inspector.
 * NO root registration, mutator, installer, approval consumer, CLI, or dynamic
 * production path. A separately reviewed trusted native root executor must
 * own/fsync/create this exact schema and reconcile unresolved transactions.
 */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {CONTRACT}=require('./honartik-universal-installer-l4-v1.cjs');
const {ARGUMENTS_SHA,PINNED_POLICY_SHA}=
  require('./honartik-universal-installer-native-approval-gate-v1.cjs');
const {readTree}=require('./honartik-universal-installer-native-fs-v1.cjs');

const FENCE='/var/lib/prhm-agent-selfmaint-exec/honartik-universal-installer-l4';
const JOURNAL='installer-transaction.journal.json';
const LOCK='installer-transaction.lock';
const SCHEMA='prhm.honartik217.fixed-native-installer-journal.v1';
const SHA=/^[a-f0-9]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=s=>{throw Error('honartik217_journal_inspect_'+s)};
const need=(ok,s)=>{if(!ok)fail(s)};
const hex=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const KEYS=Object.freeze([
  'schema','action','operation','state','journal_id','lease_id','old_digest',
  'next_digest','policy_sha256','arguments_sha256','request_id','approval_id',
  'preimage_manifest_b64','preimage_manifest_sha256','preimage_manifest_mode',
  'preimage_wrapper_b64','preimage_wrapper_sha256','preimage_wrapper_mode',
  'post_manifest_sha256','post_wrapper_sha256','record_sha256'
]);
function canonical(v){
  if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
  if(v&&typeof v==='object'){
    return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
  }
  return JSON.stringify(v);
}
function serializeForFixture(record){
  // Canonical encoding is specified for the future native journal producer.
  // Export is a nonprivileged test encoder only; it cannot create live records.
  const {record_sha256,...unsigned}=record;
  return Buffer.from(canonical({...unsigned,record_sha256:hex(Buffer.from(canonical(unsigned)+'\n'))})+'\n');
}
function exactKeys(obj,expected){
  return obj&&typeof obj==='object'&&!Array.isArray(obj)&&
    Object.keys(obj).sort().join('|')===expected.slice().sort().join('|');
}
function strictBase64(s,max=131072){
  need(typeof s==='string'&&s.length>0&&s.length<=max*2&&
    /^[a-zA-Z0-9+/]+={0,2}$/.test(s),'base64_shape');
  const b=Buffer.from(s,'base64');
  need(b.length>0&&b.length<=max&&b.toString('base64')===s,'base64_noncanonical');
  return b;
}
function parse(bytes,expectedId,entrypoint,oldExpected,nextExpected){
  need(Buffer.isBuffer(bytes)&&bytes.length>=300&&bytes.length<=512000,'record_size');
  let record;
  try{record=JSON.parse(bytes.toString('utf8'))}catch{fail('record_json')}
  need(exactKeys(record,KEYS),'record_fields');
  const {record_sha256,...unsigned}=record;
  need(SHA.test(record_sha256)&&
    record_sha256===hex(Buffer.from(canonical(unsigned)+'\n'))&&
    bytes.equals(Buffer.from(canonical(record)+'\n')),'journal_sha_or_noncanonical');
  need(record.schema===SCHEMA&&
    record.action===CONTRACT.action&&record.operation===CONTRACT.operation&&
    record.policy_sha256===PINNED_POLICY_SHA&&
    record.arguments_sha256===ARGUMENTS_SHA&&
    UUID.test(record.journal_id)&&record.journal_id===expectedId&&
    UUID.test(record.lease_id)&&
    SHA.test(record.old_digest)&&record.old_digest===oldExpected&&
    SHA.test(record.next_digest)&&record.next_digest===nextExpected&&
    ['PREPARED','COMMITTED','ROLLED_BACK'].includes(record.state),
    'journal_scope_drift');
  const m=strictBase64(record.preimage_manifest_b64);
  const w=strictBase64(record.preimage_wrapper_b64);
  need(hex(m)===record.preimage_manifest_sha256&&
    hex(w)===record.preimage_wrapper_sha256,'preimage_hash_drift');
  for(const key of ['preimage_manifest_mode','preimage_wrapper_mode']){
    need(Number.isInteger(record[key])&&record[key]>=0o400&&
      record[key]<=0o755&&(record[key]&0o022)===0,'preimage_mode_unsafe');
  }
  let prior;
  try{prior=JSON.parse(m.toString('utf8'))}catch{fail('preimage_manifest_json')}
  need(prior.digest===record.old_digest&&
    prior.entrypoint===entrypoint,'preimage_manifest_wrong');
  if(record.state==='COMMITTED'){
    need(UUID.test(record.request_id)&&UUID.test(record.approval_id)&&
      SHA.test(record.post_manifest_sha256)&&
      SHA.test(record.post_wrapper_sha256),'committed_proof_incomplete');
  }else{
    need(record.post_manifest_sha256===null&&record.post_wrapper_sha256===null,
      'not_committed_postimage_present');
    need((record.request_id===null&&record.approval_id===null)||
      (UUID.test(record.request_id)&&UUID.test(record.approval_id)),
      'approval_pair_invalid');
  }
  return Object.freeze({record,preManifest:m,preWrapper:w});
}
function verifyParentChain(filename,owner){
  let d=path.dirname(filename);
  while(true){
    const s=fs.lstatSync(d);
    const owned=s.uid===owner&&(s.mode&0o022)===0;
    // Nonroot fixtures are directly beneath the root-owned sticky /tmp.
    // Production (owner=0) accepts only root-owned non-writable ancestors.
    const fixtureAncestor=owner!==0&&s.uid===0&&(
      (d===os.tmpdir()&&(s.mode&0o1777)===0o1777)||
      (d==='/'&&(s.mode&0o022)===0));
    need(s.isDirectory()&&!s.isSymbolicLink()&&
      (owned||fixtureAncestor),'untrusted_parent');
    if(d==='/')break;
    d=path.dirname(d);
  }
}
function readSecureFile(filename,owner,{max=512000,mode=0o600}={}){
  verifyParentChain(filename,owner);
  const pre=fs.lstatSync(filename);
  need(pre.isFile()&&!pre.isSymbolicLink()&&pre.uid===owner&&
    (pre.mode&0o777)===mode&&pre.nlink===1&&pre.size>0&&
    pre.size<=max,'untrusted_file');
  const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    const st=fs.fstatSync(fd);
    need(st.dev===pre.dev&&st.ino===pre.ino&&st.mode===pre.mode&&
      st.uid===owner&&st.nlink===1&&st.size===pre.size,'file_race');
    const bytes=fs.readFileSync(fd);
    need(bytes.length===st.size,'file_short_read');
    return bytes;
  }finally{fs.closeSync(fd)}
}
function assertLock(filename,owner){
  verifyParentChain(filename,owner);
  const st=fs.lstatSync(filename);
  need(st.isFile()&&!st.isSymbolicLink()&&st.uid===owner&&
    (st.mode&0o777)===0o600&&st.nlink===1,
    'untrusted_lock');
}
function assertRootOwner(filename,owner){
  verifyParentChain(filename,owner);
  const s=fs.lstatSync(filename);
  need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===owner&&
    (s.mode&0o777)===0o700,'journal_directory_untrusted');
}
function stateFromDisk(opts,id){
  const {fence,prefix,owner,entrypoint,oldExpected,nextExpected}=opts;
  assertRootOwner(fence,owner);
  // All ambiguous source-coordinator paths must retain an exclusive lock.
  // Refuse a missing/forged lock; do not infer safe state without it.
  assertLock(path.join(fence,LOCK),owner);
  const bytes=readSecureFile(path.join(fence,JOURNAL),owner);
  const {record,preManifest,preWrapper}=parse(bytes,id,entrypoint,oldExpected,nextExpected);
  const versions=path.join(prefix,'versions');
  const oldDir=path.join(versions,record.old_digest);
  const current=path.join(prefix,'current');
  const ptr=fs.lstatSync(current);
  need(ptr.isSymbolicLink()&&ptr.uid===owner,'pointer_untrusted');
  const target=fs.realpathSync(current);
  need(target===oldDir||target===path.join(versions,record.next_digest),
    'third_party_pointer');
  need(readTree(oldDir).digest===record.old_digest,'old_bundle_tampered');
  if(target!==oldDir){
    need(readTree(target).digest===record.next_digest,'new_bundle_tampered');
  }
  if(record.state==='COMMITTED'){
    need(target===path.join(versions,record.next_digest),
      'committed_pointer_drift');
    const manifest=readSecureFile(path.join(prefix,'installation.json'),owner,
      {max:131072});
    const wrapper=readSecureFile(path.join(prefix,'deploy-project'),owner,
      {max:131072,mode:0o700});
    let json;
    try{json=JSON.parse(manifest.toString('utf8'))}catch{fail('post_manifest_json')}
    need(hex(manifest)===record.post_manifest_sha256&&
      hex(wrapper)===record.post_wrapper_sha256&&
      json.digest===record.next_digest&&json.previous===record.old_digest&&
      json.entrypoint===entrypoint,'committed_postimage_drift');
  }else if(record.state==='ROLLED_BACK'){
    need(target===oldDir,'rolled_back_pointer_drift');
    const currentManifest=readSecureFile(path.join(prefix,'installation.json'),owner,
      {max:131072,mode:record.preimage_manifest_mode});
    const currentWrapper=readSecureFile(path.join(prefix,'deploy-project'),owner,
      {max:131072,mode:record.preimage_wrapper_mode});
    need(currentManifest.equals(preManifest)&&currentWrapper.equals(preWrapper),
      'rolled_back_preimage_drift');
    // Never decide to rollback an already ROLLED_BACK journal.
  }
  return record.state;
}
function inspectFixedNativeJournalState(id){
  need(typeof process.getuid==='function'&&process.getuid()===0,'root_required');
  need(typeof id==='string'&&UUID.test(id),'journal_id_invalid');
  // Future root adapter must reconcile installed live policy against PR #15
  // before invoking this reader; this reader alone is never authorization.
  return stateFromDisk({
    fence:FENCE,prefix:CONTRACT.installer_prefix,
    owner:0,entrypoint:CONTRACT.installer_prefix+'/deploy-project',
    oldExpected:CONTRACT.existing_digest,nextExpected:CONTRACT.candidate_digest
  },id);
}
function inspectIsolatedJournalFixture(dir,id,oldExpected,nextExpected){
  need(typeof process.getuid==='function'&&process.getuid()!==0,
    'fixture_nonroot_required');
  need(typeof dir==='string'&&path.dirname(dir)===os.tmpdir()&&
    path.basename(dir).startsWith('prhm-honartik217-journal-inspect-fixture-'),
    'fixture_path_denied');
  const stat=fs.lstatSync(dir);
  need(stat.isDirectory()&&!stat.isSymbolicLink()&&
    (stat.mode&0o777)===0o700&&stat.uid===process.getuid(),
    'fixture_owner');
  need(UUID.test(id)&&SHA.test(oldExpected)&&SHA.test(nextExpected)&&
    oldExpected!==nextExpected,'fixture_identity_invalid');
  return stateFromDisk({
    fence:dir,prefix:dir,owner:process.getuid(),
    entrypoint:'fixture-only',oldExpected,nextExpected
  },id);
}
module.exports=Object.freeze({
  inspectFixedNativeJournalState,inspectIsolatedJournalFixture,
  serializeForFixture,SCHEMA,JOURNAL,LOCK,
  ROOT_ACTION_REGISTERED:false,PRODUCTION_APPLY_PRESENT:false
});
