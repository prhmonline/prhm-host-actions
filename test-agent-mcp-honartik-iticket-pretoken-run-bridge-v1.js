const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const FILE=path.join(__dirname,'agent-mcp-honartik-iticket-pretoken-run-bridge-v1.js');

test('relay is pinned to the installed git-sync bridge runtime',()=>{
 const s=fs.readFileSync(FILE,'utf8');
 assert.match(s,/const BASE_SHA='507815d1dd14960e233f8a0888f3ea1f038fdffa3b77f1e4b5a07e62c3b168c7'/);
 assert.match(s,/const COMMAND='HONARTIK_ITICKET_PRETOKEN_GIT_SYNC_V1:CONFIRM_LEVEL_3_PRODUCTION'/);
 assert.match(s,/const INNER='\{"operation":"honartik_iticket_pretoken_git_sync_v1","confirmation":"CONFIRM_LEVEL_3_PRODUCTION"\}'/);
});

test('relay captures wrapped ops_execute and exposes only exact run_project_command token',()=>{
 const s=fs.readFileSync(FILE,'utf8');
 assert.match(s,/if\(name==='ops_execute'\)opsHandler=handler/);
 assert.match(s,/if\(name==='run_project_command'\)/);
 assert.match(s,/a\?\.project==='honartik_admin_prod'/);
 assert.match(s,/a\?\.command===COMMAND/);
 assert.match(s,/a\?\.mode!=='approved-risky'/);
 assert.match(s,/access:'write'/);
 assert.match(s,/risk:'high'/);
 assert.match(s,/acknowledgeRisk:true/);
});

test('relay contains no direct filesystem, git, PHP, token or network mutation implementation',()=>{
 const s=fs.readFileSync(FILE,'utf8');
 assert.doesNotMatch(s,/spawnSync|execFile|execSync|child_process/);
 assert.doesNotMatch(s,/ITICKET_API_ACCESS_TOKEN|seller\.iticket|console\.iticket/);
 assert.doesNotMatch(s,/\/home\/honartik\/domains|\/home\/honartik\/git/);
});
