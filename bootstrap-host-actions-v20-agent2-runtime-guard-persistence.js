'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ACTION =
  'agent2_runtime_guard_persistence_v20';

const API_SOURCE_SHA =
  '46b2e680b48a641c4802038770c9bf27f6f60b5d1b55384ead03cef439217a93';

const ARTIFACT_ROOT =
  path.join(__dirname, 'artifacts', 'agent-zdt-runtime-guard-v20');

const ARTIFACTS = Object.freeze({
  stage: Object.freeze({
    source: 'control-plane-root-scripts-stage-transport-v1.js',
    target:
      '/home/agent/ssh-agent-api/control-plane-root-scripts-stage-transport-v1.js',
    sha256:
      'f598433e7cca534a8d507f21e0e2a1b4f3bb8f02d2532beb83ab026f1a154c2b',
  }),

  forward: Object.freeze({
    source:
      'agent-api-opsExecutorRoutes-rolling-helper-forward-refresh-v1.js',
    target:
      '/home/agent/ssh-agent-api/agent-api-opsExecutorRoutes-rolling-helper-forward-refresh-v1.js',
    sha256:
      'f8132af794482436e80ff3e19ae3f4353a82de8c3e5387023d90bc7e0d244b7b',
  }),

  helper: Object.freeze({
    source:
      'agent-zdt-existing-topology-rolling-refresh-v1.js',
    target:
      '/opt/prhm-agent-selfmaint-exec/actions/agent-zdt-existing-topology-rolling-refresh-v1.js',
    sha256:
      'c5e2835e3eb76d3a48bf5bb7f34956cddc8fc83fb176048e1be28dee74dbf1a7',
  }),

  guard: Object.freeze({
    source: 'mcp-runtime-preflight.sh',
    target:
      '/usr/local/libexec/prhm-agent/mcp-runtime-preflight.sh',
    sha256:
      'aeee5be4c6cdeb9f31c341898ce01b7242ecc106181faf47e3d6dfd2003fc6e3',
  }),
});

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function fail(code) {
  throw new Error(code);
}

function canonicalPath(spec) {
  return path.join(ARTIFACT_ROOT, spec.source);
}

function verifyCanonicalArtifacts() {
  const result = {};

  for (const [name, spec] of Object.entries(ARTIFACTS)) {
    const file = canonicalPath(spec);

    const st = fs.lstatSync(file);

    if (!st.isFile() || st.isSymbolicLink())
      fail(`${name}_artifact_invalid`);

    if (fs.realpathSync(file) !== file)
      fail(`${name}_artifact_realpath_mismatch`);

    const bytes = fs.readFileSync(file);
    const actual = sha256(bytes);

    if (actual !== spec.sha256)
      fail(`${name}_artifact_sha_mismatch`);

    result[name] = Object.freeze({
      target: spec.target,
      sha256: actual,
      bytes: bytes.length,
    });
  }

  return Object.freeze({
    ok: true,
    action: ACTION,
    api_source_sha256: API_SOURCE_SHA,
    production_mutation: false,
    database_mutation: false,
    artifacts: Object.freeze(result),
  });
}

module.exports = Object.freeze({
  ACTION,
  API_SOURCE_SHA,
  ARTIFACT_ROOT,
  ARTIFACTS,
  verifyCanonicalArtifacts,
});
