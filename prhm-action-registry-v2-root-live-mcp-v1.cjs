'use strict';
/*
 * Actual authenticated MCP JSON-RPC probes for the two fixed Honartik V2
 * blue/green root runner workers. NO shell, dynamic hosts, DNS or anonymous
 * fallbacks. A private systemd LoadCredential must supply the bearer.
 * HTTP/JSON-RPC transport is fail-closed: unexpected status/body/session,
 * stale/mismatched worker, unsupported endpoint or authentication fails.
 *
 * This module alone does not assert host reachability or install credentials.
 */
const fs=require('node:fs');
const http=require('node:http');
const sys=require('./prhm-action-registry-v2-fixed-systemd-bridge-v1.cjs');
const discovery=require('./prhm-action-registry-v2-mcp-discovery-v1.cjs');
const CREDFILE='mcp-discovery-bearer';
const PORTS=Object.freeze({
 'prhm-agent-mcp-blue.service':8124,
 'prhm-agent-mcp-green.service':8125
});
const PATH='/mcp';
const MAX_BYTES=65536;
function deny(reason){throw Error('registry_v2_live_mcp_'+reason)}
function check(v,reason){if(!v)deny(reason)}
function rootCredential({io=fs,env=process.env,
 cgroup=()=>fs.readFileSync('/proc/self/cgroup','utf8'),
 getuid=()=>process.getuid?.()}={}){
 const unit=sys.cgroupAttestation(cgroup(),getuid);
 const dir='/run/credentials/'+unit;
 check(env?.CREDENTIALS_DIRECTORY===dir,'sealed_systemd_directory_required');
 const st=io.lstatSync(dir),path=dir+'/'+CREDFILE;
 check(st.isDirectory()&&!st.isSymbolicLink()&&io.realpathSync(dir)===dir&&
  st.uid===0&&(st.mode&0o022)===0,'credential_parent_unsafe');
 const s=io.lstatSync(path);
 check(s.isFile()&&!s.isSymbolicLink()&&io.realpathSync(path)===path&&
  s.uid===0&&(s.mode&0o077)===0&&s.size>=32&&s.size<=4096,
  'credential_file_unsafe');
 const fd=io.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 let data;
 try{
  const t=io.fstatSync(fd);
  check(t.isFile()&&t.ino===s.ino&&t.dev===s.dev&&t.mode===s.mode&&
   t.uid===s.uid&&t.gid===s.gid&&t.size===s.size,'credential_file_swapped');
  data=io.readFileSync(fd);
 }finally{io.closeSync(fd)}
 check(Buffer.isBuffer(data)&&data.length===s.size,'credential_read_incomplete');
 const value=data.toString('utf8').trim();
 check(/^[A-Za-z0-9._~-]{32,4096}$/.test(value),'credential_format_invalid');
 return value;
}
function decode(bytes,contentType){
 check(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=MAX_BYTES,
  'rpc_body_invalid');
 // JSON only until the separately reviewed host server confirms an
 // authenticated streamable-HTTP session implementation. SSE never counts
 // as an authenticated successful tools/list result here.
 check(typeof contentType==='string','unsupported_rpc_content_type');
 let raw=bytes.toString('utf8');
 if(/^text\/event-stream(?:;|$)/i.test(contentType)){
  const replies=[];
  for(const frame of raw.split(/\r?\n\r?\n/)){
   const data=frame.split(/\r?\n/).filter(x=>x.startsWith('data:'))
    .map(x=>x.slice(5).trim()).join('\n');
   if(!data)continue;
   let message;try{message=JSON.parse(data)}catch{deny('rpc_sse_json_invalid')}
   if(message?.id===2)replies.push(message);
   else check(message?.id===undefined,'unexpected_rpc_sse_response');
  }
  check(replies.length===1,'rpc_sse_terminal_response_missing');
  raw=JSON.stringify(replies[0]);
 }else check(/^application\/json(?:;|$)/i.test(contentType),
  'unsupported_rpc_content_type');
 let obj;try{obj=JSON.parse(raw)}catch{deny('rpc_json_invalid')}
 check(obj?.jsonrpc==='2.0'&&obj.id===2&&obj.error===undefined&&
   obj.result&&typeof obj.result==='object'&&
   Array.isArray(obj.result.tools)&&obj.result.tools.length<=256,
   'rpc_result_untrusted');
 const names=[];
 for(const t of obj.result.tools){
  check(t&&typeof t.name==='string'&&
   /^[a-z][a-z0-9_]{1,127}$/.test(t.name),'rpc_tool_name_untrusted');
  names.push(t.name);
 }
 return names;
}
function transport({request=http.request}={}){
 check(typeof request==='function','http_request_missing');
 return async (service,bearer)=>{
  check(Object.hasOwn(PORTS,service),'service_not_allowlisted');
  check(typeof bearer==='string'&&bearer.length>=32,'bearer_absent');
  const payload=Buffer.from(JSON.stringify({
   jsonrpc:'2.0',id:2,method:'tools/list',
   params:{_meta:{
    'io.modelcontextprotocol/protocolVersion':'2026-07-28',
    'io.modelcontextprotocol/clientInfo':{
     name:'prhm-honartik-root-registry',version:'2.0.0'
    },
    'io.modelcontextprotocol/clientCapabilities':{}
   }}
  }));
  const body=await new Promise((resolve,reject)=>{
   const r=request({
    hostname:'127.0.0.1',port:PORTS[service],path:PATH,method:'POST',
    timeout:4000,
    headers:{authorization:'Bearer '+bearer,'content-type':'application/json',
     accept:'application/json, text/event-stream',
     'mcp-protocol-version':'2026-07-28',
     'mcp-method':'tools/list','content-length':String(payload.length)}
   },res=>{
    if(res.statusCode!==200){
     res.resume();reject(Error('registry_v2_live_mcp_http_auth_or_status'));return;
    }
    let n=0;const chunks=[];
    res.on('data',c=>{
     n+=c.length;
     if(n>MAX_BYTES){r.destroy(Error('registry_v2_live_mcp_body_limit'));return}
     chunks.push(c)
    });
    res.on('end',()=>resolve({
     bytes:Buffer.concat(chunks),
     type:res.headers['content-type'],
     session:res.headers['mcp-session-id']
    }));
    res.on('error',reject);
   });
   r.on('error',reject);
   r.on('timeout',()=>r.destroy(Error('registry_v2_live_mcp_timeout')));
   r.end(payload);
  });
  // If the server requires initialization / session, refusing its response
  // is mandatory. No invented session id and no unauthenticated retry.
  check(body.session===undefined,'uninitialized_session_not_authorized');
  return Object.freeze({
   service,ok:true,tools:decode(body.bytes,body.type),
   observed_at_ms:Date.now()
  });
 };
}
function createDiscovery(){
 const bearer=rootCredential();
 const probe=transport();
 return discovery.createCallbacks({
  probeWorker:service=>probe(service,bearer)
 });
}
module.exports=Object.freeze({
 PORTS,PATH,CREDFILE,MAX_BYTES,rootCredential,decode,transport,createDiscovery
});
