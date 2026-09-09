'use strict';

const assert=require('assert');
const fs=require('fs');
const crypto=require('crypto');

const m=require('./bootstrap-host-actions-v14-dedicated-place-probe-v1');

const sha=b=>crypto.createHash('sha256').update(b).digest('hex');

assert.equal(
  m.NEW_SHA,
  'df5c2ad6991eda64224db059388703db18fe2045aea7798d48e13efd4de62bbb'
);

assert.equal(
  sha(fs.readFileSync(m.SOURCE)),
  m.NEW_SHA
);

const src=fs.readFileSync(
  './bootstrap-host-actions-v14-dedicated-place-probe-v1.js',
  'utf8'
);

for(const forbidden of [
  'execSync(',
  'spawnSync(',
  'renameSync(',
  'writeFileSync(',
  'unlinkSync(',
  'systemctl',
  'service '
]){
  assert.ok(!src.includes(forbidden),`mutation surface: ${forbidden}`);
}

const out=m.inspect();

assert.equal(out.ok,true);
assert.equal(out.production_mutation,false);
assert.equal(out.database_mutation,false);

console.log('ITICKET_DEDICATED_PLACE_INSTALLER_TEST=PASS');
