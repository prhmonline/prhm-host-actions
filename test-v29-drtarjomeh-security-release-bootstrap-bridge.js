'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const BRIDGE='drtarjomeh-v29-mcp-bootstrap-bridge.mjs';
const EXPECTED_SOURCE_COMMIT='ed2282e245b5a6e8f72a683e5bdb09cab1972ff9';
const EXPECTED=Object.freeze({
  'bootstrap-host-actions-v29-drtarjomeh-security-release-deploy.js':'42d06bd807f0a8ef2466d792c9cfac5ff857c8241ac6c6413035710df1f5a34d',
  'drtarjomeh-security-release-v29-helper-builder.js':'a66a22b742494609686322844892769552868662694210ebb093a9eae54ea12f',
  'install-host-actions-v29-drtarjomeh-security-release.js':'c4aa0858b5761641283adce89270a3223272462cc3cbb0f0f7cda16f92e78401',
  'SOURCE_COMMIT':'d1903f41cbea9942818feaf644983755517bf1764095db558aa6510ffcb64418',
  'SHA256SUMS':'fdf30b4bf104cc91834648b9659c228cbac9a2633fe3e7ca34c12aa3de5ea5bb',
});

test('temporary bootstrap bridge is fixed to reviewed v29 artifact and has no arbitrary execution inputs',()=>{
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
