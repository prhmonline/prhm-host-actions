import fs from 'node:fs';
import assert from 'node:assert/strict';
const file='agent-api-rolling-helper-mcp-pin-forward-refresh-v1.js';
assert.equal(fs.existsSync(file),true,'implementation missing (RED until implementation exists)');
const s=fs.readFileSync(file,'utf8');
for(const token of [
"BASE_SERVER_SHA='29b9a47504bd67bf2d04c701bdd4419be3a91bdbd0403b440ab65338f3752795'",
"HELPER_OLD_SHA='93ee4406346409f87e2f5cd07f67d6c090fd82832d13ac8828b317ea3a5651a8'",
"OLD_MCP_PIN='5d631a1c94208ba2d3daa515e45f3bd3717cf705a1d918f3e8bd9f9d85a97176'",
"NEW_MCP_PIN='9034957651c7f367b6c9f5c5db79962c5cc86d5201d2ec5855c64458f6117a5b'",
"mcp_pin_forward_helper_sha_drift",
"mcp_pin_forward_anchor_mismatch",
"mcp_pin_forward_postcondition_failed",
".server-mcp-pin-forward-base-",
"m._compile(source,BASE_FILE)"
]) assert.ok(s.includes(token),token);
console.log('PASS mcp pin forward-refresh contract');
