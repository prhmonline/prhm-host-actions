'use strict';

// SOURCE-ONLY CONTRACT. No install, shell execution, approval, service or production mutation.
// A separately authorized, audited control-plane runner must verify this contract
// against independently observed host state before invoking its fixed sandbox plan.
const ACTION = 'honartik_seatzoom_candidate_build_v1';
const OPERATION = 'host_action.honartik_seatzoom_candidate_build_v1';
const BASE = 'fbb317572f3dc6b0a04363ff8222aace65644491';
const PROD = '/home/honartik/domains/honartik.ir/public_html';
const CANDIDATE = '/home/honartik/tmp/honartik-seatzoom-candidate-20261119';
const FILES = Object.freeze({
  'src/app/seat-selection/[id]/page.tsx': Object.freeze({
    old: '764b708d0fcd1503b44da0489d02c530307875cb',
    candidate: '410c28ffff1d0273a697ab9183743c5857612ff4'
  }),
  'src/clients/seatSelection/listSeat.tsx': Object.freeze({
    old: '7f90da54fedf850de6f479bc3f7870656889e0fe',
    candidate: '023e2dfbbff906380b341b7f41f06fbd5044c0db'
  })
});
const CHANGED = Object.freeze(Object.keys(FILES).sort());
const LIMITS = Object.freeze({ memoryBytes: 4 * 1024 * 1024 * 1024, cpuPercent: 100, timeoutSeconds: 480, tasks: 96 });

function fail(message) { throw new Error('honartik_candidate_' + message); }
function canonicalKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_snapshot_object');
  return Object.keys(value).sort();
}
function exactly(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// observed must come from the TRUSTED runner, never from user-supplied JSON.
// Independent attestation needs to check symlinks/realpaths and compute Git blobs
// from candidate and production files, not merely trust a GitHub commit label.
function validateObserved(observed) {
  if (!observed || typeof observed !== 'object' || Array.isArray(observed)) fail('missing_observation');
  if (observed.productionHead !== BASE || observed.candidateHead !== BASE) fail('baseline_drift');
  if (observed.productionClean !== true) fail('production_dirty');
  if (observed.candidatePath !== CANDIDATE || observed.productionPath !== PROD) fail('path_drift');
  if (observed.candidateIsServing !== false) fail('candidate_may_be_serving');
  if (observed.activeDeployOrBuild !== false) fail('concurrent_deploy_or_build');
  if (observed.sourceSymlinkDetected !== false) fail('unsafe_source_symlink');
  if (observed.nodeModulesReadOnly !== true) fail('untrusted_dependencies');
  if (!Array.isArray(observed.changedFiles) || !exactly([...observed.changedFiles].sort(), CHANGED)) {
    fail('changed_files_drift');
  }
  if (!exactly(canonicalKeys(observed.productionBlobs), CHANGED) ||
      !exactly(canonicalKeys(observed.candidateBlobs), CHANGED)) fail('blob_scope_drift');
  for (const file of CHANGED) {
    if (observed.productionBlobs[file] !== FILES[file].old) fail('production_blob_drift');
    if (observed.candidateBlobs[file] !== FILES[file].candidate) fail('candidate_blob_drift');
  }
  if (observed.pricePreserved !== true) fail('ticket_price_modified');
  if (observed.zoomFloorVerified !== true) fail('zoom_floor_unverified');
  if (observed.availableMemoryBytes < 5 * 1024 * 1024 * 1024) fail('memory_pressure');
  if (observed.loadOneMinute > 12 || observed.diskFreeBytes < 6 * 1024 * 1024 * 1024) fail('host_pressure');
  return Object.freeze({ action: ACTION, sourceBase: BASE, candidatePath: CANDIDATE, files: CHANGED });
}

// This function RETURNS a fixed, reviewable argv only; never spawns a command.
// Registration/approval and execution must be separately implemented by the
// trusted owner-controlled registry. No receipt, no runtime execution.
function sandboxPlan(observed) {
  validateObserved(observed);
  return Object.freeze({
    command: '/usr/bin/systemd-run',
    argv: Object.freeze([
      '--wait', '--collect', '--pipe',
      '--unit=honartik-seatzoom-build-20261119',
      '--property=User=honartik',
      '--property=WorkingDirectory=' + CANDIDATE,
      '--property=ProtectSystem=strict',
      '--property=ReadWritePaths=' + CANDIDATE,
      '--property=ReadOnlyPaths=' + PROD,
      '--property=NoNewPrivileges=yes',
      '--property=PrivateTmp=yes',
      '--property=MemoryMax=' + String(LIMITS.memoryBytes),
      '--property=CPUQuota=' + String(LIMITS.cpuPercent) + '%',
      '--property=TasksMax=' + String(LIMITS.tasks),
      '--property=Nice=15',
      '--property=IOSchedulingClass=idle',
      '--setenv=NODE_OPTIONS=--max-old-space-size=3072',
      '--setenv=NEXT_TELEMETRY_DISABLED=1',
      '--setenv=NEXT_DIST_DIR=.next.seatzoom.verify',
      '--', '/usr/bin/timeout', String(LIMITS.timeoutSeconds) + 's',
      '/usr/bin/npm', '--prefix', CANDIDATE, 'run', 'build:universal'
    ]),
    expectedArtifact: CANDIDATE + '/.next.seatzoom.verify/BUILD_ID',
    productionMutationAllowed: false,
    requiresTrustedSignedApproval: true,
    requiresSeparateProductionRelease: true
  });
}
module.exports = Object.freeze({ ACTION, OPERATION, BASE, PROD, CANDIDATE, FILES, CHANGED, LIMITS, validateObserved, sandboxPlan });
