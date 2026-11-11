'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const cp=require('node:child_process');
const real=require('./solo-universal-v2-owner-permit-v1.cjs');
const binding=require('./solo-universal-v2-host-action-binding-candidate-v1.cjs');
const file=path.join(__dirname,'solo-universal-v2-owner-permit-v1.cjs');
const source=fs.readFileSync(file,'utf8');
const uuid='390ad9ce-fd10-4118-9312-6173ee443bcd';
const jti='966f2f58-3786-46a7-b453-cb1fc96c4f3e';
const now=1794449000;

function syntheticFixture(){
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
  const pem=publicKey.export({type:'spki',format:'pem'});
  const der=publicKey.export({type:'spki',format:'der'});
  const pin=crypto.createHash('sha256').update(der).digest('hex');
  const injected=source.replace(real.OWNER_KEY_PIN,pin);
  assert.notEqual(injected,source);
  const m=new Module(file, module);
  m.filename=file;
  m.paths=Module._nodeModulePaths(__dirname);
  m._compile(injected,file);
  const adapted=m.exports;
  const claims={
    iss:real.ISSUER,aud:real.AUDIENCE,typ:real.TYPE,
    operation:binding.OPERATION,action:binding.ACTION,
    project:binding.PIN.project,environment:binding.PIN.environment,
    host:binding.PIN.host,level:4,risk:'critical',one_time_use:true,
    request_id:uuid,jti,iat:now-2,exp:now+120,
    deploy_control_source_commit:binding.PIN.deploy_control_source_commit,
    universal_v1_before:binding.PIN.universal_v1_before,
    universal_v2_candidate:binding.PIN.universal_v2_candidate,
    profile_sha256:binding.PIN.profile_sha256,
    solo_release_sha:binding.PIN.release_sha
  };
  const sign=(data,headerOverride)=> {
    const header=headerOverride||{alg:'EdDSA',typ:real.TYPE,kid:pin.slice(0,16)};
    const pack=obj=>Buffer.from(JSON.stringify(obj)).toString('base64url');
    const message=pack(header)+'.'+pack(data);
    return message+'.'+crypto.sign(null,Buffer.from(message),privateKey).toString('base64url');
  };
  const verify=(token,seconds=now)=>adapted.verifyOwnerPermit({
    token,publicKeyPem:pem,requestId:uuid,nowSeconds:seconds});
  return {adapted,claims,sign,verify,pem, pin};
}
test('synthetic signed permit can validate only in offline injected-pin test',()=>{
  const {claims,sign,verify,pem}=syntheticFixture();
  const result=verify(sign(claims));
  assert.equal(result.signature_verified,true);
  assert.equal(result.consumed,false);
  assert.equal(result.production_authorized,false);
  assert.equal(result.independent_root_executor_required,true);
  assert.equal(result.operation,binding.OPERATION);
  assert.equal(result.jti,jti);
  // Same synthetic key is NOT the real pinned owner Root-of-Trust.
  assert.throws(()=>real.verifyOwnerPermit({
    token:sign(claims),publicKeyPem:pem,requestId:uuid,nowSeconds:now}),
    /owner_key_pin_mismatch/);
});
test('reject tampered signature, wrong key, fake typ or algorithm',()=>{
  const {claims,sign,verify}=syntheticFixture();
  let token=sign(claims);
  assert.throws(()=>verify(token.slice(0,-2)+'ab'),/signature_invalid|noncanonical/);
  assert.throws(()=>verify(sign(claims,{alg:'HS256',typ:real.TYPE,kid:'x'})),/header_invalid/);
  assert.throws(()=>verify(sign(claims,{alg:'EdDSA',typ:'OLD-SOLO-SIX-FILE',kid:'x'})),/header_invalid/);
});
test('reject old root registration receipts and every material scope drift',()=>{
  for(const [key,value] of Object.entries({
    operation:'host_action.solo_company_runtime_registration_v1',
    action:'solo_company_runtime_registration_v1',
    host:'another-host',project:'other',environment:'staging',
    level:3,risk:'low',one_time_use:false,
    deploy_control_source_commit:'0'.repeat(40),
    universal_v1_before:'b'.repeat(64),
    universal_v2_candidate:'a'.repeat(64),
    profile_sha256:'e'.repeat(64),
    solo_release_sha:'f'.repeat(40)
  })){
    const {claims,sign,verify}=syntheticFixture();
    const altered={...claims,[key]:value};
    assert.throws(()=>verify(sign(altered)),/scope_or_digest_mismatch/,key);
  }
});
test('reject expiry, excessive permit lifetime, far future, request mismatch and nonuuid nonce',()=>{
  for(const bad of [
    {exp:now-1},{exp:now+181},{iat:now+40,exp:now+150},
    {request_id:'invalid'}, {jti:'invalid'}
  ]){
    const {claims,sign,verify}=syntheticFixture();
    const altered={...claims,...bad};
    assert.throws(()=>verify(sign(altered)),/expired_or_invalid|request_id_mismatch/);
  }
});
test('reject unsigned, unknown claims and noncanonical encoding',()=>{
  const {claims,sign,verify}=syntheticFixture();
  assert.throws(()=>verify('aaa.bbb.ccc'),/token_invalid|json_invalid/);
  assert.throws(()=>verify(sign({...claims,extra:'unapproved'})),/claims_schema_invalid/);
});
test('no standalone production action, signer, filesystem or shell writes',()=>{
  assert.equal(typeof real.sign,'undefined');
  for(const k of ['apply','issue','consume','register','deploy','restart','install'])
    assert.equal(typeof real[k],'undefined');
  for(const pattern of [/fs\.writeFile/,/spawnSync\(/,/systemctl restart/,
    /createPrivateKey\(/,/generateKeyPair\(/,/process\.env/])
    assert.doesNotMatch(source,pattern);
  const x=cp.spawnSync(process.execPath,[file],{encoding:'utf8'});
  assert.equal(x.status,64);
  assert.match(x.stderr,/SOURCE_ONLY/);
});
