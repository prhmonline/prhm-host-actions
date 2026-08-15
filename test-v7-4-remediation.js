
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const s=fs.readFileSync(path.join(__dirname,'bootstrap-host-actions-v7-4-real-market-uat-executor-validator-alignment.js'),'utf8');
test('v7.4 is executor-only SHA-bound remediation',()=>{assert.match(s,/3007e385cacd891eb27c959ab8b9ed750b668f3e00838b29eefffbfdc0f948f7/);assert.match(s,/OLD_REASON/);assert.match(s,/NEW_REASON/);assert.doesNotMatch(s,/economic_input_facts\s*\).*write|INSERT INTO marketplace\.economic_input_facts/i)});
test('v7.4 aligns outer reason and health version',()=>{assert.match(s,/price_inputs_missing/);assert.match(s,/economics_inputs_incomplete/);assert.match(s,/1\.7\.1-host-actions-v2-real-market-shadow-uat-validator/)});
test('v7.4 has preflight backup restart readiness and rollback',()=>{assert.match(s,/--preflight-only/);assert.match(s,/fs\.copyFileSync\(TARGET,bak\)/);assert.match(s,/restart','prhm-agent-selfmaint-exec\.service/);assert.match(s,/executor_health_not_ready/);assert.match(s,/rollback_incomplete/)});
