'use strict';
/**
 * Durable, no-secrets, one-use replay fence for U06 owner OIDC identity proof.
 *
 * This module only records the consumption of *cryptographically verified*
 * owner-identity evidence. It cannot issue Level-4/root authority or perform
 * any MySQL, Universal, file-install, deployment or service operation.
 * Production caller MUST use the fixed root-owned 0700 directory and verify
 * the complete host action scope separately before any privileged mutation.
 */
const fs=require('node:fs');
const path=require('node:path');
const gate=require('./honartik-u06-owner-oidc-identity-gate-v1.cjs');
const LEDGER='/var/lib/prhm-u06-owner-approvals/consumed';
const HASH=/^[0-9a-f]{64}$/;
const fail=(x)=>{throw Error('u06_owner_fence_'+x)};
function consumeVerifiedOwnerEvidence(proof,{directory=LEDGER,trustedUid=0}={}){
  if(!gate.proofVerifiedInCurrentProcess(proof))fail('not_cryptographically_verified_in_process');
  if(proof.schema!=='prhm.u06.honartik.owner-identity-evidence.v1'||
     proof.intent_digest!==gate.intentDigest()||
     !HASH.test(proof.jti_sha256)||!HASH.test(proof.challenge_sha256)||
     !/^[0-9]{1,20}$/.test(proof.run_id)||
     proof.backend_deploy_authorized!==false||
     proof.approval_to_modify_production!==false)
    fail('wrong_or_tampered_identity_scope');
  if(!Number.isSafeInteger(trustedUid)||trustedUid<0)fail('invalid_uid');
  const info=fs.lstatSync(directory);
  if(!info.isDirectory()||info.isSymbolicLink()||
     info.uid!==trustedUid||(info.mode&0o777)!==0o700)
    fail('untrusted_ledger_directory');
  const filename=proof.jti_sha256+'.'+proof.challenge_sha256+'.used';
  const target=path.join(directory,filename);
  let fd=-1;
  try{
    fd=fs.openSync(target,
      fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|
      fs.constants.O_NOFOLLOW|fs.constants.O_CLOEXEC,0o600);
    const st=fs.fstatSync(fd);
    if(!st.isFile()||st.uid!==trustedUid||(st.mode&0o777)!==0o600)
      fail('receipt_file_not_private');
    const record=JSON.stringify({
      schema:'prhm.u06.honartik.owner-oidc-consumed.v1',
      operation:gate.INTENT.operation,
      intent_digest:proof.intent_digest,
      workflow_sha:proof.workflow_sha,
      run_id:proof.run_id,
      approved_reviewer_id:proof.approved_reviewer_id,
      jti_sha256:proof.jti_sha256,
      challenge_sha256:proof.challenge_sha256
    })+'\n';
    fs.writeFileSync(fd,record,{encoding:'utf8'});
    fs.fsyncSync(fd);
    fs.closeSync(fd);fd=-1;
    const dirFd=fs.openSync(directory,
      fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
    try{fs.fsyncSync(dirFd)}finally{fs.closeSync(dirFd)}
    return Object.freeze({
      schema:'prhm.u06.honartik.owner-identity-consumption.v1',
      consumed:true,operation:gate.INTENT.operation,
      run_id:proof.run_id,
      receipt_file_created:true,
      receipt_fsynced:true,
      directory_fsynced:true,
      native_root_action_authorized:false,
      production_mutated:false
    });
  } catch(e) {
    // An interrupted or partially written fence remains a consumed lease:
    // NEVER delete/retry a failed receipt or erase it on rollback.
    if(e?.code==='EEXIST')fail('replayed_receipt');
    throw e;
  } finally {
    if(fd>=0)fs.closeSync(fd);
  }
}
module.exports=Object.freeze({
  LEDGER,consumeVerifiedOwnerEvidence,PRODUCTION_ACTION_EXPORTED:false
});
