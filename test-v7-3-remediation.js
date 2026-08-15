
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const s=fs.readFileSync(path.join(__dirname,'bootstrap-host-actions-v7-3-real-market-uat-null-economic-output-alignment.js'),'utf8');
test('v7.3 is helper-only SHA-bound current-live remediation',()=>{assert.match(s,/f7a0637fcf0c9e1dac709f0d44e206ba0276a08f3670716f37ca4494ad0d682d/);assert.match(s,/2fe6f9546ea6d14ab2d883433714ef5a543f643ba3685dfff1e4294a35f0733b/);assert.doesNotMatch(s,/systemctl|systemd-run/i)});
test('v7.3 carries null economic-output invariant in embedded helper',()=>{assert.match(s,/d\.economic_floor!==null\|\|d\.final_bid!==null/);assert.doesNotMatch(s,/d\.economic_floor!==0\|\|d\.final_bid!==0/)});
test('v7.3 retains preflight rollback and no-mutation contract',()=>{assert.match(s,/--preflight-only/);assert.match(s,/rollback_incomplete/);assert.match(s,/database_mutation:false/);assert.match(s,/business_mutation:false/);assert.match(s,/proposal_send:false/);assert.match(s,/bid_send:false/)});
