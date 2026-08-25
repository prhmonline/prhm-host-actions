import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const FIXED=Object.freeze({
  action:'root_scripts_fixed_stage_v1',
  operation:'host_action.root_scripts_fixed_stage_v1',
  rollback:'root-stage-v1:invocation-bound-two-files',
  tool:'root_scripts_fixed_stage_request_v1',
  confirmation:'CONFIRM_LEVEL_4_CRITICAL',
  helper:'/opt/prhm-agent-selfmaint-exec/actions/root-scripts-fixed-stage-v1.js',
  helper_sha256:'50c07d21fb2def962e6f801663f3293ce7c25ba00a410caa039792832910c5ee'
});
export const TARGETS=Object.freeze({
  base:Object.freeze({path:'/opt/prhm-agent-selfmaint/server.js',sha256:'e186036e8efd9c9663b977a20f62fb90cedb70b48bfa0f1fb48cbc53a64020cd'}),
  policy:Object.freeze({path:'/opt/prhm-company-control-plane/config/approval-policy.json',sha256:'76cca4574708709c921d67e91068e9f25508c6769f4d150718c8b068f870233d'}),
  registry:Object.freeze({path:'/home/agent/ssh-mcp-server/src/core/registry.js',sha256:'484005617703516bbba877482330428e3b74ea3b7ce227685506aad11edf7762'})
});
const BACKUP_ROOT='/var/backups/prhm-root-scripts-fixed-stage-action-specific-request-recovery-v1';
const SERVICES=Object.freeze(['prhm-company-approval.service','prhm-agent-selfmaint.service','prhm-agent-mcp.service']);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const clone=v=>JSON.parse(JSON.stringify(v));
function regular(p){const st=fs.lstatSync(p);if(st.isSymbolicLink()||!st.isFile())throw new Error('target_not_regular:'+p);return st}
function exactSha(p,expected){regular(p);const b=fs.readFileSync(p);const a=sha(b);if(a!==expected)throw new Error('baseline_sha_mismatch:'+p+':'+a);return{bytes:b,sha256:a,stat:fs.statSync(p)}}

export function patchBaseSource(source){
  if(source.includes('root_scripts_fixed_stage_v1:'))throw new Error('base_already_registered');
  const anchor="  imotion_credential_bind_v1: { operation: 'host_action.imotion_credential_bind_v1', rollback: 'host-action-v2:imotion-credential-bind-v1:remote-controller-backup-restore' }";
  const count=source.split(anchor).length-1;if(count!==1)throw new Error(count?'base_anchor_ambiguous':'base_anchor_missing');
  const line="  root_scripts_fixed_stage_v1: { operation: 'host_action.root_scripts_fixed_stage_v1', rollback: 'root-stage-v1:invocation-bound-two-files' },\n";
  return source.replace(anchor,line+anchor);
}

export function patchPolicyObject(input){
  const p=clone(input);
  if(p?.schema_version!=='prhm.approval-policy.v1'||!p.operations||typeof p.operations!=='object'||!Array.isArray(p.typed_scopes))throw new Error('policy_schema_invalid');
  if(p.operations[FIXED.operation]||p.typed_scopes.some(x=>x?.action===FIXED.action||x?.operation===FIXED.operation))throw new Error('policy_already_registered');
  const ref=p.typed_scopes.find(x=>x?.tool==='host_action_v2_apply'&&x?.project==='control_plane'&&x?.environment==='production'&&x?.risk==='critical'&&x?.principal_id===undefined&&Array.isArray(x?.principals)&&x.principals.some(y=>y?.principal_id==='mohammad'&&Array.isArray(y?.roles)&&y.roles.includes('mcp-operator')));
  if(!ref)throw new Error('policy_reference_scope_missing');
  p.operations[FIXED.operation]={level:4};
  p.typed_scopes.push({tool:'host_action_v2_apply',project:'control_plane',environment:'production',action:FIXED.action,risk:'critical',operation:FIXED.operation,principals:[{principal_id:'mohammad',roles:['mcp-operator']}]});
  return p;
}

export function patchRegistrySource(source){
  if(source.includes("mcp.registerTool('root_scripts_fixed_stage_request_v1'"))throw new Error('registry_already_registered');
  const decl="    let zdtStatusHandler=null,zdtApplyHandler=null,zdtApplyConfig=null;";
  if(source.split(decl).length-1!==1)throw new Error('registry_anchor_missing');
  let out=source.replace(decl,"    let zdtStatusHandler=null,zdtApplyHandler=null,zdtApplyConfig=null,rootScriptsRequestHandler=null,rootScriptsRequestConfig=null;");
  const req="if(n==='host_action_v2_request'&&p==='registerTool'&&a[0]?.inputSchema){a[0]={...a[0],inputSchema:{...a[0].inputSchema,action:z.string().regex(/^[a-z][a-z0-9_]{0,127}$/)}}}";
  if(out.split(req).length-1!==1)throw new Error('registry_request_anchor_missing');
  const replacement="if(n==='host_action_v2_request'){rootScriptsRequestHandler=fn;rootScriptsRequestConfig=a[0];if(p==='registerTool'&&a[0]?.inputSchema){a[0]={...a[0],inputSchema:{...a[0].inputSchema,action:z.string().regex(/^[a-z][a-z0-9_]{0,127}$/)}}}}";
  out=out.replace(req,replacement);
  const after="    registerHostActionsV2Plugin(zdtMcp, context);";
  if(out.split(after).length-1!==1)throw new Error('registry_hostactions_anchor_missing');
  const tool=`\n    if(typeof rootScriptsRequestHandler!=='function'||!rootScriptsRequestConfig)throw new Error('root_scripts_fixed_stage_request_handler_missing');\n    mcp.registerTool('root_scripts_fixed_stage_request_v1',{...rootScriptsRequestConfig,title:'Request Root Scripts Fixed Stage',description:'Create a Level-4 approval request only for the fixed root_scripts_fixed_stage_v1 action. Zero input; no arbitrary action, path, command, payload, SQL, service, repository, URL or SHA is accepted.',inputSchema:{}},async()=>rootScriptsRequestHandler({action:'root_scripts_fixed_stage_v1'}));`;
  out=out.replace(after,after+tool);
  return out;
}

