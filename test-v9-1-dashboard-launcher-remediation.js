const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const f=path.join(__dirname,'bootstrap-host-actions-v9-1-dashboard-launcher-fix.js');
test('v9.1 live remediation is bound to exact post-v9 executor/helper state',()=>{
 const s=fs.readFileSync(f,'utf8');
 for(const sha of ['1df458679e6559e158f7f18ef1af3347f84964bacdb3c95ee499d957d5140ea5','03a5428b71fb5a6e8bc43f5bf4d5ec6a9473591bb33d2c470aea83fda97cb7ea','b499b0344808199a834347026ba4e93fb7cfe982d6d35095b5f6a7f4ae9575a9','eb7c7279add0674e773cb981acfaa30c0c90e97becb2b7bc3a36110a39b7882a','fdba3b145acbec8b071cb342182c63d948e31e23d61aa1e9a8b464b66c780cb9','bcee64d171109f6f3f00f030521f1853143cf977bcfd90797b596ce95bfb8c75'])assert.match(s,new RegExp(sha));
 assert.match(s,/3a6da3e018a06a50b8564f0722957c1ef783916cde86f9b562701f7edeb848d0/);
 assert.match(s,/1\.9\.1-host-actions-v2-company-os-dashboard-launcher/);
});
test('v9.1 remediation mutates only executor and dashboard helper with preflight backup rollback and health',()=>{
 const s=fs.readFileSync(f,'utf8');
 assert.match(s,/--preflight-only/);
 assert.match(s,/backup/i);assert.match(s,/rollback/i);
 assert.match(s,/prhm-agent-selfmaint-exec\.service/);
 assert.match(s,/\/run\/prhm-agent-selfmaint-exec\/exec\.sock/);
 assert.match(s,/candidate_executor_sha/);assert.match(s,/candidate_helper_sha/);
 assert.doesNotMatch(s,/atomic\([^\n]*(?:approval-policy|hostActionsV2|prhm-agent-selfmaint\/server|mcp-candidate-schema)/);
 assert.match(s,/database_mutation:false/);assert.match(s,/business_mutation:false/);assert.match(s,/p0_live:false/);assert.match(s,/proposal_send:false/);assert.match(s,/bid_send:false/);
});
