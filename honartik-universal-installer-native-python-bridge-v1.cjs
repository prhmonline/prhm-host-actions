'use strict';
/**
 * Issue #217: SHA-bound native Python install bridge, SOURCE ONLY.
 * No CLI, Host Actions registration, approval issuance, generic path or shell.
 * The trusted root dispatcher must provide an already-consumed signed L4
 * receipt bound to an existing durable PREPARED journal. This runs the real
 * installed universal.install.install_bundle with fixed arguments, but does
 * not commit, rollback, or retire the journal. Independently reviewed native
 * registration, signed Linux provenance, L4 permit and root recovery are
 * prerequisites to using this in Production.
 */
const fs=require('node:fs'),path=require('node:path');
const cp=require('node:child_process');
const {CONTRACT:C}=require('./honartik-universal-installer-l4-v1.cjs');
const {readTree}=require('./honartik-universal-installer-native-fs-v1.cjs');
const I=require('./honartik-universal-installer-native-journal-inspector-v1.cjs');
const G=require('./honartik-universal-installer-native-approval-gate-v1.cjs');
const PREFIX=C.installer_prefix,OLD=C.existing_digest,NEW=C.candidate_digest;
const PYTHON=C.interpreter;
const FENCE='/var/lib/prhm-agent-selfmaint-exec/honartik-universal-installer-l4';
const SOURCE=path.join(FENCE,'candidate-source');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=s=>{throw Error('honartik217_python_bridge_'+s)};
const need=(v,s)=>{if(!v)fail(s)};
function trustedParents(p){
 let d=path.dirname(p);
 while(true){
  const st=fs.lstatSync(d);
  need(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===0&&
   (st.mode&0o022)===0,'untrusted_parent');
  if(d==='/')break;
  d=path.dirname(d);
 }
}
function rootRead(p,max=524288,mode=null){
 trustedParents(p);
 const st=fs.lstatSync(p);
 need(st.isFile()&&!st.isSymbolicLink()&&st.uid===0&&
  (st.mode&0o022)===0&&st.nlink===1&&st.size>0&&st.size<=max&&
  (mode===null||(st.mode&0o777)===mode),'untrusted_file');
 const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const got=fs.fstatSync(fd);
  need(got.dev===st.dev&&got.ino===st.ino&&got.mode===st.mode&&
   got.uid===st.uid&&got.size===st.size,'file_changed');
  return fs.readFileSync(fd);
 }finally{fs.closeSync(fd)}
}
function verifyTree(dir,digest){
 trustedParents(path.join(dir,'universal'));
 const top=fs.lstatSync(dir);
 need(top.isDirectory()&&!top.isSymbolicLink()&&top.uid===0&&
  (top.mode&0o022)===0,'tree_root_untrusted');
 const walk=p=>{
  for(const e of fs.readdirSync(p,{withFileTypes:true})){
   const child=path.join(p,e.name),s=fs.lstatSync(child);
   need(s.uid===0&&(s.mode&0o022)===0&&!s.isSymbolicLink(),
    'tree_entry_untrusted');
   if(s.isDirectory())walk(child);
   else need(s.isFile()&&s.nlink===1,'tree_special_entry');
  }
 };
 walk(dir);
 need(readTree(dir).digest===digest,'tree_sha_drift');
}
function fixedPythonCode(){
 return [
  'import sys',
  'from pathlib import Path',
  'old=Path('+JSON.stringify(path.join(PREFIX,'versions',OLD))+')',
  'source=Path('+JSON.stringify(SOURCE)+')',
  'dest=Path('+JSON.stringify(PREFIX)+')',
  'sys.path.insert(0,str(old))',
  'from universal.install import install_bundle,bundle_digest',
  'if bundle_digest(source)!='+JSON.stringify(NEW)+': raise RuntimeError("candidate_sha_drift")',
  'install_bundle(source,dest,'+JSON.stringify(NEW)+','+JSON.stringify(OLD)+')',
  'print("PRHM_FIXED_PYTHON_INSTALL_OK=1")',
 ].join('\n')+'\n';
}
function verifyInterpreter(){
 trustedParents(PYTHON);
 const real=fs.realpathSync(PYTHON);
 trustedParents(real);
 const s=fs.statSync(real);
 need(s.isFile()&&s.uid===0&&(s.mode&0o022)===0&&
  (s.mode&0o111)!==0,'python_untrusted');
}
function approvalAndJournal(journalId,requestId,tokenLoader){
 need(UUID.test(journalId||'')&&UUID.test(requestId||''),
  'id_invalid');
 need(I.inspectFixedNativeJournalState(journalId)==='PREPARED',
  'journal_not_prepared');
 const j=JSON.parse(rootRead(path.join(FENCE,I.JOURNAL),512000,0o600));
 need(j.journal_id===journalId&&j.state==='PREPARED'&&
  j.request_id===requestId&&UUID.test(j.approval_id||'')&&
  j.old_digest===OLD&&j.next_digest===NEW&&
  j.policy_sha256===G.PINNED_POLICY_SHA&&
  j.arguments_sha256===G.ARGUMENTS_SHA,'journal_unbound');
 // Verify genuine Ed25519 signature, live pinned policy and consumed ledger
 // through the pre-existing root-sealed Approval Center token loader.
 const p=G.readNativeConsumedProof(requestId,tokenLoader);
 need(p.ok===true&&p.action===C.action&&
  p.request_id===requestId&&p.approval_id===j.approval_id&&
  p.policy_sha256===j.policy_sha256&&
  p.arguments_sha256===j.arguments_sha256&&
  p.signature_verified===true&&p.consumed_ledger_verified===true,
  'signed_consumed_receipt_missing');
 const f=JSON.parse(rootRead(path.join(FENCE,p.approval_id+'.json'),8192,0o600));
 need(f.schema_version==='prhm.honartik217.l4-execution-fence.v1'&&
  f.state==='reserved_no_replay'&&f.action===C.action&&
  f.request_id===requestId&&f.approval_id===p.approval_id&&
  f.policy_sha256===G.PINNED_POLICY_SHA&&
  f.arguments_sha256===G.ARGUMENTS_SHA,'durable_one_use_fence_invalid');
 need(I.inspectFixedNativeJournalState(journalId)==='PREPARED',
  'journal_changed_during_approval');
 return j;
}
function verifyPreimage(j){
 const manifest=rootRead(path.join(PREFIX,'installation.json'),131072);
 const wrapper=rootRead(path.join(PREFIX,'deploy-project'),131072);
 need(manifest.equals(Buffer.from(j.preimage_manifest_b64,'base64'))&&
  wrapper.equals(Buffer.from(j.preimage_wrapper_b64,'base64')),
  'preimage_bytes_drift');
 const link=path.join(PREFIX,'current'),s=fs.lstatSync(link);
 need(s.isSymbolicLink()&&s.uid===0&&
  fs.realpathSync(link)===path.join(PREFIX,'versions',OLD),
  'preimage_pointer_drift');
 verifyTree(path.join(PREFIX,'versions',OLD),OLD);
 verifyTree(SOURCE,NEW);
 need(!fs.existsSync(path.join(PREFIX,'versions',NEW)),
  'new_version_already_exists');
}
function verifyPostimage(){
 const target=path.join(PREFIX,'versions',NEW);
 need(fs.realpathSync(path.join(PREFIX,'current'))===target,
  'post_pointer_invalid');
 verifyTree(target,NEW);
 const m=JSON.parse(rootRead(path.join(PREFIX,'installation.json'),131072));
 need(m.digest===NEW&&m.previous===OLD&&
  m.entrypoint===path.join(PREFIX,'deploy-project'),
  'post_manifest_invalid');
 rootRead(path.join(PREFIX,'deploy-project'),131072);
}
function installViaFixedTrustedPython(journalId,requestId,rootSealedTokenLoader){
 need(process.getuid?.()===0,'root_required');
 need(typeof rootSealedTokenLoader==='function',
  'trusted_sealed_token_source_missing');
 const j=approvalAndJournal(journalId,requestId,rootSealedTokenLoader);
 verifyPreimage(j);
 verifyInterpreter();
 const run=cp.spawnSync(PYTHON,['-I','-c',fixedPythonCode()],{
  cwd:'/',shell:false,encoding:'utf8',timeout:120000,maxBuffer:262144,
  env:{PATH:'/usr/sbin:/usr/bin:/bin',LANG:'C',LC_ALL:'C',
   PYTHONNOUSERSITE:'1',HOME:'/nonexistent'}
 });
 need(!run.error&&run.signal===null&&run.status===0&&
  run.stdout?.includes('PRHM_FIXED_PYTHON_INSTALL_OK=1'),
  'python_install_failed_recovery_required');
 verifyPostimage();
 need(I.inspectFixedNativeJournalState(journalId)==='PREPARED',
  'postinstall_journal_lost');
 return Object.freeze({ok:true,installer_switched:true,committed:false,
  journal_id:journalId,old_digest:OLD,new_digest:NEW,
  lease_preserved:true,approval_reusable:false,backend_deployed:false});
}
/**
 * Native Host Actions owner can inject this ONE method into the existing
 * applyFixedInstallerUpgrade trusted capability object after independent
 * Root-of-Trust admission. This is NOT a partial standalone root executor:
 * the owner is still responsible for all other coordinator capabilities,
 * consumed approval, signed Linux attestation and durable reconciliation.
 */
function makeFixedCoordinatorPythonTransaction(rootSealedTokenLoader){
 need(process.getuid?.()===0,'root_required');
 need(typeof rootSealedTokenLoader==='function',
  'trusted_sealed_token_source_missing');
 return async function installFixedBundleTransaction(contract,journal){
  need(contract===C,'coordinator_contract_mismatch');
  need(journal&&UUID.test(journal.id||''),
    'coordinator_journal_invalid');
  const j=JSON.parse(rootRead(path.join(FENCE,I.JOURNAL),512000,0o600));
  need(j.journal_id===journal.id&&UUID.test(j.request_id||''),
   'coordinator_approval_not_bound');
  const result=installViaFixedTrustedPython(
    journal.id,j.request_id,rootSealedTokenLoader);
  return result.ok===true&&result.installer_switched===true&&
    result.committed===false&&result.lease_preserved===true;
 };
}
module.exports=Object.freeze({
 fixedPythonCode,installViaFixedTrustedPython,
 makeFixedCoordinatorPythonTransaction,
 ROOT_ACTION_REGISTERED:false,PRODUCTION_INSTALL_AUTHORIZED:false,
 INDEPENDENT_SIGNED_LINUX_PROVENANCE_REQUIRED:true
});
