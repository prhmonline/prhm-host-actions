'use strict';
/**
 * Honartik #217 — SOURCE/REVIEW ONLY provider-bootstrap authorization.
 *
 * This is a *different* authorization from the post-registration Universal
 * Installer upgrade L4. It cannot mint a signature, register a Host Action,
 * reach the Provider, or install files. A Provider Root-of-Trust independently
 * controls the signer/anchor and has to wire its reviewed trusted dispatcher.
 *
 * Synthetic test keys MUST NEVER be used as a production signing identity.
 */
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const TX=require('./honartik-universal-installer-owner-bootstrap-native-fs-v1.cjs');
const REG=require('./honartik-universal-installer-registration-review-pack-v1.cjs');
const DISPATCH=require('./honartik-universal-installer-native-dispatch-registration-review-v1.cjs');
const ACTION='root_registration.honartik_universal_installer_upgrade_v1';
const ISSUER='prhm-provider-root-of-trust';
const AUDIENCE='prhm-agent-selfmaint-exec';
const SCHEMA='prhm.provider-root-bootstrap-authorization.v1';
const KEY_PATH='/var/lib/prhm-agent-selfmaint-exec/root-of-trust/provider-bootstrap-ed25519-public.pem';
const TX_ROOT='/var/lib/prhm-agent-selfmaint-exec/root-of-trust/honartik-registration';
const SHA256=v=>crypto.createHash('sha256').update(v).digest('hex');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const SOURCE_SHA=REG.SOURCE_SHA;
// A separate, independently provisioned Provider signer MUST be reviewed and
// pinned in a later SHA-bound commit. NULL deliberately blocks live apply.
const PINNED_PROVIDER_KEY_SHA256=null;
const fail=k=>{throw Error('honartik217_provider_bootstrap_'+k)};
const need=(condition,k)=>{if(!condition)fail(k)};
function keysExact(obj,expected){
 return !!obj&&typeof obj==='object'&&!Array.isArray(obj)&&
  Object.keys(obj).sort().join('|')===expected.slice().sort().join('|');
}
function b64decode(segment){
 need(typeof segment==='string'&&/^[A-Za-z0-9_-]+$/.test(segment),'token_encoding');
 const b=Buffer.from(segment,'base64url');
 need(b.length>0&&b.toString('base64url')===segment,'token_canonical_encoding');
 return b;
}
function parseCanonicalJson(b){
 let obj;
 try{obj=JSON.parse(b.toString('utf8'))}catch{fail('invalid_json')}
 need(Buffer.from(JSON.stringify(obj)).equals(b),'noncanonical_json');
 return obj;
}
function verifyBootstrapReceipt({token,publicKey,plan,environment,requestId,nowSeconds}={}){
 TX.checkPlan(plan);
 need(environment==='isolated-vm'||environment==='production','environment_invalid');
 need(typeof requestId==='string'&&UUID.test(requestId),'request_id_invalid');
 need(Number.isSafeInteger(nowSeconds)&&nowSeconds>0,'time_invalid');
 need(typeof token==='string'&&token.length>=100&&token.length<=16384,'token_unavailable');
 const sections=token.split('.');
 need(sections.length===3,'token_parts');
 const header=parseCanonicalJson(b64decode(sections[0]));
 const payload=parseCanonicalJson(b64decode(sections[1]));
 const signature=b64decode(sections[2]);
 let key;
 try{key=crypto.createPublicKey(publicKey)}catch{fail('public_key_invalid')}
 need(key.asymmetricKeyType==='ed25519','key_type_invalid');
 const kid=SHA256(key.export({format:'der',type:'spki'})).slice(0,16);
 need(keysExact(header,['alg','typ','kid'])&&header.alg==='EdDSA'&&
  header.typ==='PRHM-PROVIDER-ROOT-BOOTSTRAP'&&header.kid===kid,'header_invalid');
 need(signature.length===64&&crypto.verify(null,
  Buffer.from(sections[0]+'.'+sections[1]),key,signature),'signature_invalid');
 need(keysExact(payload,['schema','issuer','audience','operation',
  'project','environment','request_id','approval_id','source_commit',
  'manifest_sha256','iat','nbf','exp']),'claims_shape_invalid');
 need(payload.schema===SCHEMA&&payload.issuer===ISSUER&&
  payload.audience===AUDIENCE&&payload.operation===ACTION&&
  payload.project==='control_plane'&&payload.environment===environment&&
  payload.request_id===requestId&&UUID.test(payload.approval_id||'')&&
  payload.source_commit===SOURCE_SHA&&plan.sourceCommit===SOURCE_SHA&&
  payload.manifest_sha256===plan.manifestSha256&&
  Number.isSafeInteger(payload.iat)&&Number.isSafeInteger(payload.nbf)&&
  Number.isSafeInteger(payload.exp)&&
  payload.iat<=nowSeconds&&payload.nbf<=nowSeconds&&
  payload.exp>nowSeconds&&payload.exp>payload.iat&&
  payload.exp-payload.iat<=180,'claims_binding_invalid');
 return Object.freeze({verified:true,requestId,approvalId:payload.approval_id,
  environment,sourceCommit:SOURCE_SHA,manifestSha256:plan.manifestSha256});
}
function assertPinnedRegistrationPlan(plan){
 TX.checkPlan(plan);
 need(plan.sourceCommit===REG.SOURCE_SHA,'source_commit_drift');
 const order=['base','executor','mcp','policy'];
 need(plan.steps.every((s,i)=>s.key===order[i]&&
   s.path===REG.TARGETS[s.key].path&&
   s.beforeSha===REG.TARGETS[s.key].sha256&&
   s.expectedUid===0&&s.expectedGid===0&&
   s.expectedMode===({base:0o644,executor:0o755,mcp:0o600,policy:0o644})[s.key]),
  'root_owner_target_or_preimage_drift');
 const expectedAssetNames=[...Object.keys(REG.ARTIFACTS),DISPATCH.SHIM];
 need(plan.assets.length===expectedAssetNames.length,'asset_count_drift');
 for(let i=0;i<plan.assets.length;i++){
  const a=plan.assets[i],name=expectedAssetNames[i];
  need(a.path==='/opt/prhm-agent-selfmaint-exec/actions/'+name,'asset_target_drift');
  const blob=crypto.createHash('sha1')
   .update(Buffer.concat([Buffer.from('blob '+a.nextBytes.length+'\0'),a.nextBytes]))
   .digest('hex');
  need(blob===(name===DISPATCH.SHIM?DISPATCH.SHIM_BLOB:REG.ARTIFACTS[name]),
   'asset_git_blob_drift');
 }
 const manifest=SHA256(Buffer.from(JSON.stringify({
  action:'honartik_universal_installer_upgrade_v1',
  sourceCommit:plan.sourceCommit,shimBlob:DISPATCH.SHIM_BLOB,
  steps:plan.steps.map(s=>[s.key,s.path,s.beforeSha,s.afterSha,
   s.expectedUid,s.expectedGid,s.expectedMode]),
  assets:plan.assets.map(a=>[a.path,a.afterSha])
 })));
 need(plan.manifestSha256===manifest,'signed_manifest_digest_drift');
 return true;
}
function readPinnedProviderTrustAnchor(){
 need(process.getuid?.()===0,'root_required');
 // Live bootstrap is blocked until the independent Provider key, SHA pin,
 // and root-owned dispatcher are provisioned from a trusted console.
 need(SHA.test(PINNED_PROVIDER_KEY_SHA256||''),'provider_key_not_provisioned');
 let d=path.dirname(KEY_PATH);
 while(true){
  const st=fs.lstatSync(d);
  need(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===0&&
    (st.mode&0o022)===0,'provider_parent_untrusted');
  if(d==='/')break;
  d=path.dirname(d);
 }
 const pre=fs.lstatSync(KEY_PATH);
 need(pre.isFile()&&!pre.isSymbolicLink()&&pre.nlink===1&&pre.uid===0&&
  (pre.mode&0o777)===0o600&&pre.size>70&&pre.size<8192,
  'provider_key_file_untrusted');
 const fd=fs.openSync(KEY_PATH,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const stat=fs.fstatSync(fd);
  need(stat.ino===pre.ino&&stat.dev===pre.dev&&stat.size===pre.size&&
   stat.uid===pre.uid&&stat.mode===pre.mode,'provider_key_race');
  const b=fs.readFileSync(fd);
  need(SHA256(b)===PINNED_PROVIDER_KEY_SHA256,'provider_key_sha_drift');
  return b;
 }finally{fs.closeSync(fd)}
}
function reserveConsumedOnce(workRoot,approvalId){
 const st=fs.lstatSync(workRoot);
 need(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&
  (st.mode&0o777)===0o700&&fs.realpathSync(workRoot)===workRoot,
  'root_journal_untrusted');
 const dir=path.join(workRoot,'bootstrap-approval-leases');
 if(!fs.existsSync(dir)){
  fs.mkdirSync(dir,{mode:0o700});
  const parentFd=fs.openSync(workRoot,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
  try{fs.fsyncSync(parentFd)}finally{fs.closeSync(parentFd)}
 }
 const stDir=fs.lstatSync(dir);
 need(stDir.isDirectory()&&!stDir.isSymbolicLink()&&
  stDir.uid===process.getuid()&&(stDir.mode&0o777)===0o700,
  'lease_directory_untrusted');
 const lease=path.join(dir,approvalId+'.lease');
 const fd=fs.openSync(lease,'wx',0o600);
 try{
  const bytes=Buffer.from(JSON.stringify({approvalId})+'\n');
  fs.writeSync(fd,bytes);fs.fsyncSync(fd);
 }finally{fs.closeSync(fd)}
 const dfd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
 try{fs.fsyncSync(dfd)}finally{fs.closeSync(dfd)}
 return true; // Never delete the lease, even after rollback.
}
async function executeSignedRegistrationFromTrustedProvider({
 requestId,environment,plan,rootSealedTokenLoader,postInstall,postRollback
}={}){
 need(process.getuid?.()===0,'root_required');
 need(environment==='isolated-vm'||environment==='production','environment_invalid');
 need(typeof rootSealedTokenLoader==='function','sealed_token_loader_required');
 need(typeof postInstall==='function'&&typeof postRollback==='function',
  'service_callbacks_required');
 // Any generic request/CLI must fail until the Provider-owned anchor is
 // installed with its independent review-bound SHA and dispatcher.
 const publicKey=readPinnedProviderTrustAnchor();
 assertPinnedRegistrationPlan(plan);
 const token=rootSealedTokenLoader(requestId);
 const proof=verifyBootstrapReceipt({
  token,publicKey,plan,requestId,environment,nowSeconds:Math.floor(Date.now()/1000)
 });
 // Fatal/no-retry after receipt reservation, including rollback or crash.
 reserveConsumedOnce(TX_ROOT,proof.approvalId);
 return TX.executeCore(plan,{workRoot:TX_ROOT,postInstall,postRollback});
}
module.exports=Object.freeze({
 ACTION,ISSUER,AUDIENCE,SCHEMA,KEY_PATH,TX_ROOT,SOURCE_SHA,
 PINNED_PROVIDER_KEY_SHA256,
 verifyBootstrapReceipt,assertPinnedRegistrationPlan,
 readPinnedProviderTrustAnchor,executeSignedRegistrationFromTrustedProvider,
 REVIEW_ONLY:true,PROVIDER_DISPATCH_REGISTERED:false,
 APPROVAL_ISSUER_PRESENT:false,PRODUCTION_AUTHORIZED:false
});
if(require.main===module){
 process.stderr.write('Provider Root-of-Trust adapter is not installed: no standalone apply.\n');
 process.exitCode=64;
}
