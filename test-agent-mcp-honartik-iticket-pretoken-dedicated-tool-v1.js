const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const FILE=path.join(__dirname,'agent-mcp-honartik-iticket-pretoken-dedicated-tool-v1.js');

test('dedicated tool is pinned to original safe runtime and exact Honartik artifacts',()=>{
 const s=fs.readFileSync(FILE,'utf8');
 assert.match(s,/const BASE_SHA='e1ea620d01764e0cc4778341635bf919b4ecf5ead4f520a37835d86f6353fcdd'/);
 assert.match(s,/const TOOL='honartik_iticket_pretoken_git_sync_v1'/);
 assert.match(s,/const EXPECTED_HEAD='1eb4335da14f9eacf23b9d5fd4288c133786386c'/);
 assert.match(s,/const PROVIDER_SHA='63ee081699c3b1984e4f59e9db668b0e2937986c0dd53b786721dae0e69c1ce2'/);
 assert.match(s,/const TEST_SHA='275bc08e326917d5787082bdc72e819c980950effefc142e3eae2f49199d712c'/);
});

test('dedicated tool uses typed Level-3 confirmation and no generic write interception',()=>{
 const s=fs.readFileSync(FILE,'utf8');
 assert.match(s,/import \{ z \} from 'zod'/);
 assert.match(s,/confirmation:z\.literal\(CONFIRMATION\)/);
 assert.match(s,/args\?\.confirmation!==CONFIRMATION/);
 assert.doesNotMatch(s,/n==='ops_execute'|n==='run_project_command'|approved-risky/);
});

test('dedicated tool enforces PHP contract, exact diff, local origin and rollback',()=>{
 const s=fs.readFileSync(FILE,'utf8');
 assert.match(s,/ITICKET_EXTERNAL_PROVIDER_TEST=PASS/);
 assert.match(s,/unexpected_worktree_diff/);
 assert.match(s,/origin_branch_sha_mismatch/);
 assert.match(s,/source_overlay_changed/);
 assert.match(s,/push','origin','--delete',BRANCH/);
 assert.match(s,/worktree','remove','--force',WT/);
 assert.match(s,/production_application_tree_mutation:false/);
 assert.match(s,/database_mutation:false/);
 assert.match(s,/external_network:false/);
 assert.match(s,/token_read:false/);
});
