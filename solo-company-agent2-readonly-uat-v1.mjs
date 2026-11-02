'use strict';
// Source-only, manually invoked, no mutation, no daemon or scheduler.
// Uses the deployed Solo EngineeringAgent implementation and a fixed
// READ-ONLY capability, without changing the installed runtime.
const CAPABILITY='selfmaint_health';
const RELEASE_SHA='0eb43d72aab3f10db22172c8be4c0411cf22d074';
const SOURCE_COMMIT='02966549a751c16b582ce17d15a1e2cf8a22f0fb';
const FILE='/etc/prhm-solo-company/agent2.bearer';
const fail=code=>{throw Object.assign(new Error(code),{code})};
function assertReadOnly(meta){
  const item=meta?.[CAPABILITY];
  if(item?.annotations?.readOnlyHint!==true||
     !item.inputSchema||typeof item.inputSchema!=='object')
    fail('read_only_capability_not_verified');
}
function buildAdapter({client,metadata}){
  if(!client||typeof client.discover!=='function'||typeof client.invoke!=='function')
    fail('read_only_client_missing');
  assertReadOnly(metadata);
  return {
    async plan(workOrder){
      if(workOrder.skill!=='agent2_health_readonly'||workOrder.risk_level!==0||
         workOrder.production_mutation!==false)fail('work_order_out_of_scope');
      const found=await client.discover();
      if(found?.service_ok!==true||
        typeof found.capabilities?.[CAPABILITY]?.input_schema_fingerprint!=='string')
        fail('agent2_readonly_discovery_unhealthy');
      return Object.freeze({capability:CAPABILITY,risk_level:0,production_mutation:false,
        schema_fingerprint:found.capabilities[CAPABILITY].input_schema_fingerprint});
    },
    async execute(workOrder,plan){
      if(plan?.capability!==CAPABILITY||plan?.production_mutation!==false)
        fail('unsafe_agent_plan');
      const answer=await client.invoke(CAPABILITY,{});
      return {summary:'authenticated_agent2_readonly_health',ok:answer?.ok===true,
        service:String(answer?.service||'').slice(0,120),version:String(answer?.version||'').slice(0,120)};
    },
    async verify(workOrder,execution){
      const second=await client.invoke(CAPABILITY,{});
      return {results:[
        {id:'executor_healthy',pass:execution?.ok===true&&second?.ok===true},
        {id:'service_binding_match',pass:execution?.service==='prhm-agent-selfmaint-exec'&&execution.service===second?.service}
      ]};
    },
    async rollback(){fail('readonly_no_rollback_needed')}
  };
}
async function runPilot({client,metadata,EngineeringAgent,createWorkOrder,closureReport}){
  const adapter=buildAdapter({client,metadata});
  if(typeof EngineeringAgent!=='function'||typeof createWorkOrder!=='function'||
     typeof closureReport!=='function')fail('solo_runtime_modules_missing');
  const wo=createWorkOrder({
    id:'solo-agent2-ops-uat-'+Date.now(),company:'prhm',project:'solo-runtime',
    skill:'agent2_health_readonly',
    objective:'Audit the live Agent2 executor using an authenticated read-only workflow',
    risk_level:0,production_mutation:false,success_criteria:['executor_healthy','service_binding_match'],
    retry:{max_attempts:1},rollback:{required:false,strategy:null}
  });
  const result=await new EngineeringAgent({adapter}).run(wo);
  const report=closureReport(result);
  return Object.freeze({
    schema:'prhm.solo.agent2-readonly-uat.v1',release_sha:RELEASE_SHA,
    source_commit:SOURCE_COMMIT,work_order_id:report.work_order_id,
    status:report.final_status,attempts:report.attempts,
    evidence_count:report.evidence_count,attention:report.requires_attention,
    phases:(result.history||[]).map(step=>step.to),
    mutating_capabilities:0,production_work_order_persisted:false,
    production_runtime_restarted:false
  });
}
async function main(){
  if(process.argv.length!==3||process.argv[2]!=='--read-only')
    fail('readonly_mode_required');
  if(process.getuid?.()!==0)fail('privileged_credential_reader_required');
  const base='/opt/prhm-solo-company/src';
  const [{readFile},{createProductionTarget},{McpStreamableHttpHostBridge},
   {HostIntegrationTransport},{ProductionSshAgent2Client},
   {EngineeringAgent,closureReport},{createWorkOrder}]=await Promise.all([
    import('node:fs/promises'),
    import(base+'/service/production-main.js'),
    import(base+'/transports/mcp-streamable-http-host-bridge.js'),
    import(base+'/transports/host-integration-transport.js'),
    import(base+'/clients/production-ssh-agent2-client.js'),
    import(base+'/engineering-agent.js'),
    import(base+'/work-order.js')
  ]);
  const target=await createProductionTarget({
    env:{CREDENTIALS_DIRECTORY:'/etc/prhm-solo-company',
      SOLO_COMPANY_AGENT2_BASE_URL:'http://127.0.0.1:8123'},
    readFileImpl:()=>readFile(FILE,'utf8')
  });
  const bridge=new McpStreamableHttpHostBridge({targetProvider:async()=>target});
  const transport=new HostIntegrationTransport({bridge,allowedMutationCapabilities:[]});
  const client=new ProductionSshAgent2Client({transport,allowedMutationCapabilities:[]});
  const metadata=await bridge.capabilities();
  const result=await runPilot({client,metadata,EngineeringAgent,createWorkOrder,closureReport});
  process.stdout.write(JSON.stringify(result)+'\n');
  if(result.status!=='succeeded')process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  main().catch(error=>{
    process.stderr.write('READONLY_UAT_FAILED='+String(error?.code||'readonly_uat_error').slice(0,96)+'\n');
    process.exitCode=2;
  });
}
export {CAPABILITY,RELEASE_SHA,SOURCE_COMMIT,assertReadOnly,buildAdapter,runPilot};
