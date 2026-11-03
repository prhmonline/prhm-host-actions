'use strict';
/**
 * Create sealed GitHub-issued OIDC evidence AFTER protected-environment review.
 * Transport encryption is NOT a signing authority. The host still verifies
 * GitHub's RSA JWS, run approvals, workflow SHA, nonce, replay, and policy.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {FIXED}=require('./universal-installer-backup-only-native-contract-v1.cjs');
const INFO=Buffer.from('prhm-universal-owner-oidc-sealed-transport-v1');
const fail=s=>{throw Error('prhm_owner_seal_'+s)};
const need=(x,s)=>{if(!x)fail(s)};
function parseServerPublic(spkiBase64) {
  need(typeof spkiBase64==='string'&&spkiBase64.length>=40&&
    spkiBase64.length<=2000&&/^[A-Za-z0-9+/=]+$/.test(spkiBase64),'public_key_encoding');
  const bytes=Buffer.from(spkiBase64,'base64');
  need(bytes.toString('base64')===spkiBase64,'public_key_noncanonical');
  let key;try{key=crypto.createPublicKey({key:bytes,format:'der',type:'spki'})}
  catch{fail('untrusted_public_key')}
  need(key.asymmetricKeyType==='x25519','public_key_not_x25519');
  return key;
}
function sealJwt({token,challenge,serverPublicKeyBase64}){
  need(typeof token==='string'&&token.length>20&&token.length<=45000,'token_size');
  need(typeof challenge==='string'&&/^[a-f0-9]{64}$/.test(challenge),'challenge');
  const serverKey=parseServerPublic(serverPublicKeyBase64);
  const ephemeral=crypto.generateKeyPairSync('x25519');
  const shared=crypto.diffieHellman({privateKey:ephemeral.privateKey,publicKey:serverKey});
  const key=Buffer.from(crypto.hkdfSync('sha256',shared,Buffer.from(challenge,'hex'),INFO,32));
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  const data=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);
  return Object.freeze({
    schema:'prhm.universal.owner-oidc-sealed-transport.v1',
    challenge_sha256:crypto.createHash('sha256').update(challenge).digest('hex'),
    ephemeral_spki_b64:ephemeral.publicKey.export({format:'der',type:'spki'}).toString('base64'),
    iv_b64:iv.toString('base64'),tag_b64:cipher.getAuthTag().toString('base64'),
    ciphertext_b64:data.toString('base64')
  });
}
function openSealedJwt(sealed,challenge,hostPrivateKey){
  need(sealed?.schema==='prhm.universal.owner-oidc-sealed-transport.v1','schema');
  need(typeof challenge==='string'&&/^[a-f0-9]{64}$/.test(challenge),'challenge');
  need(sealed.challenge_sha256===crypto.createHash('sha256').update(challenge).digest('hex'),
      'challenge_mismatch');
  need(hostPrivateKey?.asymmetricKeyType==='x25519','host_transport_key');
  const ephemeral=parseServerPublic(sealed.ephemeral_spki_b64);
  const iv=Buffer.from(sealed.iv_b64||'','base64');
  const tag=Buffer.from(sealed.tag_b64||'','base64');
  const cipher=Buffer.from(sealed.ciphertext_b64||'','base64');
  need(iv.length===12&&tag.length===16&&cipher.length>20&&cipher.length<45000,
      'sealed_shape');
  const shared=crypto.diffieHellman({privateKey:hostPrivateKey,publicKey:ephemeral});
  const key=Buffer.from(crypto.hkdfSync('sha256',shared,Buffer.from(challenge,'hex'),INFO,32));
  const dec=crypto.createDecipheriv('aes-256-gcm',key,iv);
  dec.setAuthTag(tag);
  try{return Buffer.concat([dec.update(cipher),dec.final()]).toString('utf8')}
  catch{fail('transport_authentication_failed')}
}
function isTrustedGitHubOIDCRuntimeHost(url){
  // GitHub-hosted runner's ID_TOKEN_REQUEST_URL uses regional hosts such as
  // pipelinesghubeus*.actions.githubusercontent.com (NOT *.pipelines...).
  // Trust exact GitHub-controlled suffix plus a restricted pipelines prefix,
  // never a user-supplied arbitrary URL or a lookalike hostname.
  return url instanceof URL && url.protocol==='https:' &&
    url.port==='' && url.username==='' && url.password==='' &&
    /^pipelines[a-z0-9-]*\\.actions\\.githubusercontent\\.com$/.test(url.hostname);
}
async function runProtectedActionOnly() {
  need(process.argv.length===2,'unexpected_arguments');
  need(process.env.GITHUB_ACTIONS==='true','github_actions_only');
  need(process.env.GITHUB_REPOSITORY==='prhmonline/prhm-host-actions'&&
    process.env.GITHUB_REF==='refs/heads/main'&&
    process.env.GITHUB_ACTOR_ID==='193396069','external_actor_or_ref');
  const challenge=process.env.OWNER_CHALLENGE;
  const publicKey=process.env.OWNER_TRANSPORT_PUB_B64;
  need(/^[a-f0-9]{64}$/.test(challenge||''),'challenge');
  parseServerPublic(publicKey);
  const reqUrl=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL||'');
  need(isTrustedGitHubOIDCRuntimeHost(reqUrl),'untrusted_github_oidc_endpoint');
  reqUrl.searchParams.set('audience',
    'urn:prhm:universal:owner-enrollment:v1:'+challenge+':'+FIXED.candidate_bundle);
  const reqToken=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  need(typeof reqToken==='string'&&reqToken.length>20,'missing_github_runner_auth');
  const res=await fetch(reqUrl,{headers:{Authorization:'bearer '+reqToken},redirect:'error'});
  need(res.ok,'github_oidc_request_failed');
  const body=await res.json();
  need(typeof body.value==='string'&&body.value.length>100,'oidc_token_missing');
  const sealed=sealJwt({token:body.value,challenge,serverPublicKeyBase64:publicKey});
  const dest=path.join(process.env.RUNNER_TEMP||'', 'universal-owner-sealed-oidc.json');
  need(path.isAbsolute(dest),'runner_temp_missing');
  fs.writeFileSync(dest,JSON.stringify(sealed)+'\n',{mode:0o600,flag:'wx'});
  // Output only a path to ENCRYPTED data, never the GitHub-issued JWT.
  fs.appendFileSync(process.env.GITHUB_OUTPUT,'sealed_path='+dest+'\n');
  console.log('Protected owner OIDC was encrypted to host-held X25519 public key. Token NOT logged.');
}
module.exports=Object.freeze({parseServerPublic,sealJwt,openSealedJwt,isTrustedGitHubOIDCRuntimeHost});
if(require.main===module){
 runProtectedActionOnly().catch(e=>{console.error(e.message);process.exitCode=1});
}
