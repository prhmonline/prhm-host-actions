'use strict';
// Agent 3 read-only API adapter candidate; Git development only.
// Requires a trusted, pre-registered Node1 read-only executor from the existing Agent API.
// Never creates SSH sessions or runs arbitrary commands itself.
const ROUTE='/node1/vm-geometry/read-only';
const TOOL='node1_vm_geometry_readonly_v1';
const OP='node1_vm_geometry_readonly_api_v1';
const SCHEMA='prhm.node1-vm-geometry-readonly.v1';
const REQUIRED=['prhm-production','imotion-directadmin'];
function invalid(code){throw Error(code)}
function emptyPayload(value){
 if(value===undefined||value===null)return {};
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==0)invalid('readonly_zero_input_required');
 return {};
}
function safeInt(n){return Number.isSafeInteger(n)&&n>0}
function validateResult(value){
 if(!value||typeof value!=='object'||Array.isArray(value))invalid('probe_result_invalid');
 if(value.schema_version!==SCHEMA||value.host!=='server1.prhm.ir'||value.readonly!==true||value.production_mutation!==false||value.ready_for_deployment!==false)
   invalid('probe_invariants_invalid');
 if(!Array.isArray(value.domains)||value.domains.length!==2)invalid('probe_domain_count_invalid');
 const names=value.domains.map(x=>x?.domain);
 if(names.slice().sort().join('|')!==REQUIRED.slice().sort().join('|')||new Set(names).size!==2)invalid('probe_domain_identity_mismatch');
 const domains=value.domains.map(x=>{
   if(typeof x.ok!=='boolean'||x.source!=='/var/lib/libvirt/images/'+x.domain+'.qcow2')invalid('probe_disk_path_mismatch');
   if(!Array.isArray(x.errors)||x.errors.length>16||x.errors.some(e=>typeof e!=='string'||!/^[A-Za-z0-9:_-]{1,128}$/.test(e)))invalid('probe_errors_invalid');
   if(x.ok){
     if(x.errors.length!==0||x.geometrySource!=='qemu-img-info'||x.guestAgentResponsive!==true||
       !safeInt(x.virtualBytes)||!safeInt(x.physicalBytes)||!safeInt(x.allocationBytes)||
       !safeInt(x.mountedFilesystems))invalid('probe_green_unverified');
   }else if(x.errors.length===0)invalid('probe_red_without_reason');
   return Object.freeze({
     domain:x.domain,ok:x.ok,
     virtualBytes:x.ok?x.virtualBytes:null,
     physicalBytes:x.ok?x.physicalBytes:null,
     allocationBytes:x.ok?x.allocationBytes:null,
     geometrySource:x.ok?'qemu-img-info':null,
     guestAgentResponsive:x.ok,
     mountedFilesystems:x.ok?x.mountedFilesystems:0,
     errors:Object.freeze([...x.errors])
   });
 });
 const all=domains.every(x=>x.ok);
 if(value.all_domains_verified!==all)invalid('probe_summary_disagrees');
 const sum=all?domains.reduce((n,x)=>n+x.virtualBytes,0):null;
 if((all&&(!safeInt(sum)||value.totalVirtualBytes!==sum))||(!all&&value.totalVirtualBytes!==null))invalid('probe_total_invalid');
 return Object.freeze({schema_version:SCHEMA,host:'server1.prhm.ir',readonly:true,production_mutation:false,
    ready_for_deployment:false,all_domains_verified:all,totalVirtualBytes:sum,
    domains:Object.freeze(domains),source:'agent3_primary_readonly'});
}
function makeHandler(trustedExecutor){
 if(typeof trustedExecutor!=='function')invalid('trusted_node1_reader_missing');
 return async(req,res)=>{
   try{emptyPayload(req?.body)}
   catch{return res.status(400).json({ok:false,error:'readonly_zero_input_required'})}
   try{
     // Only the fixed operation may be delegated; the existing Agent3 boundary must
     // separately validate host identity and the SHA-pinned deployed runner.
     const result=await trustedExecutor(OP,Object.freeze({}));
     return res.json(validateResult(result));
   }catch{return res.status(409).json({ok:false,error:'node1_readonly_probe_unavailable'})}
 };
}
function registerRoute(app,{auth,trustedExecutor}={}){
 if(!app||typeof app.post!=='function'||typeof auth!=='function')invalid('authenticated_route_required');
 // Not registered unless an explicitly trusted fixed-operation transport exists.
 if(typeof trustedExecutor!=='function')invalid('trusted_node1_reader_missing');
 app.post(ROUTE,auth,makeHandler(trustedExecutor));
 return ROUTE;
}
module.exports={ROUTE,TOOL,OP,SCHEMA,REQUIRED,emptyPayload,validateResult,makeHandler,registerRoute};
