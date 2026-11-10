'use strict';
/*
 * Root-only, non-deploying verification bridge for exactly ONE Honartik
 * finance OWNER IDENTITY proof. It does NOT execute PHP, Git deployment,
 * MariaDB, restore, wallet credit, service restart or a generic root action.
 *
 * All runtime state/keys stay in root-owned paths. Official GitHub API
 * reads use unauthenticated HTTPS ONLY for this verified PUBLIC repository. This is a prerequisite to a SEPARATE,
 * reviewed, bounded finance release coordinator, not that coordinator.
 */
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const https=require('node:https');
const gate=require('./honartik-finance-owner-oidc-identity-v1.cjs');
const fence=require('./honartik-finance-owner-once-fence-v1.cjs');
const transport=require('./universal-owner-oidc-sealed-transport-v1.cjs');
const {G,parseToken}=require('./universal-owner-oidc-recovery-gate-v1.cjs');

const STATE='/var/lib/prhm-honartik-finance-owner';
const CONFIG='/etc/prhm-honartik-finance-owner/identity.json';
const HEX64=/^[0-9a-f]{64}$/;
const HEX40=/^[0-9a-f]{40}$/;
const deny=s=>{throw Error('HONARTIK_FINANCE_OWNER_BLOCKED='+s)};
const need=(p,s)=>{if(!p)deny(s)};
function rootOnly(){
  need(process.getuid?.()===0,'requires_existing_root_operator');
  need(os.hostname()==='prhm-production.prhm.ir','wrong_host');
}
function rootDir(p){
  const stat=fs.lstatSync(p);
  need(stat.isDirectory()&&!stat.isSymbolicLink()&&
       stat.uid===0&&(stat.mode&0o777)===0o700,'untrusted_directory');
}
function rootFile(p,max=8192){
  const st=fs.lstatSync(p);
  need(st.isFile()&&!st.isSymbolicLink()&&st.uid===0&&
       (st.mode&0o777)===0o600&&st.size>0&&st.size<max,
       'untrusted_file');
  const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    const after=fs.fstatSync(fd);
    need(after.ino===st.ino&&after.dev===st.dev&&after.uid===0,
         'changed_file');
    return fs.readFileSync(fd,{encoding:'utf8'});
  }finally{fs.closeSync(fd)}
}
function config(){
  rootDir(path.dirname(CONFIG));
  const obj=JSON.parse(rootFile(CONFIG));
  need(Object.keys(obj).sort().join(',')==='expected_workflow_sha,installed_source_sha,operation,production_base_sha,source_sha',
      'unrecognized_config');
  need(obj.operation===gate.INTENT.operation&&
       obj.production_base_sha===gate.INTENT.production_base_sha&&
       obj.source_sha===gate.INTENT.source_sha&&
       HEX40.test(obj.expected_workflow_sha)&&
       HEX40.test(obj.installed_source_sha),'wrong_release_binding');
  return obj;
}
function stateDirs(){
  rootDir(STATE);
  for(const d of ('pending inbox consumed').split(' '))
    rootDir(path.join(STATE,d));
}
function createChallenge(){
  rootOnly();
  const c=config();
  stateDirs();
  const nonce=crypto.randomBytes(32).toString('hex');
  const keys=crypto.generateKeyPairSync('x25519');
  const record={
    schema:'prhm.honartik.finance-owner-pending.v1',
    challenge:nonce,
    created_at:Math.floor(Date.now()/1000),
    expires_at:Math.floor(Date.now()/1000)+600,
    expected_workflow_sha:c.expected_workflow_sha,
    private_pkcs8_der_b64:keys.privateKey.export({
      format:'der',type:'pkcs8'
    }).toString('base64')
  };
  const p=path.join(STATE,'pending',nonce+'.json');
  const fd=fs.openSync(p,
    fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|
    fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,JSON.stringify(record)+'\n');fs.fsyncSync(fd)}
  finally{fs.closeSync(fd)}
  const dirFd=fs.openSync(path.join(STATE,'pending'),
    fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
  try{fs.fsyncSync(dirFd)}finally{fs.closeSync(dirFd)}
  return {
    operation:gate.INTENT.operation,
    source_sha:c.source_sha,production_base_sha:c.production_base_sha,
    challenge:nonce,
    host_transport_x25519_public_key_b64:keys.publicKey.export({
      format:'der',type:'spki'
    }).toString('base64'),
    identity_only:true,production_authorized:false
  };
}
function githubJSON(url,max=350000){
  const allowed=(
    url===G.jwks||
    new RegExp('^'+G.api+'/repos/'+G.owner+'/'+G.repo+'/actions/runs/[0-9]{1,20}
    url===G.api+'/repos/'+G.owner+'/'+G.repo+'/environments/'+gate.W.environment||
    url===G.api+'/repos/'+G.owner+'/'+G.repo+'/environments/'+gate.W.environment+'/deployment-branch-policies'
  );
  need(allowed,'endpoint_not_allowlisted');
  return new Promise((resolve,reject)=>{
    const headers={'User-Agent':'prhm-honartik-finance-owner-host-verifier-v1',
      'Accept':'application/vnd.github+json'};
    const req=https.get(url,{headers,timeout:9000},res=>{
      if(res.statusCode!==200){res.resume();reject(Error('github_http_'+res.statusCode));return}
      let count=0,buffers=[];
      res.on('data',chunk=>{
        count+=chunk.length;
        if(count>max)req.destroy(Error('github_response_too_large'));
        else buffers.push(chunk);
      });
      res.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(buffers).toString('utf8')))}
        catch(e){reject(e)}});
      res.on('error',reject);
    });
    req.on('timeout',()=>req.destroy(Error('github_api_timeout')));
    req.on('error',reject);
  });
}
async function consumeChallenge(nonce){
  rootOnly();
  need(typeof nonce==='string'&&HEX64.test(nonce),'challenge_format');
  const c=config();
  stateDirs();
  const now=Math.floor(Date.now()/1000);
  const raw=JSON.parse(rootFile(path.join(STATE,'pending',nonce+'.json'),10000));
  need(raw.schema==='prhm.honartik.finance-owner-pending.v1'&&
       raw.challenge===nonce&&raw.expected_workflow_sha===c.expected_workflow_sha&&
       Number.isSafeInteger(raw.created_at)&&Number.isSafeInteger(raw.expires_at)&&
       raw.created_at<=now+5&&raw.expires_at>now&&
       raw.expires_at-raw.created_at<=600,'expired_or_wrong_challenge');
  const privateKey=crypto.createPrivateKey({
    key:Buffer.from(raw.private_pkcs8_der_b64,'base64'),
    format:'der',type:'pkcs8'
  });
  need(privateKey.asymmetricKeyType==='x25519','bad_private_key');
  // The only admitted artifact name is derived from our own random nonce.
  const artifact=JSON.parse(rootFile(path.join(STATE,'inbox',nonce+'.json'),60000));
  const token=transport.openSealedJwt(artifact,nonce,privateKey);
  const claims=parseToken(token).claims; // untrusted: used solely to choose official read endpoint
  need(/^[0-9]{1,20}$/.test(String(claims.run_id)),'bad_run_id');
  const root=G.api+'/repos/'+G.owner+'/'+G.repo;
  const [jwks,run,env,branches]=await Promise.all([
    githubJSON(G.jwks,250000),
    githubJSON(root+'/actions/runs/'+String(claims.run_id)),
    githubJSON(root+'/environments/'+gate.W.environment),
    githubJSON(root+'/environments/'+gate.W.environment+'/deployment-branch-policies')
  ]);
  // Critically rejects can_admins_bypass=true, a missing environment,
  // wrong repo/actor, wrong workflow SHA, incorrect nonce and expired JWT.
  const proof=gate.verifyFinanceOwnerIdentity({
    token,jwks,environment:env,branches,run,challenge:nonce,
    expectedWorkflowSha:c.expected_workflow_sha,nowSec:now
  });
  const consumed=fence.consumeVerifiedFinanceIdentity(proof,{
    directory:path.join(STATE,'consumed'),trustedUid:0
  });
  need(consumed.consumed===true&&consumed.finance_release_authorized===false,
       'invalid_consumption');
  return {
    operation:gate.INTENT.operation,
    source_sha:c.source_sha,production_base_sha:c.production_base_sha,
    owner_identity_verified:true,
    one_use_consumed:true,run_id:proof.run_id,
    root_verifier_only:true,finance_release_authorized:false,
    production_mutated:false
  };
}
async function main(){
  rootOnly();
  const cmd=process.argv[2];
  if(cmd==='issue'&&process.argv.length===3)
    console.log(JSON.stringify(createChallenge()));
  else if(cmd==='consume'&&process.argv.length===4)
    console.log(JSON.stringify(await consumeChallenge(process.argv[3])));
  else deny('unsupported_operator_command');
}
module.exports=Object.freeze({
  STATE,CONFIG,createChallenge,consumeChallenge,
  rootFile,rootDir,githubJSON,ROOT_RELEASE_EXPORTED:false,
  DEPLOY_AUTHORIZED:false
});
if(require.main===module){
  main().catch(e=>{
    const code=String(e.message||'untrusted_error');
    console.error('HONARTIK_FINANCE_OWNER_VERIFIER=BLOCKED reason='+
      (code.startsWith('HONARTIK_FINANCE_OWNER_BLOCKED=')?
       code.slice('HONARTIK_FINANCE_OWNER_BLOCKED='.length):
       'verification_failed'));
    process.exitCode=2;
  });
}
).test(url)||
    url===G.api+'/repos/'+G.owner+'/'+G.repo+'/environments/'+gate.W.environment||
    url===G.api+'/repos/'+G.owner+'/'+G.repo+'/environments/'+gate.W.environment+'/deployment-branch-policies'
  );
  need(allowed,'endpoint_not_allowlisted');
  return new Promise((resolve,reject)=>{
    const headers={'User-Agent':'prhm-honartik-finance-owner-host-verifier-v1',
      'Accept':'application/vnd.github+json'};
    if(url!==G.jwks)headers.Authorization='Bearer '+bearer;
    const req=https.get(url,{headers,timeout:9000},res=>{
      if(res.statusCode!==200){res.resume();reject(Error('github_http_'+res.statusCode));return}
      let count=0,buffers=[];
      res.on('data',chunk=>{
        count+=chunk.length;
        if(count>max)req.destroy(Error('github_response_too_large'));
        else buffers.push(chunk);
      });
      res.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(buffers).toString('utf8')))}
        catch(e){reject(e)}});
      res.on('error',reject);
    });
    req.on('timeout',()=>req.destroy(Error('github_api_timeout')));
    req.on('error',reject);
  });
}
async function consumeChallenge(nonce){
  rootOnly();
  need(typeof nonce==='string'&&HEX64.test(nonce),'challenge_format');
  const c=config();
  stateDirs();
  const now=Math.floor(Date.now()/1000);
  const raw=JSON.parse(rootFile(path.join(STATE,'pending',nonce+'.json'),10000));
  need(raw.schema==='prhm.honartik.finance-owner-pending.v1'&&
       raw.challenge===nonce&&raw.expected_workflow_sha===c.expected_workflow_sha&&
       Number.isSafeInteger(raw.created_at)&&Number.isSafeInteger(raw.expires_at)&&
       raw.created_at<=now+5&&raw.expires_at>now&&
       raw.expires_at-raw.created_at<=600,'expired_or_wrong_challenge');
  const privateKey=crypto.createPrivateKey({
    key:Buffer.from(raw.private_pkcs8_der_b64,'base64'),
    format:'der',type:'pkcs8'
  });
  need(privateKey.asymmetricKeyType==='x25519','bad_private_key');
  // The only admitted artifact name is derived from our own random nonce.
  const artifact=JSON.parse(rootFile(path.join(STATE,'inbox',nonce+'.json'),60000));
  const token=transport.openSealedJwt(artifact,nonce,privateKey);
  const claims=parseToken(token).claims; // untrusted: used solely to choose official read endpoint
  need(/^[0-9]{1,20}$/.test(String(claims.run_id)),'bad_run_id');
  const root=G.api+'/repos/'+G.owner+'/'+G.repo;
  const auth=rootFile(API_TOKEN,4096).trim();
  need(/^[^\s]{30,400}$/.test(auth),'untrusted_api_credential');
  const [jwks,run,env,branches]=await Promise.all([
    githubJSON(G.jwks,null,250000),
    githubJSON(root+'/actions/runs/'+String(claims.run_id),auth),
    githubJSON(root+'/environments/'+gate.W.environment,auth),
    githubJSON(root+'/environments/'+gate.W.environment+'/deployment-branch-policies',auth)
  ]);
  // Critically rejects can_admins_bypass=true, a missing environment,
  // wrong repo/actor, wrong workflow SHA, incorrect nonce and expired JWT.
  const proof=gate.verifyFinanceOwnerIdentity({
    token,jwks,environment:env,branches,run,challenge:nonce,
    expectedWorkflowSha:c.expected_workflow_sha,nowSec:now
  });
  const consumed=fence.consumeVerifiedFinanceIdentity(proof,{
    directory:path.join(STATE,'consumed'),trustedUid:0
  });
  need(consumed.consumed===true&&consumed.finance_release_authorized===false,
       'invalid_consumption');
  return {
    operation:gate.INTENT.operation,
    source_sha:c.source_sha,production_base_sha:c.production_base_sha,
    owner_identity_verified:true,
    one_use_consumed:true,run_id:proof.run_id,
    root_verifier_only:true,finance_release_authorized:false,
    production_mutated:false
  };
}
async function main(){
  rootOnly();
  const cmd=process.argv[2];
  if(cmd==='issue'&&process.argv.length===3)
    console.log(JSON.stringify(createChallenge()));
  else if(cmd==='consume'&&process.argv.length===4)
    console.log(JSON.stringify(await consumeChallenge(process.argv[3])));
  else deny('unsupported_operator_command');
}
module.exports=Object.freeze({
  STATE,CONFIG,API_TOKEN,createChallenge,consumeChallenge,
  rootFile,rootDir,githubJSON,ROOT_RELEASE_EXPORTED:false,
  DEPLOY_AUTHORIZED:false
});
if(require.main===module){
  main().catch(e=>{
    const code=String(e.message||'untrusted_error');
    console.error('HONARTIK_FINANCE_OWNER_VERIFIER=BLOCKED reason='+
      (code.startsWith('HONARTIK_FINANCE_OWNER_BLOCKED=')?
       code.slice('HONARTIK_FINANCE_OWNER_BLOCKED='.length):
       'verification_failed'));
    process.exitCode=2;
  });
}
