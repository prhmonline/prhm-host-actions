'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const m=require('./central-offsite-manifest-diagnostic-v1.js');

test('classifies key-value manifest and returns keys only',()=>{
  const out=m.classifyManifestText('snapshot=abc\nbundle_sha256='+'a'.repeat(64)+'\nremote_name=opaque\n');
  assert.equal(out.format,'key_value');
  assert.equal(out.key_value_line_count,3);
  assert.deepEqual(out.keys,['snapshot','bundle_sha256','remote_name']);
  assert.equal(JSON.stringify(out).includes('opaque'),false);
  assert.equal(JSON.stringify(out).includes('abc'),false);
});
