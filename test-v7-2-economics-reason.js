
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const helper=fs.readFileSync(path.join(__dirname,'real-market-shadow-uat-v1.js'),'utf8');
test('real-market UAT expects post-Economics-Foundation incomplete reason',()=>{assert.match(helper,/economics_inputs_incomplete/);assert.doesNotMatch(helper,/expected_reason:'price_inputs_missing'/);});
