'use strict';
// M03 / Issue #246: static release-scope contract. Source-only, no privileged executor.
const crypto = require('node:crypto');
const manifest = require('./manifests/moeinshow-m03-selective-patch-v1.json');

const ACTION = 'moeinshow_m03_scoped_delivery_v1';
const OPERATION = 'host_action.moeinshow_m03_scoped_delivery_v1';
const ALLOWED_PATHS = Object.freeze([
  'src/app/layout.tsx',
  'src/components/GoftinoWidget.tsx',
  'src/clients/home/sectionSliderHome/index.tsx',
  'src/clients/home/sectionSliderHome/style.scss',
  'src/ui/assets/styles/globals.scss',
  'src/ui/layout/header/index.tsx',
  'src/ui/layout/header/style.module.scss'
]);
const FULL_SHA40 = /^[0-9a-f]{40}$/;
function fail(code) { throw new Error(code); }

function validateManifest(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) fail('manifest_invalid');
  if (m.schema_version !== 'prhm.moeinshow.m03.selective-patch-manifest.v1' || m.ticket !== 'M03') fail('manifest_identity_invalid');
  const p = m.production || {}, s = m.source || {}, policy = m.release_policy || {};
  if (p.project !== 'moeinshow_front_prod' || p.root !== '/home/moeinshow/domains/moeinshow.com/public_html'
      || p.expected_branch !== 'main' || p.expected_head !== '87c9cfbe0117ab5c102ba21e7a30fa83e9761d0d'
      || s.ref !== 'feature/honartik-parity-no-iticket-20261030'
      || s.commit !== 'b9b03e6036703a3cb12fd83d895efa53b9b4faf4') fail('manifest_release_identity_drift');
  const expected = {
    signed_single_use_level4_required: true,
    max_age_seconds: 180,
    allowed_mode: 'reviewed-three-way-only',
    allow_direct_source_copy: false,
    allow_full_feature_merge: false,
    allow_unreviewed_paths: false,
    allow_production_before_build_and_qa: false,
    local_git_objects_only: true,
    release_authorized: false,
    database_mutation: false,
    rollback_required: true
  };
  for (const [key, value] of Object.entries(expected)) {
    if (policy[key] !== value) fail('manifest_release_policy_drift_' + key);
  }
  if (!Array.isArray(m.files) || m.files.length !== ALLOWED_PATHS.length) fail('manifest_file_count_drift');
  if (new Set(m.files.map(f => f.path)).size !== ALLOWED_PATHS.length) fail('manifest_duplicate_file');
  for (let i=0; i<ALLOWED_PATHS.length; i++) {
    const f = m.files[i];
    if (!f || f.path !== ALLOWED_PATHS[i]) fail('manifest_unexpected_path');
    if (f.requires_semantic_rebase !== true) fail('manifest_review_required');
    if (!FULL_SHA40.test(f.source_blob)) fail('manifest_source_blob_invalid');
    if (f.path === 'src/components/GoftinoWidget.tsx') {
      if (f.change_kind !== 'create' || f.baseline_blob !== null) fail('manifest_creation_preimage_invalid');
    } else if (f.change_kind !== 'modify' || !FULL_SHA40.test(f.baseline_blob) || f.baseline_blob === f.source_blob) {
      fail('manifest_modified_file_preimage_invalid');
    }
  }
  const checks = m.checks || {};
  if (checks.must_be_exactly_seven_files !== true || checks.reject_payment_and_booking_paths !== true ||
      checks.proof_git_blob_sha_before_patch !== true || checks.verify_deployed_sha !== true ||
      checks.rollback_on_failure !== true || checks.verify_header_center !== true ||
      checks.verify_no_overflow !== true || checks.verify_mobile_slider !== true ||
      checks.verify_brand_logo !== true || checks.verify_goftino_hidden_on_home !== true ||
      checks.verify_nonhome_navigation !== true ||
      JSON.stringify(checks.visual_widths) !== '[375,768,1024,1440]') fail('manifest_qa_policy_invalid');
  return true;
}
function deriveCandidate() {
  validateManifest(manifest);
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return Object.freeze({
    action: ACTION, operation: OPERATION, target: manifest.production.project,
    manifest_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    production_base_sha: manifest.production.expected_head,
    source_commit: manifest.source.commit,
    file_count: manifest.files.length,
    policy_level: 4,
    one_time_approval_required: true,
    signing_authority: 'Approval Center (independent; not supplied by caller)',
    root_install_registered: false,
    approval_issued: false,
    production_release_authorized: false,
    production_mutation: false
  });
}
// Do not expose caller-controlled switch to release; this source-only module must
// be replaced by an independently reviewed and registered signed executor.
function apply() { fail('m03_root_action_not_installed'); }
module.exports = { ACTION, OPERATION, ALLOWED_PATHS, manifest, validateManifest, deriveCandidate, apply };
if (require.main === module) process.stdout.write(JSON.stringify(deriveCandidate(), null, 2) + '\n');
