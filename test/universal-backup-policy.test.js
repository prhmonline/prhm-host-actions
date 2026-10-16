'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createPlanner, verifyEvidence} = require('../lib/universal-backup-policy');
function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent3-backup-'));
  try {
    const source = path.join(dir, 'source');
    const dest = path.join(dir, 'dest');
    fs.mkdirSync(source); fs.mkdirSync(dest);
    fs.writeFileSync(path.join(source, 'one.php'), '<?php');
    return fn({dir,source,dest,registry:{projects:{imotion_admin_prod:{root:source,destination:dest,profiles:{code:{type:'files',files:['one.php']}}}}}});
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}
const request = {project_id:'imotion_admin_prod',profile_id:'code',idempotency_key:'test-key-123456'};
test('registered file backup produces plan but does not write archive', () => fixture(({registry,dest}) => {
  const plan = createPlanner(registry).planCreate(request);
  assert.equal(plan.status,'planned_not_executed');
  assert.equal(plan.expected_file_count,1);
  assert.deepEqual(fs.readdirSync(dest),[]);
}));
test('reject unregistered project and injected parameters', () => fixture(({registry}) => {
  const planner = createPlanner(registry);
  assert.throws(() => planner.planCreate({...request,project_id:'unknown'}), /denied/);
  assert.throws(() => planner.planCreate({...request,command:'rm -rf /'}), /denied/);
}));
test('reject traversal and symlink', () => fixture(({registry,source,dir}) => {
  registry.projects.imotion_admin_prod.profiles.code.files=['../outside'];
  assert.throws(() => createPlanner(registry),/denied/);
  fs.symlinkSync(path.join(source,'one.php'),path.join(source,'link.php'));
  registry.projects.imotion_admin_prod.profiles.code.files=['link.php'];
  assert.throws(() => createPlanner(registry),/denied/);
}));
test('reject destination inside source and unsupported DB profile', () => fixture(({registry,source}) => {
  registry.projects.imotion_admin_prod.destination=source;
  assert.throws(() => createPlanner(registry),/denied/);
  registry.projects.imotion_admin_prod.destination=path.dirname(source);
  registry.projects.imotion_admin_prod.profiles.code.type='database';
  assert.throws(() => createPlanner(registry),/denied/);
}));
test('idempotency conflict and evidence validation', () => fixture(({registry}) => {
  const planner = createPlanner(registry);
  const plan = planner.planCreate(request);
  assert.deepEqual(planner.planCreate(request),plan);
  assert.throws(() => verifyEvidence({},plan),/denied/);
  const hash='a'.repeat(64);
  assert.throws(() => verifyEvidence({job_id:plan.job_id,file_count:1,archive_sha256:hash,manifest_sha256:hash,archive_readback_ok:true,manifest_verified:true,atomic_commit_ok:true},plan),/denied/);
}));
