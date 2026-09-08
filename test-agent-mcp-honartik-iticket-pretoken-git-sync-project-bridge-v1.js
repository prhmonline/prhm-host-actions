const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const FILE=path.join(__dirname,'agent-mcp-honartik-iticket-pretoken-git-sync-project-bridge-v1.js');

test('bridge is bound to exact current runtime and Honartik pre-token artifacts',()=>{
  const src=fs.readFileSync(FILE,'utf8');
  assert.match(src,/const BASE_SHA='e1ea620d01764e0cc4778341635bf919b4ecf5ead4f520a37835d86f6353fcdd'/);
  assert.match(src,/const PROD='\/home\/honartik\/domains\/dashboard\.honartik\.ir\/public_html'/);
  assert.match(src,/const STAGING='\/home\/prhm\/domains\/honartik-api-staging\.prhm\.ir\/honartik-back'/);
  assert.match(src,/const ORIGIN='\/home\/honartik\/git\/honartik-dashboard-honartik-ir\.git'/);
  assert.match(src,/const EXPECTED_HEAD='1eb4335da14f9eacf23b9d5fd4288c133786386c'/);
  assert.match(src,/const LEGACY_PROVIDER_SHA='ca14ecdc210c418686c73d5ef60b150adc0629d6b943b32d11d0d06dd3a3bdf6'/);
  assert.match(src,/const PROVIDER_SHA='63ee081699c3b1984e4f59e9db668b0e2937986c0dd53b786721dae0e69c1ce2'/);
  assert.match(src,/const TEST_SHA='275bc08e326917d5787082bdc72e819c980950effefc142e3eae2f49199d712c'/);
});

test('bridge only accepts the fixed run_project_command token in approved-risky mode',()=>{
  const src=fs.readFileSync(FILE,'utf8');
  assert.match(src,/const COMMAND='HONARTIK_ITICKET_PRETOKEN_GIT_SYNC_V1:CONFIRM_LEVEL_3_PRODUCTION'/);
  assert.match(src,/a\?\.project!=='honartik_admin_prod'/);
  assert.match(src,/a\?\.command!==COMMAND/);
  assert.match(src,/a\?\.mode!=='approved-risky'/);
  assert.match(src,/n==='run_project_command'/);
  assert.doesNotMatch(src,/n==='ops_execute'/);
});

test('git sync is local-only, exact-path and production-preserving by construction',()=>{
  const src=fs.readFileSync(FILE,'utf8');
  assert.doesNotMatch(src,/https?:\/\//);
  assert.doesNotMatch(src,/shell\s*:\s*true/);
  assert.doesNotMatch(src,/execSync\s*\(/);
  assert.match(src,/const EXPECTED_PATHS=Object\.freeze\(\[REL_PROVIDER,REL_TEST\]\.sort\(\)\)/);
  assert.match(src,/production_application_tree_mutation:false/);
  assert.match(src,/database_mutation:false/);
  assert.match(src,/external_network:false/);
  assert.match(src,/token_read:false/);
  assert.match(src,/source_overlay_changed/);
  assert.match(src,/origin_branch_sha_mismatch/);
});

test('PHP verification and rollback are mandatory',()=>{
  const src=fs.readFileSync(FILE,'utf8');
  assert.match(src,/ITICKET_EXTERNAL_PROVIDER_TEST=PASS/);
  assert.match(src,/php_lint_provider/);
  assert.match(src,/php_lint_test/);
  assert.match(src,/push','origin','--delete',BRANCH/);
  assert.match(src,/worktree','remove','--force',WT/);
  assert.match(src,/branch','-D',BRANCH/);
});
