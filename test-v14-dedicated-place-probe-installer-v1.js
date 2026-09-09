'use strict';

const assert=require('assert');
const fs=require('fs');
const crypto=require('crypto');

const m=require('./bootstrap-host-actions-v14-dedicated-place-probe-v1');

const sha=b=>crypto.createHash('sha256').update(b).digest('hex');

assert.equal(
  m.NEW_SHA,
  '49e38d08562597d07b88db2c6e6dbc91fd167a3a5249129c7df7e05ae9f49034'
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
