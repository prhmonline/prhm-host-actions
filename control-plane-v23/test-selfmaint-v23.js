import fs from 'node:fs';
import assert from 'node:assert/strict';

const file=process.argv[2];
if(!file)throw new Error('candidate_path_required');
const s=fs.readFileSync(file,'utf8');

assert.ok(!s.includes('DIRECT_IDS'));
assert.ok(s.includes("callExec('/v1/status','POST',toolArgs)"));
assert.ok(s.includes("message.includes('status_not_found')"));
assert.ok(s.includes("message.includes('request_not_found')"));
assert.ok(s.includes("mcp.registerTool('selfmaint_apply_level3'"));
assert.ok(s.includes("z.literal('CONFIRM_LEVEL_3_PRODUCTION')"));
assert.ok(s.includes("if(exactRootStageSentinel(toolArgs))return legacy(toolArgs)"));
console.log('CONTROL_PLANE_SELFMAINT_STATELESS_V23=PASS');
