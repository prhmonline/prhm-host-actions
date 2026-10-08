'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const route=require('./node1-vm-geometry-agent-api-route-v1');
const V=require('./node1-live-vm-backup-v1').DOMAINS;
const GiB=1024**3;
function evidence({bad=false}={}){
 const domains=['imotion-directadmin','prhm-production'].map((domain,i)=>({
 domain,source:V[domain].source,ok:true,virtualBytes:(i+1)*80*GiB,
 physicalBytes:(i+1)*40*GiB,allocationBytes:(i+1)*60*GiB,
 geometrySource:'qemu-img-info',guestAgentResponsive:true,mountedFilesystems:2,errors:[]
 }));
 if(bad){domains[1].ok=false;domains[1].virtualBytes=null;domains[1].physicalBytes=null;domains[1].allocationBytes=null;domains[1].errors=['guest_agent_error'];domains[1].guestAgentResponsive=false}
 return {schema_version:route.SCHEMA,host:'server1.prhm.ir',readonly:true,production_mutation:false,
 ready_for_deployment:false,all_domains_verified:!bad,totalVirtualBytes:bad?null:240*GiB,domains};
}
function res(){return{code:200,payload:null,status(n){this.code=n;return this},json(x){this.payload=x;return this}}}
test('no arbitrary fields or host input are accepted',()=>{
 for(const x of [{host:'other'},[],{shell:'id'},'test',false])assert.throws(()=>route.emptyPayload(x),/readonly_zero_input_required/);
 assert.deepEqual(route.emptyPayload({}),{});
});
test('authenticated registration with trusted executor only',()=>{
 const routes=[];
 const app={post(...args){routes.push(args)}};
 const auth=()=>{};
 assert.throws(()=>route.registerRoute(app,{auth}),/trusted_node1_reader_missing/);
 route.registerRoute(app,{auth,trustedExecutor:async()=>evidence()});
 assert.equal(routes.length,1);
 assert.equal(routes[0][0],route.ROUTE);
 assert.equal(routes[0][1],auth);
});
test('route calls exactly the fixed operation with zero input and produces sanitized metadata',async()=>{
 const requests=[];
 const handler=route.makeHandler(async(op,payload)=>{requests.push({op,payload});return evidence()});
 const reply=res();
 await handler({body:{}},reply);
 assert.equal(reply.code,200);
 assert.deepEqual(requests,[{op:'node1_vm_geometry_readonly_api_v1',payload:{}}]);
 assert.equal(reply.payload.all_domains_verified,true);
 assert.equal(reply.payload.totalVirtualBytes,240*GiB);
 assert(!JSON.stringify(reply.payload).includes('source'));
});
test('route rejects attempted arbitrary command before contacting backend',async()=>{
 let called=false;
 const handler=route.makeHandler(async()=>{called=true;return evidence()});
 const reply=res();await handler({body:{command:'virsh destroy'}},reply);
 assert.equal(reply.code,400);assert.equal(called,false);
});
test('route fails closed if trusted executor is missing or errors',async()=>{
 assert.throws(()=>route.makeHandler(),/trusted_node1_reader_missing/);
 const h=route.makeHandler(async()=>{throw Error('transport disconnected: secret')});
 const reply=res();await h({body:{}},reply);
 assert.equal(reply.code,409);
 assert(!JSON.stringify(reply.payload).includes('secret'));
});
test('unknown domain and forged all-green state are rejected',()=>{
 const d=evidence();d.domains[1].domain='evil';
 assert.throws(()=>route.validateResult(d),/probe_domain_identity_mismatch/);
 const e=evidence();e.ready_for_deployment=true;
 assert.throws(()=>route.validateResult(e),/probe_invariants_invalid/);
});
test('guest agent failure yields red sanitized evidence, not Green',()=>{
 const d=route.validateResult(evidence({bad:true}));
 assert.equal(d.all_domains_verified,false);
 assert.equal(d.totalVirtualBytes,null);
 assert.equal(d.domains[1].ok,false);
 assert(d.domains[1].errors.includes('guest_agent_error'));
});
test('invalid size, forged total or arbitrary paths rejected',()=>{
 const d=evidence();d.domains[1].physicalBytes=0;
 assert.throws(()=>route.validateResult(d),/probe_green_unverified/);
 const e=evidence();e.totalVirtualBytes=1;
 assert.throws(()=>route.validateResult(e),/probe_total_invalid/);
 const f=evidence();f.domains[0].source='/etc/shadow';
 assert.throws(()=>route.validateResult(f),/probe_disk_path_mismatch/);
});
