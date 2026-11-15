'use strict';
/**
 * Root-owned read-only MCP tools/list probe for the existing Blue+Green
 * Streamable HTTP backends. NO arbitrary URLs, headers, credentials,
 * write/tool calls, registration, signing, or bootstrap.
 *
 * An authenticated Provider bootstrap MUST provision the pre-existing
 * authorization mechanism as a separate reviewed root-only credential file.
 * Absent authorization FAILS CLOSED; never request unauthenticated fallback.
 */
const fs=require('node:fs');
const http=require('node:http');
const crypto=require('node:crypto');

const AUTH_FILE='/etc/prhm-company-control-plane/registrar-mcp-probe-auth.json';
const PORTS=Object.freeze([8124,8125]);
const MAX_RESPONSE=1048576;
const MAX_PAGES=12;
const TIMEOUT_MS=6500;
const RPC_VERSION='2025-03-26';
const PROJECTS=new Set(['pbcinema','honartik']);
const LEGACY='host_action_v2_status';
const REGISTRAR_TOOLS=Object.freeze(['prhm_registrar_request_v1','prhm_registrar_apply_v1']);
const ACTION=/^[a-z][a-z0-9_]{5,100}$/;

function fail(reason){throw Error('registrar_mcp_discovery_'+reason);}
function expectedTools({action,project}={}){
 if(!PROJECTS.has(project)||typeof action!=='string'||!ACTION.test(action))
  fail('fixed_action_or_project_invalid');
 if(action===LEGACY)return [LEGACY];
 if(action==='prhm_action_registry_install_v1')
  fail('internal_action_not_a_registered_tool');
 return [LEGACY,...REGISTRAR_TOOLS,action];
}
function authToken(){
 if(typeof process.getuid!=='function'||process.getuid()!==0)fail('root_required');
 const st=fs.lstatSync(AUTH_FILE);
 if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(AUTH_FILE)!==AUTH_FILE||
  st.uid!==0||st.gid!==0||(st.mode&0o077)!==0||st.size>8192||st.size<20)
  fail('trusted_auth_file_invalid');
 const record=JSON.parse(fs.readFileSync(AUTH_FILE,'utf8'));
 if(!record||Object.keys(record).sort().join('|')!=='bearer_token|schema'||
  record.schema!=='prhm.registrar.mcp-readonly-auth.v1'||
  typeof record.bearer_token!=='string'||record.bearer_token.length<24||
  record.bearer_token.length>4096||
  !/^[\x21-\x7e]+$/.test(record.bearer_token))
  fail('auth_file_schema_invalid');
 return record.bearer_token;
}
function parseReply(raw,id,contentType){
 if(typeof raw!=='string'||raw.length<12||raw.length>MAX_RESPONSE)fail('reply_size');
 let payload=raw;
 if(contentType.startsWith('text/event-stream')){
  const chunks=raw.split(/\r?\n/).filter(x=>x.startsWith('data: ')).map(x=>x.slice(6));
  if(chunks.length!==1)fail('sse_frame_invalid');
  payload=chunks[0];
 }else if(!contentType.startsWith('application/json')){
  fail('reply_content_type_invalid');
 }
 let value;
 try{value=JSON.parse(payload)}catch{fail('reply_not_json')}
 if(!value||value.jsonrpc!=='2.0'||value.id!==id||value.error||
  !value.result||!Array.isArray(value.result.tools)||
  value.result.tools.length>2000)fail('rpc_schema_invalid');
 const names=new Set();
 for(const entry of value.result.tools){
  if(!entry||typeof entry.name!=='string'||!ACTION.test(entry.name)||
     names.has(entry.name))fail('tool_list_invalid');
  names.add(entry.name);
 }
 const cursor=value.result.nextCursor;
 if(cursor!==undefined&&(typeof cursor!=='string'||cursor.length<1||
    cursor.length>500))fail('cursor_invalid');
 return Object.freeze({names,cursor:cursor||null});
}
function request(port,token,id,cursor){
 return new Promise((resolve,reject)=>{
  const data=Buffer.from(JSON.stringify({
   jsonrpc:'2.0',id,method:'tools/list',
   params:cursor?{cursor}:{}
  }));
  const req=http.request({
   protocol:'http:',host:'127.0.0.1',port,
   path:'/mcp',method:'POST',
   headers:{
    'content-type':'application/json',
    'accept':'application/json, text/event-stream',
    'mcp-protocol-version':RPC_VERSION,
    'authorization':'Bearer '+token,
    'content-length':String(data.length)
   }
  },res=>{
   let size=0;const chunks=[];
   res.on('data',b=>{
    size+=b.length;
    if(size>MAX_RESPONSE){req.destroy(Error('reply_too_large'));return;}
    chunks.push(b);
   });
   res.on('end',()=>{
    if(res.statusCode!==200){
     reject(Error('backend_http_not_ok:'+res.statusCode));return;
    }
    try{resolve(parseReply(Buffer.concat(chunks).toString('utf8'),id,
      String(res.headers['content-type']||'').toLowerCase()));}
    catch(e){reject(e)}
   });
  });
  req.on('error',reject);
  req.setTimeout(TIMEOUT_MS,()=>req.destroy(Error('backend_timeout')));
  req.end(data);
 });
}
async function probePort(port,token,required){
 const seen=new Set(),cursors=new Set();
 let cursor=null;
 for(let page=0;page<MAX_PAGES;page++){
  const r=await request(port,token,page+1,cursor);
  for(const name of r.names){
   if(seen.has(name))fail('duplicate_tool_across_pages');
   seen.add(name);
  }
  if(!r.cursor){
   for(const name of required)if(!seen.has(name))
    fail('tool_not_found_on_'+port+':'+name);
   return Object.freeze({port,tool_count:seen.size,verified:true});
  }
  if(cursors.has(r.cursor))fail('cursor_loop');
  cursors.add(r.cursor);cursor=r.cursor;
 }
 fail('tool_list_pagination_limit');
}
async function verify({action,project}={}){
 const required=expectedTools({action,project});
 const token=authToken();
 for(const port of PORTS){
  // Sequential, separately authenticated verification of BOTH backends.
  await probePort(port,token,required);
 }
 return true;
}
module.exports=Object.freeze({verify,expectedTools,parseReply,PORTS,AUTH_FILE});
if(require.main===module){
 process.stderr.write('Not a standalone discovery command. Root Host Actions only.\n');
 process.exitCode=64;
}
