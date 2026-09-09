'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const IMPL=path.join(__dirname,'central-offsite-manifest-diagnostic-v1.js');

test('fixed zero-input manifest diagnostic exposes bounded sanitized evidence',()=>{
  const m=require(IMPL);
  assert.equal(typeof m.run,'function');
  assert.equal(m.run.length,0);
  assert.equal(m.SNAP_ROOT,'/var/backups/prhm-central');
  const source=require('node:fs').readFileSync(IMPL,'utf8');
  assert.match(source,/sha256sum/);
  assert.match(source,/-c/);
  assert.match(source,/MANIFEST/);
  assert.match(source,/20\[0-9\]\{6\}T\[0-9\]\{6\}Z/);
  assert.match(source,/basename/);
  assert.match(source,/maxBuffer/);
  assert.doesNotMatch(source,/process\.argv/);
  assert.doesNotMatch(source,/req\.body/);
  assert.doesNotMatch(source,/arbitrary_path/);
});
