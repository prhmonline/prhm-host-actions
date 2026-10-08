// PRHM_CURRENT_OWNER_BINDING_V1 eyJzY2hlbWFfdmVyc2lvbiI6InByaG0uY3VycmVudC1vd25lci1iaW5kaW5nLWNvbnN1bWVyLnYxIiwiY29uc3VtZXJfaWQiOiJyZWdpc3RyeV9icmlkZ2UiLCJtYW5pZmVzdF9zaGEyNTYiOiJmMWFjMWY0MDY3NzMxMjA5MTdjOGFlYWZkMTRlMjVjYzM5ZTJmYmU3OWRkZTE2NGY1ZTI5NGNlYWJkY2U3MWFiIiwib3duZXJzIjp7InJlZ2lzdHJ5X2Jhc2UiOiJlOTFjMzA2MjUzOTM1M2E3YTlkMDk3YjA4NzdmMWU2MTIwNTFlNGZlOGE0ODljMTAxZWRhYjNlNTZkMjY4YzliIn19
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { registerProjectPlugin as registerBoundImotionVmCreate } from '../plugins/.project-imotion-vm-base-bb818131681fbc51f8f409950bf0806e37e52bbed5fac44e3373560d57d26528.mjs';
import { registerSafeFilesPlugin as registerRawSafeFilesPlugin } from '../plugins/safeFiles.js';
import { registerSoloCompanyRuntimeInstallPlugin } from '../plugins/soloCompanyRuntimeInstall.js';

// PRHM_CURRENT_OWNER_BINDING_BLOCK_V1_BEGIN registry_bridge
const CURRENT_OWNER_BINDING_REGISTRY_BRIDGE=Object.freeze({"schema_version":"prhm.current-owner-binding-consumer.v1","consumer_id":"registry_bridge","manifest_sha256":"f1ac1f406773120917c8aeafd14e25cc39e2fbe79dde164f5e294ceabdce71ab","owners":{"registry_base":"e91c3062539353a7a9d097b0877f1e612051e4fe8a489c101edab3e56d268c9b"}});
const BASE_SHA=CURRENT_OWNER_BINDING_REGISTRY_BRIDGE.owners.registry_base;
// PRHM_CURRENT_OWNER_BINDING_BLOCK_V1_END registry_bridge
const TOOL='imotion_directadmin_vm_create_v1';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const BASE=path.join(HERE,'.registry-imotion-vm-stable-base-'+BASE_SHA+'.mjs');
const BACK='/var/backups/prhm-agent-selfmaint';
const PREFIX='agent_mcp-src_core_registry.js-';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

const PROJECT_SCHEMA_TOOLS=new Set(['safe_file_read','safe_file_upload_start','fast_dev_apply_v1']);
const NODE_RUNTIME_PROJECTS=Object.freeze({
  honartik_front_prod:'/home/honartik/domains/honartik.ir/public_html',
  moeinshow_front_prod:'/home/moeinshow/domains/moeinshow.com/public_html',
  cfpark_front_prod:'/home/cfpark/domains/cfpark.ir/public_html',
  titan_front_prod:'/home/fitness/domains/titanfitness-club.com/public_html'
});
const NODE_RUNTIME_PROJECT=z.enum(Object.keys(NODE_RUNTIME_PROJECTS));
const NODE_BIN='/usr/local/bin/prhm-node20';
const NODE_RO={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};

const NODE1_PATCH='node1_backup_worktree_patch_v1';
const NODE1_TEST='node1_backup_worktree_test_v1';
const NODE1_DIFF='node1_backup_worktree_diff_v1';
const NODE1_OVERRIDE_TOOLS=new Set([NODE1_PATCH,NODE1_TEST,NODE1_DIFF]);
const NODE1_FILE_ENUM=z.enum([
  'node1-backup-implementation-v1.js',
  'test-node1-backup-implementation-v1.js',
  'bootstrap-host-actions-node1-backup-implementation-v1.js'
]);
const HONARTIK_BOUNDARY_PATCH='honartik_staging_privilege_boundary_worktree_patch_v1';
const HONARTIK_BOUNDARY_TEST='honartik_staging_privilege_boundary_worktree_test_v1';
const HONARTIK_BOUNDARY_DIFF='honartik_staging_privilege_boundary_worktree_diff_v1';
const HONARTIK_BOUNDARY_OVERRIDE_TOOLS=new Set([HONARTIK_BOUNDARY_PATCH,HONARTIK_BOUNDARY_TEST,HONARTIK_BOUNDARY_DIFF]);
const HONARTIK_BOUNDARY_FILE_ENUM=z.enum([
  'honartik-staging-privilege-boundary-install-v1.js',
  'test-honartik-staging-privilege-boundary-install-v1.js',
  'bootstrap-host-actions-honartik-staging-privilege-boundary-install-v1.js'
]);

function node1TextResult(value){
  return {content:[{type:'text',text:JSON.stringify(value)}]};
}
function requireNode1Agent(agent){
  if(!agent||typeof agent.callAgent!=='function')throw new Error('node1_backup_agent_bridge_missing');
}
async function node1Call(agent,operation,payload={},timeoutMs=120000){
  requireNode1Agent(agent);
  const command=JSON.stringify({operation,...payload});
  return agent.callAgent('/run-project','POST',{
    project:'control_plane',
    command,
    reason:'Fixed Node1 backup development worktree operation via authenticated Agent API boundary.',
    mode:'project-operator',
    timeoutMs
  });
}
function requireHonartikBoundaryAgent(agent){
  if(!agent||typeof agent.callAgent!=='function')throw new Error('honartik_boundary_agent_bridge_missing');
}
async function honartikBoundaryCall(agent,operation,payload={},timeoutMs=120000){
  requireHonartikBoundaryAgent(agent);
  const command=JSON.stringify({operation,...payload});
  return agent.callAgent('/run-project','POST',{
    project:'control_plane',
    command,
    reason:'Fixed Honartik staging privilege-boundary development worktree operation via authenticated Agent API boundary.',
    mode:'project-operator',
    timeoutMs
  });
}

