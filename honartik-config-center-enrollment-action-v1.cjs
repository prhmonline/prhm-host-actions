'use strict';

// Pure, fixed-scope transaction contract for integration with the existing
// approval-bound Agent 3 Host Actions executor. Does not create an MCP route,
// run shell commands, or provision a credential by itself.
const CONTRACT = Object.freeze({
  action: 'honartik_config_center_readonly_enroll_v1',
  operation: 'host_action.honartik_config_center_readonly_enroll_v1',
  approvalLevel: 4,
  confirmation: 'CONFIRM_LEVEL_4_CRITICAL',
  site: 'honartik',
  revision: 1,
  scope: 'config:read',
  backendSha: '7ae8b99677ec13b3498b4a5425267a49fc87806e',
  configCenterRelease: 'git-9b41e4534382',
  scriptGitSha: '740827bc445d028bca285e20b13b8765c4d75f28',
  scriptSha256: 'b9978bd782282ee385b487cc7d4614edc2b6f4f3b8c513797c657b32f0d50903',
  credentialName: 'Honartik Backend Readonly Production 20261012',
  credentialPath: '/home/honartik/.config/prhm/config-center/readonly-machine-token',
  consumer: 'php yii config-center/check'
});

const REQUIRED_ADAPTER = Object.freeze([
  'withExclusiveLock',
  'readPreflight',
  'attestConsumedApproval',
  'runFixedEnrollment',
  'runFixedRollback',
  'readPostcondition',
  'runFixedConsumerCheck',
  'writeAudit'
]);

function assertAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') throw new Error('adapter_unavailable');
  for (const key of REQUIRED_ADAPTER) {
    if (typeof adapter[key] !== 'function') throw new Error('adapter_unavailable');
  }
}
function validatePreflight(state) {
  return !!state && state.site === CONTRACT.site &&
    state.revision === CONTRACT.revision &&
    state.backendSha === CONTRACT.backendSha &&
    state.configCenterRelease === CONTRACT.configCenterRelease &&
    state.scriptGitSha === CONTRACT.scriptGitSha &&
    state.scriptSha256 === CONTRACT.scriptSha256 &&
    state.activeCredentialCount === 0 &&
    state.credentialFileExists === false &&
    state.projectGitClean === true &&
    state.scriptGitClean === true &&
    state.consumerPresent === true &&
    state.allowedScope === CONTRACT.scope;
}
function validatePostcondition(state) {
  return !!state && state.site === CONTRACT.site &&
    state.revision === CONTRACT.revision &&
    state.activeCredentialCount === 1 &&
    state.credentialFileExists === true &&
    state.fileMode === '0600' &&
    state.fileOwner === 'honartik' &&
    state.credentialName === CONTRACT.credentialName &&
    Array.isArray(state.scopes) && state.scopes.length === 1 &&
    state.scopes[0] === CONTRACT.scope &&
    state.configHttp === 200 && state.secretsHttp === 403;
}
function validateConsumer(outcome) {
  return !!outcome && outcome.exitCode === 0 &&
    outcome.output === 'CONFIG_CENTER_READONLY_PASS tenant=honartik revision=1 source=remote';
}
function validateApproval(outcome, requestId) {
  return !!outcome && outcome.ok === true &&
    outcome.requestId === requestId &&
    outcome.action === CONTRACT.action &&
    outcome.operation === CONTRACT.operation &&
    outcome.level === CONTRACT.approvalLevel &&
    outcome.confirmation === CONTRACT.confirmation &&
    outcome.sourceSha === CONTRACT.scriptGitSha &&
    outcome.consumedOnce === true;
}
function validateRequest(request) {
  const id = request && request.requestId;
  if (typeof id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ||
      Object.keys(request).length !== 1) {
    throw new Error('invalid_request');
  }
  return id;
}
function publicStatus(status, rollback) {
  return Object.freeze({
    action: CONTRACT.action,
    site: CONTRACT.site,
    revision: CONTRACT.revision,
    status,
    rollback
  });
}

function createAction(adapter) {
  assertAdapter(adapter);
  const fixed = Object.freeze({ ...CONTRACT });
  async function preflight() {
    try {
      const attestation = await adapter.readPreflight(fixed);
      return publicStatus(validatePreflight(attestation) ? 'ready' : 'blocked', 'not_needed');
    } catch {
      return publicStatus('blocked', 'not_needed');
    }
  }
  async function apply(request) {
    let requestId;
    try { requestId = validateRequest(request); }
    catch { return publicStatus('denied', 'not_needed'); }
    try {
      return await adapter.withExclusiveLock(fixed.action, async () => {
        let started = false;
        try {
          const attestation = await adapter.readPreflight(fixed);
          if (!validatePreflight(attestation)) return publicStatus('blocked', 'not_needed');
          // Existing trusted Host Actions executor already consumed the signed one-time
          // approval before it dispatches this handler. Attest that consumed
          // authorization here; NEVER consume the same request twice.
          const approval = await adapter.attestConsumedApproval({
            requestId, action: fixed.action, operation: fixed.operation,
            level: fixed.approvalLevel, sourceSha: fixed.scriptGitSha
          });
          if (!validateApproval(approval, requestId)) return publicStatus('denied', 'not_needed');
          started = true;
          const issuance = await adapter.runFixedEnrollment(fixed);
          if (issuance !== 'issued') throw new Error('enrollment_unsuccessful');
          const post = await adapter.readPostcondition(fixed);
          if (!validatePostcondition(post)) throw new Error('postcondition_failed');
          const consumer = await adapter.runFixedConsumerCheck(fixed);
          if (!validateConsumer(consumer)) throw new Error('consumer_failed');
          try {
            await adapter.writeAudit({ action: fixed.action, result: 'success', rollback: 'not_needed', site: fixed.site, sourceSha: fixed.scriptGitSha });
          } catch {
            throw new Error('audit_failed');
          }
          return publicStatus('success', 'not_needed');
        } catch {
          if (!started) return publicStatus('blocked', 'not_needed');
          let restored = false;
          try {
            const result = await adapter.runFixedRollback(fixed);
            const post = await adapter.readPostcondition(fixed);
            restored = result === 'revoked' && post && post.activeCredentialCount === 0 && post.credentialFileExists === false;
          } catch { /* Preserve the failed result; never leak exception text. */ }
          try {
            await adapter.writeAudit({ action: fixed.action, result: 'failure', rollback: restored ? 'verified' : 'unverified', site: fixed.site, sourceSha: fixed.scriptGitSha });
          } catch { /* The result remains a fail-closed failure. */ }
          return publicStatus('failed', restored ? 'verified' : 'unverified');
        }
      });
    } catch {
      return publicStatus('blocked', 'not_needed');
    }
  }
  return Object.freeze({ preflight, apply });
}

module.exports = Object.freeze({ CONTRACT, REQUIRED_ADAPTER, createAction, validatePreflight,
  validatePostcondition, validateConsumer, validateApproval, validateRequest });
