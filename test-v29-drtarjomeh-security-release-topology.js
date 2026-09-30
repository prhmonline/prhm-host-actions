'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const bootstrap=require('./bootstrap-host-actions-v29-drtarjomeh-security-release-deploy.js');
const installer=require('./install-host-actions-v29-drtarjomeh-security-release.js');

function currentTopology(overrides={}){
  return {
    hashes:{base:bootstrap.BASE_SHA,exec:bootstrap.EXEC_SHA,policy:bootstrap.POLICY_SHA,mcp:bootstrap.MCP_SHA},
    services:{
      api_blue:'active',api_green:'active',mcp_blue:'active',mcp_green:'active',
      api_instant_delivery:'active',mcp_instant_delivery:'active',
      ...overrides,
    },
  };
}

test('v29 preflight requires the current instant-delivery production topology to be healthy',()=>{
  assert.doesNotThrow(()=>installer.assertInstallPreflight(currentTopology()));
  assert.throws(
    ()=>installer.assertInstallPreflight(currentTopology({mcp_instant_delivery:'activating'})),
    /control_plane_not_stable:mcp_instant_delivery/
  );
  assert.throws(
    ()=>installer.assertInstallPreflight(currentTopology({api_instant_delivery:'failed'})),
    /control_plane_not_stable:api_instant_delivery/
  );
});

test('production adapter restarts and verifies the active MCP instant-delivery candidate',()=>{
  const src=installer.productionDeps.toString();
  assert.match(src,/prhm-agent-api-instant-delivery-candidate\.service/);
  assert.match(src,/prhm-agent-mcp-instant-delivery-candidate\.service/);
  assert.match(src,/mcp_instant_delivery/);
  assert.match(src,/api_instant_delivery/);
  const mcpCandidate=(src.match(/prhm-agent-mcp-instant-delivery-candidate\.service/g)||[]).length;
  assert.ok(mcpCandidate>=2,'active MCP candidate must be both observed and restarted/verified');
});
