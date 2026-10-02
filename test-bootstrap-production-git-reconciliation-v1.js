'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('bootstrap exposes fixed read-only registration contract only',()=>{
  const b=require('./bootstrap-production-git-reconciliation-v1.js');
  assert.equal(b.ACTION_ID,'production_git_reconciliation_v1');
  const spec=b.buildRegistrationSpec();
  assert.equal(spec.action_id,'production_git_reconciliation_v1');
  assert.deepEqual(spec.annotations,{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false});
  assert.equal(spec.input_schema.type,'object');
  assert.equal(spec.input_schema.additionalProperties,false);
  assert.deepEqual(spec.input_schema.required,['project_id']);
  assert.deepEqual(Object.keys(spec.input_schema.properties),['project_id']);
  assert.equal(spec.input_schema.properties.project_id.type,'string');
  assert.deepEqual(spec.input_schema.properties.project_id.enum,['cfpark_front_prod']);
  assert.match(spec.executor_sha256,/^[a-f0-9]{64}$/);
});

test('bootstrap source has no automatic production execution or arbitrary inputs',()=>{
  const source=fs.readFileSync(path.join(__dirname,'bootstrap-production-git-reconciliation-v1.js'),'utf8');
  assert.doesNotMatch(source,/systemctl|\/home\/agent|\/opt\/prhm|spawnSync|execFileSync|child_process/);
  assert.doesNotMatch(source,/['"](?:command|shell|host|path|repository_root)['"]\s*:/i);
  assert.doesNotMatch(source,/CONFIRM_LEVEL|install\s*\(|deploy\s*\(/);
});

test('registration enum equals the proven production target set exactly',()=>{
  const mod=require('./bootstrap-production-git-reconciliation-v1.js');
  assert.deepEqual(mod.enabledProjectIds(),['cfpark_front_prod']);
  assert.deepEqual(mod.buildRegistrationSpec().input_schema.properties.project_id.enum,['cfpark_front_prod']);
});
