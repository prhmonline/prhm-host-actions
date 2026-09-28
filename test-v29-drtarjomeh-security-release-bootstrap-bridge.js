'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const BRIDGE='drtarjomeh-v29-mcp-bootstrap-bridge.mjs';
const EXPECTED_SOURCE_COMMIT='ed2282e245b5a6e8f72a683e5bdb09cab1972ff9';
const EXPECTED=Object.freeze({
  'bootstrap-host-actions-v29-drtarjomeh-security-release-deploy.js':'9272f15c0a6fb14d93273756d9fa20ee9728f0a8acb7fc187d87382750388d4f',
  'drtarjomeh-security-release-v29-helper-builder.js':'208e0eea22d464f55ac0fc839130813ccd8506205f9da38a8825741f7c79c271',
  'install-host-actions-v29-drtarjomeh-security-release.js':'8d64b4e55e4ed76b7bfa770f16dd66f2604beac45713aacd20e14dd8e8f7c1d2',
  'SOURCE_COMMIT':'d1903f41cbea9942818feaf644983755517bf1764095db558aa6510ffcb64418',
  'SHA256SUMS':'d3e44f8a8ffddbdeb7eac903294ebdf081d3b6f4133ec581d44701ec8af657c8',
});

test('temporary bootstrap bridge is fixed to deterministic reviewed v29 artifact and has no arbitrary execution inputs',()=>{
  const source=fs.readFileSync(BRIDGE,'utf8');
  assert.match(source,new RegExp(EXPECTED_SOURCE_COMMIT));
  for(const [name,sha] of Object.entries(EXPECTED)){
    assert.match(source,new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    assert.match(source,new RegExp(sha));
  }
  assert.match(source,/CONFIRM_LEVEL_4_CRITICAL/);
  assert.match(source,/drtarjomeh_v29_bootstrap_request_v1/);
  assert.match(source,/drtarjomeh_v29_bootstrap_status_v1/);
  assert.match(source,/drtarjomeh_v29_bootstrap_apply_v1/);
  assert.match(source,/--preflight-only/);
  assert.match(source,/systemd-run/);
  assert.match(source,/one_time_use:\s*true/);
  assert.doesNotMatch(source,/args\.command|args\.path|args\.url|args\.revision|child_process\.exec\(/);
});

test('bridge schedules only the fixed installer and never returns credential material',()=>{
  const source=fs.readFileSync(BRIDGE,'utf8');
  assert.match(source,/credential_values_returned:\s*false/);
  assert.match(source,/production_application_mutation:\s*false/);
  assert.match(source,/database_mutation:\s*false/);
  assert.doesNotMatch(source,/DRT_DB_PASS|DRT_SMS_KEY|DRT_SLACK_TOKEN/);
});