function ensureBase(){
  try{ if(sha(fs.readFileSync(BASE))===BASE_SHA)return; }catch{}
  const suffix='-'+BASE_SHA+'.bak';
  const name=fs.readdirSync(BACK).filter(item=>item.startsWith(PREFIX)&&item.endsWith(suffix)).sort().reverse()[0];
  if(!name)throw new Error('registry_imotion_vm_base_backup_missing');
  const bytes=fs.readFileSync(path.join(BACK,name));
  if(sha(bytes)!==BASE_SHA)throw new Error('registry_imotion_vm_base_sha_mismatch');
  const tmp=BASE+'.'+process.pid+'.tmp';
  fs.writeFileSync(tmp,bytes,{mode:0o600,flag:'wx'});
  fs.renameSync(tmp,BASE);
  fs.chmodSync(BASE,0o600);
}
ensureBase();
const base=await import(pathToFileURL(BASE).href+'?imotion-vm-stable='+BASE_SHA);
if(typeof base.registerPlugins!=='function')throw new Error('registry_imotion_vm_base_export_missing');

function suppressVmTool(mcp){
  return new Proxy(mcp,{get(target,property){
    if(property==='registerTool')return(name,config,handler)=>{
      if(name===TOOL||NODE1_OVERRIDE_TOOLS.has(name)||HONARTIK_BOUNDARY_OVERRIDE_TOOLS.has(name))return undefined;
      return target.registerTool(name,config,handler);
    };
    if(property==='tool')return(name,description,schema,handler)=>{
      if(name===TOOL||NODE1_OVERRIDE_TOOLS.has(name)||HONARTIK_BOUNDARY_OVERRIDE_TOOLS.has(name))return undefined;
      return target.tool(name,description,schema,handler);
    };
    const value=Reflect.get(target,property,target);
    return typeof value==='function'?value.bind(target):value;
  }});
}

function withProjectSchemas(mcp){
  const extend=(name,schema)=>{
    if(!PROJECT_SCHEMA_TOOLS.has(name))return schema;
    if(!schema||!schema.target||typeof schema.target.safeParse!=='function')throw new Error('project_schema_target_missing_'+name);
    return {...schema,target:z.string().regex(/^[A-Za-z0-9._-]{1,100}$/)};
  };
  return new Proxy(mcp,{get(target,property){
    if(property==='registerTool')return(name,config,handler)=>{
      const next=PROJECT_SCHEMA_TOOLS.has(name)?{...config,inputSchema:extend(name,config?.inputSchema)}:config;
      return target.registerTool(name,next,handler);
    };
    if(property==='tool')return(name,description,schema,handler)=>target.tool(name,description,extend(name,schema),handler);
    const value=Reflect.get(target,property,target);
    return typeof value==='function'?value.bind(target):value;
  }});
}

function vmOnly(mcp){
  let count=0;
  return {proxy:new Proxy(mcp,{get(target,property){
    if(property==='registerTool')return(name,config,handler)=>{
      if(name!==TOOL)return undefined;
      count++;
      return target.registerTool(name,config,handler);
    };
    if(property==='tool')return(name,description,schema,handler)=>{
      if(name!==TOOL)return undefined;
      count++;
      return target.tool(name,description,schema,handler);
    };
    const value=Reflect.get(target,property,target);
    return typeof value==='function'?value.bind(target):value;
  }}),count:()=>count};
}

function boundedString(value,max=200){ return typeof value==='string'?value.slice(0,max):null; }

function readPackageMetadata(root){
  const rootStat=fs.lstatSync(root);
  if(rootStat.isSymbolicLink()||!rootStat.isDirectory())throw new Error('node_runtime_root_invalid');
  const packageFile=path.join(root,'package.json');
  const stat=fs.lstatSync(packageFile);
  if(stat.isSymbolicLink()||!stat.isFile())throw new Error('node_runtime_package_invalid');
  if(stat.size>524288)throw new Error('node_runtime_package_too_large');
  const parsed=JSON.parse(fs.readFileSync(packageFile,'utf8'));
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('node_runtime_package_shape_invalid');
  const nextDeclared=parsed.dependencies?.next??parsed.devDependencies?.next??null;
  const nextPackage=path.join(root,'node_modules','next','package.json');
  let nextInstalled=null;
  try{
    const nextStat=fs.lstatSync(nextPackage);
    if(!nextStat.isSymbolicLink()&&nextStat.isFile()&&nextStat.size<=262144){
      const installed=JSON.parse(fs.readFileSync(nextPackage,'utf8'));
      nextInstalled=boundedString(installed?.version,100);
    }
  }catch{}
  return {
    name:boundedString(parsed.name,200),
    version:boundedString(parsed.version,100),
    package_manager:boundedString(parsed.packageManager,150),
    engines_node:boundedString(parsed.engines?.node,100),
    next_declared:boundedString(nextDeclared,100),
    next_installed:nextInstalled
  };
}

function nodeVersion(){
  const r=spawnSync(NODE_BIN,['--version'],{encoding:'utf8',timeout:5000,maxBuffer:10000,shell:false,env:{PATH:'/usr/local/bin:/usr/bin:/bin',LC_ALL:'C'}});
  if(r.error||r.status!==0)return {available:false,version:null,error_code:r.error?.code||'node_probe_failed'};
  return {available:true,version:boundedString(String(r.stdout||'').trim(),100),error_code:null};
}

