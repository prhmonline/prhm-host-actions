'use strict';

const fs=require('node:fs');
const crypto=require('node:crypto');
const cp=require('node:child_process');

const ACTION='gateway_v38_live_owner_preflight_v1';
const SOURCE_MAIN_SHA='858fba81f53be63c1257b637fb4a9ca39c7fb7a4';
const OWNERS=Object.freeze({
  approval:Object.freeze({path:'/opt/prhm-company-control-plane/approval/server.js',sha256:'de2569e481cd57b105b6a778cee7b32b2575fc88957d993c70760101ba39d13b',kind:'js'}),
  executor:Object.freeze({path:'/opt/prhm-company-control-plane/executor/server.js',sha256:'67b75873dbfe7c38b016d2c34ceca9792987f28d510c2f73e6c694c760df247f',kind:'js'}),
  selfmaint:Object.freeze({path:'/opt/prhm-agent-selfmaint/server.js',sha256:'4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406',kind:'js'}),
  selfmaint_exec:Object.freeze({path:'/opt/prhm-agent-selfmaint-exec/server.js',sha256:'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0',kind:'js'}),
  policy:Object.freeze({path:'/opt/prhm-company-control-plane/config/approval-policy.json',sha256:'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174',kind:'json'}),
  mcp:Object.freeze({path:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',sha256:'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166',kind:'js'})
});
const FORBIDDEN_RUNTIME_MARKERS=Object.freeze([
  'universal_execution_gateway_execute_v1',
  'host_action_v2_autonomous_execute_v1',
  'autonomousEligible',
  'standing_grant',
  'standingGrant'
]);

const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw new Error(code)};

function inspectOwnerBytes(name,bytes){
  const spec=OWNERS[name];
  if(!spec)fail('gateway_v38_unknown_owner:'+name);
  const digest=sha(bytes);
  if(digest!==spec.sha256)fail('gateway_v38_owner_sha_mismatch:'+name+':'+digest);
  if(spec.kind==='json'){
    try{JSON.parse(bytes.toString('utf8'))}catch{fail('gateway_v38_policy_json_invalid')}
  }
  return Object.freeze({name,path:spec.path,sha256:digest,kind:spec.kind});
}

function assertNoGatewayMarkers(textByOwner){
  for(const [name,text] of Object.entries(textByOwner)){
    for(const marker of FORBIDDEN_RUNTIME_MARKERS){
      if(String(text).includes(marker))fail('gateway_v38_marker_already_present:'+name+':'+marker);
    }
  }
  return true;
}

function preflight(){
  if(process.argv.length!==2)fail('gateway_v38_unexpected_arguments');
  const evidence={};
  const texts={};
  for(const [name,spec] of Object.entries(OWNERS)){
    const st=fs.lstatSync(spec.path);
    if(st.isSymbolicLink()||!st.isFile()||fs.realpathSync(spec.path)!==spec.path)fail('gateway_v38_owner_not_regular:'+name);
    const bytes=fs.readFileSync(spec.path);
    evidence[name]=inspectOwnerBytes(name,bytes);
    texts[name]=bytes.toString('utf8');
    if(spec.kind==='js'){
      const r=cp.spawnSync('/usr/local/bin/prhm-node',['--check',spec.path],{encoding:'utf8',timeout:30000,maxBuffer:1000000});
      if(r.error||r.status!==0)fail('gateway_v38_owner_syntax_failed:'+name);
    }
  }
  assertNoGatewayMarkers(texts);
  return Object.freeze({
    ok:true,
    action:ACTION,
    source_main_sha:SOURCE_MAIN_SHA,
    owners:evidence,
    owner_count:Object.keys(evidence).length,
    runtime_gateway_markers_present:false,
    candidate_transform_executed:false,
    standing_grant_created:false,
    production_mutation:false,
    database_mutation:false,
    external_network:false
  });
}

if(require.main===module){
  try{process.stdout.write(JSON.stringify(preflight())+'\n')}
  catch(error){process.stderr.write(String(error&&error.stack||error)+'\n');process.exit(1)}
}

module.exports=Object.freeze({
  ACTION,SOURCE_MAIN_SHA,OWNERS,FORBIDDEN_RUNTIME_MARKERS,
  inspectOwnerBytes,assertNoGatewayMarkers,
  production_mutation:false,database_mutation:false
});
