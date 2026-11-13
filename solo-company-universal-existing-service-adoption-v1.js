'use strict';
/*
 * Source-only candidate for an existing, stateful Solo Runtime service.
 * This is NOT installed by, nor registered in, Universal Installer v1.
 * No CLI, no I/O, no service control, no network requests, no authority.
 * A trusted future Installer adapter must independently gather evidence.
 */
const crypto = require('node:crypto');
const EXPECTED = Object.freeze({
  schema: 'prhm.universal.existing-service-adoption.v1',
  project: 'solo_company',
  environment: 'production',
  status: 'SOURCE_ONLY_NO_GO',
  runtime_installation_record: 'OPERATIONAL_ACCEPTED_2026-11-03_PR233',
  host_action_registration_state: 'NOT_REGISTERED',
  operation: 'read_only_admission',
  release_sha: '0eb43d72aab3f10db22172c8be4c0411cf22d074',
  install_root: '/opt/prhm-solo-company',
  marker: '/opt/prhm-solo-company/.release-sha',
  unit: 'prhm-solo-company-runtime.service',
  state_directory: 'prhm-solo-company',
  state_root: '/var/lib/private/prhm-solo-company',
  bind: '127.0.0.1:8782',
  health_path: '/health',
  status_path: '/status',
  managed_by_universal: false,
  allow_restart: false,
  allow_stop: false,
  allow_install: false,
  allow_mutate_state: false,
  allow_open_public_route: false,
  rollback_policy: 'observe-only-preserve-state-and-unit'
});
const fail = code => { throw Error('solo_universal_adoption_' + code); };
function requireExactKeys(obj, expected) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) ||
      Object.keys(obj).sort().join('|') !== Object.keys(expected).sort().join('|'))
    fail('profile_schema_invalid');
}
function verifyCandidate(profile) {
  requireExactKeys(profile, EXPECTED);
  for (const [key, value] of Object.entries(EXPECTED))
    if (profile[key] !== value) fail('candidate_binding_invalid_' + key);
  return Object.freeze({valid:true, executable:false, registered:false,
    managed_by_universal:false, release_sha:EXPECTED.release_sha});
}
function verifyObservation(profile, observation) {
  verifyCandidate(profile);
  if (!observation || typeof observation !== 'object' || Array.isArray(observation))
    fail('observation_required');
  const {systemd, release, health, status, network, state} = observation;
  if (!systemd || systemd.unit !== EXPECTED.unit ||
      systemd.active_state !== 'active' ||
      systemd.sub_state !== 'running' ||
      systemd.unit_file_state !== 'enabled' ||
      systemd.dynamic_user !== true ||
      systemd.protect_system !== 'strict')
    fail('unit_not_healthy_or_mismatch');
  if (!release || release.marker_path !== EXPECTED.marker ||
      release.marker_sha !== EXPECTED.release_sha ||
      release.install_root !== EXPECTED.install_root)
    fail('release_mismatch');
  if (!network || network.listening !== EXPECTED.bind ||
      network.publicly_exposed !== false)
    fail('network_not_private');
  if (!state || state.state_directory !== EXPECTED.state_directory ||
      state.root !== EXPECTED.state_root ||
      state.persistent !== true ||
      state.data_mutated_by_admission !== false)
    fail('persistent_state_unverified');
  if (!health || health.http_status !== 200 ||
      health.body?.ok !== true || health.body?.state !== 'running' ||
      health.body?.heartbeat_fresh !== true)
    fail('health_not_fresh');
  if (!status || status.http_status !== 200 ||
      status.body?.state !== 'running' ||
      ['queue_depth','retrying','blocked','awaiting_approval',
        'completed_total','failed_total'].some(k=>status.body[k]!==0) ||
      status.body?.worker_busy !== false)
    fail('not_dark_or_not_idle');
  const evidence = {
    project:EXPECTED.project,environment:EXPECTED.environment,
    release_sha:EXPECTED.release_sha,unit:EXPECTED.unit,
    loopback:EXPECTED.bind,dark_mode:true,service_healthy:true,
    state_persistent:true,read_only:true,
    registration_authorized:false,production_mutation:false,
    managed_by_universal:false
  };
  return Object.freeze({
    schema:'prhm.universal.existing-service-observation.v1',
    evidence, evidence_sha256:crypto.createHash('sha256')
      .update(JSON.stringify(evidence)).digest('hex'),
    result:'READ_ONLY_ADMISSION_PASS_NOT_MANAGED'
  });
}
module.exports=Object.freeze({EXPECTED,verifyCandidate,verifyObservation});
if(require.main===module){
  process.stderr.write('NO_CLI: source-only, review and trusted Universal Installer adapter required\n');
  process.exitCode=64;
}