function nodeRuntimeProbe(project){
  const root=NODE_RUNTIME_PROJECTS[project];
  if(!root)throw new Error('node_runtime_project_not_allowed');
  try{
    return {ok:true,type:'project-node-runtime-v1',read_only:true,project,root,runtime:nodeVersion(),package:readPackageMetadata(root),build_executed:false,install_executed:false,mutation:false};
  }catch(error){
    return {ok:false,type:'project-node-runtime-v1',read_only:true,project,error:String(error?.message||error).slice(0,300),build_executed:false,install_executed:false,mutation:false};
  }
}


const TICKETING_WAVE4_TASK7_PROJECT='ticketing_core_back_wave4';
const TICKETING_WAVE4_TASK7_MATERIALIZE='TICKETING_CORE_WAVE4_TASK7_MATERIALIZE_V1';
const TICKETING_WAVE4_TASK7_CLEAN_CACHE='TICKETING_CORE_WAVE4_TASK7_CLEAN_CACHE_V1';
const TICKETING_WAVE4_TASK7_RUN='TICKETING_CORE_WAVE4_TASK7_RUN_V1';
const TICKETING_WAVE4_TASK8_RUN='TICKETING_CORE_WAVE4_TASK8_RUN_V1';
const TICKETING_WAVE4_TASK9_RUN='TICKETING_CORE_WAVE4_TASK9_RUN_V1';
const TICKETING_WAVE4_TASK10_RED_RUN='TICKETING_CORE_WAVE4_TASK10_RED_RUN_V1';
const TICKETING_WAVE4_TASK10_GREEN_RUN='TICKETING_CORE_WAVE4_TASK10_GREEN_RUN_V1';
const TICKETING_WAVE4_TASK11_RED_RUN='TICKETING_CORE_WAVE4_TASK11_RED_RUN_V1';
const TICKETING_WAVE4_TASK11_GREEN_RUN='TICKETING_CORE_WAVE4_TASK11_GREEN_RUN_V1';
const TICKETING_WAVE4_TASK12_RED_RUN='TICKETING_CORE_WAVE4_TASK12_RED_RUN_V1';
const TICKETING_WAVE4_TASK12_GREEN_RUN='TICKETING_CORE_WAVE4_TASK12_GREEN_RUN_V1';
const TICKETING_WAVE4_CLOSURE_RUN='TICKETING_CORE_WAVE4_CLOSURE_RUN_V1';
const TICKETING_WAVE4_SAFE_PUSH_RUN='TICKETING_CORE_WAVE4_SAFE_PUSH_RUN_V1';
const PRHM_PROJECT_FACTORY_NEXT_REPAIR='PRHM_PROJECT_FACTORY_NEXT_16_3_5_REPAIR_V1';
const PRHM_PROJECT_FACTORY_WEBPACK_REPAIR='PRHM_PROJECT_FACTORY_NEXT_WEBPACK_REPAIR_V1';
const PRHM_PROJECT_FACTORY_BUILD_WEBPACK_REPAIR='PRHM_PROJECT_FACTORY_NEXT_BUILD_WEBPACK_REPAIR_V1';
const PRHM_PROJECT_FACTORY_NEXT_SECURITY_V2_REPAIR='PRHM_PROJECT_FACTORY_NEXT_SECURITY_V2_REPAIR_V1';
const PRHM_PROJECT_FACTORY_AUDIT_OVERRIDES_REPAIR='PRHM_PROJECT_FACTORY_AUDIT_OVERRIDES_REPAIR_V1';
const PRHM_PROJECT_FACTORY_SHARP_0354_REPAIR='PRHM_PROJECT_FACTORY_SHARP_0354_REPAIR_V1';
const TICKETING_WAVE4_TASK7_HEAD='63230d1dde0ec6a7e7ecd45eaaf5c9312c1f3222';
const TICKETING_WAVE4_TASK7_IMPL_REF='8069fac6fe439521f1fd56165d4edd8d9f722fda';
const TICKETING_WAVE4_TASK7_TEST_REF='1a11edd0a2c637929c65ce61db4ac022314118a5';
const TICKETING_WAVE4_TASK7_ZERO='0'.repeat(64);
const TICKETING_WAVE4_TASK7_FILES=Object.freeze([
  Object.freeze({path:'src/Coupon/CouponEffectPort.php',ref:TICKETING_WAVE4_TASK7_IMPL_REF}),
  Object.freeze({path:'src/Payment/FinalizationCommand.php',ref:TICKETING_WAVE4_TASK7_IMPL_REF}),
  Object.freeze({path:'src/Payment/FinalizationOrchestrator.php',ref:TICKETING_WAVE4_TASK7_IMPL_REF}),
  Object.freeze({path:'src/Payment/FinalizationResult.php',ref:TICKETING_WAVE4_TASK7_IMPL_REF}),
  Object.freeze({path:'src/Ticket/TicketIssuancePort.php',ref:TICKETING_WAVE4_TASK7_IMPL_REF}),
  Object.freeze({path:'tests/Wave4FinalizationTest.php',ref:TICKETING_WAVE4_TASK7_TEST_REF})
]);

