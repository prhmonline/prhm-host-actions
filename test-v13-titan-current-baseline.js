'use strict';
const fs = require('node:fs');
const assert = require('node:assert');
const src = fs.readFileSync('bootstrap-host-actions-v13-titan-staged-production-finalize.js', 'utf8');
for (const p of [
  '/opt/prhm-agent-selfmaint/server.js',
  '/opt/prhm-agent-selfmaint-exec/server.js',
  '/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
  '/opt/prhm-company-control-plane/config/approval-policy.json',
]) assert(src.includes(p), `missing baseline path ${p}`);
assert(src.includes('assertKnownBaseline'));
assert(!src.includes('BASELINE_SHA_PLACEHOLDER'));
assert(!src.includes('FULL_RUNTIME_B64'));
console.log('TITAN_BASELINE_TEST=PASS');
