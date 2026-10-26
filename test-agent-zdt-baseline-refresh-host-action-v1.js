const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const helper=path.join(__dirname,'agent-zdt-baseline-refresh-v1.js');

test('helper exists and is syntax-ready source',()=>{
  assert.equal(fs.existsSync(helper),true,'agent-zdt-baseline-refresh-v1.js must exist');
});

test('helper pins exactly one production target and five reviewed SHA replacements',()=>{
  const s=fs.readFileSync(helper,'utf8');
  assert.match(s,/agent_zdt_baseline_refresh_v1/);
  assert.match(s,/\/opt\/prhm-agent-selfmaint-exec\/actions\/agent-zero-downtime-bootstrap-v1\.js/);
  assert.doesNotMatch(s,/TARGET_CANONICAL/);
  const pairs=[
    ['ebe988fb99794ed3e09b2cefa7496c2d47c967a850b900a117b6b762b388cc34','7362fcf00bff04e46287df574f875110603d8c7da8b1bb207e9e609dc86c5b85'],
    ['fcf4420ab9b9c0b540f0e88f923065e16a331580cd238a097b9b1c53db34b2d0','b1f618ea5efeaa82b0d63bdf044ba82f8cea43f2ed5569b1a7bf706529717a80'],
    ['5c6ffbd60a5347ad2f21352de856bde2033b7ad5b3599301afd3139be8791102','70368fdc8be24646b10d414f6159502c2f3d338ed1132451d5b5740d1270999c'],
    ['b084b501b2ea572b39336e45673b4d987a6f7cdb10c769a4db3191ce86ca2877','b0ada3809307005d7715a1c7c970687b65ace82e765c8dfaeb5408061477b4ae'],
    ['5346b24f88c19121898288bd197a8dbe2a18a8c587402cfcd5a27afcfeadacad','6b945fcb3afe8ef3e074b07745912c5183f28826728bf4d14ed93c1161c961ba']
  ];
  const block=s.match(/const REPLACEMENTS=Object\.freeze\(\[([\s\S]*?)\]\);/);
  assert.ok(block,'REPLACEMENTS block must exist');
  for(const [oldSha,newSha] of pairs){assert.equal(block[1].split(oldSha).length-1,1);assert.equal(block[1].split(newSha).length-1,1);}
  assert.match(s,/a54e2890eb455c078a4e09e92e007d71545f834dfec7d8d62bb232e1c91406b4/);
  assert.match(s,/replacements_applied/);
  assert.match(s,/unexpected_changes/);
  assert.match(s,/rollback_performed/);
});
