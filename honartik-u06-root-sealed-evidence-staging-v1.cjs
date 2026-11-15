'use strict';
/**
 * Fixed U06 encrypted GitHub OIDC evidence staging.
 *
 * SOURCE ONLY: requires an independently authorized and installed shared
 * Root gate, which this draft does NOT provide. No CLI, owner approval issuer,
 * token decryption, MySQL or Native backup, and no caller-chosen path.
 * The received envelope is encrypted; a later separate verifier must validate
 * the GitHub JWS, actor, run, SHA, nonce and one-use proof.
 */
const fs=require('node:fs');
const crypto=require('node:crypto');
const os=require('node:os');
const Shared=require('./honartik-u06-shared-exclusive-lock-v1.cjs');
const DIR='/var/lib/prhm-agent-selfmaint-exec/honartik-u06-native-root/owner-oidc';
const CHALLENGE=DIR+'/challenge.json';
const ENVELOPE=DIR+'/encrypted-gh-evidence.json';
const RECOVERY=DIR+'/reconciliation.journal.json';
const SHA=b=>crypto.createHash('sha256').update(b).digest('hex');
const deny=x=>{throw Error('u06_sealed_stage_'+x)};
const need=(ok,x)=>{if(!ok)deny(x)};
function verifiedOwnedFile(file,max) {
 const st=fs.lstatSync(file);
 need(st.isFile()&&!st.isSymbolicLink()&&st.uid===0&&st.gid===0&&
  st.nlink===1&&(st.mode&0o777)===0o600&&st.size>0&&st.size<=max,
  'untrusted_file');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try {
  const b=fs.fstatSync(fd);
  need(st.dev===b.dev&&st.ino===b.ino&&st.mode===b.mode&&st.size===b.size,
    'raced_file');
  return fs.readFileSync(fd);
 } finally {fs.closeSync(fd)}
}
function stageSealedEvidence(sharedBinding,serialized) {
 Shared.assertSourceBoundLease(sharedBinding,'owner_evidence_staging');
 need(process.getuid?.()===0&&os.hostname()==='prhm-production.prhm.ir',
   'trusted_root_required');
 const parent=fs.lstatSync(DIR);
 need(parent.isDirectory()&&!parent.isSymbolicLink()&&parent.uid===0&&
   parent.gid===0&&(parent.mode&0o777)===0o700,'trusted_directory_required');
 need(!fs.existsSync(ENVELOPE)&&!fs.existsSync(RECOVERY),
   'prior_evidence_or_recovery');
 const c=JSON.parse(verifiedOwnedFile(CHALLENGE,8192));
 need(c.schema==='prhm.u06.root-owner-identity-challenge.v1'&&
   /^[0-9a-f]{64}$/.test(c.challenge||'')&&
   Number.isSafeInteger(c.expires_at_ms)&&Date.now()<c.expires_at_ms&&
   Date.now()>c.issued_at_ms,'challenge_expired_or_invalid');
 need(typeof serialized==='string'&&serialized.length>=100&&
   serialized.length<=80000,'sealed_size_invalid');
 let e;try{e=JSON.parse(serialized)}catch{deny('sealed_json_invalid')}
 need(e&&Object.keys(e).sort().join('|')===
  ['schema','challenge_sha256','ephemeral_spki_b64','iv_b64',
   'tag_b64','ciphertext_b64'].sort().join('|')&&
  e.schema==='prhm.universal.owner-oidc-sealed-transport.v1'&&
  e.challenge_sha256===SHA(Buffer.from(c.challenge))&&
  typeof e.ciphertext_b64==='string'&&
  e.ciphertext_b64.length>32&&e.ciphertext_b64.length<65000,
  'sealed_envelope_scope_invalid');
 Shared.assertSourceBoundLease(sharedBinding,'owner_evidence_staging');
 const fd=fs.openSync(ENVELOPE,
  fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|
  fs.constants.O_NOFOLLOW,0o600);
 try {
  fs.writeFileSync(fd,serialized.endsWith('\n')?serialized:serialized+'\n');
  fs.fsyncSync(fd);
 }finally{fs.closeSync(fd)}
 const dir=fs.openSync(DIR,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|
   fs.constants.O_NOFOLLOW);
 try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}
 return Object.freeze({staged:true,encrypted_only:true,
   envelope_sha256:SHA(Buffer.from(serialized)),owner_oidc_verified:false,
   level4_issued:false,production_backup_authorized:false});
}
module.exports=Object.freeze({stageSealedEvidence,
 ROOT_HANDLER_REGISTERED:false,PRODUCTION_AUTHORIZED:false,
 APPROVAL_ISSUER:false,ROOT_CLI_EXPORTED:false});
if(require.main===module){
 process.stderr.write('U06 encrypted proof stager has no authorized Root CLI.\n');
 process.exitCode=64;
}
