'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {
  parseBridgeEnv,
  rewriteBridgeEnv,
  diffAllowed,
  validateEnvMetadata,
  buildPreflightReport,
  expectedEndpoints,
  identityOk,
  checkBridgeHealth,
  preflight,
  apply,
  run
}=require('./readonly-bridge-repair-v1');

function sha(text){return crypto.createHash('sha256').update(Buffer.from(text)).digest('hex');}
function goodStat(){return {uid:0,gid:0,mode:0o100600,isFile:()=>true,isSymbolicLink:()=>false};}
function fakeDeps(overrides={}){
  const events=[];
  const initial='PORT=8140\nTOKEN=fixture-secret-value\n';
  let current=initial;
  let restarts=41;
  const deps={
    events,
    lstatEnv:()=>goodStat(),
    readEnv:()=>Buffer.from(current),
    unitContractOk:()=>true,
    portFree:(host,port)=>port===8141,
    health:(url)=>{
      if(url===expectedEndpoints.recovery)return {ok:true,service:'prhm-recovery-agent'};
      if(url===expectedEndpoints.bridge)return {ok:true,service:'prhm-readonly-http'};
      if(url===expectedEndpoints.bridgePrivate)return null;
      if(url===expectedEndpoints.agentApi)return {ok:true,service:'ssh-agent-api'};
      if(expectedEndpoints.mcp.includes(url))return {ok:true,service:'prhm-dev-agent-mcp'};
      return null;
    },
    bridgeActive:()=>true,
    backup:(bytes)=>{events.push('backup');assert.equal(Buffer.from(bytes).toString(),initial);return '/var/backups/prhm-readonly-bridge-repair-v1/test/prhm-readonly-http.env.bak';},
    atomicReplace:(bytes)=>{events.push('write');current=Buffer.from(bytes).toString();},
    restartBridge:()=>{events.push('restart:bridge');},
    getNRestarts:()=>restarts,
    sleep:async()=>{events.push('sleep');},
    setRestarts:(n)=>{restarts=n;},
    getCurrent:()=>current,
    setCurrent:(v)=>{current=v;}
  };
  return Object.assign(deps,overrides);
}

test('parseBridgeEnv accepts exactly one numeric listen port assignment',()=>{const text='# bridge\nPORT=8140\nTOKEN=redacted-fixture\n';assert.deepEqual(parseBridgeEnv(text),{key:'PORT',port:8140,lineIndex:1});});
test('parseBridgeEnv rejects zero port assignments',()=>{assert.throws(()=>parseBridgeEnv('TOKEN=x\n'),/bridge_port_assignment_count:0/);});
test('parseBridgeEnv rejects multiple port assignments',()=>{assert.throws(()=>parseBridgeEnv('PORT=8140\nHTTP_PORT=8140\n'),/bridge_port_assignment_count:2/);});
test('rewriteBridgeEnv rejects unexpected current port',()=>{assert.throws(()=>rewriteBridgeEnv('PORT=9000\n'),/bridge_port_expected_8140_actual_9000/);});
test('rewriteBridgeEnv changes only the single port value and preserves unrelated bytes',()=>{const before='# keep-this\nTOKEN=fixture-secret-value\nPORT=8140\nOTHER=value with spaces\n';const after=rewriteBridgeEnv(before);assert.equal(after,'# keep-this\nTOKEN=fixture-secret-value\nPORT=8141\nOTHER=value with spaces\n');assert.equal(diffAllowed(before,after),true);});
test('diffAllowed rejects unrelated mutations',()=>{const before='PORT=8140\nTOKEN=one\n';const after='PORT=8141\nTOKEN=two\n';assert.equal(diffAllowed(before,after),false);});
test('validateEnvMetadata accepts only root-owned regular 0600 non-symlink files',()=>{const good=goodStat();assert.equal(validateEnvMetadata(good),true);assert.throws(()=>validateEnvMetadata({...good,uid:1016}),/env_owner_not_root/);assert.throws(()=>validateEnvMetadata({...good,mode:0o100640}),/env_mode_not_0600/);assert.throws(()=>validateEnvMetadata({...good,isFile:()=>false}),/env_not_regular_file/);assert.throws(()=>validateEnvMetadata({...good,isSymbolicLink:()=>true}),/env_symlink_forbidden/);});
test('buildPreflightReport emits only secret-safe allowlisted metadata',()=>{const report=buildPreflightReport({envSha256:'a'.repeat(64),portKey:'PORT',currentPort:8140,replacementPort:8141,recoveryHealthy:true,agentApiHealthy:true,mcpHealthy:true,envText:'PORT=8140\nTOKEN=super-secret-fixture\n',token:'super-secret-fixture'});const serialized=JSON.stringify(report);assert.equal(serialized.includes('super-secret-fixture'),false);assert.equal(Object.prototype.hasOwnProperty.call(report,'envText'),false);assert.equal(Object.prototype.hasOwnProperty.call(report,'token'),false);});
test('expectedEndpoints are fixed and contain no user-supplied surface',()=>{assert.deepEqual(expectedEndpoints,{recovery:'http://10.71.0.118:8140/health',bridge:'http://127.0.0.1:8141/health',bridgePrivate:'http://10.71.0.118:8141/health',agentApi:'http://127.0.0.1:8099/health',mcp:['http://127.0.0.1:8123/health','http://127.0.0.1:8124/health','http://127.0.0.1:8125/health']});});
test('identityOk strictly binds each health endpoint to its expected service',()=>{assert.equal(identityOk('recovery',{ok:true,service:'prhm-recovery-agent'}),true);assert.equal(identityOk('recovery',{ok:true,service:'prhm-readonly-http'}),false);assert.equal(identityOk('bridge',{ok:true,service:'prhm-readonly-http'}),true);assert.equal(identityOk('bridge',{ok:true,service:'prhm-recovery-agent'}),false);assert.equal(identityOk('agentApi',{ok:true,service:'ssh-agent-api'}),true);assert.equal(identityOk('mcp',{ok:true,service:'prhm-dev-agent-mcp'}),true);assert.equal(identityOk('unknown',{ok:true,service:'anything'}),false);});

