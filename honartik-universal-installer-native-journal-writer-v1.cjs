'use strict';
/**
 * Issue #217 SOURCE-ONLY fixed native Journal producer. No executable CLI,
 * no Host Actions registration, no Approval Center token consumption,
 * no real installer apply/commit export. Production PREPARED writer is root
 * gated and pinned to an exact approved policy; this policy is NOT live yet.
 *
 * The Linux nonroot fixture writer shares the exact on-disk v1 record/lock
 * serialization. Failures never silently clear a reserved lease or journal.
 */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {CONTRACT}=require('./honartik-universal-installer-l4-v1.cjs');
const {ARGUMENTS_SHA,PINNED_POLICY_SHA}=
  require('./honartik-universal-installer-native-approval-gate-v1.cjs');
const {readTree}=require('./honartik-universal-installer-native-fs-v1.cjs');
const I=require('./honartik-universal-installer-native-journal-inspector-v1.cjs');
const FENCE='/var/lib/prhm-agent-selfmaint-exec/honartik-universal-installer-l4';
const POLICY='/opt/prhm-company-control-plane/config/approval-policy.json';
const SHA=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEASE_SCHEMA='prhm.honartik217.fixed-native-installer-lease.v1';
const fail=s=>{throw Error('honartik217_journal_writer_'+s)};
const need=(x,s)=>{if(!x)fail(s)};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');

