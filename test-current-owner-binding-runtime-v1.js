'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const r=require('./current-owner-binding-runtime-v1.js');

test('runtime exposes only fixed production roots, services and V19 verification paths',()=>{
  assert.equal(r.ACTION,'control_plane_current_owner_binding_refresh_v1');
  assert.equal(r.PRIVATE_DIR,'/opt/prhm-agent-selfmaint-exec/actions/current-owner-binding-v1');
  assert.equal(r.STATE_ROOT,'/var/lib/prhm-agent-selfmaint-exec/current-owner-binding-v1');
  assert.equal(r.BACKUP_ROOT,'/var/backups/prhm-current-owner-binding-refresh-v1');
  assert.equal(r.SERVICES.selfmaint,'prhm-agent-selfmaint.service');
  assert.equal(r.SERVICES.executor,'prhm-agent-selfmaint-exec.service');
  assert.equal(r.V19_WORKTREE,'/home/prhm/worktrees/prhm-host-actions-zdt-installer-v2');
  assert.equal(r.V19_TEST,r.V19_WORKTREE+'/test-v18-agent-zdt-current-baseline-refresh.js');
  assert.equal(r.V19_HELPER,'/opt/prhm-agent-selfmaint-exec/actions/agent-zdt-source-sha-refresh-v19.sh');
});

test('runtime production dependency object has exactly the core dependency contract',()=>{
  const fakeModules={manifest:{},systemd:{}};
  const d=r.createDeps(fakeModules);
  const names=Object.keys(d).sort();
  assert.deepEqual(names,[
    'acquireLock','atomicReplace','daemonReload','effectiveState','inspectDropin','installDropin','inventoryOwners','now',
    'persistCandidate','persistPreimage','persistRollback','persistTransaction','probeWritable','removeDropin','restartService',
    'selfmaintHealth','snapshotConsumer','validateCandidate','verifyFileSha','verifyHook'
  ].sort());
});

test('runtime source has no generic shell, arbitrary path, network URL or inactive MCP service restart',()=>{
  const src=fs.readFileSync(require.resolve('./current-owner-binding-runtime-v1.js'),'utf8');
  assert.doesNotMatch(src,/bash\s+-c|sh\s+-c|execSync\(|(?:child_process|cp)\.exec\(|shell\s*:\s*true/);
  assert.doesNotMatch(src,/https?:\/\//);
  assert.doesNotMatch(src,/prhm-agent-mcp\.service/);
  assert.match(src,/prhm-agent-selfmaint-exec\.service/);
  assert.match(src,/PRHM_CURRENT_OWNER_BINDING_V1/);
});

test('runtime CLI delegates only through core fixed-mode parser',()=>{
  const src=fs.readFileSync(require.resolve('./current-owner-binding-runtime-v1.js'),'utf8');
  assert.match(src,/runCli\(args,createDeps\(modules\)\)/);
  assert.doesNotMatch(src,/process\.argv\.slice\(2\).*path|process\.argv\.slice\(2\).*command/);
});
