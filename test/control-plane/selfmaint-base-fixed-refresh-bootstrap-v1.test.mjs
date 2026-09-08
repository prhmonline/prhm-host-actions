import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIXED_BOOTSTRAP,
  patchApiSource,
  patchMcpSource
} from '../../candidates/control-plane/selfmaint-base-fixed-refresh-bootstrap-v1.mjs';

const apiFixture = `'use strict';\nconst http=require('http');\nconst path=require('path');\nconst base=require(BASE_FILE);\nfunction registerSelfmaintRoutes(app,ctx){return base.registerSelfmaintRoutes(appProxy(app),ctx);}\nmodule.exports={...base,registerSelfmaintRoutes,__selfmaintLevel3ProxyTest:{exactSentinel,SENTINEL,ROUTES,dispatchKind}};\n`;

const mcpFixture = `import { textResult } from '../core/result.js';\nexport function registerSelfmaintPlugin(mcp,context){return base.registerSelfmaintPlugin(wrappedMcp(mcp),context);}\n`;

test('bootstrap is bound to current API/MCP owners and current selfmaint PID', () => {
  assert.equal(FIXED_BOOTSTRAP.api_sha256, '01e11a69b4c5a110aad16d4ee71efd11bdd6c52c6594d09117b5d4bb339ace20');
  assert.equal(FIXED_BOOTSTRAP.mcp_sha256, 'b3cfc90b72cf3f13fecf9c0737369646c6625cda7ca527ed017c78834385a7e4');
  assert.equal(FIXED_BOOTSTRAP.base_runtime_sha256, 'a23b4fec52123f8ad484f31576281c2f1933f24a3c811cd98c28e764a292e315');
  assert.equal(FIXED_BOOTSTRAP.expected_pid, 4015906);
  assert.equal(FIXED_BOOTSTRAP.service, 'prhm-agent-selfmaint.service');
});

test('API patch adds only the fixed authenticated one-shot refresh route', () => {
  const out = patchApiSource(apiFixture);
  assert.match(out, /\/selfmaint\/base-fixed-refresh-v1/);
  assert.match(out, /EXPECTED_PID=4015906/);
  assert.match(out, /BASE_RUNTIME_SHA='a23b4fec/);
  assert.match(out, /ctx&&ctx\.auth/);
  assert.match(out, /systemctl.*restart/);
  assert.match(out, /file_mutation:false/);
  assert.doesNotMatch(out, /req\.body\.(service|path|command|action)/);
  assert.equal((out.match(/base-fixed-refresh-v1/g)||[]).length >= 1, true);
});

test('MCP patch exposes exactly one zero-input fixed Agent API facade', () => {
  const out = patchMcpSource(mcpFixture);
  assert.match(out, /selfmaint_base_fixed_refresh_v1/);
  assert.match(out, /inputSchema:\{\}/);
  assert.match(out, /agent\.callAgent\('\/selfmaint\/base-fixed-refresh-v1','POST',\{\}\)/);
  assert.doesNotMatch(out, /action:z\.|service:z\.|path:z\.|command:z\./);
});

test('patchers fail closed when their exact anchor is absent or already patched', () => {
  assert.throws(() => patchApiSource('anchorless'), /api_anchor_invalid/);
  assert.throws(() => patchMcpSource('anchorless'), /mcp_anchor_invalid/);
  assert.throws(() => patchApiSource(apiFixture + 'selfmaint_base_fixed_refresh_v1'), /api_already_patched/);
  assert.throws(() => patchMcpSource(mcpFixture + 'selfmaint_base_fixed_refresh_v1'), /mcp_already_patched/);
});