function syncDir(dir){
  const fd=fs.openSync(dir,fs.constants.O_RDONLY|
    fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
  try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
function parentCheck(p,owner){
  let d=path.dirname(p);
  while(true){
    const s=fs.lstatSync(d);
    const owned=s.uid===owner&&(s.mode&0o022)===0;
    const fixtureParent=owner!==0&&s.uid===0&&(
      (d===os.tmpdir()&&(s.mode&0o1777)===0o1777)||
      (d==='/'&&(s.mode&0o022)===0));
    need(s.isDirectory()&&!s.isSymbolicLink()&&
      (owned||fixtureParent),'parent_untrusted');
    if(d==='/')break;d=path.dirname(d);
  }
}
function readOwnedFile(file,owner,allowedModes,max=131072){
  parentCheck(file,owner);
  const st=fs.lstatSync(file);
  need(st.isFile()&&!st.isSymbolicLink()&&st.uid===owner&&st.nlink===1&&
    allowedModes.includes(st.mode&0o777)&&st.size>0&&st.size<=max,
    'source_file_untrusted');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    const chk=fs.fstatSync(fd);
    need(chk.ino===st.ino&&chk.dev===st.dev&&chk.uid===st.uid&&
      chk.mode===st.mode&&chk.size===st.size,'source_file_race');
    const bytes=fs.readFileSync(fd);
    need(bytes.length===st.size,'source_file_short');
    return {bytes,mode:st.mode&0o777};
  }finally{fs.closeSync(fd)}
}
function ownedDirectory(dir,owner){
  parentCheck(dir,owner);
  const st=fs.lstatSync(dir);
  need(st.isDirectory()&&!st.isSymbolicLink()&&
    st.uid===owner&&(st.mode&0o777)===0o700,'directory_untrusted');
}
function treeOwned(root,owner){
  const top=fs.lstatSync(root);
  need(top.isDirectory()&&!top.isSymbolicLink()&&top.uid===owner&&
    (top.mode&0o022)===0,'bundle_directory_untrusted');
  function walk(dir){
    for(const d of fs.readdirSync(dir,{withFileTypes:true})){
      const abs=path.join(dir,d.name),st=fs.lstatSync(abs);
      need(st.uid===owner&&(st.mode&0o022)===0&&!st.isSymbolicLink(),
        'bundle_owner_or_symlink');
      if(st.isDirectory())walk(abs);
      else need(st.isFile()&&st.nlink===1,'bundle_special_file');
    }
  }
  walk(root);
  return readTree(root).digest;
}
function preimage(prefix,owner,old,next,entrypoint,verifyNext){
  parentCheck(path.join(prefix,'current'),owner);
  const link=fs.lstatSync(path.join(prefix,'current'));
  need(link.isSymbolicLink()&&link.uid===owner,'current_pointer_untrusted');
  const resolved=fs.realpathSync(path.join(prefix,'current'));
  const oldPath=path.join(prefix,'versions',old);
  need(resolved===oldPath,'preimage_pointer_drift');
  need(treeOwned(oldPath,owner)===old,'preimage_bundle_drift');
  if(verifyNext){
    need(treeOwned(path.join(prefix,'versions',next),owner)===next,
      'candidate_bundle_drift');
  }
  const manifest=readOwnedFile(path.join(prefix,'installation.json'),
    owner,[0o600,0o644]);
  const wrapper=readOwnedFile(path.join(prefix,'deploy-project'),
    owner,[0o700,0o744,0o755]);
  let parsed;
  try{parsed=JSON.parse(manifest.bytes)}catch{fail('preimage_manifest_json')}
  need(parsed.digest===old&&parsed.entrypoint===entrypoint,
    'preimage_manifest_mismatch');
  return {manifest,wrapper};
}
function atomicWriteExclusive(file,bytes){
  const dir=path.dirname(file),stage=path.join(dir,'.honartik217-'+crypto.randomUUID());
  // Never replace an existing journal: preserve previous approval and history.
  need(!fs.existsSync(file),'prior_journal_denied');
  const fd=fs.openSync(stage,fs.constants.O_WRONLY|fs.constants.O_CREAT|
    fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{
    need(fs.writeSync(fd,bytes,0,bytes.length)===bytes.length,'short_write');
    fs.fsyncSync(fd);
  }finally{fs.closeSync(fd)}
  // Producer is single owner of O_EXCL durable lock; an unexpected file
  // appearing here must stop, not overwrite or auto-repair it.
  need(!fs.existsSync(file),'prior_journal_race');
  fs.renameSync(stage,file);syncDir(dir);
}
function createLease(fence,owner,leaseId){
  const file=path.join(fence,I.LOCK);
  const contents=Buffer.from(JSON.stringify({
    schema:LEASE_SCHEMA,lease_id:leaseId})+'\n');
  const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|
    fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{
    const st=fs.fstatSync(fd);
    need(st.uid===owner&&(st.mode&0o777)===0o600&&
      st.isFile()&&st.nlink===1,'lease_untrusted');
    need(fs.writeSync(fd,contents,0,contents.length)===contents.length,
      'lease_short_write');
    fs.fsyncSync(fd);
  }finally{fs.closeSync(fd)}
  syncDir(fence);
}
function prepare({fence,prefix,owner,old,next,entrypoint,verifyNext,
  crash=null}){
  need(SHA.test(old)&&SHA.test(next)&&old!==next,'digest_invalid');
  ownedDirectory(fence,owner);
  ownedDirectory(prefix,owner);
  // Immutable preimage must be byte verified BEFORE grabbing the lease.
  const before=preimage(prefix,owner,old,next,entrypoint,verifyNext);
  need(!fs.existsSync(path.join(fence,I.JOURNAL)),
    'old_journal_requires_reconciliation');
  const journalId=crypto.randomUUID(),leaseId=crypto.randomUUID();
  createLease(fence,owner,leaseId);
  // Crash after fsynced lease is ambiguous; it must remain on disk.
  if(crash==='after_lease')process.exit(95);
  const record={
    schema:I.SCHEMA,action:CONTRACT.action,operation:CONTRACT.operation,
    state:'PREPARED',journal_id:journalId,lease_id:leaseId,
    old_digest:old,next_digest:next,
    policy_sha256:PINNED_POLICY_SHA,arguments_sha256:ARGUMENTS_SHA,
    request_id:null,approval_id:null,
    preimage_manifest_b64:before.manifest.bytes.toString('base64'),
    preimage_manifest_sha256:sha(before.manifest.bytes),
    preimage_manifest_mode:before.manifest.mode,
    preimage_wrapper_b64:before.wrapper.bytes.toString('base64'),
    preimage_wrapper_sha256:sha(before.wrapper.bytes),
    preimage_wrapper_mode:before.wrapper.mode,
    post_manifest_sha256:null,post_wrapper_sha256:null,
    post_manifest_mode:null,post_wrapper_mode:null,record_sha256:null
  };
  atomicWriteExclusive(path.join(fence,I.JOURNAL),
    I.serializeForFixture(record));
  if(crash==='after_journal')process.exit(96);
  // The root writer MUST demand a readback from the independent inspector.
  const result=owner===0?
    I.inspectFixedNativeJournalState(journalId):
    I.inspectIsolatedJournalFixture(fence,journalId,old,next);
  need(result==='PREPARED','prepared_not_durable');
  return Object.freeze({id:journalId,lease_id:leaseId,state:'PREPARED',
    approved:false,installed:false});
}
function prepareFixedRootJournal(){
  need(typeof process.getuid==='function'&&process.getuid()===0,
    'root_required');
  // Fail closed unless policy is already reconciled by separate authorized
  // Root-of-Trust. The installed policy currently does NOT match this SHA.
  const policy=readOwnedFile(POLICY,0,[0o600,0o640,0o644],131072);
  need(sha(policy.bytes)===PINNED_POLICY_SHA,'live_policy_unreconciled');
  return prepare({fence:FENCE,prefix:CONTRACT.installer_prefix,owner:0,
    old:CONTRACT.existing_digest,next:CONTRACT.candidate_digest,
    entrypoint:CONTRACT.installer_prefix+'/deploy-project',verifyNext:false});
}
function prepareIsolatedJournalFixture(root,next,crash=null){
  need(typeof process.getuid==='function'&&process.getuid()!==0,
    'fixture_must_be_nonroot');
  need(typeof root==='string'&&path.dirname(root)===os.tmpdir()&&
    path.basename(root).startsWith('prhm-honartik217-journal-inspect-fixture-'),
    'fixture_path_denied');
  const owner=process.getuid();
  ownedDirectory(root,owner);
  const link=fs.realpathSync(path.join(root,'current'));
  const old=path.basename(link);
  return prepare({fence:root,prefix:root,owner,old,next,
    entrypoint:'fixture-only',verifyNext:true,crash});
}
module.exports=Object.freeze({
 prepareFixedRootJournal,prepareIsolatedJournalFixture,
 ROOT_ACTION_REGISTERED:false,INSTALLER_MUTATION_EXPORTED:false,
 LIVE_APPROVAL_CONSUMPTION:false
});
