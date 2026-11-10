'use strict';
/**
 * Durable, one-use consumption of IN-PROCESS-VERIFIED financial owner identity.
 * This module records evidence but grants no root or application authority.
 * Installer must create a root-owned private ledger and separately verify
 * live Git, backup, restore, host operation scope and rollback readiness.
 */
const fs=require('node:fs');
const path=require('node:path');
const gate=require('./honartik-finance-owner-oidc-identity-v1.cjs');
const LEDGER='/var/lib/prhm-honartik-finance-owner/consumed';
const SHA64=/^[a-f0-9]{64}$/;
const fail=(s)=>{throw Error('honartik_finance_owner_fence_'+s)};
function consumeVerifiedFinanceIdentity(proof,{directory=LEDGER,trustedUid=0}={}){
  if(!gate.proofVerifiedInProcess(proof))
    fail('not_verified_in_this_process');
  if(proof.schema!=='prhm.honartik.finance-owner-identity-evidence.v1'||
     proof.intent_digest!==gate.intentDigest()||
     proof.operation!==gate.INTENT.operation||
     proof.production_base_sha!==gate.INTENT.production_base_sha||
     proof.source_sha!==gate.INTENT.source_sha||
     !SHA64.test(proof.jti_sha256)||!SHA64.test(proof.challenge_sha256)||
     !/^[0-9]{1,20}$/.test(proof.run_id)||
     proof.finance_release_authorized!==false||
     proof.production_mutated!==false)
    fail('wrong_finance_identity_scope');
  if(!Number.isSafeInteger(trustedUid)||trustedUid<0)
    fail('invalid_trusted_uid');
  // O_NOFOLLOW on the receipt plus root-owned 0700 parent: fail closed
  // if the ledger is replaced or too permissive. Never create it here.
  const dir=fs.lstatSync(directory);
  if(!dir.isDirectory()||dir.isSymbolicLink()||
     dir.uid!==trustedUid||(dir.mode&0o777)!==0o700)
    fail('untrusted_ledger_directory');
  const basename=proof.jti_sha256+'.consumed';
  const dest=path.join(directory,basename);
  let fd=-1;
  try{
    fd=fs.openSync(dest,
      fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|
      fs.constants.O_NOFOLLOW|fs.constants.O_CLOEXEC,0o600);
    const st=fs.fstatSync(fd);
    if(!st.isFile()||st.uid!==trustedUid||(st.mode&0o777)!==0o600)
      fail('receipt_not_private');
    fs.writeFileSync(fd,JSON.stringify({
      schema:'prhm.honartik.finance-owner-identity-consumed.v1',
      operation:gate.INTENT.operation,
      intent_digest:proof.intent_digest,
      source_sha:proof.source_sha,
      production_base_sha:proof.production_base_sha,
      workflow_sha:proof.workflow_sha,
      run_id:proof.run_id,
      jti_sha256:proof.jti_sha256,
      challenge_sha256:proof.challenge_sha256
    })+'\n');
    fs.fsyncSync(fd);
    fs.closeSync(fd);fd=-1;
    const parent=fs.openSync(directory,
      fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
    try{fs.fsyncSync(parent)}finally{fs.closeSync(parent)}
    return Object.freeze({
      schema:'prhm.honartik.finance-owner-consumption.v1',
      consumed:true,
      receipt_fsynced:true,
      directory_fsynced:true,
      finance_release_authorized:false,
      production_mutated:false
    });
  }catch(e){
    // If interrupted after creating a receipt, leave it consumed.
    // A separate recovery/inspection process is needed: never auto-retry.
    if(e?.code==='EEXIST')fail('replayed_owner_proof');
    throw e;
  }finally{
    if(fd>=0)fs.closeSync(fd);
  }
}
module.exports=Object.freeze({
  LEDGER,consumeVerifiedFinanceIdentity,
  ROOT_ACTION_EXPORTED:false,PRODUCTION_AUTHORIZED:false
});
