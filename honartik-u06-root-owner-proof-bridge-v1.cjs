'use strict';
/**
 * Fixed Root-side U06 GitHub owner-identity sealed proof bridge.
 *
 * Stage a GitHub Actions encrypted output in a root-owned 0600 file and
 * verify it against a root-generated X25519 one-use challenge. Only the
 * official GitHub JWKS/run metadata and pinned owner workflow identity
 * can produce a verified owner proof for coordinator consumption.
 * No L4 authorization, arbitrary key, API server or CLI supplied here.
 */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const crypto=require('node:crypto'),https=require('node:https');
const Owner=require('./honartik-u06-owner-oidc-identity-gate-v1.cjs');
const Sealed=require('./universal-owner-oidc-sealed-transport-v1.cjs');
const DIR='/var/lib/prhm-agent-selfmaint-exec/honartik-u06-native-root/owner-oidc';
const CHALLENGE=DIR+'/challenge.json';
const PRIVATE=DIR+'/host-private.pem';
const ENVELOPE=DIR+'/encrypted-gh-evidence.json';
const PINNED_REPO='prhmonline/prhm-host-actions';
const FAIL=x=>{throw Error('u06_owner_sealed_root_'+x)};
const must=(v,x)=>{if(!v)FAIL(x)};
const sync=dir=>{const fd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
 try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}};
function requireDir(){
 must(process.getuid?.()===0&&os.hostname()==='prhm-production.prhm.ir','root_host');
 const d=fs.lstatSync(DIR);
 must(d.isDirectory()&&!d.isSymbolicLink()&&d.uid===0&&d.gid===0&&
  (d.mode&0o777)===0o700,'trusted_owner_proof_directory_missing');
}
function readOwned(p,max=50000){
 const a=fs.lstatSync(p);
 must(a.isFile()&&!a.isSymbolicLink()&&a.uid===0&&a.gid===0&&
  (a.mode&0o777)===0o600&&a.nlink===1&&a.size>0&&a.size<=max,
  'owner_proof_file_untrusted');
 const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const b=fs.fstatSync(fd);
  must(a.dev===b.dev&&a.ino===b.ino&&a.size===b.size,'owner_proof_file_race');
  return fs.readFileSync(fd);
 }finally{fs.closeSync(fd)}
}
function writeExclusive(p,bytes){
 const fd=fs.openSync(p,fs.constants.O_WRONLY|fs.constants.O_CREAT|
  fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd)}
 finally{fs.closeSync(fd)}
 sync(DIR);
}
function readOfficialSha(){
 return new Promise((resolve,reject)=>{
  const u='https://api.github.com/repos/'+PINNED_REPO+'/commits/main';
  const req=https.get(u,{headers:{'User-Agent':'prhm-u06-root-owner-proof-v1',
   'Accept':'application/vnd.github+json'},timeout:9000},res=>{
   if(res.statusCode!==200){res.resume();reject(Error('github_main_unavailable'));return}
   const chunks=[];let n=0;
   res.on('data',b=>{n+=b.length;if(n>180000)req.destroy(Error('github_sha_oversized'));else chunks.push(b)});
   res.on('end',()=>{try{
    const j=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    must(/^[0-9a-f]{40}$/.test(j.sha||''),'github_main_sha_invalid');
    resolve(j.sha);
   }catch(e){reject(e)}});
  });
  req.on('timeout',()=>req.destroy(Error('github_sha_timeout')));req.on('error',reject);
 });
}
async function prepareOwnerChallenge(){
 requireDir();
 for(const file of [CHALLENGE,PRIVATE,ENVELOPE]){
  must(!fs.existsSync(file),'prior_owner_challenge_requires_reconciliation');
 }
 const expectedRunSha=await readOfficialSha();
 const challenge=crypto.randomBytes(32).toString('hex');
 const pair=crypto.generateKeyPairSync('x25519');
 const publicB64=pair.publicKey.export({format:'der',type:'spki'}).toString('base64');
 const issuedAt=Date.now();
 writeExclusive(PRIVATE,pair.privateKey.export({format:'pem',type:'pkcs8'}));
 writeExclusive(CHALLENGE,Buffer.from(JSON.stringify({
  schema:'prhm.u06.root-owner-identity-challenge.v1',
  challenge,expectedRunSha,issued_at_ms:issuedAt,
  expires_at_ms:issuedAt+8*60*1000,
  workflow_ref:Owner.W.workflowRef,
  public_key_spki_b64:publicB64
 })+'\n'));
 return Object.freeze({
  schema:'prhm.u06.owner-proof-prepare.v1',
  challenge,public_key_spki_b64:publicB64,
  expected_run_sha:expectedRunSha,
  operator_action:'Trigger exact pinned GitHub U06 owner OIDC workflow and securely stage encrypted output',
  root_action_registered:false,level4_issued:false,production_mutated:false
 });
}
async function consumeStagedOwnerProof(){
 requireDir();
 const c=JSON.parse(readOwned(CHALLENGE).toString('utf8'));
 must(c.schema==='prhm.u06.root-owner-identity-challenge.v1'&&
  /^[0-9a-f]{64}$/.test(c.challenge||'')&&
  /^[0-9a-f]{40}$/.test(c.expectedRunSha||'')&&
  c.workflow_ref===Owner.W.workflowRef&&
  Date.now()>c.issued_at_ms&&Date.now()<c.expires_at_ms,
  'owner_challenge_expired_or_wrong_workflow');
 const k=crypto.createPrivateKey(readOwned(PRIVATE));
 must(k.asymmetricKeyType==='x25519','owner_ephemeral_key_invalid');
 const sealed=JSON.parse(readOwned(ENVELOPE).toString('utf8'));
 const token=Sealed.openSealedJwt(sealed,c.challenge,k);
 // Verify GitHub's RSA signature, run actor, workflow, exact pinned SHA,
 // one-use jti and nonce directly against authoritative endpoints.
 const proof=await Owner.verifyFromOfficialGitHub({
   token,challenge:c.challenge,expectedRunSha:c.expectedRunSha
 });
 must(Owner.proofVerifiedInCurrentProcess(proof)&&
  proof.intent_digest===Owner.intentDigest()&&
  proof.backend_deploy_authorized===false&&
  proof.approval_to_modify_production===false,
  'github_owner_proof_not_valid');
 return proof; // actual owner OIDC one-use fence happens after Root's L4.
}
module.exports=Object.freeze({
 DIR,CHALLENGE,PRIVATE,ENVELOPE,prepareOwnerChallenge,consumeStagedOwnerProof,
 ROOT_ACTION_REGISTERED:false,AUTO_DEPLOY:false,LEVEL4_ISSUER:false
});
if(require.main===module){
 process.stderr.write('No owner identity CLI. Root trustee must stage a genuine sealed official GitHub proof.\n');
 process.exitCode=64;
}
