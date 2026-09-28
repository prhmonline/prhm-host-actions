'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const WORKFLOW='.github/workflows/host-actions-v29-drtarjomeh-security-release-ci.yml';
const EXPECTED=Object.freeze([
  'bootstrap-host-actions-v29-drtarjomeh-security-release-deploy.js',
  'drtarjomeh-security-release-v29-helper-builder.js',
  'install-host-actions-v29-drtarjomeh-security-release.js',
]);

test('CI publishes an immutable v29 root-of-trust artifact',()=>{
  const source=fs.readFileSync(WORKFLOW,'utf8');
  assert.match(source,/name:\s*drtarjomeh-v29-root-of-trust/);
  assert.match(source,/actions\/upload-artifact@v4/);
  assert.match(source,/retention-days:\s*1/);
  assert.match(source,/if-no-files-found:\s*error/);
  assert.match(source,/SHA256SUMS/);
  assert.match(source,/GITHUB_SHA/);
  for(const file of EXPECTED)assert.match(source,new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('artifact contract contains no Production secrets or env files',()=>{
  const source=fs.readFileSync(WORKFLOW,'utf8');
  assert.doesNotMatch(source,/\.env\.production/i);
  assert.doesNotMatch(source,/production\.env/);
  assert.doesNotMatch(source,/DRT_DB_PASS/);
  assert.doesNotMatch(source,/DRT_SMS_KEY/);
  assert.doesNotMatch(source,/DRT_SLACK_TOKEN/);
});