test('checkBridgeHealth accepts private-address bridge when loopback is absent',async()=>{
  const deps=fakeDeps({health:(url)=>{
    if(url===expectedEndpoints.bridge)return null;
    if(url===expectedEndpoints.bridgePrivate)return {ok:true,service:'prhm-readonly-http'};
    return null;
  }});
  assert.equal(await checkBridgeHealth(deps),true);
});

test('checkBridgeHealth fails closed on any unexpected listener identity',async()=>{
  const deps=fakeDeps({health:(url)=>{
    if(url===expectedEndpoints.bridge)return {ok:true,service:'prhm-readonly-http'};
    if(url===expectedEndpoints.bridgePrivate)return {ok:true,service:'prhm-recovery-agent'};
    return null;
  }});
  await assert.rejects(()=>checkBridgeHealth(deps),/bridge_health_identity_mismatch/);
});

test('preflight is read-only, SHA-binds env, and verifies fixed dependencies',async()=>{const deps=fakeDeps();const out=await preflight(deps);assert.equal(out.env_sha256,sha('PORT=8140\nTOKEN=fixture-secret-value\n'));assert.equal(out.current_port,8140);assert.equal(out.replacement_port,8141);assert.deepEqual(deps.events,[]);});
test('apply backs up before write, restarts only bridge, and verifies stable health',async()=>{const deps=fakeDeps();const out=await apply(deps);assert.equal(out.ok,true);assert.equal(out.rollback_performed,false);assert.equal(out.database_mutation,false);assert.equal(out.recovery_mutation,false);assert.equal(deps.getCurrent(),'PORT=8141\nTOKEN=fixture-secret-value\n');assert.deepEqual(deps.events,['backup','write','restart:bridge','sleep']);});
test('apply aborts before mutation when env SHA drifts after preflight',async()=>{let reads=0;const deps=fakeDeps({readEnv:()=>{reads++;return Buffer.from(reads===1?'PORT=8140\nTOKEN=fixture-secret-value\n':'PORT=8140\nTOKEN=changed-after-preflight\n');}});await assert.rejects(()=>apply(deps),/env_sha_drift_before_apply/);assert.deepEqual(deps.events,[]);});
test('post-write verification failure restores exact preimage and restarts only bridge',async()=>{const deps=fakeDeps({bridgeActive:()=>false});await assert.rejects(()=>apply(deps),/readonly_bridge_repair_failed_rolled_back:bridge_service_not_active/);assert.equal(deps.getCurrent(),'PORT=8140\nTOKEN=fixture-secret-value\n');assert.deepEqual(deps.events,['backup','write','restart:bridge','write','restart:bridge']);});
test('restart counter increase after health causes rollback',async()=>{const deps=fakeDeps();let calls=0;deps.getNRestarts=()=>{calls++;return calls===1?41:42;};await assert.rejects(()=>apply(deps),/readonly_bridge_repair_failed_rolled_back:restart_counter_increased/);assert.equal(deps.getCurrent(),'PORT=8140\nTOKEN=fixture-secret-value\n');});

test('run accepts only fixed preflight/apply modes',async()=>{
  const deps=fakeDeps();
  const pf=await run(['--preflight-only'],deps);
  assert.equal(pf.preflight_only,true);
  const deps2=fakeDeps();
  const result=await run(['--apply'],deps2);
  assert.equal(result.ok,true);
  await assert.rejects(()=>run([],fakeDeps()),/unexpected_arguments/);
  await assert.rejects(()=>run(['--apply','extra'],fakeDeps()),/unexpected_arguments/);
});
