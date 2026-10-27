'use strict';

/**
 * PBCinema: SOURCE-ONLY discovery overlay for GET /projects.
 *
 * This module must NEVER add aliases to the executable PROJECTS registry.
 * /run-project, /ops/execute, Safe Files, deployment and DB operations must
 * continue to reject both aliases while sharing application roots.
 *
 * The existing Host Actions v2 atomic installer is the only possible trusted
 * installation path. Before installation it MUST independently obtain actual
 * Apache vhosts, the 8081 process cwd, realpaths, explicit write-denials,
 * pinned owner SHA-256, signed one-time L4 authorization, backup and rollback.
 * Caller-provided evidence is not a security/approval credential.
 */
const crypto=require('node:crypto');
const ACTION='pbcinema_projects_register_v1';
const SHA=/^[a-f0-9]{64}$/;
const PROJECTS=Object.freeze({
  pbcinema_front_prod:Object.freeze({
    domain:'pbcinema.ir',
    root:'/home/cfpark/domains/park.prhm.ir/public_html',
    route:Object.freeze({kind:'reverse_proxy',target:'http://127.0.0.1:8081/'})
  }),
  pbcinema_admin_prod:Object.freeze({
    domain:'dashboard.pbcinema.ir',
    root:'/home/cfpark/domains/dashboard.park.prhm.ir/public_html/app',
    route:Object.freeze({
      kind:'document_root',
      documentRoot:'/home/cfpark/domains/dashboard.park.prhm.ir/public_html/app/web'
    })
  })
});
const WRITE_CAPABILITIES=Object.freeze([
  'dbWrite','deploy','execWrite','fileWrite','projectWrite'
]);
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw new Error('pbcinema_registry_'+code);};
const isObject=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
function exactRoot(actual,expected){
  return isObject(actual)&&actual.exists===true&&actual.isDirectory===true&&
    actual.isSymlink===false&&actual.realpath===expected;
}

function verifyEvidence(evidence){
  // Shape validation only: the invoking root-owned installer must gather and
  // attest all values independently; booleans do not prove authorization.
  if(!isObject(evidence)||!isObject(evidence.roots)||
     !isObject(evidence.vhosts)||!isObject(evidence.permissions)||
     !isObject(evidence.runtime)||evidence.writeAllowlistAudit!=='DENY_ALL_PBCINEMA')
     fail('preflight_missing');
  for(const [id,spec] of Object.entries(PROJECTS)){
    const perms=evidence.permissions[id],vhost=evidence.vhosts[id];
    if(!exactRoot(evidence.roots[id],spec.root))
      fail('application_root_unverified:'+id);
    if(!isObject(perms)||
       Object.keys(perms).sort().join('|')!==WRITE_CAPABILITIES.slice().sort().join('|')||
       Object.values(perms).some(x=>x!==false))
       fail('write_denial_unverified:'+id);
    if(!isObject(vhost)||vhost.domain!==spec.domain||vhost.kind!==spec.route.kind)
      fail('vhost_route_unverified:'+id);
    if(spec.route.kind==='reverse_proxy'){
      if(vhost.proxyTarget!==spec.route.target||
         !isObject(evidence.runtime[id])||
         evidence.runtime[id].listenAddress!=='127.0.0.1:8081'||
         evidence.runtime[id].processCwd!==spec.root||
         evidence.runtime[id].processCwdVerified!==true)
         fail('proxy_or_runtime_root_unverified:'+id);
    }else{
      if(vhost.documentRoot!==spec.route.documentRoot||
         !exactRoot(evidence.roots[id+'_web'],spec.route.documentRoot))
         fail('admin_document_root_unverified:'+id);
    }
  }
  return true;
}

function projectResponseOverlay({response,expectedResponseSha256,evidence}){
  if(!isObject(response)||response.ok!==true||!isObject(response.projects))
    fail('response_contract_invalid');
  const original=Buffer.from(JSON.stringify(response),'utf8');
  if(!SHA.test(expectedResponseSha256||'')||
     sha256(original)!==expectedResponseSha256) fail('response_sha_drift');
  verifyEvidence(evidence);
  const records={...response.projects};
  for(const [id,spec] of Object.entries(PROJECTS)){
    if(Object.prototype.hasOwnProperty.call(records,id))
      fail('executable_or_duplicate_alias:'+id);
    records[id]=Object.freeze({
      name:id,root:spec.root,description:'PBCinema shared-root discovery only',
      discoveryOnly:true,metadataOnly:true,writeEnabled:false,
      deploymentEnabled:false
    });
  }
  return {...response,projects:records};
}

function prepareCandidate({response,expectedResponseSha256,evidence}){
  const projectedResponse=projectResponseOverlay({response,expectedResponseSha256,evidence});
  return Object.freeze({
    action:ACTION,state:'source_only_not_installed',
    projectIds:Object.keys(PROJECTS),writesEnabled:false,
    requiresConsumedSignedL4:true,requiresExistingAtomicInstaller:true,
    originalSha256:expectedResponseSha256,
    augmentedSha256:sha256(Buffer.from(JSON.stringify(projectedResponse),'utf8')),
    projectedResponse
  });
}

module.exports=Object.freeze({
  ACTION,PROJECTS,WRITE_CAPABILITIES,sha256,verifyEvidence,
  projectResponseOverlay,prepareCandidate
});
