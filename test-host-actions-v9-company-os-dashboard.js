const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const f=path.join(__dirname,'bootstrap-host-actions-v9-company-os-dashboard.js');
test('v9 registers Company OS dashboard at base executor MCP and Level-4 policy layers',()=>{
 const s=fs.readFileSync(f,'utf8');
 assert.match(s,/company_os_dashboard_v1/);
 assert.match(s,/host_action\.company_os_dashboard_v1/);
 assert.match(s,/level:4/);
 assert.match(s,/risk:'critical'/);
 assert.match(s,/1\.9\.3-host-actions-v2-company-os-dashboard-credentials/);
 assert.match(s,/hostActionsV2\.js/);
 assert.match(s,/mcp-candidate-schema-compare-v1\.js/);
});
test('v9 bootstrap is state-bound, preflightable and rollback-capable',()=>{
 const s=fs.readFileSync(f,'utf8');
 for(const sha of ['5d8c42b5032c766832822097fe73905ae34097f697e7232fed6b333d54c9dbbd','97a0a438c12a0158d3386cf345c5579a6517be558c6093113efa2086729e4c8d','7c94467843b084f7970945c3251d6e03b6528ba10ac5c973c10861f41cba41f4','afae32985861cb8b9396f4cea4b05e1c68b90a6ad55937b27c8fcf7dc84321df','0a5d184b22c8840bef075e439924d9be17d4143c2971796ec84294b6ddc06745'])assert.match(s,new RegExp(sha));
 assert.match(s,/--preflight-only/);assert.match(s,/backup/i);assert.match(s,/rollback/i);
 assert.match(s,/CONFIRM_LEVEL_4_CRITICAL/);
});
