'use strict';
/**
 * Approval Center LIVE identity read-only cross-check.
 *
 * Fixed local /health endpoint + fixed local PUBLIC key and policy files.
 * This does not read private key, token, approval records or environment.
 * Network traffic strictly HTTP GET 127.0.0.1:18133/health.
 * Zero writes, restarts, signatures, request/consume calls, approvals.
 *
 * Even a PASS attests only health-reported configuration/key relationship,
 * NOT binary identity, exact authorization, replay, or human confirmation.
 */
const fs=require('node:fs'),http=require('node:http'),crypto=require('node:crypto');
const POLICY='/opt/prhm-company-control-plane/config/approval-policy.json';
const PUBLIC='/var/lib/prhm-company-approval/ed25519-public.pem';
const ENDPOINT='http://127.0.0.1:18133/health';
const ORIGINAL_POLICY_SHA='148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174';
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
function fail(x){throw Error('issuer_identity_readonly_blocked_'+x);}
function validate({policyBytes,publicKeyBytes,health,policyMetadata,publicMetadata,expectedPolicySha=ORIGINAL_POLICY_SHA}={}){
  if(!Buffer.isBuffer(policyBytes)||!Buffer.isBuffer(publicKeyBytes))fail('bytes_missing');
  for(const [kind,stat] of [['policy',policyMetadata],['public',publicMetadata]]){
    if(!stat||stat.uid!==0||stat.nlink!==1||stat.isFile!==true||
       stat.isSymbolicLink===true||(stat.mode&0o022)!==0)fail('file_trust_'+kind);
  }
  if(sha(policyBytes)!==expectedPolicySha)fail('original_policy_sha_drift');
  let policy;
  try{policy=JSON.parse(policyBytes.toString('utf8'));}catch{fail('policy_json_invalid');}
  if(policy.schema_version!=='prhm.approval-policy.v1'||
     policy.default_deny!==true||policy.one_time_use!==true||
     policy.issuer!=='prhm-company-approval')fail('policy_schema_or_controls');
  let pub;
  try{pub=crypto.createPublicKey(publicKeyBytes);}catch{fail('public_key_invalid');}
  if(pub.asymmetricKeyType!=='ed25519')fail('public_key_not_ed25519');
  const fingerprint=sha(pub.export({format:'der',type:'spki'}));
  const policyHash=sha(Buffer.from(JSON.stringify(policy),'utf8'));
  if(!health||health.ok!==true||health.service!=='prhm-company-approval'||
     health.mode!=='mcp-operator'||health.algorithm!=='Ed25519'||
     health.one_time_use!==true)fail('health_service_mismatch');
  if(health.key_fingerprint!==fingerprint)fail('health_key_fingerprint_mismatch');
  if(health.policy_hash!==policyHash||health.policy_version!==policy.version)
    fail('health_policy_mismatch');
  return Object.freeze({
    status:'LIVE_HEALTH_PUBLIC_KEY_AND_POLICY_CONSISTENT',
    source_policy_preimage_sha256:expectedPolicySha,
    reported_policy_sha256:policyHash,
    key_spki_sha256:fingerprint,
    live_health_version:String(health.version||''),
    policy_version:policy.version,
    issuer_binary_identity_attested:false,
    effective_l4_approval_attested:false,
    second_confirmation_attested:false,
    actual_replay_consumption_attested:false,
    production_mutation:false,install_authorized:false
  });
}
function checkedRegular(path){
  const st=fs.lstatSync(path);
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)fail('unsafe_file');
  const fd=fs.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    const direct=fs.fstatSync(fd);
    if(direct.dev!==st.dev||direct.ino!==st.ino||direct.uid!==st.uid||
      direct.gid!==st.gid||direct.mode!==st.mode)fail('race');
    const bytes=fs.readFileSync(fd);
    const end=fs.fstatSync(fd);
    if(end.ino!==direct.ino||end.size!==direct.size||end.mtimeMs!==direct.mtimeMs)
      fail('modified_during_read');
    return {bytes,stat:{uid:st.uid,mode:st.mode,nlink:st.nlink,isFile:true,isSymbolicLink:false}};
  }finally{fs.closeSync(fd);}
}
function readHealth(){
  return new Promise((resolve,reject)=>{
    const req=http.get(ENDPOINT,{timeout:3000,agent:false},res=>{
      if(res.statusCode!==200){res.resume();return reject(Error('issuer_identity_readonly_blocked_health_http_'+res.statusCode));}
      let total=0;const chunks=[];
      res.on('data',chunk=>{total+=chunk.length;if(total>16000){req.destroy(Error('health_too_large'));return;}chunks.push(chunk);});
      res.on('end',()=>{
        try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}
        catch{reject(Error('issuer_identity_readonly_blocked_health_json'));}
      });
      res.on('error',reject);
    });
    req.on('timeout',()=>req.destroy(Error('issuer_identity_readonly_blocked_health_timeout')));
    req.on('error',reject);
  });
}
async function main(){
  if(process.argv.length!==2)fail('args_forbidden');
  const p=checkedRegular(POLICY),k=checkedRegular(PUBLIC);
  const out=validate({
    policyBytes:p.bytes,publicKeyBytes:k.bytes,policyMetadata:p.stat,publicMetadata:k.stat,
    health:await readHealth()
  });
  console.log('ISSUER_LIVE_IDENTITY='+out.status);
  console.log('ISSUER_HEALTH_VERSION='+out.live_health_version);
  console.log('ISSUER_POLICY_VERSION='+out.policy_version);
  console.log('ISSUER_POLICY_HASH='+out.reported_policy_sha256);
  console.log('ISSUER_PUBLIC_KEY_FINGERPRINT='+out.key_spki_sha256);
  console.log('SIGNED_OPERATION_EFFECTIVE_L4=NOT_ATTESTED');
  console.log('APPROVAL_REPLAY_CONSUMPTION=NOT_ATTESTED');
  console.log('PRODUCTION_MUTATION=NO');
  console.log('INSTALL_AUTHORIZED=NO');
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports=Object.freeze({POLICY,PUBLIC,ENDPOINT,validate,checkedRegular,readHealth});
