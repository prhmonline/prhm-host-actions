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
  assert.equal(route.V14_SHA,'a1d5e590f5798226fb8bf39652b15e2e341ece82c23c2591ba839fad12834b20');
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
  assert.equal(installer.EXPECTED.registry,'cf3681ca4d4632156df2f77886afe59c07da9a86dbcb68f4217577f811b22231');
  assert.equal(installer.IMMUTABLE_HOST_ACTIONS_V2_SHA,'7efeeb17253bc52aeac1f362c377fd4121984f49f159fd9e72ae7e06897ded56');
  assert.equal(installer.V14_SHA,'4bd64fc2c6e8764af1d835c7785263c8cf98219047e457b718fd5a24c750a090');
  assert.equal(typeof installer.patchAgentServer,'function');
  assert.equal(typeof installer.patchRegistry,'function');
  assert.equal(typeof installer.preflight,'function');
  assert.equal(typeof installer.install,'function');
});


test('dedicated MCP plugin exposes only the fixed zero-input Agent API call',()=>{
  const pluginPath=path.join(__dirname,'honartik-iticket-v14-preflight-mcp.js');
  const plugin=require('node:fs').readFileSync(pluginPath,'utf8');
  assert.match(plugin,/export function registerHonartikIticketPreflightPlugin/);
  assert.match(plugin,/const TOOL='honartik_iticket_v14_preflight_readonly'/);
  assert.match(plugin,/mcp\.registerTool\(TOOL,/);
  assert.match(plugin,/inputSchema:\{\},annotations:RO/);
  assert.match(plugin,/agent\.callAgent\('\/honartik\/iticket\/v14\/preflight','POST',\{\}\)/);
  assert.doesNotMatch(plugin,/host_action_v2_(request|apply)/);
  assert.doesNotMatch(plugin,/honartik_iticket_dark_backend_batch1_v1/);
});

test('installer patches only Agent wrapper and MCP registry while preserving hostActionsV2',()=>{
  const installer=require(path.join(__dirname,'bootstrap-host-actions-v14-1-honartik-iticket-v14-preflight-readonly.js'));
  const agentFixture=`'use strict';\nconst baseImotionMonitor=require('./imotionMonitorRoutes.js');\nfunction wrapped(app,deps){\n  const wrappedRunSSH=deps.runSSH;\n  return baseImotionMonitor.registerImotionMonitorRoutes(app,{...deps,runSSH:wrappedRunSSH});\n}`;
  const patchedAgent=installer.patchAgentServer(agentFixture);
  assert.match(patchedAgent,/registerHonartikIticketV14PreflightRoutes/);
  assert.match(patchedAgent,/honartikIticketV14PreflightRoutes/);
  assert.throws(()=>installer.patchAgentServer(patchedAgent),/agent_preflight_already_patched/);

  const registryFixture=`import { registerHostActionsV2Plugin } from '../plugins/hostActionsV2.js';\nimport { registerProjectFactoryPlugin } from '../plugins/projectFactory.js';\nexport function registerPlugins(mcp, context) {\n  registerHostActionsV2Plugin(mcp, context);\n  registerProjectFactoryPlugin(mcp, context);\n}`;
  const patchedRegistry=installer.patchRegistry(registryFixture);
  assert.match(patchedRegistry,/registerHonartikIticketPreflightPlugin/);
  assert.match(patchedRegistry,/honartikIticketPreflight\.js/);
  assert.throws(()=>installer.patchRegistry(patchedRegistry),/mcp_registry_preflight_already_patched/);
  assert.equal(installer.PATHS.hostActionsV2,'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js');
  assert.equal(installer.PATHS.mcpPlugin,'/home/agent/ssh-mcp-server/src/plugins/honartikIticketPreflight.js');
  assert.equal(installer.PATHS.mcpRegistry,'/home/agent/ssh-mcp-server/src/core/registry.js');
  assert.equal(Object.prototype.hasOwnProperty.call(installer.PATHS,'mcp'),false);
});

test('installer marks mutation before the first write so partial installs always rollback',()=>{
  const source=fs.readFileSync(path.join(__dirname,'bootstrap-host-actions-v14-1-honartik-iticket-v14-preflight-readonly.js'),'utf8');
  const mutation=source.indexOf('mutated=true;');
  const firstWrite=source.indexOf('atomicWrite(PATHS.agentRoute');
  assert.ok(mutation>=0&&firstWrite>=0&&mutation<firstWrite,'mutation tracking must start before first install write');
});

test('installer syntax-checks MCP candidate as ESM from stdin',()=>{
  const source=fs.readFileSync(path.join(__dirname,'bootstrap-host-actions-v14-1-honartik-iticket-v14-preflight-readonly.js'),'utf8');
  assert.match(source,/nodeCheckSource\('mcpRegistry',patched\.registry,true\)/);
  assert.match(source,/nodeCheckSource\('mcpPlugin',mcpPlugin\.toString\('utf8'\),true\)/);
  assert.match(source,/--input-type=module/);
});


test('installer embeds exact V14 route and dedicated MCP plugin bytes',()=>{
  const installer=require(path.join(__dirname,'bootstrap-host-actions-v14-1-honartik-iticket-v14-preflight-readonly.js'));
  assert.deepEqual(Buffer.from(installer.V14_B64,'base64'),fs.readFileSync(path.join(__dirname,'bootstrap-host-actions-v14-honartik-iticket-dark-backend-batch1.js')));
  assert.deepEqual(Buffer.from(installer.ROUTE_B64,'base64'),fs.readFileSync(path.join(__dirname,'honartik-iticket-v14-preflight-readonly-routes.js')));
  assert.deepEqual(Buffer.from(installer.MCP_PLUGIN_B64,'base64'),fs.readFileSync(path.join(__dirname,'honartik-iticket-v14-preflight-mcp.js')));
});

test('installer never writes or patches the V14-bound hostActionsV2 file',()=>{
  const source=fs.readFileSync(path.join(__dirname,'bootstrap-host-actions-v14-1-honartik-iticket-v14-preflight-readonly.js'),'utf8');
  assert.doesNotMatch(source,/function patchMcp\(/);
  assert.doesNotMatch(source,/atomicWrite\(PATHS\.hostActionsV2/);
  assert.doesNotMatch(source,/backupFile\(PATHS\.hostActionsV2/);
  assert.match(source,/assertSha\('hostActionsV2'/);
});

test('installer injects read-only route via live iMotion wrapper hook without migration-backup route anchors',()=>{
  const source=fs.readFileSync(path.join(__dirname,'bootstrap-host-actions-v14-1-honartik-iticket-v14-preflight-readonly.js'),'utf8');
  assert.equal(source.includes('verifyMigrationBaseAnchors'),false);
  assert.match(source,/const AGENT_IMPORT_ANCHOR=/);
  assert.match(source,/const AGENT_REGISTER_ANCHOR=/);
  assert.match(source,/registerHonartikIticketV14PreflightRoutes/);
  assert.match(source,/deps\.auth/);
});
