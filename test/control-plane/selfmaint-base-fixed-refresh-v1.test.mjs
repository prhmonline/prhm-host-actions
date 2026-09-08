import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIXED,
  requestToolSchema,
  applyToolSchema,
  verifyRefreshResult
} from '../../candidates/control-plane/selfmaint-base-fixed-refresh-v1.mjs';

test('selfmaint base refresh surface is zero-input and fixed to one service', () => {
  assert.deepEqual(requestToolSchema(), {});
  assert.deepEqual(applyToolSchema(), {
    request_id: 'uuid',
    second_confirmation: 'CONFIRM_LEVEL_3_PRODUCTION'
  });
  assert.equal(FIXED.action, 'selfmaint_base_fixed_refresh_v1');
  assert.equal(FIXED.operation, 'host_action.selfmaint_base_fixed_refresh_v1');
  assert.equal(FIXED.service, 'prhm-agent-selfmaint.service');
  assert.equal(FIXED.target_sha256, 'a23b4fec52123f8ad484f31576281c2f1933f24a3c811cd98c28e764a292e315');
  assert.equal(FIXED.arbitrary_input, false);
  assert.equal(FIXED.file_mutation, false);
});

test('refresh verification requires active service, changed pid and healthy socket', () => {
  const ok = verifyRefreshResult({
    before_pid: 101,
    after_pid: 202,
    service_active: true,
    health_ok: true,
    runtime_sha256: FIXED.target_sha256
  });
  assert.equal(ok, true);

  for (const bad of [
    { before_pid: 101, after_pid: 101, service_active: true, health_ok: true, runtime_sha256: FIXED.target_sha256 },
    { before_pid: 101, after_pid: 202, service_active: false, health_ok: true, runtime_sha256: FIXED.target_sha256 },
    { before_pid: 101, after_pid: 202, service_active: true, health_ok: false, runtime_sha256: FIXED.target_sha256 },
    { before_pid: 101, after_pid: 202, service_active: true, health_ok: true, runtime_sha256: '0'.repeat(64) }
  ]) {
    assert.throws(() => verifyRefreshResult(bad));
  }
});
