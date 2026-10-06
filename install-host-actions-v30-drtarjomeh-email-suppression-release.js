'use strict';

const crypto=require('node:crypto');
const bootstrap=require('./bootstrap-host-actions-v30-drtarjomeh-email-suppression-release.js');

const PATHS=Object.freeze({
  base:'/opt/prhm-agent-selfmaint/server.js',
  exec:'/opt/prhm-agent-selfmaint-exec/server.js',
  policy:'/opt/prhm-company-control-plane/config/approval-policy.json',
  mcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
  helper:'/opt/prhm-agent-selfmaint-exec/actions/drtarjomeh-email-suppression-release-bootstrap-v1.js'
});
const INSTALL_RESULT='/var/lib/prhm-agent-selfmaint-exec/drtarjomeh-email-suppression-installer-v1/latest.json';
const BACKUP_ROOT='/var/backups/prhm-drtarjomeh-email-suppression-installer-v1';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(code){throw new Error(code)}

function buildInstallPlan(source,helperSource){
  if(!source||typeof source!=='object')fail('source_invalid');
  if(typeof helperSource!=='string'||!helperSource.trim())fail('helper_source_invalid');
  const helperSha=sha(Buffer.from(helperSource));
  const files=Object.freeze({
    base:bootstrap.buildBaseCandidate(source.base),
    exec:bootstrap.buildExecCandidate(source.exec,helperSha),
    policy:bootstrap.buildPolicyCandidate(source.policy),
    mcp:bootstrap.buildMcpCandidate(source.mcp),
    helper:helperSource
  });
  return Object.freeze({
    files,
    helper_sha256:helperSha,
    sha256:Object.freeze(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,sha(Buffer.from(v))]))),
    production_application_mutation:false,
    database_mutation:false,
    external_send_allowed:false
  });
}

function createFixtureInstallerAdapter(state,options={}){
  const sources={
    base:[
      'const HOST_ACTION_V2_SPECS = Object.freeze({',
      "  existing_v1: { operation: 'host_action.existing_v1', rollback: 'existing:rollback' }",
      '});',
      'const HOST_ACTION_V2_LEVEL3 = new Set(["existing_v1"]);'
    ].join('\n'),
    exec:[
      'const HOST_ACTION_V2_SPECS = Object.freeze({',
      "  existing_v1:{operation:'host_action.existing_v1',kind:'existing_v1'}",
      '});',
      'const applyHostActionV2Original=applyHostActionV2;',
      "applyHostActionV2=async function(action){if(action==='existing_v1')return applyExistingV1();return applyHostActionV2Original(action);};"
    ].join('\n'),
    policy:JSON.stringify({schema_version:'prhm.approval-policy.v1',version:'fixture',operations:{'host_action.existing_v1':{level:3,risk:'high'}},typed_scopes:[{action:'existing_v1',operation:'host_action.existing_v1'}]},null,2),
    mcp:"const HostActionV2=z.enum(['existing_v1']);"
  };
  return {
    preflight:()=>({ok:true,stable:true}),
    readSources:()=>sources,
    backup:()=>JSON.parse(JSON.stringify(state)),
    atomic:(key,value)=>{state[key]=value},
    validate:()=>true,
    verify:()=>options.verify!==false,
    rollback:backup=>{for(const key of Object.keys(state))delete state[key];Object.assign(state,backup);return true},
    persist:()=>true
  };
}

function install(adapter,options={}){
  let backup=null;
  let mutated=false;
  try{
    const pf=adapter.preflight();
    if(!pf||pf.ok!==true||pf.stable!==true)fail('preflight_failed');
    const plan=buildInstallPlan(adapter.readSources(),options.helperSource);
    backup=adapter.backup(PATHS);
    for(const key of ['helper','base','exec','policy','mcp']){adapter.atomic(key,plan.files[key]);mutated=true}
    if(adapter.validate(plan)!==true)fail('validation_failed');
    if(adapter.verify(plan)!==true)fail('verify_installed_hashes_failed');
    const result={
      ok:true,
      schema_version:'prhm.host-action-result.v1',
      action:'drtarjomeh_email_suppression_release_installer_v1',
      installed:true,
      installed_targets:{...PATHS},
      helper_sha256:plan.helper_sha256,
      rollback_performed:false,
      production_application_mutation:false,
      database_mutation:false,
      external_send_allowed:false
    };
    adapter.persist(result,INSTALL_RESULT);
    return result;
  }catch(error){
    let rollbackVerified=true;
    if(mutated&&backup){
      try{rollbackVerified=adapter.rollback(backup,PATHS)!==false}catch{rollbackVerified=false}
    }
    const result={
      ok:false,
      schema_version:'prhm.host-action-result.v1',
      action:'drtarjomeh_email_suppression_release_installer_v1',
      installed:false,
      rollback_performed:mutated,
      rollback_verified:rollbackVerified,
      production_application_mutation:false,
      database_mutation:false,
      external_send_allowed:false,
      error:'install_failed'
    };
    try{adapter.persist(result,INSTALL_RESULT)}catch{}
    return result;
  }
}

function main(){
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==='--preflight-only'){
    process.stdout.write(JSON.stringify({
      ok:false,
      preflight:false,
      blocked:true,
      reason:'production_binding_not_materialized',
      action:'drtarjomeh_email_suppression_release_installer_v1',
      production_application_mutation:false,
      database_mutation:false,
      external_send_allowed:false
    })+'\n');
    process.exitCode=2;
    return;
  }
  fail('production_binding_not_materialized');
}

module.exports={PATHS,INSTALL_RESULT,BACKUP_ROOT,sha,buildInstallPlan,createFixtureInstallerAdapter,install};
if(require.main===module){try{main()}catch(error){console.error(String(error?.message||error));process.exit(1)}}
