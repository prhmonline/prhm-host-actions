
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const p=path.join(__dirname,'bootstrap-host-actions-v7-1-real-market-uat-target-literal-fix.js');const s=fs.readFileSync(p,'utf8');
test('remediation is helper-only and SHA-bound',()=>{assert.match(s,/real-market-shadow-uat-v1\.js/);assert.match(s,/7d3982a59f6324c34ec79be18cbcd8f913ea449844bc71957cdac88fe2495cff/);assert.match(s,/cbd404c817f8b9cb8885f3c11ddb5c1c129b2f6f5b96063cc1e3bf6d8e8c08c0/);assert.doesNotMatch(s,/systemctl|systemd-run/i);assert.doesNotMatch(s,/(?:writeFileSync|renameSync|copyFileSync)\([^\n]*009_economic_input_facts/i)});
test('remediation has preflight and automatic rollback',()=>{assert.match(s,/--preflight-only/);assert.match(s,/candidate_preflight_invalid/);assert.match(s,/rollback_incomplete/);assert.match(s,/fs\.copyFileSync\(backup,TARGET\)/)});
test('remediation declares no DB business or send mutation',()=>{assert.match(s,/database_mutation:false/);assert.match(s,/business_mutation:false/);assert.match(s,/p0_live:false/);assert.match(s,/proposal_send:false/);assert.match(s,/bid_send:false/)});
