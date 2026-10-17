'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const inspector=require('../ops/agent3-universal-backup/five-field-live-contract-inspector.cjs');
test('inspector reports bounded line identifiers and digests, never full source',()=>{
 const fixture=Buffer.from([
  'const HOST_ACTION_V2_SPECS = Object.freeze({',
  "  existing_v1:{operation:'host_action.existing_v1'},",
  '});',
  'function hostActionV2Spec(action) {',
  "  if(!action)throw Error('not-allowed');",
  '}',
  'function applyHostActionV2(action) { return false; }',
  'const approvalToken = "VERY_SECRET_DO_NOT_PRINT";',
  'const arguments_sha256 = someHash;',
  ''
 ].join('\n'));
 const out=inspector.scan('executor',fixture);
 assert.equal(out.anchors.v2_spec_registry.count,1);
 assert.equal(out.anchors.v2_request_handler.count,1);
 assert.equal(out.anchors.v2_apply_dispatch.count,1);
 assert.equal(out.anchors.request_signature_binding.count,1);
 assert.equal(JSON.stringify(out).includes('VERY_SECRET'),false);
 assert.equal(out.line_count,10);
 assert.equal(typeof out.sha256,'string');
 assert.equal(out.anchors.v2_apply_dispatch.samples[0].line,7);
 assert.equal(Object.hasOwn(out.anchors.v2_spec_registry.samples[0],'excerpt'),false);
 assert.equal(JSON.stringify(out).includes('const HOST_ACTION_V2_SPECS'),false);
 assert.equal(JSON.stringify(out).includes('function applyHostActionV2'),false);
});
test('all token, environment and credential lines are redacted including false positives',()=>{
 for(const text of [
  'const password = "user-password"',
  "const API_KEY = 'abc'",
  'process.env.APP_SECRET',
  'Authorization: Bearer secret',
  'const foo = credentialHeader',
  'const approvalToken = something',
  'privateKey = bytes',
  'cookie: session=123'
 ]) assert.equal(inspector.redact(text),'[REDACTED_SENSITIVE_SOURCE_LINE]');
 assert.equal(inspector.redact('const alpha = 1'),'const alpha = 1');
});
test('bounded samples and excerpts; no unauthorized path or owner set',()=>{
 const lines=Array.from({length:17},(_,i)=>
  "function hostActionV2Spec(action) { /* safe "+i+" */ }").join('\n');
 const out=inspector.scan('executor',Buffer.from(lines));
 assert.equal(out.anchors.v2_request_handler.count,17);
 assert.equal(out.anchors.v2_request_handler.samples.length,inspector.MAX_WINDOW_HITS);
 assert.equal(inspector.redact('Z'.repeat(10000)).length,inspector.MAX_SOURCE_LINE);
 assert.throws(()=>inspector.scan('unapproved',Buffer.from('x')),/inspector_untrusted_owner/);
 assert.throws(()=>inspector.scan('base','x'),/inspector_untrusted_owner/);
});
test('this script has no install or arbitrary CLI mode',()=>{
 const file=path.join(__dirname,'../ops/agent3-universal-backup/five-field-live-contract-inspector.cjs');
 const result=cp.spawnSync(process.execPath,[file,'--apply'],{encoding:'utf8',timeout:10000});
 assert.equal(result.status,64);
 assert.match(result.stderr,/read-only --inspect only/);
});
