
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const helperPath=path.join(__dirname,'real-market-verified-economics-uat-v1.js');

test('fixed positive UAT is provenance-backed, isolated, and no-send',()=>{
  const s=fs.readFileSync(helperPath,'utf8');
  assert.match(s,/a3294311-871b-498a-8ffb-484bd51f2b92/);
  assert.match(s,/310319/);
  assert.match(s,/recommendedPrice[^\n]+800000/);
  assert.match(s,/platformMinimum[^\n]+800000/);
  assert.match(s,/deliveryCost[^\n]+30900/);
  assert.match(s,/platformFee[^\n]+120000/);
  assert.match(s,/hardFloor[^\n]+230900/);
  assert.match(s,/minimumMarginPrice[^\n]+288625/);
  assert.match(s,/riskReserve[^\n]+80000/);
  assert.match(s,/controlled_uat_policy/);
  assert.match(s,/conservative_fee_ceiling/);
  assert.match(s,/verified:true/);
  assert.match(s,/SEND_NOW/);
  assert.match(s,/auto_send_allowed:false/);
  assert.match(s,/proposal_send:false/);
  assert.match(s,/bid_send:false/);
  assert.match(s,/outbox_write:false/);
  assert.match(s,/telegram_write:false/);
  assert.match(s,/cleanup_verified:true/);
});

test('helper accepts no arbitrary production inputs',()=>{
  const s=fs.readFileSync(helperPath,'utf8');
  assert.match(s,/unexpected_arguments/);
  assert.doesNotMatch(s,/process\.env\.(TARGET|SQL|COMMAND|PATH)/);
});
