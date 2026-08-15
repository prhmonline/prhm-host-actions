
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const s=fs.readFileSync(path.join(__dirname,'bootstrap-host-actions-v7-real-market-shadow-uat.js'),'utf8');
test('clean-install executor validates Economics Foundation reason',()=>{assert.match(s,/result\.reason!==\'economics_inputs_incomplete\'/);assert.doesNotMatch(s,/result\.reason!==\'price_inputs_missing\'/)});
test('clean-install executor health version identifies validator-aligned build',()=>{assert.match(s,/1\.7\.1-host-actions-v2-real-market-shadow-uat-validator/)});
