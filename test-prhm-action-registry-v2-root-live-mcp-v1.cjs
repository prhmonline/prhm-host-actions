'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const MCP=require('./prhm-action-registry-v2-root-live-mcp-v1.cjs');
const data={jsonrpc:'2.0',id:2,result:{
 resultType:'complete',tools:[{name:'honartik_config_center_readonly_enroll_v1'}]
}};
test('authenticated current MCP tools/list JSON and SSE have the same exact output',()=>{
 const text=JSON.stringify(data);
 const plain=MCP.decode(Buffer.from(text),'application/json');
 const sse=MCP.decode(Buffer.from('event: message\ndata: '+text+'\n\n'),
  'text/event-stream');
 assert.deepEqual(plain,sse);
 assert.deepEqual(plain,['honartik_config_center_readonly_enroll_v1']);
 assert.throws(()=>MCP.decode(Buffer.from('data: {"id":2}\n\n'),
  'text/event-stream'),/rpc_result_untrusted|rpc_sse_terminal_response_missing/);
});
test('both worker locations are fixed loopback ports, with no arbitrary destinations',()=>{
 assert.deepEqual(Object.keys(MCP.PORTS).sort(),
 ['prhm-agent-mcp-blue.service','prhm-agent-mcp-green.service'].sort());
 assert.equal(MCP.PORTS['prhm-agent-mcp-blue.service'],8124);
 assert.equal(MCP.PORTS['prhm-agent-mcp-green.service'],8125);
 assert.equal(MCP.PATH,'/mcp');
});
test('tools/list includes protocol metadata, bearer and bound routing headers',async()=>{
 let host=null,headers=null,message=null;
 const request=(opts,callback)=>{
  host=opts.hostname+':'+opts.port+opts.path;
  headers=opts.headers;
  const req=new EventEmitter();
  req.end=bytes=>{
   message=JSON.parse(bytes.toString('utf8'));
   const res=new EventEmitter();
   res.statusCode=200;
   res.headers={'content-type':'application/json'};
   process.nextTick(()=>{
    callback(res);
    res.emit('data',Buffer.from(JSON.stringify(data)));
    res.emit('end');
   });
  };
  req.destroy=e=>req.emit('error',e);
  return req;
 };
 const probe=MCP.transport({request});
 const report=await probe('prhm-agent-mcp-blue.service','x'.repeat(64));
 assert.equal(host,'127.0.0.1:8124/mcp');
 assert.equal(headers.authorization,'Bearer '+'x'.repeat(64));
 assert.equal(headers['mcp-protocol-version'],'2026-07-28');
 assert.equal(headers['mcp-method'],'tools/list');
 assert.match(headers.accept,/text\/event-stream/);
 assert.equal(message.params._meta['io.modelcontextprotocol/protocolVersion'],'2026-07-28');
 assert.equal(report.ok,true);
 assert.equal(report.tools[0],'honartik_config_center_readonly_enroll_v1');
 await assert.rejects(()=>probe('other.service','x'.repeat(64)),/service_not_allowlisted/);
});
