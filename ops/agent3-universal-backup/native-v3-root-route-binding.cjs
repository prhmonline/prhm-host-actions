'use strict';
/**
 * Native v3 route binder for a separately authenticated, root-owned Executor.
 *
 * SOURCE ONLY. Not a listener, privilege escalator, installer, signer, or
 * approval client. It cannot be used to register any Host Action by itself.
 * The existing root Executor must construct basePost, rootCapabilities and
 * assertAuthenticatedTransport from its OWN fixed native code, never from
 * a request, MCP caller, or environment-driven dynamic module.
 *
 * The transport callback MUST authenticate the live AF_UNIX peer/session
 * using ONLY server-owned, closure-captured connection evidence. Never pass
 * client-supplied transportContext/uid/role or request data into this verifier.
 * No production owner source is modified here.
 */
const native=require('./native-five-field-executor-v3-handlers.cjs');
const REQUEST=native.REQUEST_PATH;
const EXECUTE=native.EXECUTE_PATH;
const PATHS=Object.freeze([REQUEST,EXECUTE]);
function deny(reason){throw Error('agent3_native_root_route_denied:'+reason);}
function requireRoot(){
 if(typeof process.getuid!=='function'||process.getuid()!==0)
  deny('trusted_root_executor_required');
}
function bind({basePost,rootCapabilities,assertAuthenticatedTransport}={}){
 requireRoot();
 if(typeof basePost!=='function'||
    typeof assertAuthenticatedTransport!=='function'||
    !rootCapabilities||typeof rootCapabilities!=='object'||
    Array.isArray(rootCapabilities))
  deny('fixed_root_native_dependencies_required');
 const executor=native.bindTrustedExecutor({basePost,rootCapabilities});
 if(!executor||typeof executor.request!=='function'||
    typeof executor.execute!=='function')
  deny('trusted_native_executor_not_bound');
 async function handle(envelope={}){
  requireRoot();
  if(!envelope||typeof envelope!=='object'||Array.isArray(envelope))
   deny('route_envelope_required');
  // Do not intercept pre-existing legacy /v1 or /v2 handlers.
  const url=envelope.url;
  if(!PATHS.includes(url))return Object.freeze({handled:false});
  // No authentication metadata, peer context or arbitrary caller fields may
  // enter the fixed route dispatcher. The trusted auth closure is server-owned.
  if(Object.keys(envelope).sort().join('|')!=='body|method|url')
   deny('caller_supplied_transport_context');
  if(envelope.method!=='POST')deny('post_only');
  const trusted=await assertAuthenticatedTransport();
  if(trusted!==true)deny('unauthenticated_native_transport');
  const answer=url===REQUEST?await executor.request(envelope.body):await executor.execute(envelope.body);
  // No unverified action status is manufactured by this router.
  return Object.freeze({handled:true,response:answer});
 }
 return Object.freeze({paths:PATHS,handle});
}
if(require.main===module){
 process.stderr.write('source-only native Root route binder; no server, apply or install\\n');
 process.exitCode=78;
}
module.exports=Object.freeze({REQUEST,EXECUTE,PATHS,bind});
