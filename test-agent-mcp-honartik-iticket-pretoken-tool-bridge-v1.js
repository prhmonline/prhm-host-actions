const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const FILE=path.join(__dirname,'agent-mcp-honartik-iticket-pretoken-tool-bridge-v1.js');

test('tool bridge is pinned to the installed run bridge runtime',()=>{
 const s=fs.readFileSync(FILE,'utf8');
 assert.match(s,/const BASE_SHA='34e95fcd1d79e2058d3abcb48e9fb5ef189934fa464a6085dd575e9c92935264'/);
 assert.match(s,/const TOOL='honartik_iticket_pretoken_git_sync_v1'/);
 assert.match(s,/const INNER='\{"operation":"honartik_iticket_pretoken_git_sync_v1","confirmation":"CONFIRM_LEVEL_3_PRODUCTION"\}'/);
});

test('tool bridge captures wrapped ops_execute and exposes a zero-input fixed tool',()=>{
 const s=fs.readFileSync(FILE,'utf8');
 assert.match(s,/if\(name==='ops_execute'\)opsHandler=handler/);
 assert.match(s,/mcp\.tool\(TOOL,/);
 assert.match(s,/\{\},async\(\)=>/);
 assert.match(s,/project:'honartik_admin_prod'/);
 assert.match(s,/access:'write'/);
 assert.match(s,/risk:'high'/);
 assert.match(s,/acknowledgeRisk:true/);
});

test('tool bridge has no direct git, PHP, network, token or production path implementation',()=>{
 const s=fs.readFileSync(FILE,'utf8');
 assert.doesNotMatch(s,/spawnSync|execFile|execSync|child_process/);
 assert.doesNotMatch(s,/ITICKET_API_ACCESS_TOKEN|seller\.iticket|console\.iticket/);
 assert.doesNotMatch(s,/\/home\/honartik\/domains|\/home\/honartik\/git/);
});
