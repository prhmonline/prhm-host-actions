'use strict';
/**
 * SHA-pinned, read-only server-local readiness probe for the existing Universal
 * Installer backup-only upgrade. This is NOT a registrar, signature issuer,
 * privileged installer, or authorization. It never changes production state.
 */
const fs = require('node:fs');
const crypto = require('node:crypto');
const { FIXED } = require('./universal-installer-backup-only-native-contract-v1.cjs');

const PATHS = Object.freeze({
  installedBackup: '/usr/local/libexec/deploy-control/universal/current/universal/backup.py',
  candidateArchive: '/home/honartik/tmp/universal-backup-only-20261029/universal-installer-backup-only.tar.gz',
  nativeProviderPublicKey: '/var/lib/prhm-agent-selfmaint-exec/root-of-trust/provider-bootstrap-ed25519-public.pem',
  approvalCenterPublicKey: '/var/lib/prhm-company-approval/ed25519-public.pem',
  approvalCenterConsumedLedger: '/var/lib/prhm-company-approval/consumed',
  base: '/opt/prhm-agent-selfmaint/server.js',
  executor: '/opt/prhm-agent-selfmaint-exec/server.js',
  mcp: '/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
  policy: '/opt/prhm-company-control-plane/config/approval-policy.json',
  nativeFixedContract: '/opt/prhm-agent-selfmaint-exec/actions/universal-installer-backup-only-native-contract-v1.cjs'
});
const SHA = /^[a-f0-9]{64}$/;
function hash(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

function readRegularFixed(path, maxBytes = 2_000_000) {
  try {
    const st = fs.lstatSync(path);
    if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 ||
        st.size < 1 || st.size > maxBytes) return { present: true, safe: false, sha256: null };
    const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const opened = fs.fstatSync(fd);
      if (opened.ino !== st.ino || opened.dev !== st.dev || opened.size !== st.size)
        return { present: true, safe: false, sha256: null };
      const bytes = fs.readFileSync(fd);
      if (bytes.length !== st.size) return { present: true, safe: false, sha256: null };
      return { present: true, safe: true, sha256: hash(bytes), bytes };
    } finally { fs.closeSync(fd); }
  } catch {
    return { present: false, safe: false, sha256: null };
  }
}
function existsFixed(path, expectedDir = false) {
  try {
    const st = fs.lstatSync(path);
    return !st.isSymbolicLink() && (expectedDir ? st.isDirectory() : st.isFile());
  } catch { return false; }
}
/**
 * Pure diagnostic logic. Synthetic input cannot authorize execution, because
 * there is deliberately no execution function or approval-token handling.
 */
function classify(s) {
  const gates = Object.freeze({
    installedBaseExact: s.installedBaseSha === FIXED.installed_backup_sha256,
    candidateExact: s.candidateArchiveSha === FIXED.archive_sha256,
    approvalCenterPublicKeyPresent: s.approvalCenterPublicKeyPresent === true,
    approvalCenterLedgerPresent: s.approvalCenterLedgerPresent === true,
    providerTrustAnchorPresent: s.providerTrustAnchorPresent === true,
    rootOwnedNativeActionPresent: s.rootOwnedNativeActionPresent === true,
    agentApiRegistered: s.agentApiRegistered === true,
    rootExecutorRegistered: s.rootExecutorRegistered === true,
    mcpRegistered: s.mcpRegistered === true,
    exactPolicyRegistered: s.exactPolicyRegistered === true,
    typedL4ScopeRegistered: s.typedL4ScopeRegistered === true
  });
  const blockers = Object.entries(gates).filter(([,ok])=>!ok).map(([k])=>k);
  return Object.freeze({
    schema: 'prhm.universal.backup-only.server-local-readiness.v1',
    action: FIXED.action,
    installedBundleExpected: FIXED.installed_bundle,
    candidateBundleExpected: FIXED.candidate_bundle,
    gates, blockers,
    readyToRequestSignedL4: blockers.length === 0,
    signedReceiptValidated: false,
    rootOfTrustRegistrationExecuted: false,
    productionInstallerUpgraded: false,
    applicationDeployed: false,
    executionAuthorizedByThisProbe: false
  });
}
function inspectLiveReadOnly() {
  const base = readRegularFixed(PATHS.base);
  const executor = readRegularFixed(PATHS.executor);
  const mcp = readRegularFixed(PATHS.mcp);
  const policy = readRegularFixed(PATHS.policy);
  const backup = readRegularFixed(PATHS.installedBackup);
  const candidate = readRegularFixed(PATHS.candidateArchive, 2_000_000);
  const action = FIXED.action, operation = FIXED.operation;
  const has = (f,needle)=>f.safe && f.bytes.includes(Buffer.from(needle));
  let parsed = null;
  try { if (policy.safe) parsed = JSON.parse(policy.bytes.toString('utf8')); } catch {}
  const scopes = Array.isArray(parsed?.typed_scopes) ? parsed.typed_scopes : [];
  const native = readRegularFixed(PATHS.nativeFixedContract);
  const nativeSt = (()=>{try{return fs.lstatSync(PATHS.nativeFixedContract)}catch{return null}})();
  const s = {
    installedBaseSha: backup.safe ? backup.sha256 : null,
    candidateArchiveSha: candidate.safe ? candidate.sha256 : null,
    approvalCenterPublicKeyPresent: existsFixed(PATHS.approvalCenterPublicKey),
    approvalCenterLedgerPresent: existsFixed(PATHS.approvalCenterConsumedLedger, true),
    providerTrustAnchorPresent: existsFixed(PATHS.nativeProviderPublicKey),
    rootOwnedNativeActionPresent: native.safe && nativeSt.uid === 0 &&
      (nativeSt.mode & 0o022) === 0 && has(native,action),
    agentApiRegistered: has(base,action),
    rootExecutorRegistered: has(executor,action),
    mcpRegistered: has(mcp,action),
    exactPolicyRegistered: parsed?.operations &&
      Object.prototype.hasOwnProperty.call(parsed.operations,operation) === true,
    typedL4ScopeRegistered: scopes.some(x=>x && x.action === action &&
      (x.level === 4 || x.risk === 'critical'))
  };
  return classify(s);
}
module.exports = Object.freeze({ FIXED, PATHS, classify, inspectLiveReadOnly });
if (require.main === module) {
  if (process.argv.length !== 2) {
    process.stderr.write('No arguments allowed; this is a fixed read-only probe.\n');
    process.exitCode = 64;
  } else {
    const result = inspectLiveReadOnly();
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    process.exitCode = result.readyToRequestSignedL4 ? 0 : 2;
  }
}
