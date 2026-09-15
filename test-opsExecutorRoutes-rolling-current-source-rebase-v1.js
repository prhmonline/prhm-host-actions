'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const s=fs.readFileSync('opsExecutorRoutes-rolling-current-source-rebase-v1.js','utf8');
for(const token of [
"BASE_SHA='b0e9a007561b5f3b4bb351a6a57b7cd3b317aaab174425ad0eda33695315de3e'",
"HELPER_EXPECTED_SHA='bd955078a45a92f1891a7a89f31dc1969c9d21607dd5d76635677e817fdca138'",
"OLD_API='f59700a37bde6fac59c3e3983a4b54148755730a87a3f55d2ca7e4b3ced09ace'",
"NEW_API='5878fb592d8afcac571faa710e35811e462d4b98a2c120104b1eaf3ec1644001'",
"OLD_MCP='5a8f3a391145452a9c70a7fbe227903e482829a409bc6c1a960bf4ce56d52472'",
"NEW_MCP='025727acc89926bb69f8de2f85387cb24474be1fb4000f8e77f3c1eaf9ce320f'",
"CONFIRM='CONFIRM_LEVEL_4_CRITICAL'",
"rolling_helper_current_source_rebase_preflight_v1",
"rolling_helper_current_source_rebase_apply_v1",
"rolling_rebase_rollback_sha_mismatch",
"arbitrary_path:false",
"arbitrary_command:false"
]) assert.ok(s.includes(token), token);
assert.equal(/process\.argv|execSync\(|eval\(/.test(s),false);
console.log('PASS rolling helper current-source rebase contract');
