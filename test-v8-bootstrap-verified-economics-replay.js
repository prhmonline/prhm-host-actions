
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const file=path.join(__dirname,'bootstrap-host-actions-v8-verified-economics-replay.js');

test('v8 registers verified economics replay across all approval layers',()=>{
 const s=fs.readFileSync(file,'utf8');
 assert.match(s,/real_market_verified_economics_uat_v1/);
 assert.match(s,/host_action\.real_market_verified_economics_uat_v1/);
 assert.match(s,/level:4/);
 assert.match(s,/risk:'critical'/);
 assert.match(s,/1\.8\.0-host-actions-v2-verified-economics-replay/);
 assert.match(s,/CONFIRM_LEVEL_4_CRITICAL/);
});

test('v8 is state-bound and rollback-capable',()=>{
 const s=fs.readFileSync(file,'utf8');
 for(const sha of [
 'adae6fc8d49c150706f9811af9c2c494c211ba135e1d0548dc3657af5f3e8d00',
 '487efed91b1c6ccf78990276718c6497967d4dbdffa5892a86a85d2a4f8da3ba',
 '831fc0a3c42b41fd3c494bffedfda50863b74d7e4f31f7ac340b5272b440ed03',
 '33d61df7539f2812f40723022afebe94187d92d597257f957a227bcd2f410d2d'
 ]) assert.match(s,new RegExp(sha));
 assert.match(s,/backupDir/);
 assert.match(s,/rollback/);
 assert.match(s,/--preflight-only/);
 assert.match(s,/production_mutation:false/);
});
