const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const f=path.join(__dirname,'bootstrap-host-actions-v9-3-dashboard-credentials.js');
test('v9.3 remediation is bound to exact live v9.2 state and stale auth residue',()=>{
 const s=fs.readFileSync(f,'utf8');
 for(const sha of ['a58ded1d02a382e2ade282d2015171ff97711646ef53d4931ebb322ce5286e1d','4798d43e1ddc86cc63ee2c58af5b81127f36b792e063044124057e0c65d3287e','b499b0344808199a834347026ba4e93fb7cfe982d6d35095b5f6a7f4ae9575a9','eb7c7279add0674e773cb981acfaa30c0c90e97becb2b7bc3a36110a39b7882a','fdba3b145acbec8b071cb342182c63d948e31e23d61aa1e9a8b464b66c780cb9','bcee64d171109f6f3f00f030521f1853143cf977bcfd90797b596ce95bfb8c75','cc96917022687ec14dda88be5cdf3f16dd678a232058f3eb187aa9924f3e9c95'])assert.match(s,new RegExp(sha));
 assert.match(s,/1\.9\.3-host-actions-v2-company-os-dashboard-credentials/);
});
test('v9.3 changes only executor/helper and removes only exact stale auth.json residue',()=>{
 const s=fs.readFileSync(f,'utf8');
 assert.match(s,/--preflight-only/);assert.match(s,/backup/i);assert.match(s,/rollback/i);
 assert.match(s,/\/etc\/prhm-company-os-dashboard\/auth\.json/);
 assert.match(s,/stale_auth_sha_mismatch/);
 assert.match(s,/unlinkSync\(STALE_AUTH\)/);
 assert.match(s,/candidate_executor_sha/);assert.match(s,/candidate_helper_sha/);
 assert.doesNotMatch(s,/atomic\([^\n]*(?:approval-policy|hostActionsV2|prhm-agent-selfmaint\/server|mcp-candidate-schema)/);
 assert.match(s,/prhm-agent-selfmaint-exec\.service/);
 assert.match(s,/database_mutation:false/);assert.match(s,/business_mutation:false/);assert.match(s,/p0_live:false/);assert.match(s,/proposal_send:false/);assert.match(s,/bid_send:false/);
});
