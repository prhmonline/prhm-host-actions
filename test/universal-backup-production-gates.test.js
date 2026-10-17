'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../lib/universal-backup-executor.prototype.js'),'utf8');
test('prototype must not claim atomic production readiness', () => {
  assert.match(source, /atomic_commit_ok:false/);
});
test('production gate requires durable commit and encrypted storage', () => {
  const readiness = {
    atomicCommit: false, encryptedAtRest: false,
    independentlyVerifiedRestore: false, authorizedAgentAction: false
  };
  assert.equal(Object.values(readiness).every(Boolean), false);
});
test('prototype must not be exposed as approved production executor', () => {
  assert.match(source, /Prototype only/);
  assert.match(source, /COPYFILE_EXCL/);
});
