const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const ROOT=__dirname;
const collector=path.join(ROOT,'company-os-dashboard','collector.js');
const server=path.join(ROOT,'company-os-dashboard','server.js');

test('collector contract is fixed read-only and sanitizes dashboard snapshot',()=>{
  const s=fs.readFileSync(collector,'utf8');
  assert.match(s,/default_transaction_read_only=on/);
  assert.match(s,/SELECT/);
  assert.doesNotMatch(s,/(?:query|jsonOne|jsonRows)\(`\s*(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i);
  assert.match(s,/P0_SHADOW_MODE/);
  assert.match(s,/PROPOSAL_AUTO_SEND_ENABLED/);
  assert.match(s,/real-market-verified-economics-uat-v1\/latest\.json/);
  assert.match(s,/host-action-v2-jobs/);
  assert.match(s,/snapshot\.json/);
  assert.match(s,/chownSync\(tmp,0,48\)/);
  assert.match(s,/token|secret|private[_-]?key/i);
});

test('dashboard server is GET-only except no session mutation and requires Basic auth',()=>{
  const s=fs.readFileSync(server,'utf8');
  assert.match(s,/Authorization/i);
  assert.match(s,/Basic /);
  assert.match(s,/timingSafeEqual/);
  assert.match(s,/method!=='GET'/);
  assert.match(s,/405/);
  assert.match(s,/127\.0\.0\.1/);
  assert.match(s,/18135/);
  assert.match(s,/snapshot\.json/);
  assert.doesNotMatch(s,/child_process|execFile|spawn|psql|PGPASSWORD/);
});


test('dashboard redirects non-HTTPS requests before Basic authentication',()=>{
  const s=fs.readFileSync(server,'utf8');
  assert.match(s,/x-forwarded-proto/i);
  assert.match(s,/301/);
  assert.match(s,/https:\/\/agent\.prhm\.ir/);
  assert.ok(s.indexOf('x-forwarded-proto') < s.indexOf('if(!authorized(req))'));
});

test('server and collector pass Node syntax check',()=>{
  for(const f of [collector,server]){
    const x=cp.spawnSync(process.execPath,['--check',f],{encoding:'utf8'});
    assert.equal(x.status,0,x.stderr);
  }
});
