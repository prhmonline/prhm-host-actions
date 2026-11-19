'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const contract = require('./honartik-seatzoom-candidate-build-contract-v1.cjs');
const fileEntries = Object.entries(contract.FILES);
function fixture() {
  return {
    productionHead: contract.BASE,
    candidateHead: contract.BASE,
    productionClean: true,
    productionPath: contract.PROD,
    candidatePath: contract.CANDIDATE,
    candidateIsServing: false,
    activeDeployOrBuild: false,
    sourceSymlinkDetected: false,
    nodeModulesReadOnly: true,
    productionBlobs: Object.fromEntries(fileEntries.map(([p,v])=>[p,v.old])),
    candidateBlobs: Object.fromEntries(fileEntries.map(([p,v])=>[p,v.candidate])),
    changedFiles: [...contract.CHANGED],
    pricePreserved: true,
    zoomFloorVerified: true,
    availableMemoryBytes: 8 * 1024 ** 3,
    diskFreeBytes: 20 * 1024 ** 3,
    loadOneMinute: 2
  };
}
const variants = [
  ['mismatched live SHA', x => x.productionHead = '0'.repeat(40)],
  ['mismatched candidate SHA', x => x.candidateHead = '0'.repeat(40)],
  ['dirty live source', x => x.productionClean = false],
  ['wrong candidate path', x => x.candidatePath = contract.PROD],
  ['serving candidate', x => x.candidateIsServing = true],
  ['active deployment', x => x.activeDeployOrBuild = true],
  ['source symlink', x => x.sourceSymlinkDetected = true],
  ['mutable linked dependencies', x => x.nodeModulesReadOnly = false],
  ['unrelated changed file', x => x.changedFiles.push('src/lib/api/payments.ts')],
  ['changed active zoom blob', x => x.candidateBlobs[contract.CHANGED[0]] = '0'.repeat(40)],
  ['changed old production blob', x => x.productionBlobs[contract.CHANGED[0]] = '0'.repeat(40)],
  ['missing price preservation', x => x.pricePreserved = false],
  ['missing zoom contract', x => x.zoomFloorVerified = false],
  ['insufficient available memory', x => x.availableMemoryBytes = 1024],
  ['insufficient disk', x => x.diskFreeBytes = 1024],
  ['excessive load', x => x.loadOneMinute = 25],
];
test('exact two-file SHA-bound candidate passes and emits fixed no-deploy sandbox plan', () => {
  const p = contract.sandboxPlan(fixture());
  assert.equal(p.command, '/usr/bin/systemd-run');
  assert.equal(p.productionMutationAllowed, false);
  assert.equal(p.requiresTrustedSignedApproval, true);
  assert.equal(p.requiresSeparateProductionRelease, true);
  assert.equal(p.argv.includes('--property=ReadWritePaths=' + contract.CANDIDATE), true);
  assert.equal(p.argv.includes('--property=ReadOnlyPaths=' + contract.PROD), true);
  assert.equal(p.argv.includes('--property=MemoryMax=4294967296'), true);
  assert.equal(p.argv.includes('--property=CPUQuota=100%'), true);
  assert.ok(p.argv.includes('--setenv=NEXT_DIST_DIR=.next.seatzoom.verify'));
  assert.equal(p.expectedArtifact, contract.CANDIDATE + '/.next.seatzoom.verify/BUILD_ID');
  assert.equal(p.argv.includes('--'), true);
  assert.equal(p.argv.includes('/bin/sh'), false);
  assert.equal(p.argv.includes('/bin/bash'), false);
});
for (const [title, fn] of variants) {
  test('FAIL CLOSED: ' + title, () => {
    const x=fixture(); fn(x);
    assert.throws(() => contract.sandboxPlan(x), /honartik_candidate_/);
  });
}
test('module cannot directly execute, and exposes no caller-controlled path, shell or approval shortcut', () => {
  const fs=require('node:fs');
  const code=fs.readFileSync(require.resolve('./honartik-seatzoom-candidate-build-contract-v1.cjs'), 'utf8');
  for (const forbidden of ['spawnSync(', 'execSync(', 'execFile(', 'system(', 'process.argv', 'require(\'node:child_process\')']) {
    assert.equal(code.includes(forbidden), false, forbidden);
  }
  assert.equal(typeof contract.sandboxPlan,'function');
});
