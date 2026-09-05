'use strict';

const crypto = require('node:crypto');

const ACTION = 'agent_zdt_existing_topology_rolling_refresh_source_sha_refresh_v19';
const TARGET_PATH = '/opt/prhm-agent-selfmaint-exec/actions/agent-zdt-existing-topology-rolling-refresh-v1.js';
const OLD_ACTION_SHA = 'd6e9b9d1478f680986773d9ac4fddf4c4c292a4b83421aabc9025ac33d7215c3';
const OLD_API_SHA = '7897c7e50d73bc9f00eb7efcc9bde7b25e2a0107175d592dad0d8b9180db78f9';
const NEW_API_SHA = 'c59283afb1d03c523d22d649765ebdaf388857d49e3d86e5a2abab8543fcf69a';

function fail(message) {
  throw new Error(message);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function countOccurrences(source, needle) {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = source.indexOf(needle, offset);
    if (index === -1) return count;
    count += 1;
    offset = index + needle.length;
  }
}

function buildCandidate(source) {
  if (typeof source !== 'string') fail('source_invalid');

  const oldCount = countOccurrences(source, OLD_API_SHA);
  if (oldCount === 0) fail('expected_old_api_sha_missing');
  if (oldCount !== 1) fail('expected_old_api_sha_not_unique');
  if (countOccurrences(source, NEW_API_SHA) !== 0) fail('new_api_sha_already_present');

  const content = source.replace(OLD_API_SHA, NEW_API_SHA);

  if (countOccurrences(content, OLD_API_SHA) !== 0) fail('old_api_sha_remains_after_refresh');
  if (countOccurrences(content, NEW_API_SHA) !== 1) fail('new_api_sha_postcondition_failed');

  return Object.freeze({
    ok: true,
    action: ACTION,
    target_path: TARGET_PATH,
    expected_old_action_sha256: OLD_ACTION_SHA,
    old_api_sha256: OLD_API_SHA,
    new_api_sha256: NEW_API_SHA,
    content,
    sha256: sha256(content),
    replacement_count: 1,
    production_mutation: false,
  });
}

module.exports = Object.freeze({
  ACTION,
  TARGET_PATH,
  OLD_ACTION_SHA,
  OLD_API_SHA,
  NEW_API_SHA,
  buildCandidate,
});
