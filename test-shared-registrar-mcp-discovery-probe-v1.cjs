'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const probe=require('./shared-registrar-mcp-discovery-probe-v1.cjs');
const message=(tools,extra={})=>JSON.stringify({
 jsonrpc:'2.0',id:1,result:{tools:tools.map(name=>({name})),...extra}
});
test('fixed Blue/Green ports; no external socket or credential input',()=>{
 assert.deepEqual(probe.PORTS,[8124,8125]);
 assert.equal(probe.AUTH_FILE,'/etc/prhm-company-control-plane/registrar-mcp-probe-auth.json');
 assert.equal(Object.isFrozen(probe),true);
 assert.equal(typeof probe.install,'undefined');
 assert.equal(typeof probe.issueApproval,'undefined');
});
test('a project action needs BOTH registered fixed registrar tools and legacy',()=>{
 assert.deepEqual(probe.expectedTools({action:'pbcinema_banner_publish_v1',project:'pbcinema'}),
 ['host_action_v2_status','prhm_registrar_request_v1','prhm_registrar_apply_v1','pbcinema_banner_publish_v1']);
 assert.deepEqual(probe.expectedTools({action:'host_action_v2_status',project:'honartik'}),
 ['host_action_v2_status']);
 for(const req of [
  {action:'prhm_action_registry_install_v1',project:'pbcinema'},
  {action:'some_tool',project:'../../etc'},
  {action:'INVALID',project:'honartik'},
  {action:'test/action',project:'pbcinema'}
 ])assert.throws(()=>probe.expectedTools(req),/registrar_mcp_discovery_/);
});
test('actual JSON-RPC list parser requires one valid 2.0 matching reply',()=>{
 const o=probe.parseReply(message(['host_action_v2_status','prhm_registrar_request_v1']),1,'application/json');
 assert.equal(o.names.size,2);
 assert.equal(o.cursor,null);
 assert.throws(()=>probe.parseReply(message(['host_action_v2_status']),2,'application/json'),/rpc_schema_invalid/);
 assert.throws(()=>probe.parseReply(JSON.stringify({jsonrpc:'2.0',id:1,error:{code:-32003,message:'Unauthorized'}}),1,'application/json'),/rpc_schema_invalid/);
});
test('SSE reply accepted only as one unambiguous event',()=>{
 const d='data: '+message(['host_action_v2_status'])+'\n\n';
 const x=probe.parseReply(d,1,'text/event-stream');
 assert.equal(x.names.has('host_action_v2_status'),true);
 assert.throws(()=>probe.parseReply(d+d,1,'text/event-stream'),/sse_frame_invalid/);
});
test('malformed tool list and pagination cursor reject fail-closed',()=>{
 for(const data of [
  message(['same_name','same_name']),
  message(['name with spaces']),
  message(['host_action_v2_status'],{nextCursor:42}),
  JSON.stringify({jsonrpc:'2.0',id:1,result:{tools:'not-an-array'}})
 ])assert.throws(()=>probe.parseReply(data,1,'application/json'),/registrar_mcp_discovery_/);
});
test('root-only auth unavailable on ordinary hosted CI; never bypasses 401',async()=>{
 if(process.platform==='linux'&&process.getuid()!==0){
  await assert.rejects(probe.verify({project:'pbcinema',action:'host_action_v2_status'}),/registrar_mcp_discovery_root_required/);
 }
});
