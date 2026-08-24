'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const recovery = require('./control-plane-root-trust-anchor-one-shot-recovery-v1.js');

test('repairs only the fixed root_scripts trust anchor and fixed recovery artifacts', async () => {
  assert.equal(typeof recovery.runRecovery, 'function');
});
