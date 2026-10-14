'use strict';
/**
 * Source-only isolated, fixed Unix HTTP transport for Honartik registry V2.
 * Unlike a patch to /opt/prhm-agent-selfmaint/server.js this transport
 * preserves ALL four original release owner digests until the signed L4
 * installer has established and durably claimed its one-time transaction.
 *
 * NO TCP listener, no inherited host action-only route, no arbitrary bind,
 * no token disclosure. Production startup is intentionally guarded by a
 * separately reviewed root capabilities provider and a dedicated systemd
 * unit. Source compilation/tests alone are NOT installation authorization.
 */
const http=require('node:http');
const fs=require('node:fs');
const ADAPTER=require('./prhm-action-registry-v2-approval-http-adapter-v1.cjs');
const GATE=require('./prhm-action-registry-v2-five-field-approval-gate-v1.cjs');
const SOCKET_DIR='/run/prhm-shared-registry-v2';
const SOCKET=SOCKET_DIR+'/registry.sock';
const UNIT='prhm-shared-registry-approval-v2.service';
const MAX_BODY=4096;
const paths=Object.freeze(Object.values(ADAPTER.URL));
const PATHS=new Set(paths);
function stop(c){throw Error('registry_v2_socket_'+c)}
function must(v,c){if(!v)stop(c)}
function checkRuntime(io=fs,root=()=>process.getuid?.(),
 cgroup=()=>fs.readFileSync('/proc/self/cgroup','utf8')){
 must(root()===0,'root_required');
 const group=cgroup();
 must(typeof group==='string'&&group.length<8192&&
  group.split('\n').some(line=>line.split('/').includes(UNIT)),
  'separate_root_systemd_unit_required');
 const dir=io.lstatSync(SOCKET_DIR);
 must(dir.isDirectory()&&!dir.isSymbolicLink()&&
  io.realpathSync(SOCKET_DIR)===SOCKET_DIR&&
  dir.uid===0&&dir.gid===0&&(dir.mode&0o777)===0o700,
  'private_socket_dir_not_staged');
 // Refuse takeover or deletion of ANY preexisting socket/path.
 let found=false;
 try{io.lstatSync(SOCKET);found=true}catch(e){
  if(e?.code!=='ENOENT')throw e;
 }
 must(!found,'socket_path_already_owned');
 return true;
}
function createSocketHandler(createTrustedHandlers){
 must(typeof createTrustedHandlers==='function','root_handler_factory_missing');
 return async function(req,res){
  const respond=(code,obj)=>{
   const bytes=Buffer.from(JSON.stringify(obj));
   res.writeHead(code,{'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','content-length':bytes.length});
   res.end(bytes);
  };
  if(req.method!=='POST'||!PATHS.has(req.url)){
   respond(404,{ok:false,error:'not_found'});return;
  }
  let count=0;
  const chunks=[];
  try{
   for await(const part of req){
    count+=part.length;
    if(count>MAX_BODY)stop('payload_too_large');
    chunks.push(part);
   }
   let body;
   try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}
   catch{stop('invalid_json')}
   must(body&&typeof body==='object'&&!Array.isArray(body),
    'body_not_object');
   // createTrustedHandlers comes from the fixed root-owned module only.
   // No client-provided callbacks, endpoints, approval token or URLs.
   const handlers=createTrustedHandlers();
   must(handlers&&typeof handlers.dispatch==='function',
    'trusted_handler_missing');
   const result=await handlers.dispatch(req.method,req.url,body);
   must(result?.secret_exposed===false&&result?.ok===true&&
    result.action===GATE.REQUEST.action&&
    result.arguments_sha256===GATE.ARGUMENTS_SHA&&
    typeof result.request_id==='string',
    'secret_or_postcondition_invalid');
   const expected=(result.status==='registered'
    ? ['ok','request_id','action','arguments_sha256','status','registry_visible','secret_exposed']
    : ['ok','request_id','action','arguments_sha256','status','secret_exposed']);
   must(Object.keys(result).sort().join('|')===expected.sort().join('|')&&
    ['pending','approved','registered'].includes(result.status)&&
    (result.status!=='registered'||result.registry_visible===true),
    'unreviewed_response_fields');
   respond(result.status==='pending'?201:200,result);
  }catch(e){
   // Deliberately avoid reflecting exceptions with secret-bearing data.
   respond(count>MAX_BODY?413:409,{ok:false,error:'registry_request_rejected'});
  }
 };
}
function createIsolatedServer(handlers){
 return http.createServer(createSocketHandler(handlers));
}
function startFixedRootSidecar(){
 if(process.argv.length!==2)stop('cli_arguments_not_supported');
 checkRuntime();
 // No fallback factory. Missing the exact vetted root transport must
 // prevent bind/listen; never run an action-only or incomplete fallback.
 const host=require('./prhm-action-registry-v2-trusted-base-capabilities-v1.cjs');
 must(host&&typeof host.createRootCapabilities==='function',
  'root_capabilities_missing');
 const capabilities=host.createRootCapabilities();
 const handlers=ADAPTER.createHandlers(capabilities);
 const server=createIsolatedServer(()=>handlers);
 // Enforce a private 0600 socket from the instant bind() creates it.
 // A later chmod() alone would leave a permission exposure window.
 process.umask(0o077);
 server.listen(SOCKET,()=>{
  fs.chmodSync(SOCKET,0o600);
 });
 return server;
}
if(require.main===module){
 try{startFixedRootSidecar()}catch(e){
  process.stderr.write(String(e?.message||'registry_socket_blocked').slice(0,150)+'\n');
  process.exitCode=78;
 }
}
module.exports=Object.freeze({
 SOCKET_DIR,SOCKET,UNIT,MAX_BODY,checkRuntime,
 createSocketHandler,createIsolatedServer,startFixedRootSidecar
});
