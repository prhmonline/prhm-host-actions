'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const m=require('./central-offsite-manifest-diagnostic-v1.js');

test('sanitizes checksum, missing and unreadable manifest failures',()=>{
  assert.equal(typeof m.parseCheckLines,'function');
  const out=m.parseCheckLines([
    'database.dump: FAILED',
    'sha256sum: ./nested/config.tar.gz: No such file or directory',
    'secrets.bin: FAILED open or read',
    'sha256sum: WARNING: 1 listed file could not be read'
  ]);
  assert.deepEqual(out.failures,[
    {entry:'database.dump',reason:'checksum'},
    {entry:'config.tar.gz',reason:'missing'},
    {entry:'secrets.bin',reason:'unreadable'}
  ]);
  assert.equal(out.warning_count,1);
  assert.equal(JSON.stringify(out).includes('/nested/'),false);
});
