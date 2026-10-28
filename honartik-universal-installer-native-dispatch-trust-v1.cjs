'use strict';
/**
 * PRHM #217: fixed-root Honartik Universal Installer dispatch trust boundary.
 * SOURCE-ONLY, NOT REGISTERED, NOT AN APPROVAL ISSUER OR A ROOT BOOTSTRAP.
 * This module cannot be called from a generic Host Action. Only the existing
 * independently reviewed trusted v2 executor may call it AFTER verified
 * server-side confirm + authorize-consume and an explicit Level-4 confirmation.
 *
 * Production registration and installation require a separate reviewed,
 * root-owned Root-of-Trust registration transaction with signed approval,
 * exact owner byte preimages, atomic install and durable rollback.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const ACTION='honartik_universal_installer_upgrade_v1';
const ROOT='/opt/prhm-agent-selfmaint-exec/actions';
const ENTRY='honartik-universal-installer-native-root-transaction-v1.cjs';
const BLOBS=Object.freeze({
 'honartik-universal-installer-l4-v1.cjs':'d9d25684f6480eb8bdbb4c097e0ffc3645e9c559',
 'honartik-universal-installer-l4-approval-verify-v1.cjs':'280cb91673c074f6abba6e82dc861ac0c0cf9a30',
 'honartik-universal-installer-native-approval-gate-v1.cjs':'227bc7fdf891bf67ddae1944936d30a72c7e10d5',
 'honartik-universal-installer-native-fs-v1.cjs':'9678e8d45e32c6989808ef7d7d2419f3426a1d0d',
 'honartik-universal-installer-native-journal-inspector-v1.cjs':'439380a7f382298f7c2a8a14cdf2142c0ad7f965',
 'honartik-universal-installer-native-journal-writer-v1.cjs':'a80f65b23a69d5f76af91797c4e2cc83ab6bf9c1',
 'honartik-universal-installer-native-l4-fence-v1.cjs':'9c3f1279fe0697affd774be35551d2c81a6912cd',
 'honartik-universal-installer-native-python-bridge-v1.cjs':'608bfcf07ac06c50081730b5f4863f0f2fc3f27c',
 'honartik-universal-installer-native-reconciler-v1.cjs':'9f471dff187e6305fde4d6f7f69920ea2bd4f124',
 'honartik-universal-installer-native-root-preflight-v1.cjs':'7a92e3d4f6c30aaca5d4d0b5794eccd5e83c9084',
 'honartik-universal-installer-native-root-receipt-v1.cjs':'106edec5141652f439f3dcecce359f0dc59fef84',
 'honartik-universal-installer-native-terminal-archive-v1.cjs':'7de2333ba52c25d9432e3d3e93edd00a5fb53816',
 [ENTRY]:'b7d020771fd576356494735a6e9224c6217b1e55'
});
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fail=name=>{throw new Error('honartik217_native_dispatch_'+name)};
const need=(value,name)=>{if(!value)fail(name)};
function gitBlob(bytes){
 need(Buffer.isBuffer(bytes),'blob_buffer_required');
 return crypto.createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
}
function verifyPinnedBlobs(reader){
 need(typeof reader==='function','reader_required');
 const found={};
 for(const [name,expected] of Object.entries(BLOBS)){
  const bytes=reader(name);
  need(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=1024*1024,'artifact_unavailable_'+name);
  const actual=gitBlob(bytes);
  need(actual===expected,'artifact_changed_'+name);
  found[name]=actual;
 }
 return Object.freeze(found);
}
function trustedParentChain(directory){
 let current=directory;
 for(;;){
  const st=fs.lstatSync(current);
  need(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===0&&
   (st.mode&0o022)===0,'parent_untrusted');
  if(current==='/')break;
  current=path.dirname(current);
 }
}
function readFixedRootFile(name){
 need(Object.prototype.hasOwnProperty.call(BLOBS,name),'unregistered_artifact');
 const filename=path.join(ROOT,name);
 const a=fs.lstatSync(filename);
 need(a.isFile()&&!a.isSymbolicLink()&&a.uid===0&&
  a.nlink===1&&(a.mode&0o022)===0&&a.size>0&&a.size<=1024*1024,
  'source_untrusted_'+name);
 const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const b=fs.fstatSync(fd);
  need(b.dev===a.dev&&b.ino===a.ino&&b.size===a.size&&
   b.uid===0&&b.mode===a.mode,'source_changed_during_read');
  const bytes=fs.readFileSync(fd);
  need(bytes.length===a.size,'short_read');
  return bytes;
 }finally{fs.closeSync(fd)}
}
function verifyInstalledRootClosure(){
 need(process.getuid?.()===0,'root_only');
 trustedParentChain(ROOT);
 return verifyPinnedBlobs(readFixedRootFile);
}
function bindExistingTrustedContext(binding){
 need(binding&&typeof binding==='object'&&!Array.isArray(binding),
  'trusted_binding_missing');
 need(binding.action===ACTION&&binding.level===4&&
  binding.authorization_consumed===true&&
  binding.confirmation==='CONFIRM_LEVEL_4_CRITICAL'&&
  typeof binding.request_id==='string'&&UUID.test(binding.request_id)&&
  typeof binding.loadConsumedServerToken==='function',
  'l4_context_invalid');
 const requestId=binding.request_id;
 const closure=binding.loadConsumedServerToken;
 // Identity pinning prevents cross-request token access. No token may be
 // accepted from arguments, environment, MCP or disk by this loader.
 const loadForExactRequest=expectedId=>{
  need(expectedId===requestId,'request_identity_drift');
  const token=closure(expectedId);
  need(typeof token==='string'&&token.length>=120&&token.length<=16384,
   'server_token_unavailable');
  return token;
 };
 return Object.freeze({requestId,loadForExactRequest});
}
function runFixedRegisteredAction(binding){
 need(process.getuid?.()===0,'root_only');
 const {requestId,loadForExactRequest}=bindExistingTrustedContext(binding);
 verifyInstalledRootClosure();
 // Load ONLY the root-owned exact Git-blob-verified native entrypoint.
 // The native transaction MUST reverify signed Ed25519, exact policy hash,
 // authoritative consumed ledger, and the durable O_EXCL execution fence.
 const tx=require(path.join(ROOT,ENTRY));
 need(typeof tx.runFixedRootSignedInstaller==='function'&&
  tx.PRODUCTION_EXECUTION_AUTHORIZED===false&&
  tx.ROOT_ACTION_REGISTERED===false,'native_transaction_contract_drift');
 return tx.runFixedRootSignedInstaller(requestId,loadForExactRequest);
}
module.exports=Object.freeze({
 ACTION,ROOT,ENTRY,BLOBS,gitBlob,verifyPinnedBlobs,
 bindExistingTrustedContext,verifyInstalledRootClosure,runFixedRegisteredAction,
 SOURCE_ONLY:true,ROOT_INSTALLATION_COMPLETED:false,
 INDEPENDENT_SECURITY_REVIEW_VERIFIED:false,
 NO_L4_APPROVAL_ISSUED_BY_MODULE:true
});
