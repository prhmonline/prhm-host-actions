'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const m = require('./rahekomak-host-action-executor-patch-v2.js');

function syntheticOldExecutor() {
  return [
    "'use strict';",
    "const fs=require('node:fs');",
    m.START,
    "const RAHEKOMAK_DEPLOY_HELPER='/home/prhm/projects/generated/rahekomak/infra/docker/production-deploy-v1.cjs';",
    "const RAHEKOMAK_DEPLOY_HEAD='" + m.OLD_HEAD + "';",
    "const RAHEKOMAK_DEPLOY_HELPER_SHA='" + m.OLD_HELPER_SHA + "';",
    "function applyRahKomakProductionDeployV1(){",
    " const st=fs.lstatSync(RAHEKOMAK_DEPLOY_HELPER);",
    " const args=['systemd-run'];",
    "}",
    m.END,
    "function testMarker(){}"
  ].join('\n');
}

test('replacement is valid JavaScript, removes all in-process /home reads', () => {
  const source=m.patchExecutor(syntheticOldExecutor());
  assert.doesNotMatch(source, /fs\.lstatSync\(RAHEKOMAK_DEPLOY_HELPER\)/);
  assert.match(source, /fs\.lstatSync\(RAHEKOMAK_DEPLOY_WORKER\)/);
  assert.match(source, /ProtectHome=read-only/);
  assert.match(source, /ReadWritePaths=\/home\/prhm\/projects\/generated\/rahekomak/);
  assert.match(source, /runRahKomakBoundWorker\('--preflight'/);
  assert.match(source, /runRahKomakBoundWorker\('--apply'/);
  assert.match(source, /rahekomak_worker_git_blob_mismatch/);
  assert.match(source, /NoNewPrivileges=true/);
  assert.doesNotMatch(source, /ProtectHome=false|ProtectHome=no|systemctl','restart','prhm-agent-selfmaint-exec/);
  assert.doesNotThrow(() => new vm.Script(source));
});

test('fail-closed on mismatched old bindings, repeated insertion or structural drift', () => {
  const old=syntheticOldExecutor();
  for (const text of [
    old.replace(m.OLD_HEAD, '0'.repeat(40)),
    old.replace(m.OLD_HELPER_SHA, '0'.repeat(64)),
    old.replace('systemd-run', 'something-else'),
    old.replace('fs.lstatSync(RAHEKOMAK_DEPLOY_HELPER)', 'fs.statSync(RAHEKOMAK_DEPLOY_HELPER)'),
    old.replace(m.END, ''),
    old+ '\n' + m.START,
  ]) {
    assert.throws(() => m.patchExecutor(text));
  }
  assert.throws(() => m.patchExecutor(m.patchExecutor(old)), /already_patched|unreviewed/);
});

test('pinned worker corresponds exactly to reviewed Git blob; no caller-supplied path', () => {
  const bytes=fs.readFileSync(path.join(__dirname,'rahekomak-production-deploy-worker-v2.js'));
  const actual=crypto.createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
  assert.equal(actual,m.WORKER_GIT_BLOB_SHA);
  const out=m.replacement();
  assert.match(out,/crypto\.createHash\('sha1'\)/);
  assert.match(out,/'blob '\+bytes\.length\+'\\0'/);
  assert.doesNotMatch(out,/process\.argv|body\.path|input\.path|shell\s*:\s*true/);
});

test('release is explicitly bound; deployment never occurs while importing module', () => {
  const plan=m.manifest();
  assert.equal(plan.production_mutation,false);
  assert.equal(plan.executor_protect_home,'yes_preserved');
  assert.equal(plan.release_head,'7f2ea82b0865bb64c8adbc3192e8547fe4f43c25');
  assert.equal(plan.helper_sha256,'d61140507300b4e2fc6650f2fc5e4b769543d9937dd2ff58574827af9c40696f');
  assert.equal(plan.installer_status,'not_installed');
  assert.equal(plan.approval,'fresh_level_4_required_for_cutover');
});
