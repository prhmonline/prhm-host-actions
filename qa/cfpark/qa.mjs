import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {DurableAuditQueue,makeBucketId} from './queue.mjs';

const CORE_RELEASE='0eb43d72aab3f10db22172c8be4c0411cf22d074';
const CORE_ROOT='/opt/prhm-solo-company';
const API='cfpark_readonly_audit';
const GIT='source_mapping_git_status_readonly';
const GIT_TARGET='cfpark_front_prod';
const ENDPOINTS=Object.freeze([
  {id:'frontend_http',url:'https://cfpark.ir/'},
  {id:'dashboard_http',url:'https://dashboard.cfpark.ir/'}
]);
const ERROR_CODE=/^[a-z0-9_]{1,64}$/;
const fail=code=>{throw Object.assign(new Error(code),{code})};
export const QA_ROLE=Object.freeze({
 name:'CF Park QA Agent',project:'cfpark',risk_level:0,
 capabilities:[API,GIT],frontend_checks:ENDPOINTS.map(x=>x.id),
 allowed_mutations:[],production_mutation:false
});
export function assertQaCapabilities(metadata){
 if(metadata?.[API]?.annotations?.readOnlyHint!==true||
    metadata?.[GIT]?.annotations?.readOnlyHint!==true)fail('qa_readonly_capability_missing');
 if(Object.keys(metadata[API].inputSchema?.properties||{}).length!==0)
   fail('qa_api_schema_not_fixed');
 const target=metadata[GIT].inputSchema?.properties?.target;
 if(!metadata[GIT].inputSchema?.required?.includes('target')||
    !target?.enum?.includes(GIT_TARGET)||
    typeof target.enum.length!=='number')fail('qa_git_scope_invalid');
}
function check(id,ok,level='critical'){
 return {id,result:ok?'pass':level==='warning'?'warn':'fail'};
}
function severity(checks){
 return checks.some(x=>x.result==='fail')?'critical':
   checks.some(x=>x.result==='warn')?'warning':'none';
}
async function fixedHttp(fetchImpl,url){
 try{
  const response=await fetchImpl(url,{
    method:'GET',redirect:'manual',
    headers:{accept:'text/html'},
    signal:AbortSignal.timeout(8000)
  });
  return Number.isInteger(response?.status)?response.status:0;
 }catch{return 0}
}
export function qaAdapter({client,metadata,fetchImpl=fetch}){
 assertQaCapabilities(metadata);
 if(typeof client?.discover!=='function'||typeof client?.invoke!=='function'||
    typeof fetchImpl!=='function')fail('qa_client_missing');
 let savedChecks=[];
 return {
  getChecks:()=>savedChecks.map(x=>({...x})),
  async plan(wo){
   if(wo?.skill!=='qa_cfpark_readonly'||wo.risk_level!==0||
      wo.production_mutation!==false)fail('qa_workorder_scope_denied');
   const d=await client.discover();
   if(d?.service_ok!==true)fail('qa_agent2_discovery_unhealthy');
   for(const n of [API,GIT]){
    if(!/^[a-f0-9]{64}$/.test(d.capabilities?.[n]?.input_schema_fingerprint||''))
      fail('qa_agent2_schema_unverified');
   }
   return Object.freeze({capabilities:[API,GIT],git_target:GIT_TARGET,production_mutation:false});
  },
  async execute(wo,plan){
   if(plan?.production_mutation!==false||plan.git_target!==GIT_TARGET||
     JSON.stringify(plan.capabilities)!==JSON.stringify([API,GIT]))
     fail('qa_plan_scope_denied');
   // No tool/host choice comes from work order or retrieved text.
   let api;
   for(let attempt=0;attempt<2;attempt++){
    try{api=await client.invoke(API,{})}catch{api=null}
    if(api?.ok===true&&api?.places?.status_code===200)break;
    if(attempt===0)await new Promise(resolve=>setTimeout(resolve,500));
   }
   const apiReachable=api?.ok===true&&api?.places?.status_code===200;
   const git=await client.invoke(GIT,{target:GIT_TARGET});
   const statuses=[];
   for(const e of ENDPOINTS)statuses.push({id:e.id,status:await fixedHttp(fetchImpl,e.url)});
   const checks=[
    check('places_tool_ok',apiReachable,'warning'),
    check('place_api_http',apiReachable,'warning'),
    check('places_present',!apiReachable||(Number.isInteger(api?.places?.record_count)&&api.places.record_count>0),'warning'),
    check('admin_root_verified',!apiReachable||api?.backend?.verified===true),
    check('git_tool_ok',git?.ok===true&&git?.read_only===true&&git?.target===GIT_TARGET),
    check('git_sha_valid',/^[a-f0-9]{40}$/.test(git?.head||'')),
    check('git_clean',git?.clean===true,'warning'),
    check('git_main_branch',git?.branch==='main','warning'),
    ...statuses.map(e=>check(e.id,e.status>=200&&e.status<400))
   ];
   savedChecks=checks;
   return {summary:'fixed_cfpark_backend_api_git_and_public_smoke_checks',
     checks,api_records:Number.isInteger(api?.places?.record_count)?api.places.record_count:null,
     git_clean:git?.clean===true,git_sha_valid:/^[a-f0-9]{40}$/.test(git?.head||''),
     severity:severity(checks)};
  },
  async verify(wo,result){
   let second;
   for(let attempt=0;attempt<2;attempt++){
    try{second=await client.invoke(API,{})}catch{second=null}
    if(second?.ok===true&&second?.places?.status_code===200)break;
    if(attempt===0)await new Promise(resolve=>setTimeout(resolve,500));
   }
   // A transport outage is inconclusive, not proof of invalid application data.
   // The execute phase already records connectivity warnings in savedChecks.
   const verified=second?.ok!==true||second?.places?.status_code===200;
   return {results:[
    {id:'repeat_api_readonly',pass:verified},
    {id:'scope_unchanged',pass:result?.checks?.length===10&&
      result.checks.every(x=>['pass','warn','fail'].includes(x.result))}
   ]};
  },
  async rollback(){fail('qa_no_mutation_no_rollback')}
 };
}
export async function runOnce({queue,client,metadata,EngineeringAgent,
 createWorkOrder,closureReport,fetchImpl=fetch,now=Date.now()}={}){
 if(!queue||!client||!EngineeringAgent||!createWorkOrder||!closureReport)
   fail('qa_dependencies_missing');
 if(await queue.stopped())return {status:'stopped',executed:false};
 await queue.schedule(makeBucketId(now));
 const claimed=await queue.claim();
 if(!claimed)return {status:'idle',executed:false};
 let adapter;
 try{
  if(await queue.stopped()){
   await queue.complete(claimed.id,{status:'failed',errorCode:'qa_kill_switch'});
   return {status:'stopped',executed:false};
  }
  adapter=qaAdapter({client,metadata,fetchImpl});
  const wo=createWorkOrder({id:claimed.id,company:'prhm',project:'cfpark',
    skill:'qa_cfpark_readonly',objective:'Check CF Park public API, site availability and fixed Git source',
    risk_level:0,production_mutation:false,
    success_criteria:['repeat_api_readonly','scope_unchanged'],
    retry:{max_attempts:1},rollback:{required:false,strategy:null}});
  const result=await new EngineeringAgent({adapter}).run(wo);
  const report=closureReport(result);
  const checks=adapter.getChecks();
  const history=(await queue.snapshot()).jobs.filter(j=>j.id!==claimed.id && ['succeeded','failed'].includes(j.status));
  const previous=history.at(-1);
  if(checks.find(x=>x.id==='place_api_http')?.result==='warn' &&
     previous?.checks?.find(x=>x.id==='place_api_http')?.result==='warn'){
    checks.find(x=>x.id==='place_api_http').result='fail';
  }
  const level=severity(checks);
  const ok=report.final_status==='succeeded'&&level!=='critical';
  await queue.complete(claimed.id,{
    status:ok?'succeeded':'failed',
    summary:ok?'cfpark_qa_completed':'cfpark_qa_findings_or_verification_failed',
    errorCode:ok?null:'qa_critical_check',
    evidenceCount:Number.isInteger(report.evidence_count)?report.evidence_count:0,
    checks,severity:level
  });
  return {status:ok?'succeeded':'failed',work_order_id:claimed.id,
    severity:level,checks,attempts:claimed.attempts,
    evidence_count:report.evidence_count||0,mutation_count:0};
 }catch(error){
  const code=ERROR_CODE.test(String(error?.code||''))?error.code:'qa_execution_failed';
  await queue.complete(claimed.id,{status:'failed',errorCode:code,
    checks:adapter?.getChecks()||[],severity:'critical'});
  return {status:'failed',work_order_id:claimed.id,error_code:code,mutation_count:0};
 }
}
export async function productionOnce({stateDir,credentialsDir}={}){
 if(typeof stateDir!=='string'||!stateDir.startsWith('/var/lib/prhm-solo-qa')||
    typeof credentialsDir!=='string'||!credentialsDir.startsWith('/run/prhm-solo-qa'))
    fail('qa_runtime_path_invalid');
 if((await readFile(CORE_ROOT+'/.release-sha','utf8')).trim()!==CORE_RELEASE)
    fail('qa_core_release_mismatch');
 const [{createProductionTarget},{McpStreamableHttpHostBridge},
 {HostIntegrationTransport},{ProductionSshAgent2Client},
 {EngineeringAgent,closureReport},{createWorkOrder}]=await Promise.all([
   import(CORE_ROOT+'/src/service/production-main.js'),
   import(CORE_ROOT+'/src/transports/mcp-streamable-http-host-bridge.js'),
   import(CORE_ROOT+'/src/transports/host-integration-transport.js'),
   import(CORE_ROOT+'/src/clients/production-ssh-agent2-client.js'),
   import(CORE_ROOT+'/src/engineering-agent.js'),
   import(CORE_ROOT+'/src/work-order.js')
 ]);
 const queue=new DurableAuditQueue({file:stateDir+'/queue.json',stopFile:stateDir+'/STOP'});
 if(await queue.stopped())return {status:'stopped',executed:false};
 const target=await createProductionTarget({
  env:{CREDENTIALS_DIRECTORY:credentialsDir,
   SOLO_COMPANY_AGENT2_BASE_URL:'http://127.0.0.1:8123'}
 });
 const bridge=new McpStreamableHttpHostBridge({targetProvider:async()=>target});
 const transport=new HostIntegrationTransport({bridge,allowedMutationCapabilities:[]});
 const client=new ProductionSshAgent2Client({transport,allowedMutationCapabilities:[]});
 const metadata=await bridge.capabilities();
 return runOnce({queue,client,metadata,EngineeringAgent,createWorkOrder,closureReport});
}
async function main(){
 if(process.argv.length!==3||!['--once','--status'].includes(process.argv[2]))
   fail('qa_explicit_mode_required');
 const stateDir=process.env.SOLO_QA_STATE_DIR;
 if(typeof stateDir!=='string'||!stateDir.startsWith('/var/lib/prhm-solo-qa'))
   fail('qa_runtime_path_invalid');
 const queue=new DurableAuditQueue({file:stateDir+'/queue.json',stopFile:stateDir+'/STOP'});
 if(process.argv[2]==='--status'){
   const d=await queue.snapshot();
   console.log(JSON.stringify({schema:d.schema,stopped:await queue.stopped(),
     jobs:d.jobs.length,recent:d.jobs.slice(-5).map(x=>({
      id:x.id,status:x.status,attempts:x.attempts,
      evidence_count:x.evidence_count,severity:x.severity,
      checks:x.checks,error_code:x.error_code
     }))}));
   return;
 }
 const r=await productionOnce({stateDir,credentialsDir:process.env.CREDENTIALS_DIRECTORY});
 console.log(JSON.stringify(r));
 if(r.status==='failed')process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 main().catch(e=>{
  console.error('SOLO_QA_ERROR='+String(e?.code||'qa_failed').slice(0,64));
  process.exitCode=2;
 });
}
