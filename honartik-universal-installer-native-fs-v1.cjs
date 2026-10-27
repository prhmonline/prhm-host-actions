'use strict';
/**
 * Issue #217: real Linux filesystem primitives for a fixed Universal bundle
 * and crash-safe, NON-PRIVILEGED test fixture. No production apply/export.
 *
 * A native root Host Actions adapter must still be independently reviewed,
 * signed, installed and wired to the Approval Center before any live action.
 */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {CONTRACT}=require('./honartik-universal-installer-l4-v1.cjs');
const fail=s=>{throw Error('honartik_native_'+s)};
const hex=b=>crypto.createHash('sha256').update(b).digest('hex');
function safeFile(p){
 const s=fs.lstatSync(p);
 if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o022))fail('unsafe_regular_file');
 return s;
}
function safeDir(p){
 const s=fs.lstatSync(p);
 if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o022))fail('unsafe_directory');
 return s;
}
function fsyncDir(p) {
 const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
 try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
function atomicData(p,data,mode=0o600) {
 const parent=path.dirname(p);safeDir(parent);
 const temp=path.join(parent,'.stage-'+crypto.randomUUID());
 const fd=fs.openSync(temp,fs.constants.O_CREAT|fs.constants.O_EXCL|
   fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,mode);
 try{fs.writeFileSync(fd,data);fs.fsyncSync(fd)}
 finally{fs.closeSync(fd)}
 fs.renameSync(temp,p);fsyncDir(parent);
}
function readTree(root) {
 // Same file ordering and framing as universal.install.bundle_digest.
 safeDir(root);const universal=path.join(root,'universal');safeDir(universal);
 const paths=[];
 function walk(dir){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
   const absolute=path.join(dir,entry.name);
   if(entry.isSymbolicLink())fail('bundle_symlink');
   if(entry.isDirectory()){safeDir(absolute);
    if(entry.name==='__pycache__')continue;
    walk(absolute);
   }else if(entry.isFile()){
    safeFile(absolute);
    if(path.extname(entry.name)!=='.py')fail('unknown_bundle_file');
    paths.push(absolute);
   }else fail('bundle_unknown_entry');
  }
 }
 walk(universal);if(!paths.some(p=>path.basename(p)==='cli.py'))
   fail('bundle_cli_missing');
 // Python pathlib sorting is codepoint-order, not locale collation. UTF-8
 // lexicographic ordering agrees for valid filenames and ASCII bundle paths.
 paths.sort((a,b)=>Buffer.compare(Buffer.from(path.relative(root,a)),
   Buffer.from(path.relative(root,b))));
 const hash=crypto.createHash('sha256');
 for(const p of paths){
  const relative=path.relative(root,p).split(path.sep).join('/');
  hash.update(Buffer.from(relative));hash.update(Buffer.from([0]));
  hash.update(fs.readFileSync(p));hash.update(Buffer.from([0]));
 }
 return {digest:hash.digest('hex'),python_files:paths.length};
}
function fixtureRoot(root){
 // Only local disposable fixture directories directly under os.tmpdir().
 if(typeof root!=='string'||path.dirname(root)!==os.tmpdir()||
    !path.basename(root).startsWith('prhm-honartik217-native-fixture-'))
   fail('fixture_root_denied');
 const st=safeDir(root);
 if(typeof process.getuid!=='function'||st.uid!==process.getuid()||
    (st.mode&0o777)!==0o700)fail('fixture_ownership_denied');
 return root;
}
function exactSymlink(link,root){
 const st=fs.lstatSync(link);
 if(!st.isSymbolicLink())fail('missing_release_symlink');
 const resolved=fs.realpathSync(link);
 const versions=path.join(root,'versions');
 if(path.dirname(resolved)!==versions)fail('release_symlink_escape');
 return resolved;
}
function record(root){
 fixtureRoot(root);const live=exactSymlink(path.join(root,'current'),root);
 const manifest=path.join(root,'installation.json');safeFile(manifest);
 const value=JSON.parse(fs.readFileSync(manifest,'utf8'));
 if(value.digest!==path.basename(live))fail('installed_manifest_drift');
 const installed=readTree(live);
 if(installed.digest!==value.digest)fail('installed_content_drift');
 return {digest:installed.digest,manifest:fs.readFileSync(manifest),
   current:live};
}
function initFixture(root,oldBundle,candidateBundle){
 fixtureRoot(root);
 const versions=path.join(root,'versions');
 fs.mkdirSync(versions,{mode:0o700});
 const d1=readTree(oldBundle).digest;
 const d2=readTree(candidateBundle).digest;
 if(d1===d2)fail('identical_fixture_bundles');
 function copy(src,digest){
  const dest=path.join(versions,digest);fs.cpSync(src,dest,{recursive:true,
   errorOnExist:true,force:false});return dest;
 }
 const old=copy(oldBundle,d1);copy(candidateBundle,d2);
 fs.symlinkSync(old,path.join(root,'current'));
 atomicData(path.join(root,'installation.json'),Buffer.from(JSON.stringify({
  digest:d1,previous:null,entrypoint:'fixture-only'})),0o600);
 return {old_digest:d1,candidate_digest:d2};
}
function begin(root,desiredDigest){
 const prior=record(root);
 if(!/^[a-f0-9]{64}$/.test(desiredDigest)||desiredDigest===prior.digest)
   fail('invalid_candidate_digest');
 const next=path.join(root,'versions',desiredDigest);
 if(readTree(next).digest!==desiredDigest)fail('candidate_content_drift');
 // O_EXCL single-use lock; crash leaves lock until reconciled.
 const lock=path.join(root,'upgrade.lock');
 let fd;try{fd=fs.openSync(lock,fs.constants.O_WRONLY|
   fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600)}
 catch{fail('exclusive_lock_busy')}
 const journal=path.join(root,'upgrade.journal');
 try{
  // Preimage record written+fsynced before first mutation.
  const obj={schema:'prhm.honartik217.fixture-journal.v1',old:prior.digest,
   next:desiredDigest,prior_manifest_base64:prior.manifest.toString('base64')};
  atomicData(journal,Buffer.from(JSON.stringify(obj)),0o600);
  fs.fsyncSync(fd);fsyncDir(root);
 }catch(e){
  // A failed journal write/fsync has indeterminate persistence. Retain the
  // exclusive recovery fence even if the journal file is not yet visible.
  fs.closeSync(fd);throw e;
 }
 fs.closeSync(fd);
 return {old:prior.digest,next:desiredDigest};
}
function switchFixture(root,nextDigest,crashStage){
 fixtureRoot(root);
 const journal=path.join(root,'upgrade.journal');
 safeFile(journal);const j=JSON.parse(fs.readFileSync(journal,'utf8'));
 if(j.next!==nextDigest)fail('journal_candidate_mismatch');
 const before=path.join(root,'current');
 if(path.basename(exactSymlink(before,root))!==j.old)fail('before_drift');
 const pending=path.join(root,'.next-'+crypto.randomUUID());
 fs.symlinkSync(path.join(root,'versions',nextDigest),pending);
 fs.renameSync(pending,before);fsyncDir(root);
 if(crashStage==='after_pointer')process.exit(87);
 atomicData(path.join(root,'installation.json'),
  Buffer.from(JSON.stringify({digest:nextDigest,previous:j.old,entrypoint:'fixture-only'})));
 if(crashStage==='after_manifest')process.exit(88);
 const current=record(root);
 if(current.digest!==nextDigest)fail('postimage_not_valid');
 return {state:'SWITCHED',digest:current.digest};
}
function commitFixture(root,crashStage){
 fixtureRoot(root);
 const journal=path.join(root,'upgrade.journal');
 safeFile(path.join(root,'upgrade.lock'));safeFile(journal);
 const j=JSON.parse(fs.readFileSync(journal,'utf8'));
 if(j.schema!=='prhm.honartik217.fixture-journal.v1'||j.old===j.next||
    (j.state!==undefined&&j.state!=='COMMITTED'))fail('commit_journal_invalid');
 if(record(root).digest!==j.next)fail('commit_postimage_invalid');
 // The durable COMMITTED marker is the linearization point. Never roll back
 // after this marker, even if the acknowledgement is lost on process crash.
 atomicData(journal,Buffer.from(JSON.stringify({...j,state:'COMMITTED'})),0o600);
 if(crashStage==='after_commit')process.exit(89);
 return {state:'COMMITTED',digest:j.next};
}
function recoverFixture(root){
 fixtureRoot(root);const p=path.join(root,'upgrade.journal');safeFile(p);
 safeFile(path.join(root,'upgrade.lock'));
 const j=JSON.parse(fs.readFileSync(p,'utf8'));
 if(j.schema!=='prhm.honartik217.fixture-journal.v1'||j.old===j.next)
   fail('journal_invalid');
 if(j.state==='COMMITTED'){
  if(record(root).digest!==j.next)fail('committed_postimage_drift');
  fs.unlinkSync(p);fs.unlinkSync(path.join(root,'upgrade.lock'));fsyncDir(root);
  return {state:'COMMITTED',sha256:j.next,production_mutated:false};
 }
 if(j.state!==undefined)fail('journal_state_invalid');
 const live=exactSymlink(path.join(root,'current'),root);
 if(![j.old,j.next].includes(path.basename(live)))
   fail('third_party_pointer_drift');
 const old=path.join(root,'versions',j.old);
 if(readTree(old).digest!==j.old)fail('original_bytes_drift');
 const expected=Buffer.from(j.prior_manifest_base64,'base64');
 const prior=JSON.parse(expected.toString('utf8'));
 if(prior.digest!==j.old)fail('journal_manifest_drift');
 const pending=path.join(root,'.restore-'+crypto.randomUUID());
 fs.symlinkSync(old,pending);
 fs.renameSync(pending,path.join(root,'current'));fsyncDir(root);
 atomicData(path.join(root,'installation.json'),expected);
 const result=record(root);
 if(result.digest!==j.old||!result.manifest.equals(expected))
   fail('restore_verification_failed');
 fs.unlinkSync(p);fs.unlinkSync(path.join(root,'upgrade.lock'));fsyncDir(root);
 return {state:'ROLLED_BACK',sha256:j.old,production_mutated:false};
}
// A production registration/export is intentionally absent. This code cannot
// authorize itself, use root, consume an Approval Center token or install live.
module.exports=Object.freeze({CONTRACT,readTree,fixtureRoot,initFixture,begin,
 switchFixture,commitFixture,recoverFixture,record});
