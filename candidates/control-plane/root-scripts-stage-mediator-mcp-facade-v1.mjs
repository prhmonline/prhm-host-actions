import http from 'node:http';

export const FIXED=Object.freeze({
  socket:'/run/prhm-root-scripts-stage-mediator-v1/mediator.sock',
  confirmation:'CONFIRM_LEVEL_4_CRITICAL',
  max_response_bytes:262144,
  tools:Object.freeze({
    preflight:'control_plane_root_scripts_stage_preflight_v1',
    request:'control_plane_root_scripts_stage_request_v1',
    apply:'control_plane_root_scripts_stage_apply_v1'
  })
});

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const preflightToolSchema=()=>({});
export const requestToolSchema=()=>({});
export const applyToolSchema=()=>({
  request_id:{type:'string',format:'uuid'},
  second_confirmation:{type:'string',enum:[FIXED.confirmation]}
});

function validateApply(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('invalid_apply_input');
  const keys=Object.keys(input).sort();
  if(keys.length!==2||keys[0]!=='request_id'||keys[1]!=='second_confirmation')throw new Error('invalid_apply_input');
  if(!UUID.test(String(input.request_id||'')))throw new Error('invalid_request_id');
  if(String(input.second_confirmation||'')!==FIXED.confirmation)throw new Error('critical_second_confirmation_required');
  return {request_id:String(input.request_id),second_confirmation:FIXED.confirmation};
}

export function unixTransport({method,path,body}){
  if(method!=='POST'||!['/v1/preflight','/v1/request','/v1/apply'].includes(path))throw new Error('mediator_route_not_allowed');
  const payload=Buffer.from(JSON.stringify(body||{}));
  return new Promise((resolve,reject)=>{
    const req=http.request({socketPath:FIXED.socket,path,method,headers:{'content-type':'application/json','content-length':String(payload.length)}},res=>{
      const chunks=[];let size=0;
      res.on('data',c=>{size+=c.length;if(size>FIXED.max_response_bytes){req.destroy(new Error('mediator_response_too_large'));return;}chunks.push(c);});
      res.on('end',()=>{
        try{
          const out=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
          if(res.statusCode<200||res.statusCode>=300||out?.ok!==true)throw new Error(String(out?.error||`mediator_rejected_${res.statusCode}`).slice(0,180));
          resolve(out);
        }catch(e){reject(e);}
      });
    });
    req.setTimeout(10000,()=>req.destroy(new Error('mediator_timeout')));
    req.on('error',reject);req.end(payload);
  });
}

export function createMediatorClient({transport=unixTransport}={}){
  if(typeof transport!=='function')throw new Error('mediator_transport_required');
  return Object.freeze({
    preflight:()=>transport({method:'POST',path:'/v1/preflight',body:{}}),
    request:()=>transport({method:'POST',path:'/v1/request',body:{}}),
    apply:input=>transport({method:'POST',path:'/v1/apply',body:validateApply(input)})
  });
}

export function registerMediatorTools(mcp,{transport=unixTransport}={}){
  if(!mcp||typeof mcp.registerTool!=='function')throw new Error('mcp_register_tool_required');
  const client=createMediatorClient({transport});
  mcp.registerTool(FIXED.tools.preflight,{title:'Root Scripts Stage Preflight',description:'Run the fixed read-only preflight against the existing root-scripts stage mediator.',inputSchema:preflightToolSchema()},async()=>client.preflight());
  mcp.registerTool(FIXED.tools.request,{title:'Root Scripts Stage Request',description:'Create a Level-4 approval request for the existing fixed root-scripts stage transport. Zero input.',inputSchema:requestToolSchema()},async()=>client.request());
  mcp.registerTool(FIXED.tools.apply,{title:'Root Scripts Stage Apply',description:'Apply only a previously created fixed root-scripts stage request using the literal Level-4 confirmation.',inputSchema:applyToolSchema()},async input=>client.apply(input));
}
