'use strict';
/**
 * U06-only GitHub-hosted protected-environment identity evidence transport.
 *
 * The OIDC JWT is cryptographically scoped to a fixed U06 operation plus the
 * server's one-time nonce. It is sealed to host-generated X25519 public key
 * before leaving GitHub's runner; private keys and JWT are never artifact data.
 * No root action, MySQL changes or Production dispatch in this module.
 */
const fs=require('node:fs');
const path=require('node:path');
const {audience}=require('./honartik-u06-owner-oidc-identity-gate-v1.cjs');
const {parseServerPublic,sealJwt,isTrustedGitHubOIDCRuntimeHost}
  =require('./universal-owner-oidc-sealed-transport-v1.cjs');
const need=(x,msg)=>{if(!x)throw Error('u06_owner_seal_'+msg)};
async function main(){
  need(process.argv.length===2,'unexpected_cli_args');
  need(process.env.GITHUB_ACTIONS==='true'&&
    process.env.GITHUB_REPOSITORY==='prhmonline/prhm-host-actions'&&
    process.env.GITHUB_REF==='refs/heads/main'&&
    process.env.GITHUB_ACTOR_ID==='193396069','github_owner_context');
  const challenge=process.env.U06_OWNER_CHALLENGE;
  const pub=process.env.U06_TRANSPORT_PUBLIC_B64;
  const aud=audience(challenge);
  parseServerPublic(pub);
  const u=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL||'');
  need(isTrustedGitHubOIDCRuntimeHost(u),'github_issuer_endpoint');
  u.searchParams.set('audience',aud);
  const bearer=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  need(typeof bearer==='string'&&bearer.length>20,'missing_github_runtime_auth');
  const response=await fetch(u,{
    headers:{Authorization:'bearer '+bearer},
    redirect:'error'
  });
  need(response.ok,'oidc_request_http');
  const body=await response.json();
  need(typeof body.value==='string'&&body.value.length>100,'jwt_absent');
  const sealed=sealJwt({
    token:body.value,challenge,serverPublicKeyBase64:pub
  });
  const base=process.env.RUNNER_TEMP||'';
  need(path.isAbsolute(base),'runner_tmp_required');
  const output=path.join(base,'u06-owner-approval-sealed-oidc.json');
  fs.writeFileSync(output,JSON.stringify(sealed)+'\n',{mode:0o600,flag:'wx'});
  fs.appendFileSync(process.env.GITHUB_OUTPUT,'sealed_path='+output+'\n');
  console.log('U06 owner-specific signed identity was encrypted for exact host challenge.');
  console.log('NO_ROOT_ACTION=TRUE; NO_PROVIDER_APPROVAL=TRUE; NO_PRODUCTION_MUTATION=TRUE');
}
module.exports=Object.freeze({
  audience,ROOT_OPERATION_EXPORTED:false,PRODUCTION_AUTHORIZED:false
});
if(require.main===module){
  main().catch(e=>{console.error(e.message);process.exitCode=1});
}
