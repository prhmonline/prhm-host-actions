import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {DurableAuditQueue,makeBucketId} from './queue.mjs';

const CAPABILITY='selfmaint_health';
const RELEASE='0eb43d72aab3f10db22172c8be4c0411cf22d074';
const ROOT='/opt/prhm-solo-company';
const fail=c=>{throw Object.assign(new Error(c),{code:c})};
export const AUDITOR_ROLE=Object.freeze({name:'Operations Auditor',
  capability:CAPABILITY,risk_level:0,production_mutation:false,allow_mutations:[]});

export function makeAuditorAdapter({client,metadata}){
  if(metadata?.selfmaint_health?.annotations?.readOnlyHint!==true ||
    !metadata.selfmaint_health.inputSchema ||
    typeof client?.discover!=='function'||typeof client?.invoke!=='function')
    fail('auditor_readonly_discovery_not_verified');
  return {
    async plan(wo){
      if(wo?.risk_level!==0||wo?.production_mutation!==false||
        wo.skill!=='ops_agent2_health_audit')fail('auditor_workorder_out_of_scope');
      const found=await client.discover();
      const fingerprint=found?.capabilities?.[CAPABILITY]?.input_schema_fingerprint;
      if(found?.service_ok!==true||!/^[a-f0-9]{64}$/.test(fingerprint||''))
        fail('auditor_schema_discovery_failed');
      return Object.freeze({capability:CAPABILITY,production_mutation:false,
        fingerprint});
    },
    async execute(wo,plan){
      if(plan?.capability!==CAPABILITY||plan?.production_mutation!==false)
        fail('auditor_plan_invalid');
      const r=await client.invoke(CAPABILITY,{});
      return {summary:'fixed_readonly_executor_health',
        ok:r?.ok===true,service:String(r?.service||'').slice(0,90)};
    },
    async verify(wo,execution){
      const r=await client.invoke(CAPABILITY,{});
      return {results:[
        {id:'agent2_healthy',pass:execution.ok===true&&r?.ok===true},
        {id:'executor_identity',pass:execution.service==='prhm-agent-selfmaint-exec'&&r?.service===execution.service}
      ]};
    },
    async rollback(){fail('auditor_rollback_not_applicable')}
  };
}
export async function runOnce({queue,client,metadata,EngineeringAgent,
  createWorkOrder,closureReport,now=Date.now()}={}){
  if(!queue||!client||!EngineeringAgent||!createWorkOrder||!closureReport)
    fail('auditor_dependencies_missing');
  if(await queue.stopped())return {status:'stopped',executed:false};
  const id=makeBucketId(now);
  await queue.schedule(id);
  const claimed=await queue.claim();
  if(!claimed)return {status:'idle',executed:false};
  try{
    // Recheck STOP immediately after claiming, before first MCP invocation.
    if(await queue.stopped()){
      await queue.complete(claimed.id,{status:'failed',errorCode:'kill_switch'});
      return {status:'stopped',executed:false};
    }
    const adapter=makeAuditorAdapter({client,metadata});
    const wo=createWorkOrder({id:claimed.id,company:'prhm',
      project:'solo-company',skill:'ops_agent2_health_audit',
      objective:'Check trusted SSH Agent2 executor health and identity',
      risk_level:0,production_mutation:false,
      success_criteria:['agent2_healthy','executor_identity'],
      retry:{max_attempts:1},rollback:{required:false,strategy:null}});
    const result=await new EngineeringAgent({adapter}).run(wo);
    const report=closureReport(result);
    if(report.final_status!=='succeeded')fail('auditor_verification_failed');
    await queue.complete(claimed.id,{status:'succeeded',summary:'agent2_healthy_verified_twice',evidenceCount:report.evidence_count});
    return {status:'succeeded',id:claimed.id,evidence_count:report.evidence_count,
      mutation_count:0,attempts:claimed.attempts};
  }catch(error){
    const code=/^auditor_[a-z0-9_]+$/.test(String(error?.code||''))?error.code:
      'auditor_execution_failed';
    await queue.complete(claimed.id,{status:'failed',errorCode:code});
    return {status:'failed',id:claimed.id,error_code:code,mutation_count:0};
  }
}
export async function productionOnce({stateDir,credentialsDir}={}){
  if(typeof stateDir!=='string'||!stateDir.startsWith('/var/lib/prhm-solo-auditor')||
    typeof credentialsDir!=='string'||!credentialsDir.startsWith('/run/prhm-solo-auditor'))
    fail('auditor_runtime_paths_invalid');
  if((await readFile(ROOT+'/.release-sha','utf8')).trim()!==RELEASE)
    fail('auditor_runtime_sha_mismatch');
  const [{createProductionTarget},{McpStreamableHttpHostBridge},
    {HostIntegrationTransport},{ProductionSshAgent2Client},
    {EngineeringAgent,closureReport},{createWorkOrder}]=await Promise.all([
    import(ROOT+'/src/service/production-main.js'),
    import(ROOT+'/src/transports/mcp-streamable-http-host-bridge.js'),
    import(ROOT+'/src/transports/host-integration-transport.js'),
    import(ROOT+'/src/clients/production-ssh-agent2-client.js'),
    import(ROOT+'/src/engineering-agent.js'),
    import(ROOT+'/src/work-order.js')
  ]);
  const queue=new DurableAuditQueue({file:stateDir+'/queue.json',
    stopFile:stateDir+'/STOP'});
  if(await queue.stopped())return {status:'stopped',executed:false};
  const target=await createProductionTarget({
    env:{CREDENTIALS_DIRECTORY:credentialsDir,
      SOLO_COMPANY_AGENT2_BASE_URL:'http://127.0.0.1:8123'}});
  const bridge=new McpStreamableHttpHostBridge({targetProvider:async()=>target});
  const transport=new HostIntegrationTransport({bridge,allowedMutationCapabilities:[]});
  const client=new ProductionSshAgent2Client({transport,allowedMutationCapabilities:[]});
  // Tool discovery must independently assert readOnlyHint.
  const metadata=await bridge.capabilities();
  return runOnce({queue,client,metadata,EngineeringAgent,createWorkOrder,closureReport});
}
async function main(){
  if(process.argv.length!==3||!['--once','--status'].includes(process.argv[2]))
    fail('auditor_explicit_mode_required');
  const stateDir=process.env.SOLO_AUDITOR_STATE_DIR;
  if(!stateDir||!stateDir.startsWith('/var/lib/prhm-solo-auditor'))
    fail('auditor_runtime_paths_invalid');
  if(process.argv[2]==='--status'){
    const queue=new DurableAuditQueue({file:stateDir+'/queue.json',
      stopFile:stateDir+'/STOP'});
    const data=await queue.snapshot();
    console.log(JSON.stringify({schema:data.schema,stopped:await queue.stopped(),
      total:data.jobs.length,last:data.jobs.slice(-5).map(x=>({id:x.id,status:x.status,
        attempts:x.attempts,evidence_count:x.evidence_count,updated_at:x.updated_at,error_code:x.error_code}))}));
    return;
  }
  const report=await productionOnce({stateDir,credentialsDir:process.env.CREDENTIALS_DIRECTORY});
  console.log(JSON.stringify(report));
  if(report.status==='failed')process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(error=>{
    console.error('AUDITOR_ERROR='+String(error?.code||'auditor_failed').slice(0,64));
    process.exitCode=2;
  });
}
