'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('./control-plane-root-trust-anchor-typed-bootstrap-successor-adoption-v1.js');

test('successor adoption contract is fixed and fail-closed', () => {
  assert.equal(m.ACTION, 'control_plane_root_scripts_stage_transport_v1');
  assert.equal(m.OPERATION, 'host_action.control_plane_root_scripts_stage_transport_v1');
  assert.deepEqual(m.ARTIFACTS.transport, {bytes:72854, sha256:'049250921dda0aa98ade7cf3707634668590bd66163606de5906841f5ca34335e'});
  assert.deepEqual(m.ARTIFACTS.bootstrap, {bytes:109634, sha256:'d3be569a4fd63b8e0c78e370ad689a27aa2751ea772891cb6b7ffe7fbd49b35e'});
  assert.equal(m.EXECUTION_CONTRACT.level4Required, true);
  assert.equal(m.EXECUTION_CONTRACT.legacyFallback, false);
  assert.equal(m.EXECUTION_CONTRACT.parkProductionMutation, false);
});
