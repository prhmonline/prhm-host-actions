const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const file=path.join(__dirname,'bootstrap-host-actions-v9-4-dashboard-apache-access.js');
test('v9.4 remediation is bound to exact live helper and exact attempt4 residues',()=>{
 const s=fs.readFileSync(file,'utf8');
 for(const sha of [
 '1d9c1843ffe944f6faa40301ff2e0760eacfea9398ca05dc49fc6f2eb07a99c1',
 'd62bfe42fe4566fe075336fe2afd336985bb4c2c37244d62429e21c71f82551e',
 '63527eded76af02c498907a73c6c478257f6f1fc6f08a8a7e8af34f89d451b7e',
 '8985c56197254808c5c45357bda9b70edfb2c1f1aa1ee618d5942d7632670d79',
 'd889b895e85d892fdd71be5c2392e1adcb328d4e63b7c22524d1eb4e0610dad6']) assert.match(s,new RegExp(sha));
 assert.match(s,/--preflight-only/);
 assert.match(s,/v9\.4-dashboard-apache-access/);
});
test('v9.4 remediation changes only dashboard helper and guarded auth snapshot residues',()=>{
 const s=fs.readFileSync(file,'utf8');
 assert.match(s,/company-os-dashboard-v1\.js/);
 assert.match(s,/auth\.json/);assert.match(s,/snapshot\.json/);
 assert.doesNotMatch(s,/writeFileSync\([^\n]*(server\.js|hostActionsV2\.js|approval-policy\.json|mcp-candidate-schema-compare-v1\.js)/);
 assert.doesNotMatch(s,/systemctl[^\n]*(restart|reload)/i);
 assert.doesNotMatch(s,/P0_DECISION_ENABLED[^\n]{0,120}(true|1)/i);
 assert.match(s,/database_mutation:false/);assert.match(s,/business_mutation:false/);assert.match(s,/p0_live:false/);assert.match(s,/proposal_send:false/);assert.match(s,/bid_send:false/);
});
