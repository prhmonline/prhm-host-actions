'use strict';
/**
 * Fixed Approval Center transport from the independently rooted registry
 * sidecar. Existing, VERIFIED real server contract (2026-10-14):
 * GET /v1/requests/:uuid [REQUEST_TOKEN],
 * POST /v1/requests [REQUEST_TOKEN],
 * POST /v1/requests/:uuid/decision [DECISION_TOKEN],
 * POST /v1/validate and /v1/consume over private Approval Center socket.
 *
 * No untrusted endpoint, hostname, request method, credential file, body
 * field or caller-provided socket path. No HTTP redirect, proxy, shell,
 * public network, key generation, production mutation or fallbacks.
 *
 * Still source only; must be reviewed/pinned and bound by a separately
 * installed root capability factory. This module alone never runs a server.
 */
const http=require('node:http');
const fs=require('node:fs');
const F=require('./prhm-action-registry-v2-five-field-approval-gate-v1.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENV='/etc/prhm-company-control-plane/approval-client.env';
const SOCKET='/run/prhm-agent-approval/approval.sock';
const HOST='127.0.0.1',PORT=18133,MAX_RESPONSE=65536;
function fail(s){throw Error('registry_v2_approval_transport_'+s)}
function check(x,s){if(!x)fail(s)}
function requestUrl(method,route){
 check(method==='GET'||method==='POST','method_not_allowed');
 if(method==='POST'&&route==='/v1/requests')return route;
 if(method==='POST'&&(/^\/v1\/requests\/([0-9a-f-]+)\/decision$/i).test(route)){
  check(UUID.test(route.slice(13,-9)),'invalid_decision_uuid');
  return route;
 }
 if(method==='GET'&&(/^\/v1\/requests\/([0-9a-f-]+)$/i).test(route)){
  check(UUID.test(route.slice(13)),'invalid_lookup_uuid');return route;
 }
 fail('route_not_allowed');
}
function safeToken(t){
 check(typeof t==='string'&&t.length>=16&&t.length<=8192&&
  /^[A-Za-z0-9._~+/=-]+$/.test(t),'credential_format_invalid');
 return t;
}
function readRootCredentials(io=fs,getuid=()=>process.getuid?.()){
 check(getuid()===0,'root_required');
 const st=io.lstatSync(ENV);
 check(st.isFile()&&!st.isSymbolicLink()&&st.uid===0&&
  st.size>40&&st.size<16384&&(st.mode&0o077)===0,
  'credential_file_mode_or_owner_unsafe');
 const fd=io.openSync(ENV,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 let body;
 try{
  const post=io.fstatSync(fd);
  check(post.isFile()&&post.dev===st.dev&&post.ino===st.ino&&
   post.uid===st.uid&&post.size===st.size&&post.mode===st.mode,
   'credential_file_changed');
  body=io.readFileSync(fd);
 }finally{io.closeSync(fd)}
 check(Buffer.isBuffer(body)&&body.length===st.size,
  'credential_bytes_invalid');
 const env=Object.create(null);
 for(const raw of body.toString('utf8').split(/\r?\n/)){
  const line=raw.trim();
  if(!line||line.startsWith('#'))continue;
  const equal=line.indexOf('=');
  check(equal>0,'credential_line_invalid');
  const key=line.slice(0,equal).trim(),val=line.slice(equal+1).trim();
  check(/^[A-Z][A-Z0-9_]*$/.test(key)&&!Object.hasOwn(env,key),
   'credential_key_duplicate_or_invalid');
  // Only request+decision credentials are exposed to this module;
  // the Approval Center's private socket verifies executor permissions.
  if(key==='APPROVAL_REQUEST_TOKEN'||key==='APPROVAL_DECISION_TOKEN'){
   env[key]=safeToken(val);
  }
 }
 check(env.APPROVAL_REQUEST_TOKEN&&env.APPROVAL_DECISION_TOKEN,
  'approval_credential_missing');
 return Object.freeze({request:env.APPROVAL_REQUEST_TOKEN,
  decision:env.APPROVAL_DECISION_TOKEN});
}
function jsonCall(requestFn,options,body){
 return new Promise((resolve,reject)=>{
  const bytes=body===undefined?null:Buffer.from(JSON.stringify(body));
  check(bytes===null||bytes.length<=16384,'request_body_too_large');
  const optionsCopy={...options,headers:{
   ...options.headers,
   ...(bytes===null?{}:{'content-type':'application/json',
    'content-length':bytes.length})
  }};
  let finished=false,req;
  function rejectOnce(err){
   if(finished)return;finished=true;
   reject(Error('registry_v2_approval_transport_rejected'));
  }
  try{
   req=requestFn(optionsCopy,res=>{
    if(res.statusCode<200||res.statusCode>=300){
     res.resume();return rejectOnce(Error('http_status_unexpected'));
    }
    let size=0;const chunks=[];
    res.on('data',chunk=>{
     size+=chunk.length;
     if(size>MAX_RESPONSE){req.destroy();return rejectOnce(Error('response_too_large'))}
     chunks.push(chunk);
    });
    res.on('end',()=>{
     if(finished)return;
     let data;
     try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'))}
     catch{return rejectOnce(Error('invalid_response_json'))}
     if(data&&data.ok===true){finished=true;resolve(data)}
     else rejectOnce(Error('approval_center_refused'));
    });
    res.on('error',rejectOnce);
   });
   req.setTimeout(5000,()=>req.destroy(Error('timeout')));
   req.on('error',rejectOnce);
   req.end(bytes);
  }catch(e){rejectOnce(e)}
 });
}
function createTransport({requestFn=http.request,credentialReader=readRootCredentials,
 getuid=()=>process.getuid?.()}={}){
 check(getuid()===0,'root_required');
 check(typeof requestFn==='function'&&typeof credentialReader==='function',
  'trusted_transport_missing');
 function creds(){return credentialReader()}
 async function approvalHttp(method,route,providedToken,body){
  requestUrl(method,route);
  const trusted=creds();
  const token=route.endsWith('/decision')?trusted.decision:trusted.request;
  check(providedToken===token,'requested_bearer_not_root_bound');
  return jsonCall(requestFn,{host:HOST,port:PORT,
   method,path:route,headers:{authorization:'Bearer '+token}},body);
 }
 async function getTrustedRequest(id){
  check(UUID.test(id),'lookup_uuid_invalid');
  const obj=await approvalHttp('GET','/v1/requests/'+id,creds().request);
  check(obj?.request&&obj.request.request_id===id,'lookup_response_mismatch');
  // The real API response is a typed record, not a client-crafted body.
  F.checkRequestRecord(obj.request,id);
  return obj.request;
 }
 async function approvalBridge(route,body){
  check(route==='/v1/validate'||route==='/v1/consume',
   'approval_socket_route_untrusted');
  check(body&&typeof body==='object'&&!Array.isArray(body)&&
   body.action===F.REQUEST.action&&
   body.arguments_sha256===F.ARGUMENTS_SHA&&
   body.tool==='host_action_v2_apply',
   'socket_payload_binding_invalid');
  return jsonCall(requestFn,{socketPath:SOCKET,method:'POST',
   path:route,headers:{}},body);
 }
 return Object.freeze({
  getApprovalCredentials:creds,approvalHttp,getTrustedRequest,approvalBridge
 });
}
module.exports=Object.freeze({ENV,SOCKET,HOST,PORT,
 requestUrl,readRootCredentials,createTransport});