function ticketingWave4TextPayload(result,label){
  if(result&&typeof result==='object'&&result.ok===true)return result;
  if(result&&typeof result==='object'&&result.result&&typeof result.result==='object')return result.result;
  const item=result?.content?.find?.(entry=>entry?.type==='text');
  if(!item||typeof item.text!=='string')throw new Error(label+'_text_result_missing');
  let parsed;
  try{parsed=JSON.parse(item.text)}catch{throw new Error(label+'_invalid_json')}
  if(parsed&&typeof parsed==='object'&&parsed.result&&typeof parsed.result==='object')return parsed.result;
  return parsed;
}
function ticketingWave4ProjectStdout(result,label){
  const payload=ticketingWave4TextPayload(result,label);
  if(payload?.ok!==true||typeof payload.stdout!=='string')throw new Error(label+'_project_result_invalid');
  if(Number(payload.exit_code)!==0)throw new Error(label+'_project_exit_'+String(payload.exit_code));
  return payload.stdout;
}
function ticketingWave4CaptureSafe(context){
  const captured=new Map();
  const sink={
    registerTool(name,config,handler){captured.set(name,{config,handler});return undefined;},
    tool(name,description,schema,handler){captured.set(name,{config:{description,inputSchema:schema},handler});return undefined;}
  };
  registerRawSafeFilesPlugin(sink,context);
  return captured;
}
function ticketingWave4DeleteArgs(entry,path,sha256){
  const schema=entry?.config?.inputSchema||{};
  const args={target:TICKETING_WAVE4_TASK7_PROJECT,path};
  if(Object.prototype.hasOwnProperty.call(schema,'expectedSha256'))args.expectedSha256=sha256;
  if(Object.prototype.hasOwnProperty.call(schema,'backup'))args.backup=false;
  return args;
}
async function ticketingWave4ReadOrNull(safe,path){
  const entry=safe.get('safe_file_read');
  if(!entry||typeof entry.handler!=='function')throw new Error('ticketing_wave4_safe_read_missing');
  try{
    const payload=ticketingWave4TextPayload(await entry.handler({
      target:TICKETING_WAVE4_TASK7_PROJECT,path,encoding:'utf8',maxBytes:1000000
    }),'ticketing_wave4_safe_read');
    if(payload?.ok===false)throw new Error(String(payload.error||'ticketing_wave4_safe_read_failed'));
    return payload;
  }catch(error){
    const message=String(error?.message||error);
    if(/ENOENT|not[_ ]found|404|does not exist/i.test(message))return null;
    throw error;
  }
}
async function ticketingWave4DeleteIfPresent(safe,path){
  const current=await ticketingWave4ReadOrNull(safe,path);
  if(current===null)return false;
  const entry=safe.get('safe_file_delete');
  if(!entry||typeof entry.handler!=='function')throw new Error('ticketing_wave4_safe_delete_missing');
  const sha256=String(current.sha256||current?.result?.sha256||'');
  const payload=ticketingWave4TextPayload(
    await entry.handler(ticketingWave4DeleteArgs(entry,path,sha256)),
    'ticketing_wave4_safe_delete'
  );
  if(payload?.ok!==true)throw new Error('ticketing_wave4_safe_delete_failed');
  return true;
}
function ticketingWave4ProjectBridge(mcp,context){
  const safe=ticketingWave4CaptureSafe(context);
  let projectConfig=null,projectHandler=null;
  const proxy=new Proxy(mcp,{get(target,property){
    if(property==='registerTool')return(name,config,handler)=>{
      if(name==='project_exec_v1'){projectConfig=config;projectHandler=handler;return undefined}
      return target.registerTool.call(target,name,config,handler);
    };
    if(property==='tool')return(name,description,schema,handler)=>{
      if(name==='project_exec_v1'){
        projectConfig={title:'Project Exec v1',description,inputSchema:schema};
        projectHandler=handler;
        return undefined;
      }
      return target.tool.call(target,name,description,schema,handler);
    };
    const value=Reflect.get(target,property,target);
    return typeof value==='function'?value.bind(target):value;
  }});
  const install=()=>{
    if(!projectConfig||typeof projectHandler!=='function')throw new Error('ticketing_wave4_project_exec_capture_missing');
    for(const name of ['safe_file_read','safe_file_upload_start','safe_file_upload_chunk','safe_file_upload_commit','safe_file_upload_cancel','safe_file_delete']){
      if(typeof safe.get(name)?.handler!=='function')throw new Error('ticketing_wave4_safe_handler_missing_'+name);
    }
    mcp.registerTool('project_exec_v1',projectConfig,async args=>{
      const command=String(args?.command||'').trim();
      const fixedProject=args?.project===TICKETING_WAVE4_TASK7_PROJECT;
      if(fixedProject&&command===TICKETING_WAVE4_TASK7_RUN){
        const agent=context&&context.agent;
        if(!agent||typeof agent.callAgent!=='function')throw new Error('ticketing_wave4_task7_agent_bridge_missing');
        const out=await agent.callAgent('/run-project','POST',{
          project:TICKETING_WAVE4_TASK7_PROJECT,
          command:TICKETING_WAVE4_TASK7_RUN,
          reason:'Run the fixed Ticketing Core Wave 4 Task 7 runner through the authenticated Agent API boundary.',
          mode:'project-operator',
          timeoutMs:900000
        });
        return {content:[{type:'text',text:typeof out==='string'?out:JSON.stringify(out)}]};
      }
      if(fixedProject&&command===TICKETING_WAVE4_TASK8_RUN){
        const agent=context&&context.agent;
        if(!agent||typeof agent.callAgent!=='function')throw new Error('ticketing_wave4_task8_agent_bridge_missing');
        const out=await agent.callAgent('/run-project','POST',{
          project:TICKETING_WAVE4_TASK7_PROJECT,
          command:TICKETING_WAVE4_TASK8_RUN,
          reason:'Run the fixed Ticketing Core Wave 4 Task 8 reconciliation runner through the authenticated Agent API boundary.',
          mode:'project-operator',
          timeoutMs:900000
        });
        return {content:[{type:'text',text:typeof out==='string'?out:JSON.stringify(out)}]};
      }
      if(fixedProject&&command===TICKETING_WAVE4_TASK9_RUN){
        const agent=context&&context.agent;
        if(!agent||typeof agent.callAgent!=='function')throw new Error('ticketing_wave4_task9_agent_bridge_missing');
        const out=await agent.callAgent('/run-project','POST',{
          project:TICKETING_WAVE4_TASK7_PROJECT,
          command:TICKETING_WAVE4_TASK9_RUN,
          reason:'Run the fixed Ticketing Core Wave 4 Task 9 transaction-safety gate runner through the authenticated Agent API boundary.',
          mode:'project-operator',
          timeoutMs:900000
        });
        return {content:[{type:'text',text:typeof out==='string'?out:JSON.stringify(out)}]};
      }
      if(fixedProject&&command===TICKETING_WAVE4_TASK10_RED_RUN){
        const agent=context&&context.agent;
        if(!agent||typeof agent.callAgent!=='function')throw new Error('ticketing_wave4_task10_agent_bridge_missing');
        const out=await agent.callAgent('/run-project','POST',{
          project:TICKETING_WAVE4_TASK7_PROJECT,
          command:TICKETING_WAVE4_TASK10_RED_RUN,
          reason:'Run the fixed Ticketing Core Wave 4 Task 10 RED owner-identity contract runner through the authenticated Agent API boundary.',
          mode:'project-operator',
          timeoutMs:900000
        });
        return {content:[{type:'text',text:typeof out==='string'?out:JSON.stringify(out)}]};
      }
      if(fixedProject&&command===TICKETING_WAVE4_TASK10_GREEN_RUN){
        const agent=context&&context.agent;
        if(!agent||typeof agent.callAgent!=='function')throw new Error('ticketing_wave4_task10_green_agent_bridge_missing');
        const out=await agent.callAgent('/run-project','POST',{
          project:TICKETING_WAVE4_TASK7_PROJECT,
          command:TICKETING_WAVE4_TASK10_GREEN_RUN,
          reason:'Run the fixed Ticketing Core Wave 4 Task 10 GREEN owner-identity implementation runner through the authenticated Agent API boundary.',
          mode:'project-operator',
          timeoutMs:900000
        });
        return {content:[{type:'text',text:typeof out==='string'?out:JSON.stringify(out)}]};
      }
      if(fixedProject&&command===TICKETING_WAVE4_TASK11_RED_RUN){
        const agent=context&&context.agent;
        if(!agent||typeof agent.callAgent!=='function')throw new Error('ticketing_wave4_task11_red_agent_bridge_missing');
        const out=await agent.callAgent('/run-project','POST',{
          project:TICKETING_WAVE4_TASK7_PROJECT,
          command:TICKETING_WAVE4_TASK11_RED_RUN,
          reason:'Run the fixed Ticketing Core Wave 4 Task 11 RED seat-lock owner-identity contract runner through the authenticated Agent API boundary.',
          mode:'project-operator',
          timeoutMs:900000
        });
        return {content:[{type:'text',text:typeof out==='string'?out:JSON.stringify(out)}]};
      }
      if(fixedProject&&command===TICKETING_WAVE4_TASK11_GREEN_RUN){
        const agent=context&&context.agent;
        if(!agent||typeof agent.callAgent!=='function')throw new Error('ticketing_wave4_task11_green_agent_bridge_missing');
        const out=await agent.callAgent('/run-project','POST',{
          project:TICKETING_WAVE4_TASK7_PROJECT,
          command:TICKETING_WAVE4_TASK11_GREEN_RUN,
          reason:'Run the fixed Ticketing Core Wave 4 Task 11 GREEN seat-lock owner-identity runner through the authenticated Agent API boundary.',
          mode:'project-operator',
          timeoutMs:900000
        });
        return {content:[{type:'text',text:typeof out==='string'?out:JSON.stringify(out)}]};
      }
      if(fixedProject&&command===TICKETING_WAVE4_TASK12_RED_RUN){
        const agent=context&&context.agent;
        if(!agent||typeof agent.callAgent!=='function')throw new Error('ticketing_wave4_task12_red_agent_bridge_missing');
        const out=await agent.callAgent('/run-project','POST',{
          project:TICKETING_WAVE4_TASK7_PROJECT,
          command:TICKETING_WAVE4_TASK12_RED_RUN,
          reason:'Run the fixed Ticketing Core Wave 4 Task 12 RED external-effect crash test runner through the authenticated Agent API boundary.',
          mode:'project-operator',
          timeoutMs:900000
        });
        return {content:[{type:'text',text:typeof out==='string'?out:JSON.stringify(out)}]};
      }
      if(fixedProject&&command===TICKETING_WAVE4_TASK12_GREEN_RUN){
        const agent=context&&context.agent;
        if(!agent||typeof agent.callAgent!=='function')throw new Error('ticketing_wave4_task12_green_agent_bridge_missing');
        const out=await agent.callAgent('/run-project','POST',{
          project:TICKETING_WAVE4_TASK7_PROJECT,
          command:TICKETING_WAVE4_TASK12_GREEN_RUN,
          reason:'Run the fixed Ticketing Core Wave 4 Task 12 GREEN external-effect crash guard implementation runner through the authenticated Agent API boundary.',
          mode:'project-operator',
          timeoutMs:900000
        });
        return {content:[{type:'text',text:typeof out==='string'?out:JSON.stringify(out)}]};
      }
      if(fixedProject&&command===TICKETING_WAVE4_CLOSURE_RUN){
        const agent=context&&context.agent;
        if(!agent||typeof agent.callAgent!=='function')throw new Error('ticketing_wave4_closure_agent_bridge_missing');
        const out=await agent.callAgent('/run-project','POST',{
          project:TICKETING_WAVE4_TASK7_PROJECT,
          command:TICKETING_WAVE4_CLOSURE_RUN,
          reason:'Run the fixed Ticketing Core Wave 4 warning-free closure runner through the authenticated Agent API boundary.',
          mode:'project-operator',
          timeoutMs:900000
        });
        return {content:[{type:'text',text:typeof out==='string'?out:JSON.stringify(out)}]};
      }
      if(fixedProject&&command===TICKETING_WAVE4_SAFE_PUSH_RUN){
        const agent=context&&context.agent;
        if(!agent||typeof agent.callAgent!=='function')throw new Error('ticketing_wave4_safe_push_agent_bridge_missing');
        const out=await agent.callAgent('/run-project','POST',{
          project:TICKETING_WAVE4_TASK7_PROJECT,
          command:TICKETING_WAVE4_SAFE_PUSH_RUN,
          reason:'Run the fixed Ticketing Core Wave 4 non-force push to a new remote branch while preserving the existing remote branch.',
          mode:'project-operator',
          timeoutMs:1200000
        });
        return {content:[{type:'text',text:typeof out==='string'?out:JSON.stringify(out)}]};
      }
      if(fixedProject&&command===PRHM_PROJECT_FACTORY_NEXT_REPAIR){
        const agent=context&&context.agent;
        if(!agent||typeof agent.callAgent!=='function')throw new Error('project_factory_next_repair_agent_bridge_missing');
        const out=await agent.callAgent('/run-project','POST',{
          project:TICKETING_WAVE4_TASK7_PROJECT,
          command:PRHM_PROJECT_FACTORY_NEXT_REPAIR,
          reason:'Run the fixed SHA-bound Project Factory Next.js 16.3.5 security repair.',
          mode:'project-operator',
          timeoutMs:180000
        });
        return {content:[{type:'text',text:typeof out==='string'?out:JSON.stringify(out)}]};
      }
      if(fixedProject&&command===PRHM_PROJECT_FACTORY_WEBPACK_REPAIR){
        const agent=context&&context.agent;
        if(!agent||typeof agent.callAgent!=='function')throw new Error('project_factory_webpack_repair_agent_bridge_missing');
        const out=await agent.callAgent('/run-project','POST',{
          project:TICKETING_WAVE4_TASK7_PROJECT,
          command:PRHM_PROJECT_FACTORY_WEBPACK_REPAIR,
          reason:'Run the fixed SHA-bound Project Factory Webpack compatibility repair for old-glibc hosts.',
          mode:'project-operator',
          timeoutMs:180000
        });
        return {content:[{type:'text',text:typeof out==='string'?out:JSON.stringify(out)}]};
      }
      if(fixedProject&&command===PRHM_PROJECT_FACTORY_BUILD_WEBPACK_REPAIR){
        const agent=context&&context.agent;
        if(!agent||typeof agent.callAgent!=='function')throw new Error('project_factory_build_webpack_repair_agent_bridge_missing');
        const out=await agent.callAgent('/run-project','POST',{
          project:TICKETING_WAVE4_TASK7_PROJECT,
          command:PRHM_PROJECT_FACTORY_BUILD_WEBPACK_REPAIR,
          reason:'Run the fixed SHA-bound Project Factory Next build-script Webpack repair for old-glibc hosts.',
          mode:'project-operator',
          timeoutMs:180000
        });
        return {content:[{type:'text',text:typeof out==='string'?out:JSON.stringify(out)}]};
      }
      if(fixedProject&&command===PRHM_PROJECT_FACTORY_NEXT_SECURITY_V2_REPAIR){
        const agent=context&&context.agent;
        if(!agent||typeof agent.callAgent!=='function')throw new Error('project_factory_next_security_v2_agent_bridge_missing');
        const out=await agent.callAgent('/run-project','POST',{
          project:TICKETING_WAVE4_TASK7_PROJECT,
          command:PRHM_PROJECT_FACTORY_NEXT_SECURITY_V2_REPAIR,
          reason:'Run the fixed SHA-bound Project Factory next-security v2 repair with explicit sharp pin and failure observability.',
          mode:'project-operator',
          timeoutMs:180000
        });
        return {content:[{type:'text',text:typeof out==='string'?out:JSON.stringify(out)}]};
      }
      if(fixedProject&&command===PRHM_PROJECT_FACTORY_AUDIT_OVERRIDES_REPAIR){
        const agent=context&&context.agent;
        if(!agent||typeof agent.callAgent!=='function')throw new Error('project_factory_audit_overrides_agent_bridge_missing');
        const out=await agent.callAgent('/run-project','POST',{
          project:TICKETING_WAVE4_TASK7_PROJECT,
          command:PRHM_PROJECT_FACTORY_AUDIT_OVERRIDES_REPAIR,
          reason:'Run the fixed SHA-bound Project Factory audit override repair with major-preserving brace-expansion pins.',
          mode:'project-operator',
          timeoutMs:180000
        });
        return {content:[{type:'text',text:typeof out==='string'?out:JSON.stringify(out)}]};
      }
      if(fixedProject&&command===PRHM_PROJECT_FACTORY_SHARP_0354_REPAIR){
        const agent=context&&context.agent;
        if(!agent||typeof agent.callAgent!=='function')throw new Error('project_factory_sharp_0354_agent_bridge_missing');
        const out=await agent.callAgent('/run-project','POST',{
          project:TICKETING_WAVE4_TASK7_PROJECT,
          command:PRHM_PROJECT_FACTORY_SHARP_0354_REPAIR,
          reason:'Run the fixed SHA-bound Project Factory sharp 0.35.4 security repair.',
          mode:'project-operator',
          timeoutMs:180000
        });
        return {content:[{type:'text',text:typeof out==='string'?out:JSON.stringify(out)}]};
      }
      if(!fixedProject||![TICKETING_WAVE4_TASK7_MATERIALIZE,TICKETING_WAVE4_TASK7_CLEAN_CACHE].includes(command)){
        return projectHandler(args);
      }
      if(command===TICKETING_WAVE4_TASK7_CLEAN_CACHE){
        const cache=await ticketingWave4ReadOrNull(safe,'.phpunit.result.cache');
        return {content:[{type:'text',text:JSON.stringify({
          ok:true,action:TICKETING_WAVE4_TASK7_CLEAN_CACHE,removed:false,preserved:cache!==null,
          reason:'phpunit cache is non-source and intentionally ignored by the fixed Task 7 precondition',
          project:TICKETING_WAVE4_TASK7_PROJECT,arbitrary_path:false,arbitrary_command:false
        })}]};
      }
      const branch=ticketingWave4ProjectStdout(await projectHandler({...args,command:'git branch --show-current'}),'ticketing_wave4_branch').trim();
      const head=ticketingWave4ProjectStdout(await projectHandler({...args,command:'git rev-parse HEAD'}),'ticketing_wave4_head').trim();
      const status=ticketingWave4ProjectStdout(await projectHandler({...args,command:'git status --short'}),'ticketing_wave4_status');
      if(branch!=='wave4/transaction-safety')throw new Error('ticketing_wave4_branch_mismatch:'+branch);
      if(head!==TICKETING_WAVE4_TASK7_HEAD)throw new Error('ticketing_wave4_head_mismatch:'+head);
      const statusLines=status.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
      const unexpected=statusLines.filter(line=>line!=='?? .phpunit.result.cache');
      if(unexpected.length)throw new Error('ticketing_wave4_worktree_not_clean:'+unexpected.join('|').slice(0,1000));

      const staged=[];
      const committed=[];
      try{
        for(const spec of TICKETING_WAVE4_TASK7_FILES){
          const existing=await ticketingWave4ReadOrNull(safe,spec.path);
          if(existing!==null)throw new Error('ticketing_wave4_target_preexists:'+spec.path);
          const stdout=ticketingWave4ProjectStdout(
            await projectHandler({...args,command:'git show '+spec.ref+':'+spec.path}),
            'ticketing_wave4_reference_'+spec.path.replace(/[^A-Za-z0-9]/g,'_')
          );
          const bytes=Buffer.from(stdout,'utf8');
          const finalSha256=createHash('sha256').update(bytes).digest('hex');
          const start=ticketingWave4TextPayload(await safe.get('safe_file_upload_start').handler({
            target:TICKETING_WAVE4_TASK7_PROJECT,
            path:spec.path,
            backup:false,
            mode:'0644',
            expectedSha256:TICKETING_WAVE4_TASK7_ZERO,
            finalSha256
          }),'ticketing_wave4_upload_start');
          const uploadId=String(start.upload_id||start.uploadId||'');
          if(!/^[0-9a-fA-F-]{36}$/.test(uploadId))throw new Error('ticketing_wave4_upload_id_invalid');
          const chunk=ticketingWave4TextPayload(await safe.get('safe_file_upload_chunk').handler({
            uploadId,sequence:0,chunkBase64:bytes.toString('base64')
          }),'ticketing_wave4_upload_chunk');
          if(chunk?.ok!==true)throw new Error('ticketing_wave4_upload_chunk_failed:'+spec.path);
          staged.push({path:spec.path,uploadId,sha256:finalSha256,bytes:bytes.length,committed:false});
        }
        for(const item of staged){
          const commit=ticketingWave4TextPayload(await safe.get('safe_file_upload_commit').handler({uploadId:item.uploadId}),'ticketing_wave4_upload_commit');
          if(commit?.ok!==true)throw new Error('ticketing_wave4_upload_commit_failed:'+item.path);
          item.committed=true;
          committed.push(item);
        }
      }catch(error){
        for(const item of staged){
          if(item.committed)continue;
          try{await safe.get('safe_file_upload_cancel').handler({uploadId:item.uploadId})}catch{}
        }
        for(const item of committed.slice().reverse()){
          try{
            const del=safe.get('safe_file_delete');
            await del.handler(ticketingWave4DeleteArgs(del,item.path,item.sha256));
          }catch{}
        }
        throw error;
      }
      return {content:[{type:'text',text:JSON.stringify({
        ok:true,
        action:TICKETING_WAVE4_TASK7_MATERIALIZE,
        project:TICKETING_WAVE4_TASK7_PROJECT,
        base_head:TICKETING_WAVE4_TASK7_HEAD,
        implementation_ref:TICKETING_WAVE4_TASK7_IMPL_REF,
        tightened_test_ref:TICKETING_WAVE4_TASK7_TEST_REF,
        files:staged.map(({path,sha256,bytes})=>({path,sha256,bytes})),
        file_count:staged.length,
        official_safe_files_path:true,
        arbitrary_path:false,
        arbitrary_command:false,
        production_mutation:false,
        database_mutation:false
      })}]};
    });
  };
  return {proxy,install};
}

