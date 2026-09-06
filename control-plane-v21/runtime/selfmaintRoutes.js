'use strict';
const http=require('http');
const path=require('path');

const BASE_FILE=path.join(__dirname,'.selfmaintRoutes-root-stage-request-base-45f22b6879add519c51a0dadaf9840a62b1be3d0301f562f70b92656a89fa8c4.cjs');
const MEDIATOR_SOCKET='/run/prhm-root-scripts-stage-mediator-v1/mediator.sock';
const SELFMAINT_SOCKET='/run/prhm-agent-selfmaint/selfmaint.sock';
const ROUTES=Object.freeze({
  '/selfmaint/request':'/v1/request',
  '/selfmaint/confirm':'/v1/confirm',
  '/selfmaint/apply':'/v1/apply'
});
const REQUEST_ROUTE='/selfmaint/request';
const SENTINEL=Object.freeze({
  target:'agent_api',
  path:'server.js',
  expected_sha256:'7171a63ac5a7e72cd7c0af7d0c90e7d16abd17ed1af623441c44387444e77b23',
  new_content:'/* PRHM_ROOT_SCRIPTS_STAGE_TRANSPORT_REQUEST_SURFACE_V1 */\n',
  reason:'Request fixed control-plane root scripts stage transport approval via mediator.'
});
const MAX_RESPONSE_BYTES=262144;

function fail(code){const e=new Error(code);e.policy=true;throw e;}
function exactSentinel(body){
  if(!body||typeof body!=='object'||Array.isArray(body))return false;
  const keys=Object.keys(body).sort();
  const expected=Object.keys(SENTINEL).sort();
  if(keys.length!==expected.length||keys.some((k,i)=>k!==expected[i]))return false;
  return expected.every(k=>body[k]===SENTINEL[k]);
}
function dispatchKind(route,body){
  if(route===REQUEST_ROUTE&&exactSentinel(body))return 'mediator';
  if(Object.prototype.hasOwnProperty.call(ROUTES,route))return 'base';
  return 'legacy';
}
function requestJson({socketPath,requestPath,body,maxBytes=MAX_RESPONSE_BYTES}){
  return new Promise((resolve,reject)=>{
    const data=Buffer.from(JSON.stringify(body??{}));
    const req=http.request({socketPath,path:requestPath,method:'POST',headers:{'content-type':'application/json','content-length':String(data.length)}},res=>{
      let size=0;const chunks=[];
      res.on('data',c=>{size+=c.length;if(size<=maxBytes)chunks.push(c);});
      res.on('end',()=>{
        if(size>maxBytes)return reject(new Error('selfmaint_proxy_response_too_large'));
        let out={};
        try{out=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}
        catch{return reject(new Error('selfmaint_proxy_invalid_json'));}
        resolve({statusCode:Number(res.statusCode||500),body:out});
      });
    });
    req.setTimeout(15000,()=>req.destroy(new Error('selfmaint_proxy_timeout')));
    req.on('error',reject);
    req.end(data);
  });
}
async function callMediatorRequest(){
  const {statusCode,body:out}=await requestJson({socketPath:MEDIATOR_SOCKET,requestPath:'/v1/request',body:{},maxBytes:65536});
  if(statusCode<200||statusCode>=300||out.ok!==true)throw new Error(String(out.error||'root_stage_mediator_rejected_'+statusCode).slice(0,240));
  const request_id=String(out.request_id||'');
  const m=out.binding_metadata||{};
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request_id))throw new Error('root_stage_mediator_request_id_invalid');
  if(String(m.action||'')!=='control_plane_root_scripts_stage_transport_v1')throw new Error('root_stage_mediator_action_mismatch');
  if(String(m.operation||'')!=='host_action.control_plane_root_scripts_stage_transport_v1')throw new Error('root_stage_mediator_operation_mismatch');
  return {ok:true,type:'control-plane-root-scripts-stage-transport-action-specific-request-surface-v1',request_id,binding_metadata:{action:String(m.action||''),operation:String(m.operation||''),project:String(m.project||''),environment:String(m.environment||''),risk:String(m.risk||''),arguments_sha256:String(m.arguments_sha256||''),level:Number(m.level||0),expires_at:m.expires_at??null},arbitrary_command:false,arbitrary_path:false,token_exposed:false,production_mutation:false};
}
async function proxyBase(route,body){
  const requestPath=ROUTES[route];
  if(!requestPath)fail('selfmaint_proxy_route_not_allowlisted');
  return requestJson({socketPath:SELFMAINT_SOCKET,requestPath,body});
}
function intercept(route){
  return async(req,res,next)=>{
    const kind=dispatchKind(route,req.body);
    if(kind==='legacy')return next();
    try{
      if(kind==='mediator'){const out=await callMediatorRequest();return res.status(201).json(out);}
      const out=await proxyBase(route,req.body);return res.status(out.statusCode).json(out.body);
    }catch(error){
      const status=kind==='mediator'?409:502;
      return res.status(status).json({ok:false,error:String(error&&error.message||error).slice(0,240),proxy:kind==='base'?'prhm-agent-selfmaint':'root-stage-mediator',production_mutation:false});
    }
  };
}
function appProxy(app){
  return new Proxy(app,{get(target,prop){
    if(prop==='post')return(route,...handlers)=>{
      if(!Object.prototype.hasOwnProperty.call(ROUTES,route))return target.post(route,...handlers);
      if(handlers.length<2||typeof handlers[0]!=='function')fail('selfmaint_proxy_auth_handler_missing');
      return target.post(route,handlers[0],intercept(route),...handlers.slice(1));
    };
    const value=target[prop];
    return typeof value==='function'?value.bind(target):value;
  }});
}

const base=require(BASE_FILE);
function registerSelfmaintRoutes(app,ctx){return base.registerSelfmaintRoutes(appProxy(app),ctx);}
module.exports={...base,registerSelfmaintRoutes,__selfmaintLevel3ProxyTest:{exactSentinel,SENTINEL,ROUTES,dispatchKind}};
