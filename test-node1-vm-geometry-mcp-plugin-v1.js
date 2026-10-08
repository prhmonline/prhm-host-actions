'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const load=()=>import(pathToFileURL(path.join(__dirname,'node1-vm-geometry-mcp-plugin-v1.mjs')).href);
test('registers read-only zero-input tool once and forwards fixed authenticated POST',async()=>{
 const m=await load(),registered=[],calls=[];
 const mcp={registerTool(name,config,handler){registered.push({name,config,handler});return true}};
 const agent={async callAgent(url,method,payload){calls.push({url,method,payload});return{
 schema_version:'prhm.node1-vm-geometry-readonly.v1',readonly:true,production_mutation:false,
 ready_for_deployment:false,all_domains_verified:false,host:'server1.prhm.ir',
 totalVirtualBytes:null,domains:[]}}};
 assert.equal(m.registerNode1VmGeometryReadonlyPlugin(mcp,{agent}),true);
 assert.equal(registered.length,1);
 assert.equal(registered[0].name,'node1_vm_geometry_readonly_v1');
 assert.deepEqual(registered[0].config.inputSchema,{});
 assert.equal(registered[0].config.annotations.readOnlyHint,true);
 assert.equal(registered[0].config.annotations.destructiveHint,false);
 const result=await registered[0].handler({});
 assert.deepEqual(calls,[{url:'/node1/vm-geometry/read-only',method:'POST',payload:{}}]);
 assert.equal(result.content[0].type,'text');
});
test('no extra operations or direct host networking',async()=>{
 const m=await load();
 const f=await require('node:fs').promises.readFile(path.join(__dirname,'node1-vm-geometry-mcp-plugin-v1.mjs'),'utf8');
 assert(!/\bssh\b|spawnSync|execSync|fetch\s*\(|https?:\/\//i.test(f));
 assert.equal(m.ROUTE,'/node1/vm-geometry/read-only');
});
test('missing transport and invalid response fail closed',async()=>{
 const m=await load(),mcp={registerTool(_a,_b,handler){this.handler=handler}};
 assert.throws(()=>m.registerNode1VmGeometryReadonlyPlugin(mcp,{}),/authenticated_agent_bridge_missing/);
 m.registerNode1VmGeometryReadonlyPlugin(mcp,{agent:{callAgent:async()=>({ok:true})}});
 await assert.rejects(()=>mcp.handler({}),/node1_geometry_response_invalid/);
});