function buildPatched(){
  const b=exactSha(TARGETS.base.path,TARGETS.base.sha256),p=exactSha(TARGETS.policy.path,TARGETS.policy.sha256),r=exactSha(TARGETS.registry.path,TARGETS.registry.sha256);
  const helper=exactSha(FIXED.helper,FIXED.helper_sha256);
  const base=Buffer.from(patchBaseSource(b.bytes.toString('utf8')),'utf8');
  const policyObj=patchPolicyObject(JSON.parse(p.bytes.toString('utf8')));
  const policy=Buffer.from(JSON.stringify(policyObj,null,2)+'\n','utf8');
  const registry=Buffer.from(patchRegistrySource(r.bytes.toString('utf8')),'utf8');
  return{before:{base:b,policy:p,registry:r,helper},after:{base:{bytes:base,sha256:sha(base)},policy:{bytes:policy,sha256:sha(policy)},registry:{bytes:registry,sha256:sha(registry)}}};
}
function serviceState(){const out={};for(const s of SERVICES){const r=spawnSync('/usr/bin/systemctl',['is-active',s],{encoding:'utf8',timeout:10000});out[s]=String(r.stdout||'').trim();if(r.status!==0||out[s]!=='active')throw new Error('service_not_active:'+s)}return out}
function restartServices(){for(const s of SERVICES){const r=spawnSync('/usr/bin/systemctl',['restart',s],{encoding:'utf8',timeout:30000});if(r.status!==0)throw new Error('service_restart_failed:'+s)}return serviceState()}
function atomicWrite(target,bytes,st){const dir=path.dirname(target),tmp=path.join(dir,'.'+path.basename(target)+'.root-scripts-recovery-'+process.pid+'-'+Date.now());fs.writeFileSync(tmp,bytes,{mode:st.mode&0o777});fs.chmodSync(tmp,st.mode&0o777);try{fs.chownSync(tmp,st.uid,st.gid)}catch{};fs.renameSync(tmp,target)}
function backupName(k){return k==='base'?'prhm-agent-selfmaint-server.js':k==='policy'?'approval-policy.json':'mcp-registry.js'}
export function preflight(){const x=buildPatched();return{ok:true,schema_version:'prhm.root-scripts-fixed-stage-request-recovery-preflight.v1',mode:'read_only',action:FIXED.action,operation:FIXED.operation,tool:FIXED.tool,helper_sha256:x.before.helper.sha256,baseline_sha256:{base:x.before.base.sha256,policy:x.before.policy.sha256,registry:x.before.registry.sha256},post_sha256:{base:x.after.base.sha256,policy:x.after.policy.sha256,registry:x.after.registry.sha256},arbitrary_action:false,arbitrary_path:false,arbitrary_command:false,arbitrary_payload:false,sql:false,external_network:false,executor_mutation:false,helper_mutation:false,application_mutation:false,database_mutation:false}}
export function apply(confirmation){if(confirmation!==FIXED.confirmation)throw new Error('critical_second_confirmation_required');const x=buildPatched();serviceState();const stamp=new Date().toISOString().replace(/[:.]/g,'-'),dir=path.join(BACKUP_ROOT,stamp);fs.mkdirSync(dir,{recursive:true,mode:0o700});const written=[];let rollbackPerformed=false;try{for(const k of ['base','policy','registry']){const t=TARGETS[k],before=x.before[k],after=x.after[k];fs.writeFileSync(path.join(dir,backupName(k)),before.bytes,{mode:0o600});atomicWrite(t.path,after.bytes,before.stat);written.push(k);const got=sha(fs.readFileSync(t.path));if(got!==after.sha256)throw new Error('post_write_sha_mismatch:'+k)}const health=restartServices();return{ok:true,schema_version:'prhm.root-scripts-fixed-stage-request-recovery-result.v1',installed:true,action:FIXED.action,tool:FIXED.tool,post_sha256:Object.fromEntries(['base','policy','registry'].map(k=>[k,x.after[k].sha256])),backup_dir:dir,health,rollback:{performed:false},executor_mutation:false,helper_mutation:false,application_mutation:false,database_mutation:false,arbitrary_action:false,arbitrary_path:false,arbitrary_command:false,arbitrary_payload:false,sql:false,external_network:false}}catch(error){rollbackPerformed=written.length>0;for(const k of written.reverse()){try{atomicWrite(TARGETS[k].path,x.before[k].bytes,x.before[k].stat)}catch{}}try{restartServices()}catch{};throw Object.assign(error,{rollback_performed:rollbackPerformed})}}
function main(){const a=process.argv.slice(2);let out;if(a.length===1&&a[0]==='--preflight')out=preflight();else if(a.length===2&&a[0]==='--apply')out=apply(a[1]);else throw new Error('invalid_arguments');process.stdout.write(JSON.stringify(out)+'\n')}
if(import.meta.url===`file://${process.argv[1]}`)main();
