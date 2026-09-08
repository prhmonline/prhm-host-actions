const fs=require('fs');
const assert=require('assert');
const file='agent-api-rolling-helper-mcp-pin-canonical-refresh-v1.js';
assert.ok(fs.existsSync(file),'implementation missing');
const s=fs.readFileSync(file,'utf8');
for(const needle of [
  "EXPECTED_HELPER_SHA='d436975129a1d06965bc004cee688e4dcbd6a6b76bcfa2fb923c4269ed72196d'",
  "EXPECTED_HELPER_PIN='46b2e680b48a641c4802038770c9bf27f6f60b5d1b55384ead03cef439217a93'",
  "OLD_MCP_PIN='9034957651c7f367b6c9f5c5db79962c5cc86d5201d2ec5855c64458f6117a5b'",
  "CURRENT_MCP_PIN='5d631a1c94208ba2d3daa515e45f3bd3717cf705a1d918f3e8bd9f9d85a97176'",
  'rollbackHelper(helperChange)'
]) assert.ok(s.includes(needle),needle);
assert.strictEqual((s.match(/OLD_MCP_PIN=/g)||[]).length,1);
assert.strictEqual((s.match(/CURRENT_MCP_PIN=/g)||[]).length,1);
console.log('PASS canonical MCP pin refresh contract');
