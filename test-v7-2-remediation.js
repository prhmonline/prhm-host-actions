
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const s=fs.readFileSync(path.join(__dirname,'bootstrap-host-actions-v7-2-real-market-uat-economics-reason-alignment.js'),'utf8');
test('v7.2 is helper-only SHA-bound current-live remediation',()=>{assert.match(s,/cbd404c817f8b9cb8885f3c11ddb5c1c129b2f6f5b96063cc1e3bf6d8e8c08c0/);assert.match(s,/f7a0637fcf0c9e1dac709f0d44e206ba0276a08f3670716f37ca4494ad0d682d/);assert.doesNotMatch(s,/systemctl|systemd-run/i)});
test('v7.2 expects Economics Foundation reason',()=>{assert.match(s,/economics_inputs_incomplete/);assert.doesNotMatch(s,/expected_reason==='price_inputs_missing'/)});
test('v7.2 retains rollback and no-mutation contract',()=>{assert.match(s,/rollback_incomplete/);assert.match(s,/database_mutation:false/);assert.match(s,/business_mutation:false/);assert.match(s,/proposal_send:false/);assert.match(s,/bid_send:false/)});
