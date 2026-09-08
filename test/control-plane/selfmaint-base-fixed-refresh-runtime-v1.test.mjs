import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'../..');
const apiPath=path.join(root,'control-plane-v26/runtime/selfmaintRoutes.js');
const mcpPath=path.join(root,'control-plane-v26/runtime/selfmaint.js');
const manifestPath=path.join(root,'control-plane-v26/manifest.json');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');

test('runtime wrappers preserve exact current owners through SHA-pinned backup imports',()=>{
  const api=fs.readFileSync(apiPath,'utf8');
  const mcp=fs.readFileSync(mcpPath,'utf8');
  assert.match(api,/BASE_SHA='01e11a69b4c5a110aad16d4ee71efd11bdd6c52c6594d09117b5d4bb339ace20'/);
  assert.match(api,/agent_api-selfmaintRoutes\.js-/);
  assert.match(mcp,/BASE_SHA='b3cfc90b72cf3f13fecf9c0737369646c6625cda7ca527ed017c78834385a7e4'/);
  assert.match(mcp,/agent_mcp-src_plugins_selfmaint\.js-/);
});

test('API wrapper exposes one authenticated zero-input PID/SHA-bound refresh only',()=>{
  const api=fs.readFileSync(apiPath,'utf8');
  assert.match(api,/REFRESH_ROUTE='\/selfmaint\/base-fixed-refresh-v1'/);
  assert.match(api,/BASE_RUNTIME_SHA='a23b4fec52123f8ad484f31576281c2f1933f24a3c811cd98c28e764a292e315'/);
  assert.match(api,/EXPECTED_PID=4015906/);
  assert.match(api,/REFRESH_SERVICE='prhm-agent-selfmaint\.service'/);
  assert.match(api,/app\.post\(REFRESH_ROUTE,auth/);
  assert.match(api,/Object\.keys\(req\.body\)\.length/);
  assert.match(api,/\['restart',REFRESH_SERVICE\]/);
  assert.match(api,/runtime_sha256:postSha/);
  assert.match(api,/file_mutation:false/);
  assert.doesNotMatch(api,/req\.body\.(service|path|command|action)/);
});

test('MCP wrapper exposes only a zero-input fixed Agent API facade',()=>{
  const mcp=fs.readFileSync(mcpPath,'utf8');
  assert.match(mcp,/registerTool\('selfmaint_base_fixed_refresh_v1'/);
  assert.match(mcp,/inputSchema:\{\}/);
  assert.match(mcp,/agent\.callAgent\('\/selfmaint\/base-fixed-refresh-v1','POST',\{\}\)/);
  assert.doesNotMatch(mcp,/service:z\.|path:z\.|command:z\.|action:z\./);
});

test('manifest binds source and generated runtime SHA values',()=>{
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  const apiBytes=fs.readFileSync(apiPath);
  const mcpBytes=fs.readFileSync(mcpPath);
  assert.equal(manifest.schema_version,'prhm.selfmaint-base-fixed-refresh.v1');
  assert.equal(manifest.preimage.api,'01e11a69b4c5a110aad16d4ee71efd11bdd6c52c6594d09117b5d4bb339ace20');
  assert.equal(manifest.preimage.mcp,'b3cfc90b72cf3f13fecf9c0737369646c6625cda7ca527ed017c78834385a7e4');
  assert.equal(manifest.preimage.base,'a23b4fec52123f8ad484f31576281c2f1933f24a3c811cd98c28e764a292e315');
  assert.equal(manifest.expected_pid,4015906);
  assert.equal(manifest.candidates.api,sha(apiBytes));
  assert.equal(manifest.candidates.mcp,sha(mcpBytes));
});
