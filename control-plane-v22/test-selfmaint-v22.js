import assert from 'node:assert/strict';
import fs from 'node:fs';

const candidate=process.argv[2];
assert.ok(candidate,'candidate path required');
const src=fs.readFileSync(candidate,'utf8');

for(const marker of [
  "const SOCKET='/run/prhm-agent-selfmaint-exec/exec.sock';",
  "callExec('/v1/request','POST',toolArgs)",
  "callExec('/v1/status','POST',toolArgs)",
  "callExec('/v1/execute','POST',toolArgs,1200000)",
  "if(exactRootStageSentinel(toolArgs))return legacy(toolArgs);",
  "base.registerSelfmaintPlugin(directProxy(mcp),context);",
  "mcp.registerTool('selfmaint_apply_level3'",
  "z.literal('CONFIRM_LEVEL_3_PRODUCTION')"
]) assert.ok(src.includes(marker),'missing contract marker: '+marker);

assert.ok(!src.includes('cleanupOnce();'),'import-time cleanup side effect must be absent');
assert.ok(src.includes("path:'server.js'"),'root-stage sentinel must remain');
assert.ok(src.includes("reason:'Request fixed control-plane root scripts stage transport approval via mediator.'"),'root-stage reason must remain');
assert.ok(src.includes("if(!DIRECT_IDS.has(id))return legacy(toolArgs);"),'legacy status/apply compatibility must remain');

console.log('CONTROL_PLANE_SELFMAINT_MCP_DIRECT_PROXY_V22=PASS');
