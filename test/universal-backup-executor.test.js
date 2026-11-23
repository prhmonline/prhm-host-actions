'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {createPlanner}=require('../lib/universal-backup-policy');
const {executeFileBackup}=require('../lib/universal-backup-executor.prototype');
const {verifyIsolatedRestore}=require('../lib/universal-backup-restore-verifier.prototype');
test('executor creates read-back verified file-only archive without modifying source', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'backup-exec-'));
  try {
    const root=path.join(dir,'source'),dest=path.join(dir,'backups');
    fs.mkdirSync(root);fs.mkdirSync(dest);
    const source=path.join(root,'a.php');
    fs.writeFileSync(source,'<?php echo 42;');
    const before=crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    const planner=createPlanner({projects:{imotion_admin_prod:{root,destination:dest,profiles:{code:{type:'files',files:['a.php']}}}}});
    const plan=planner.planCreate({project_id:'imotion_admin_prod',profile_id:'code',idempotency_key:'integration-test-123456'});
    const evidence=await executeFileBackup(plan);
    assert.equal(evidence.file_count,1);
    assert.equal(evidence.archive_readback_ok,true);
    assert.equal(evidence.atomic_commit_ok,false);
    assert.deepEqual(await verifyIsolatedRestore(evidence.archive_path,evidence.manifest_path),{verified:true,file_count:1,archive_sha256:evidence.archive_sha256});
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),before);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(evidence.archive_path)).digest('hex'),evidence.archive_sha256);
    assert.equal(JSON.parse(fs.readFileSync(evidence.manifest_path,'utf8')).files[0].sha256,before);
    await assert.rejects(executeFileBackup(plan),/EEXIST/);
    fs.appendFileSync(evidence.archive_path,'tamper');
    await assert.rejects(verifyIsolatedRestore(evidence.archive_path,evidence.manifest_path),/archive_hash_mismatch/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
