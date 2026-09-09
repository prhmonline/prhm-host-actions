'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const m=require('./central-offsite-manifest-diagnostic-v1.js');

test('classifies manifest format without exposing content',()=>{
  assert.equal(typeof m.classifyManifestText,'function');
  assert.deepEqual(m.classifyManifestText('a'.repeat(64)+'  database.dump\n'),{line_count:1,formatted_line_count:1,format:'sha256sum'});
  assert.equal(m.classifyManifestText('a'.repeat(64)+'\n').format,'sha256_only');
  assert.equal(m.classifyManifestText('{"x":1}\n').format,'json');
  assert.equal(m.classifyManifestText('nonsense\n').format,'other');
});
