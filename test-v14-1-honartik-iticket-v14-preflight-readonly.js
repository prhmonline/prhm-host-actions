'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROUTE_FILE=path.join(__dirname,'honartik-iticket-v14-preflight-readonly-routes.js');

test('runtime module exposes the fixed zero-input contract',()=>{
  const route=require(ROUTE_FILE);
  assert.equal(typeof route.registerHonartikIticketV14PreflightRoutes,'function');
  assert.equal(typeof route.runPinnedPreflight,'function');
  assert.equal(route.TOOL,'honartik_iticket_v14_preflight_readonly');
  assert.equal(route.ROUTE,'/honartik/iticket/v14/preflight');
  assert.equal(route.V14_SHA,'134ef8c0828b6c941b98e0d5c3ecb5d6ceaff1e1bf6ef73daabc79a92f5d8b78');
});

test('runtime source contains no public arbitrary execution surface',()=>{
  const source=fs.readFileSync(ROUTE_FILE,'utf8');
  assert.match(source,/app\.post\(ROUTE,auth,/);
  assert.match(source,/Object\.keys\(body\)\.length!==0/);
  assert.doesNotMatch(source,/req\.body\.(command|path|ref|host|token)/);
  assert.match(source,/iticket_v14_preflight_network_denied/);
  assert.match(source,/iticket_v14_preflight_child_process_denied/);
});


test('installer is SHA-bound to the live Agent API/MCP baselines and V14 payload',()=>{
  const installer=require(path.join(__dirname,'bootstrap-host-actions-v14-1-honartik-iticket-v14-preflight-readonly.js'));
  assert.equal(installer.EXPECTED.agentServer,'70368fdc8be24646b10d414f6159502c2f3d338ed1132451d5b5740d1270999c');
  assert.equal(installer.EXPECTED.mcp,'ebe988fb99794ed3e09b2cefa7496c2d47c967a850b900a117b6b762b388cc34');
  assert.equal(installer.V14_SHA,'134ef8c0828b6c941b98e0d5c3ecb5d6ceaff1e1bf6ef73daabc79a92f5d8b78');
  assert.equal(typeof installer.patchAgentServer,'function');
  assert.equal(typeof installer.patchMcp,'function');
  assert.equal(typeof installer.preflight,'function');
  assert.equal(typeof installer.install,'function');
});


test('installer patches only the Agent route binding and zero-input MCP tool',()=>{
  const installer=require(path.join(__dirname,'bootstrap-host-actions-v14-1-honartik-iticket-v14-preflight-readonly.js'));
  const agentFixture=`'use strict';\n${"const x=1;"}\nsource=replaceOnce(source,"'status'=>1,'created_at'=>$now","'status'=>2,'created_at'=>$now",'admin_active_status');\ntry { const compiled=1; }`;
  const patchedAgent=installer.patchAgentServer(agentFixture);
  assert.match(patchedAgent,/registerHonartikIticketV14PreflightRoutes/);
  assert.match(patchedAgent,/honartikIticketV14PreflightRoutes/);
  assert.throws(()=>installer.patchAgentServer(patchedAgent),/agent_preflight_already_patched/);

  const mcpFixture=`const HostActionV2=z.enum(['agent_zero_downtime_bootstrap_v1']);\nexport function registerHostActionsV2Plugin(mcp){mcp.registerTool('host_action_v2_status',{inputSchema:{request_id:z.string().uuid()},annotations:RO},async args=>textResult(await callExec('/v2/host-actions/status','POST',args)));}`;
  const patchedMcp=installer.patchMcp(mcpFixture);
  assert.match(patchedMcp,/honartik_iticket_v14_preflight_readonly/);
  assert.match(patchedMcp,/inputSchema:\{\}/);
  const enumBody=patchedMcp.slice(patchedMcp.indexOf('const HostActionV2=z.enum(['),patchedMcp.indexOf(']);')+3);
  assert.doesNotMatch(enumBody,/honartik_iticket_dark_backend_batch1_v1/);
  assert.throws(()=>installer.patchMcp(patchedMcp),/mcp_preflight_already_patched/);
});


test('installer marks mutation before the first write so partial installs always rollback',()=>{
  const source=fs.readFileSync(path.join(__dirname,'bootstrap-host-actions-v14-1-honartik-iticket-v14-preflight-readonly.js'),'utf8');
  const mutation=source.indexOf('mutated=true;');
  const firstWrite=source.indexOf('atomicWrite(PATHS.agentRoute');
  assert.ok(mutation>=0&&firstWrite>=0&&mutation<firstWrite,'mutation tracking must start before first install write');
});

test('installer syntax-checks MCP candidate as ESM from stdin',()=>{
  const source=fs.readFileSync(path.join(__dirname,'bootstrap-host-actions-v14-1-honartik-iticket-v14-preflight-readonly.js'),'utf8');
  assert.match(source,/nodeCheckSource\('mcp',patched\.mcp,true\)/);
  assert.match(source,/--input-type=module/);
});
