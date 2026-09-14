'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
  parseBridgeEnv,
  rewriteBridgeEnv,
  diffAllowed,
  validateEnvMetadata,
  buildPreflightReport
}=require('./readonly-bridge-repair-v1');

test('parseBridgeEnv accepts exactly one numeric listen port assignment',()=>{
  const text='# bridge\nPORT=8140\nTOKEN=redacted-fixture\n';
  assert.deepEqual(parseBridgeEnv(text),{key:'PORT',port:8140,lineIndex:1});
});

test('parseBridgeEnv rejects zero port assignments',()=>{
  assert.throws(()=>parseBridgeEnv('TOKEN=x\n'),/bridge_port_assignment_count:0/);
});

test('parseBridgeEnv rejects multiple port assignments',()=>{
  assert.throws(()=>parseBridgeEnv('PORT=8140\nHTTP_PORT=8140\n'),/bridge_port_assignment_count:2/);
});

test('rewriteBridgeEnv rejects unexpected current port',()=>{
  assert.throws(()=>rewriteBridgeEnv('PORT=9000\n'),/bridge_port_expected_8140_actual_9000/);
});

test('rewriteBridgeEnv changes only the single port value and preserves unrelated bytes',()=>{
  const before='# keep-this\nTOKEN=fixture-secret-value\nPORT=8140\nOTHER=value with spaces\n';
  const after=rewriteBridgeEnv(before);
  assert.equal(after,'# keep-this\nTOKEN=fixture-secret-value\nPORT=8141\nOTHER=value with spaces\n');
  assert.equal(diffAllowed(before,after),true);
});

test('diffAllowed rejects unrelated mutations',()=>{
  const before='PORT=8140\nTOKEN=one\n';
  const after='PORT=8141\nTOKEN=two\n';
  assert.equal(diffAllowed(before,after),false);
});

test('validateEnvMetadata accepts only root-owned regular 0600 non-symlink files',()=>{
  const good={uid:0,mode:0o100600,isFile:()=>true,isSymbolicLink:()=>false};
  assert.equal(validateEnvMetadata(good),true);
  assert.throws(()=>validateEnvMetadata({...good,uid:1016}),/env_owner_not_root/);
  assert.throws(()=>validateEnvMetadata({...good,mode:0o100640}),/env_mode_not_0600/);
  assert.throws(()=>validateEnvMetadata({...good,isFile:()=>false}),/env_not_regular_file/);
  assert.throws(()=>validateEnvMetadata({...good,isSymbolicLink:()=>true}),/env_symlink_forbidden/);
});

test('buildPreflightReport emits only secret-safe allowlisted metadata',()=>{
  const report=buildPreflightReport({
    envSha256:'a'.repeat(64),
    portKey:'PORT',
    currentPort:8140,
    replacementPort:8141,
    recoveryHealthy:true,
    agentApiHealthy:true,
    mcpHealthy:true,
    envText:'PORT=8140\nTOKEN=super-secret-fixture\n',
    token:'super-secret-fixture'
  });
  const serialized=JSON.stringify(report);
  assert.equal(serialized.includes('super-secret-fixture'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(report,'envText'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(report,'token'),false);
  assert.deepEqual(report,{
    ok:true,
    action:'readonly_bridge_repair_v1',
    schema_version:'prhm.host-action-preflight.v1',
    preflight_only:true,
    production_mutation:false,
    database_mutation:false,
    recovery_mutation:false,
    agent_api_mutation:false,
    mcp_mutation:false,
    env_sha256:'a'.repeat(64),
    port_key:'PORT',
    current_port:8140,
    replacement_port:8141,
    recovery_healthy:true,
    agent_api_healthy:true,
    mcp_healthy:true
  });
});
