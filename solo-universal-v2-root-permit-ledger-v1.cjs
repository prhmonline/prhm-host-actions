'use strict';
/*
 * SOURCE ONLY. Fixed Owner-L4 production receipt bridge and durable one-use
 * ledger. Not an issuer, signer, installed Root Action, or CLI.
 *
 * Caller MUST be a separately registered fixed-scope native root dispatcher.
 * There is no user-selected operation, target path, signer, key or token.
 * The driver SHA is checked against independently attested clean release
 * checkout, never taken from the JWS payload.
 */
const fs=require('node:fs');
const crypto=require('node:crypto');
const path=require('node:path');
const cp=require('node:child_process');
const release=require('./solo-universal-v2-signed-release-contract-v1.cjs');
const P=release.PINS;
const fail=m=>{throw Error('solo_v2_receipt_bridge_'+m)};
const LEDGER='/var/lib/prhm-agent-selfmaint-exec/solo-universal-v2-root-receipts-v1';
const SOURCE='/var/lib/prhm-agent-selfmaint-exec/solo-universal-v2-reviewed-source';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SHA=/^[0-9a-f]{40}$/;
function rootFile(f){
  const st=fs.lstatSync(f);
  if(!st.isFile()||st.isSymbolicLink()||st.uid!==0||st.gid!==0||
     (st.mode&0o777)!==0o600||st.size<1||st.size>32768)
    fail('root_file_not_pinned');
  return fs.readFileSync(f);
}
function trustedDir(f){
  const st=fs.lstatSync(f);
  if(!st.isDirectory()||st.isSymbolicLink()||fs.realpathSync(f)!==f||
     st.uid!==0||st.gid!==0||(st.mode&0o777)!==0o700)
    fail('root_directory_untrusted');
}
function fsyncDir(f){
  const fd=fs.openSync(f,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
  try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
function runGit(args){
  const proc=cp.spawnSync('/usr/bin/git',['-C',SOURCE,...args],{
    encoding:'utf8',timeout:7000,maxBuffer:8192,env:{
      PATH:'/usr/bin:/bin',LANG:'C',HOME:'/nonexistent',
      GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',
      GIT_TERMINAL_PROMPT:'0',
    },
  });
  if(proc.error||proc.status!==0)fail('source_git_attestation_failed');
  return proc.stdout.trim();
}
function attestSourceSha(){
  trustedDir(SOURCE);
  const head=runGit(['rev-parse','HEAD']);
  if(!SHA.test(head))fail('source_sha_invalid');
  if(runGit(['status','--porcelain'])!=='')fail('dirty_source_checkout');
  if(runGit(['remote','get-url','origin'])!=='https://github.com/prhmonline/prhm-host-actions.git' &&
     runGit(['remote','get-url','origin'])!=='git@github.com:prhmonline/prhm-host-actions.git')
    fail('source_origin_untrusted');
  return head;
}
function requireReceiptProof(proof,nowSec){
  if(!proof||proof.verified!==true||proof.consumed!==false||
     proof.operation!==P.operation||
     proof.candidate_digest!==P.candidate_digest||
     proof.profile_sha256!==P.profile_sha256||
     !UUID.test(proof.jti||'')||!UUID.test(proof.request_id||'')||
     !SHA.test(proof.driver_git_sha||'')||
     !Number.isSafeInteger(nowSec)||nowSec<=0||
     !Number.isSafeInteger(proof.expiry)||proof.expiry<=nowSec)
    fail('receipt_untrusted');
}
function durableConsumeVerified(proof,dir,nowSec){
  requireReceiptProof(proof,nowSec);
  if(typeof dir!=='string'||!path.isAbsolute(dir)||path.resolve(dir)!==dir)
    fail('ledger_path_invalid');
  const st=fs.lstatSync(dir);
  if(!st.isDirectory()||st.isSymbolicLink()||fs.realpathSync(dir)!==dir||
     (st.mode&0o077)!==0||st.uid!==process.getuid())
    fail('ledger_permissions_untrusted');
  const marker=path.join(dir,proof.jti+'.json');
  const payload=Buffer.from(JSON.stringify({
    schema:'prhm.solo-universal-v2.consumed-owner-l4.v1',
    jti:proof.jti,request_id:proof.request_id,operation:P.operation,
    driver_git_sha:proof.driver_git_sha,
    candidate_digest:P.candidate_digest,profile_sha256:P.profile_sha256,
  })+'\n');
  let fd;
  try{
    fd=fs.openSync(marker,fs.constants.O_CREAT|fs.constants.O_EXCL|
      fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
  }catch(e){
    if(e.code==='EEXIST')fail('signed_one_time_receipt_replay');
    throw e;
  }
  try{fs.writeFileSync(fd,payload);fs.fsyncSync(fd)}
  finally{fs.closeSync(fd)}
  fsyncDir(dir);
  return Object.freeze({
    verified:true,consumed:true,operation:P.operation,
    driver_git_sha:proof.driver_git_sha,
    candidate_digest:P.candidate_digest,profile_sha256:P.profile_sha256,
    jti:proof.jti,request_id:proof.request_id,
  });
}
/*
 * The production entry has fixed paths, cannot consume a synthetic key,
 * and never creates or self-signs a receipt.
 */
function verifyConsumeProduction(){
  if(process.geteuid()!==0||process.getuid()!==0)fail('root_only');
  trustedDir(LEDGER);trustedDir(path.dirname(P.owner_receipt_path));
  const sourceSha=attestSourceSha();
  const token=rootFile(P.owner_receipt_path).toString('ascii').trim();
  const publicKey=rootFile(P.public_key_path);
  const nowSec=Math.floor(Date.now()/1000);
  const proof=release.verifyProductionOwnerPermit({
    token,publicKeyPem:publicKey,driverGitSha:sourceSha,nowSec,
  });
  // CRITICAL: durable consumption precedes ANY install/version/profile write.
  return durableConsumeVerified(proof,LEDGER,Math.floor(Date.now()/1000));
}
module.exports=Object.freeze({
  LEDGER,SOURCE,attestSourceSha,requireReceiptProof,
  durableConsumeVerified,verifyConsumeProduction,
});
if(require.main===module){
  process.stderr.write('NO_CLI: signed root adapter required\n');
  process.exitCode=64;
}