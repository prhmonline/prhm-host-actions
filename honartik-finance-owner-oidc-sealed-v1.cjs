'use strict';
/**
 * Encrypt GitHub-issued finance OWNER IDENTITY for a host-held X25519 key.
 * This is evidence transport only; never authorizes or executes a release.
 */
const fs=require('node:fs');
const path=require('node:path');
const {audience}=require('./honartik-finance-owner-oidc-identity-v1.cjs');
const {sealJwt,parseServerPublic,isTrustedGitHubOIDCRuntimeHost}
  =require('./universal-owner-oidc-sealed-transport-v1.cjs');
const need=(ok,s)=>{if(!ok)throw Error('honartik_finance_seal_'+s)};
async function main(){
  need(process.argv.length===2,'unexpected_arguments');
  need(process.env.GITHUB_ACTIONS==='true'&&
    process.env.GITHUB_REPOSITORY==='prhmonline/prhm-host-actions'&&
    process.env.GITHUB_REF==='refs/heads/main'&&
    process.env.GITHUB_ACTOR_ID==='193396069',
    'owner_workflow_context');
  const challenge=process.env.HONARTIK_FINANCE_CHALLENGE;
  const pub=process.env.HONARTIK_FINANCE_TRANSPORT_PUB_B64;
  const aud=audience(challenge);
  parseServerPublic(pub);
  const url=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL||'');
  need(isTrustedGitHubOIDCRuntimeHost(url),'oidc_endpoint_untrusted');
  url.searchParams.set('audience',aud);
  const key=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  need(typeof key==='string'&&key.length>20,'runner_identity_token_missing');
  const res=await fetch(url,{
    headers:{Authorization:'bearer '+key},redirect:'error'
  });
  need(res.ok,'github_oidc_http_error');
  const data=await res.json();
  need(typeof data.value==='string'&&data.value.length>100,
       'github_oidc_jwt_missing');
  // Universal sealed envelope is only transport; the target host verifier
  // MUST authenticate the FINANCE intent audience and protected environment.
  const sealed=sealJwt({token:data.value,challenge,
    serverPublicKeyBase64:pub});
  const tmp=process.env.RUNNER_TEMP||'';
  need(path.isAbsolute(tmp),'runner_temp_invalid');
  const dest=path.join(tmp,'honartik-finance-owner-sealed-oidc.json');
  fs.writeFileSync(dest,JSON.stringify(sealed)+'\n',{mode:0o600,flag:'wx'});
  fs.appendFileSync(process.env.GITHUB_OUTPUT,'sealed_path='+dest+'\n');
  console.log('Encrypted finance owner OIDC evidence; no JWT or key logged.');
  console.log('ROOT_EXECUTOR=NOT_INSTALLED; PRODUCTION_AUTHORIZED=FALSE');
}
module.exports=Object.freeze({
  audience,ROOT_ACTION_EXPORTED:false,PRODUCTION_AUTHORIZED:false
});
if(require.main===module){
  main().catch(e=>{console.error(e.message);process.exitCode=1});
}
