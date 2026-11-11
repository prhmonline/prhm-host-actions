'use strict';
/**
 * U06 Root-native L4 authorization and durable consumed-approval replay fence.
 *
 * This is a real FS-backed component (O_NOFOLLOW/O_EXCL/fsync) for the future
 * dedicated U06 Root Host Action, not a route registrar, policy editor, token
 * issuer, or production backup entrypoint. On production it ONLY reads the
 * fixed Approval Center Root-owned trust files and creates ONE durable replay
 * fence after verifying an independently consumed exact-U06 Ed25519 receipt.
 *
 * Root-only ownership, exact installed policy SHA, consumed-ledger and a
 * signed request/receipt MUST pass. A synthetic callback's true booleans
 * cannot confer Root authority. No dynamic file/command/SQL paths are
 * accepted by the production constructor.
 */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {decodeJws}=require('./honartik-universal-installer-l4-approval-verify-v1.cjs');
const {verifySignedConsumedL4,ACTION,OPERATION}
  =require('./honartik-u06-native-l4-consumed-receipt-v1.cjs');
const APPROVAL_UID=65039; // actual systemd StateDirectory owner on prhm-production
const APPROVAL_ALIAS='/var/lib/prhm-company-approval';
const APPROVAL_BASE='/var/lib/private/prhm-company-approval';
const FIXED=Object.freeze({
  host:'prhm-production.prhm.ir',
  policy:'/opt/prhm-company-control-plane/config/approval-policy.json',
  // Resolve systemd's fixed StateDirectory alias via the only canonical,
  // link-free path. Both alias and target are verified before live use.
  issuer:APPROVAL_BASE+'/ed25519-public.pem',
  consumed:APPROVAL_BASE+'/consumed',
  fence:'/var/lib/prhm-agent-selfmaint-exec/honartik-u06-native-root/l4-consumed',
  policy_sha256:'aa1563b168aea2725a0539373c54c45b2317b6320334c80a6d3a5e2723520934'
});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX=/^[0-9a-f]{64}$/;
const H=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const deny=why=>{throw Error('u06_native_root_l4_'+why)};
const need=(v,why)=>{if(!v)deny(why)};
function ensureParents(root,file){
  // Root-owned, non-symlink, non-group-writable ancestry.
  need(path.isAbsolute(file)&&path.normalize(file)===file,'unsafe_absolute_path');
  const p=path.parse(file).root,parts=file.slice(p.length).split('/').filter(Boolean);
  let cursor=p;
  for(let i=0;i<parts.length-1;i++){
    cursor=path.join(cursor,parts[i]);
    const st=fs.lstatSync(cursor);
    const fixtureTmp=root!==0&&cursor==='/tmp'&&st.uid===0&&
      (st.mode&0o7777)===0o1777;
    const fixedApprovalRoot=root===0&&
      (cursor===APPROVAL_BASE||cursor===FIXED.consumed)&&
      st.uid===APPROVAL_UID&&st.gid===APPROVAL_UID&&
      (st.mode&0o777)===0o700;
    need(st.isDirectory()&&!st.isSymbolicLink()&&
      (fixtureTmp||fixedApprovalRoot||
       (st.uid===root&&(st.mode&0o022)===0)),
      'untrusted_parent');
  }
}
function readOwned(root,file,{max=200000,exactMode=null,ownerUid=root}={}){
  ensureParents(root,file);
  const first=fs.lstatSync(file);
  need(first.isFile()&&!first.isSymbolicLink()&&first.uid===ownerUid&&
    (first.mode&0o022)===0&&first.nlink===1&&first.size>0&&
    first.size<=max&&(exactMode===null||(first.mode&0o777)===exactMode),
    'untrusted_file');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    const now=fs.fstatSync(fd);
    need(now.isFile()&&now.uid===ownerUid&&now.dev===first.dev&&
      now.ino===first.ino&&now.mode===first.mode&&now.size===first.size&&
      now.nlink===1,'raced_file');
    const buf=fs.readFileSync(fd);
    need(buf.length===now.size,'truncated_file');
    return buf;
  }finally{fs.closeSync(fd)}
}
function ensurePrivate(root,dir,ownerUid=root){
  ensureParents(root,path.join(dir,'private-file'));
  const st=fs.lstatSync(dir);
  need(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===ownerUid&&
    (st.mode&0o777)===0o700,'private_directory_required');
}
function attestFixedSystemdApprovalAlias(){
  // Actual systemd StateDirectory=/var/lib/prhm-company-approval is a
  // root-owned symlink into /var/lib/private. Never follow other links.
  const alias=fs.lstatSync(APPROVAL_ALIAS);
  need(alias.isSymbolicLink()&&alias.uid===0&&alias.gid===0&&
    fs.readlinkSync(APPROVAL_ALIAS)==='private/prhm-company-approval',
    'systemd_state_alias_drift');
  const privateRoot=fs.lstatSync('/var/lib/private');
  need(privateRoot.isDirectory()&&!privateRoot.isSymbolicLink()&&
    privateRoot.uid===0&&privateRoot.gid===0&&
    (privateRoot.mode&0o777)===0o700,'systemd_private_root_drift');
  ensurePrivate(0,APPROVAL_BASE,APPROVAL_UID);
  ensurePrivate(0,FIXED.consumed,APPROVAL_UID);
  return true;
}
function syncDir(dir){
  const fd=fs.openSync(dir,fs.constants.O_RDONLY|
    fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
  try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
function durableExclusive(dir,file,bytes,root){
  ensurePrivate(root,dir);
  const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|
    fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{
    const st=fs.fstatSync(fd);
    need(st.isFile()&&st.uid===root&&st.nlink===1&&
      (st.mode&0o777)===0o600,'new_fence_untrusted');
    // A failure after opening is deliberately NOT cleaned up. It burns the
    // approval and blocks replay even if fsync only partially succeeds.
    fs.writeFileSync(fd,bytes);
    fs.fsyncSync(fd);
  }finally{fs.closeSync(fd)}
  syncDir(dir);
}
function bindRootL4({requestId,loadSealedToken,rootUid,paths,fixture}){
  need(UUID.test(requestId||''),'request_id_invalid');
  need(typeof loadSealedToken==='function','trusted_sealed_token_loader_missing');
  need(typeof process.getuid==='function'&&process.getuid()===rootUid,
    'executor_uid_mismatch');
  if(!fixture){
    need(rootUid===0&&os.hostname()===FIXED.host,'live_root_host_required');
    need(paths===FIXED,'live_fixed_paths_required');
  }else{
    need(rootUid!==0&&typeof paths==='object'&&
      paths!==FIXED&&paths.policy.startsWith('/tmp/u06-root-l4-test-')&&
      paths.issuer.startsWith('/tmp/u06-root-l4-test-')&&
      paths.consumed.startsWith('/tmp/u06-root-l4-test-')&&
      paths.fence.startsWith('/tmp/u06-root-l4-test-'),
      'fixture_must_be_unprivileged_and_disposable');
  }
  const verified=new WeakSet();
  let last=null;
  function verifyNativeConsumedSignedLevel4(F,journal){
    need(F&&F.reviewed_l4_policy_sha256===paths.policy_sha256&&
      F.operation==='honartik_back.production.native_backup',
      'owner_scope_not_bound');
    need(journal&&UUID.test(journal.id)||journal&&
      /^[a-z0-9_-]{12,100}$/i.test(journal.id||''),'durable_journal_not_bound');
    if(!fixture)attestFixedSystemdApprovalAlias();
    ensurePrivate(rootUid,paths.consumed,fixture?rootUid:APPROVAL_UID);
    ensurePrivate(rootUid,paths.fence);
    const policyBytes=readOwned(rootUid,paths.policy,{max:200000});
    need(H(policyBytes)===paths.policy_sha256,'installed_policy_sha_drift');
    const issuerPublicKey=readOwned(rootUid,paths.issuer,{
      max:8192,exactMode:0o600,ownerUid:fixture?rootUid:APPROVAL_UID
    });
    const token=loadSealedToken(requestId);
    need(typeof token==='string'&&token.length>=120&&token.length<=16384,
      'sealed_approval_unavailable');
    // Verify the Ed25519 signature before using the claim as a pathname.
    const signed=decodeJws(token,issuerPublicKey);
    need(signed.request_id===requestId&&UUID.test(signed.approval_id||''),
      'signed_request_not_current');
    const consumedFile=path.join(paths.consumed,signed.approval_id+'.json');
    const ledgerBytes=readOwned(rootUid,consumedFile,{
      max:16384,exactMode:0o600,ownerUid:fixture?rootUid:APPROVAL_UID
    });
    let consumedLedger;
    try{consumedLedger=JSON.parse(ledgerBytes.toString('utf8'))}
    catch{deny('consumed_ledger_json')}
    const verifiedReceipt=verifySignedConsumedL4({
      token,issuerPublicKey,consumedLedger,policyBytes,
      reviewedPolicySha256:paths.policy_sha256,
      nowSec:Math.floor(Date.now()/1000)
    });
    need(verifiedReceipt.request_id===requestId&&
      verifiedReceipt.approval_id===signed.approval_id&&
      verifiedReceipt.signature_verified===true&&
      verifiedReceipt.consumed_ledger_verified===true&&
      verifiedReceipt.level4_scope_exact===true,
      'consumed_receipt_invalid');
    const out=Object.freeze({
      operation:OPERATION,level:4,
      signature_verified:true,consumed_ledger_verified:true,
      policy_sha256:paths.policy_sha256,
      request_id:requestId,approval_id:signed.approval_id
    });
    verified.add(out);
    last=out;
    return out;
  }
  function reserveNativeLevel4ReplayFence(F,journal,approval){
    need(approval&&verified.has(approval)&&last===approval,
      'not_verifier_owned_receipt');
    need(F&&F.reviewed_l4_policy_sha256===paths.policy_sha256,
      'wrong_fixed_policy_sha');
    need(journal&&/^[a-z0-9_-]{12,100}$/i.test(journal.id||''),
      'missing_durable_journal');
    const file=path.join(paths.fence,approval.approval_id+'.json');
    const bytes=Buffer.from(JSON.stringify({
      schema:'prhm.u06.native-root-l4-consumed-fence.v1',
      action:ACTION,operation:OPERATION,
      approval_id:approval.approval_id,request_id:approval.request_id,
      policy_sha256:paths.policy_sha256,
      journal_id:journal.id,
      state:'CONSUMED_NO_REPLAY',
      receipt_signed_and_consumed:true
    })+'\n','utf8');
    durableExclusive(paths.fence,file,bytes,rootUid);
    last=null; // Even successful same-process verifier reuse is disallowed.
    return true;
  }
  return Object.freeze({
    verifyNativeConsumedSignedLevel4,
    reserveNativeLevel4ReplayFence
  });
}
function createLiveRootL4Callbacks(requestId,loadSealedToken){
  return bindRootL4({requestId,loadSealedToken,rootUid:0,
    paths:FIXED,fixture:false});
}
function createDisposableRootL4Fixture(requestId,loadSealedToken,paths){
  return bindRootL4({requestId,loadSealedToken,
    rootUid:process.getuid(),paths,fixture:true});
}
module.exports=Object.freeze({
  FIXED,APPROVAL_UID,APPROVAL_ALIAS,APPROVAL_BASE,
  attestFixedSystemdApprovalAlias,
  createLiveRootL4Callbacks,createDisposableRootL4Fixture,
  ROOT_ACTION_REGISTERED:false,
  PRODUCTION_APPLY_EXPORTED:false,
  POLICY_INSTALLER_EXPORTED:false
});
