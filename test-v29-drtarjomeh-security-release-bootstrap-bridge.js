'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const BRIDGE='drtarjomeh-v29-mcp-bootstrap-bridge.mjs';
const EXPECTED_SOURCE_COMMIT='f8acddbb8c9677a954626baa296ad82947e6e5d9';
const EXPECTED=Object.freeze({
  'bootstrap-host-actions-v29-drtarjomeh-security-release-deploy.js':'9272f15c0a6fb14d93273756d9fa20ee9728f0a8acb7fc187d87382750388d4f',
  'drtarjomeh-security-release-v29-helper-builder.js':'208e0eea22d464f55ac0fc839130813ccd8506205f9da38a8825741f7c79c271',
  'install-host-actions-v29-drtarjomeh-security-release.js':'41b129227441f59629a21caf443431bf74ac01634f9b6efbf18a869a37c0de9c',
  'SOURCE_COMMIT':'016f5e48d55a41e5a4b6983058ee8e9a4ba02d8f6781222f53a1dca8ccbc6092',
  'SHA256SUMS':'dcdc61c4cfe1038938459365bbc582050594a52be9b601a57f27e51cfb720992',
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
