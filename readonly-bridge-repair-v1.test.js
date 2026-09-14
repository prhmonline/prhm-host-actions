'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
  parseBridgeEnv,
  rewriteBridgeEnv,
  diffAllowed
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