export function registerPlugins(mcp,context){
  mcp.registerTool(NODE1_PATCH,{
    title:'Patch Node1 Backup Development File',
    description:'Create or patch exactly one of three fixed Node1 backup development files in the isolated prhm-host-actions worktree with mandatory SHA binding and automatic rollback. No arbitrary path, host or command input.',
    inputSchema:{
      file:NODE1_FILE_ENUM,
      expected_old_sha256:z.string().regex(/^[a-f0-9]{64}$/),
      expected_new_sha256:z.string().regex(/^[a-f0-9]{64}$/),
      new_content:z.string().max(120000)
    },
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}
  },async args=>node1TextResult(await node1Call(context&&context.agent,'node1_backup_worktree_patch_api_v1',args,120000)));

  mcp.registerTool(NODE1_TEST,{
    title:'Test Node1 Backup Development Contract',
    description:'Run only the fixed Node1 backup development contract test in the isolated worktree. No arbitrary command, host or path input.',
    inputSchema:{},
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
  },async()=>node1TextResult(await node1Call(context&&context.agent,'node1_backup_worktree_test_api_v1',{},120000)));

  mcp.registerTool(NODE1_DIFF,{
    title:'Diff Node1 Backup Development Files',
    description:'Return branch, HEAD, status, diff and SHA metadata only for the three fixed Node1 backup development files.',
    inputSchema:{},
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
  },async()=>node1TextResult(await node1Call(context&&context.agent,'node1_backup_worktree_diff_api_v1',{},120000)));

  mcp.registerTool(HONARTIK_BOUNDARY_PATCH,{
    title:'Patch Honartik Staging Privilege Boundary Development File',
    description:'Create or patch exactly one of three fixed Honartik staging privilege-boundary development files in the isolated prhm-host-actions worktree with mandatory SHA binding and automatic rollback. No arbitrary path, host or command input.',
    inputSchema:{
      file:HONARTIK_BOUNDARY_FILE_ENUM,
      expected_old_sha256:z.string().regex(/^[a-f0-9]{64}$/),
      expected_new_sha256:z.string().regex(/^[a-f0-9]{64}$/),
      new_content:z.string().max(120000)
    },
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}
  },async args=>node1TextResult(await honartikBoundaryCall(context&&context.agent,'honartik_staging_privilege_boundary_worktree_patch_api_v1',args,120000)));

  mcp.registerTool(HONARTIK_BOUNDARY_TEST,{
    title:'Test Honartik Staging Privilege Boundary Development Contract',
    description:'Run only the fixed Honartik staging privilege-boundary contract test in the isolated prhm-host-actions worktree. No arbitrary command, host or path input.',
    inputSchema:{},
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
  },async()=>node1TextResult(await honartikBoundaryCall(context&&context.agent,'honartik_staging_privilege_boundary_worktree_test_api_v1',{},120000)));

  mcp.registerTool(HONARTIK_BOUNDARY_DIFF,{
    title:'Diff Honartik Staging Privilege Boundary Development Files',
    description:'Return branch, HEAD, status, diff and SHA metadata only for the three fixed Honartik staging privilege-boundary development files.',
    inputSchema:{},
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
  },async()=>node1TextResult(await honartikBoundaryCall(context&&context.agent,'honartik_staging_privilege_boundary_worktree_diff_api_v1',{},120000)));
  const ticketingBridge=ticketingWave4ProjectBridge(suppressVmTool(mcp),context);
  let zdtStatusHandler=null,zdtLevel3ApplyHandler=null,zdtLevel3ApplyConfig=null;
  const zdtCaptureMcp=new Proxy(withProjectSchemas(ticketingBridge.proxy),{get(target,prop){
    if(prop==='registerTool'||prop==='tool')return(name,...args)=>{
      const i=args.length-1,handler=args[i];
      if(name==='host_action_v2_status')zdtStatusHandler=handler;
      if(name==='host_action_v2_apply_level3'){zdtLevel3ApplyHandler=handler;zdtLevel3ApplyConfig=args[0];}
      return target[prop](name,...args);
    };
    const value=target[prop];return typeof value==='function'?value.bind(target):value;
  }});
  const result=base.registerPlugins(zdtCaptureMcp,context);
  if(typeof zdtStatusHandler!=='function'||typeof zdtLevel3ApplyHandler!=='function'||!zdtLevel3ApplyConfig)throw new Error('agent_zdt_action_specific_handlers_missing');
  mcp.registerTool('agent_zdt_existing_topology_rolling_refresh_apply_v1',{...zdtLevel3ApplyConfig,title:'Apply Agent ZDT Rolling Refresh',description:'After explicit Level-3 production confirmation, execute only a pending fixed agent_zdt_existing_topology_rolling_refresh_v1 request after exact action, hash, request-id, policy and expiry checks.'},async args=>{
    const statusResult=await zdtStatusHandler({request_id:args.request_id});
    const statusText=statusResult?.content?.find?.(x=>x?.type==='text')?.text;
    let status;try{status=JSON.parse(String(statusText||''))}catch{throw new Error('agent_zdt_status_response_invalid')}
    if(status?.ok!==true||status?.status!=='pending')throw new Error('agent_zdt_request_not_pending');
    if(String(status.request_id||'')!==String(args.request_id||''))throw new Error('agent_zdt_request_id_mismatch');
    if(String(status.action||'')!=='agent_zdt_existing_topology_rolling_refresh_v1')throw new Error('agent_zdt_request_action_mismatch');
    if(String(status.operation||'')!=='host_action.agent_zdt_existing_topology_rolling_refresh_v1')throw new Error('agent_zdt_request_operation_mismatch');
    if(String(status.arguments_sha256||'')!=='038cf86f8148bad455466dd7cc252805c56cded28f9ea1040a662db43f89d076')throw new Error('agent_zdt_request_arguments_sha_mismatch');
    if(Number(status.level)!==3||String(status.risk||'')!=='high')throw new Error('agent_zdt_request_policy_mismatch');
    if(String(status.project||'')!=='control_plane'||String(status.environment||'')!=='production')throw new Error('agent_zdt_request_scope_mismatch');
    const expires=Date.parse(String(status.expires_at||''));if(!Number.isFinite(expires)||Date.now()>=expires)throw new Error('agent_zdt_request_expired');
    return zdtLevel3ApplyHandler(args);
  });
  registerSoloCompanyRuntimeInstallPlugin(mcp, context);
  ticketingBridge.install();
  const filtered=vmOnly(mcp);
  registerBoundImotionVmCreate(filtered.proxy,context);
  if(filtered.count()!==1)throw new Error('registry_imotion_vm_registration_cardinality_'+filtered.count());

  mcp.registerTool('project_node_runtime_v1',{
    title:'Project Node Runtime v1',
    description:'Fixed read-only Node/Next runtime metadata probe for allowlisted frontend projects. Accepts only a project enum; no command, path, build, install, environment, credential or write input.',
    inputSchema:{project:NODE_RUNTIME_PROJECT},
    annotations:NODE_RO
  },async({project})=>({content:[{type:'text',text:JSON.stringify(nodeRuntimeProbe(project))}]}));
  return result;
}
// IMOTION_VM_CREATE_STABLE_REGISTRY_V2_PROJECT_SCHEMAS_NODE_RUNTIME
