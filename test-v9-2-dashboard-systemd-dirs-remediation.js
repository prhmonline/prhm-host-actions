const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const f=path.join(__dirname,'bootstrap-host-actions-v9-2-dashboard-systemd-dirs.js');
test('v9.2 live remediation is bound to exact live v9.1 state',()=>{
 const s=fs.readFileSync(f,'utf8');
 for(const sha of ['2bf02b85c1b734fc196ab4fb235f31b803975fb694f7a1aa0819f088d527d03b','3a6da3e018a06a50b8564f0722957c1ef783916cde86f9b562701f7edeb848d0','b499b0344808199a834347026ba4e93fb7cfe982d6d35095b5f6a7f4ae9575a9','eb7c7279add0674e773cb981acfaa30c0c90e97becb2b7bc3a36110a39b7882a','fdba3b145acbec8b071cb342182c63d948e31e23d61aa1e9a8b464b66c780cb9','bcee64d171109f6f3f00f030521f1853143cf977bcfd90797b596ce95bfb8c75'])assert.match(s,new RegExp(sha));
 assert.match(s,/4798d43e1ddc86cc63ee2c58af5b81127f36b792e063044124057e0c65d3287e/);
 assert.match(s,/1\.9\.2-host-actions-v2-company-os-dashboard-systemd-dirs/);
});
test('v9.2 remediation changes only executor and dashboard helper and preserves sandbox strength',()=>{
 const s=fs.readFileSync(f,'utf8');
 assert.match(s,/--preflight-only/);assert.match(s,/backup/i);assert.match(s,/rollback/i);
 assert.match(s,/candidate_executor_sha/);assert.match(s,/candidate_helper_sha/);
 const m=s.match(/const NEW_BLOCK=(\"(?:\\.|[^\"\\])*\");/); assert.ok(m); const candidate=JSON.parse(m[1]);
 assert.match(candidate,/StateDirectory=prhm-company-os-dashboard/);
 assert.match(candidate,/ConfigurationDirectory=prhm-company-os-dashboard/);
 assert.doesNotMatch(candidate,/ReadWritePaths=\/opt\/prhm-company-os-dashboard/);
 assert.doesNotMatch(s,/atomic\([^\n]*(?:approval-policy|hostActionsV2|prhm-agent-selfmaint\/server|mcp-candidate-schema)/);
 assert.match(s,/prhm-agent-selfmaint-exec\.service/);
 assert.match(s,/database_mutation:false/);assert.match(s,/business_mutation:false/);assert.match(s,/p0_live:false/);assert.match(s,/proposal_send:false/);assert.match(s,/bid_send:false/);
});
