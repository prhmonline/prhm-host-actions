import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {z} from 'zod';
import {textResult} from '../core/result.js';

const BASE_SHA='__PRHM_SAFEFILES_BASE_SHA__';
const SOURCE_COMMIT='ed2282e245b5a6e8f72a683e5bdb09cab1972ff9';
const CONFIRM='CONFIRM_LEVEL_4_CRITICAL';
const REQUEST_TOOL='drtarjomeh_v29_bootstrap_request_v1';
const STATUS_TOOL='drtarjomeh_v29_bootstrap_status_v1';
const APPLY_TOOL='drtarjomeh_v29_bootstrap_apply_v1';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const BASE_FILE=path.join(HERE,`.drtarjomeh-v29-bootstrap-base-${BASE_SHA}.mjs`);
const ARTIFACT_ROOT='/home/agent/ssh-mcp-server/.drtarjomeh-v29-root-of-trust-ed2282e2';
const STATE_ROOT='/var/lib/prhm-agent-mcp-bootstrap/drtarjomeh-v29';
const RESULT_PATH='/var/lib/prhm-agent-selfmaint-exec/drtarjomeh-security-release-installer-v1/latest.json';
const INSTALLER=path.join(ARTIFACT_ROOT,'install-host-actions-v29-drtarjomeh-security-release.js');
const TTL_MS=180000;
const EXPECTED=Object.freeze({
  'bootstrap-host-actions-v29-drtarjomeh-security-release-deploy.js':'42d06bd807f0a8ef2466d792c9cfac5ff857c8241ac6c6413035710df1f5a34d',
  'drtarjomeh-security-release-v29-helper-builder.js':'a66a22b742494609686322844892769552868662694210ebb093a9eae54ea12f',
  'install-host-actions-v29-drtarjomeh-security-release.js':'c4aa0858b5761641283adce89270a3223272462cc3cbb0f0f7cda16f92e78401',
  'SOURCE_COMMIT':'d1903f41cbea9942818feaf644983755517bf1764095db558aa6510ffcb64418',
  'SHA256SUMS':'fdf30b4bf104cc91834648b9659c228cbac9a2633fe3e7ca34c12aa3de5ea5bb',
});
const EXPECTED_SUMS=`42d06bd807f0a8ef2466d792c9cfac5ff857c8241ac6c6413035710df1f5a34d  bootstrap-host-actions-v29-drtarjomeh-security-release-deploy.js\na66a22b742494609686322844892769552868662694210ebb093a9eae54ea12f  drtarjomeh-security-release-v29-helper-builder.js\nc4aa0858b5761641283adce89270a3223272462cc3cbb0f0f7cda16f92e78401  install-host-actions-v29-drtarjomeh-security-release.js\n`;
const RO={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
const MUT={readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=code=>{throw new Error(code)};

function stateFile(id){if(!/^[0-9a-f-]{36}$/i.test(String(id||'')))fail('request_id_invalid');return path.join(STATE_ROOT,String(id)+'.json');}
function atomicJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+process.pid+'.'+Date.now()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(tmp,file);fs.chmodSync(file,0o600);}
function readState(id){const file=stateFile(id),st=fs.lstatSync(file);if(st.isSymbolicLink()||!st.isFile()||fs.realpathSync(file)!==file)fail('request_state_invalid');const state=JSON.parse(fs.readFileSync(file,'utf8'));if(state.request_id!==id)fail('request_state_mismatch');return{file,state};}
function fixedRegular(file,expectedSha){const rootReal=fs.realpathSync(ARTIFACT_ROOT),st=fs.lstatSync(file);if(st.isSymbolicLink()||!st.isFile())fail('artifact_not_regular');const real=fs.realpathSync(file);if(!(real===rootReal||real.startsWith(rootReal+path.sep)))fail('artifact_escape');const bytes=fs.readFileSync(real);if(sha(bytes)!==expectedSha)fail('artifact_sha_mismatch');return bytes;}
function verifyArtifact(){
  for(const [name,digest] of Object.entries(EXPECTED))fixedRegular(path.join(ARTIFACT_ROOT,name),digest);
  if(fs.readFileSync(path.join(ARTIFACT_ROOT,'SOURCE_COMMIT'),'utf8')!==SOURCE_COMMIT+'\n')fail('source_commit_mismatch');
  if(fs.readFileSync(path.join(ARTIFACT_ROOT,'SHA256SUMS'),'utf8')!==EXPECTED_SUMS)fail('sha256sums_mismatch');
  return true;
}
function parseLastJson(text){for(const line of String(text||'').trim().split(/\n+/).reverse()){try{return JSON.parse(line)}catch{}}fail('preflight_result_missing');}
function runPreflight(){
  const r=spawnSync('/usr/local/bin/prhm-node',[INSTALLER,'--preflight-only'],{cwd:ARTIFACT_ROOT,encoding:'utf8',timeout:180000,maxBuffer:1024*1024,env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C',HOME:'/nonexistent'}});
  if(r.error||r.status!==0)fail('installer_preflight_failed');
  const out=parseLastJson(r.stdout);
  if(out?.ok!==true||out?.preflight!==true||out?.payload_count!==24||out?.credential_values_returned!==false)fail('installer_preflight_contract_invalid');
  return {ok:true,payload_count:24,credential_values_returned:false};
}
function scheduleInstall(){
  const unit='prhm-drt-v29-bootstrap-'+Date.now();
  const args=['--collect','--unit='+unit,'--property=Type=oneshot','--property=UMask=0077','--property=NoNewPrivileges=true','--property=PrivateTmp=true','--property=ProtectSystem=strict','--property=ProtectHome=read-only','--property=ProtectKernelTunables=true','--property=ProtectKernelModules=true','--property=ProtectControlGroups=true','--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6','--property=ReadWritePaths=/opt/prhm-agent-selfmaint /opt/prhm-agent-selfmaint-exec /opt/prhm-company-control-plane /home/agent/ssh-mcp-server/src/plugins /var/lib/prhm-agent-selfmaint-exec /var/backups/prhm-drtarjomeh-security-release-installer-v1 /run','--setenv=HOME=/home/drtarjomeh','--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','/usr/local/bin/prhm-node',INSTALLER];
  const r=spawnSync('/usr/bin/systemd-run',args,{encoding:'utf8',timeout:30000,maxBuffer:200000,env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C'}});
  if(r.error||r.status!==0)fail('installer_schedule_failed');
  return unit;
}
function request(){const id=crypto.randomUUID(),now=Date.now();const state={ok:true,request_id:id,status:'pending',action:'drtarjomeh_v29_bootstrap_v1',source_commit:SOURCE_COMMIT,level:4,risk:'critical',one_time_use:true,second_confirmation_required:true,created_at:new Date(now).toISOString(),expires_at:new Date(now+TTL_MS).toISOString(),production_application_mutation:false,database_mutation:false,credential_values_returned:false};atomicJson(stateFile(id),state);return state;}
function status(id){const{state}=readState(id);let install_result={present:false};try{const r=JSON.parse(fs.readFileSync(RESULT_PATH,'utf8'));install_result={present:true,ok:r?.ok===true,installed:r?.installed===true,rollback_performed:r?.rollback_performed===true,rollback_verified:r?.rollback_verified!==false,action:String(r?.action||'').slice(0,100)}}catch{}return{...state,expired:Date.now()>Date.parse(state.expires_at),install_result,credential_values_returned:false};}
function apply(id,confirmation){
  if(confirmation!==CONFIRM)fail('critical_second_confirmation_required');
  const{file,state}=readState(id);if(state.status!=='pending')fail('request_not_pending');if(Date.now()>Date.parse(state.expires_at)){state.status='expired';state.consumed_at=new Date().toISOString();atomicJson(file,state);fail('request_expired')}
  state.status='applying';state.consumed_at=new Date().toISOString();atomicJson(file,state);
  try{verifyArtifact();runPreflight();try{fs.unlinkSync(RESULT_PATH)}catch(e){if(e.code!=='ENOENT')throw e}const unit=scheduleInstall();state.status='scheduled';state.unit=unit;state.scheduled_at=new Date().toISOString();state.production_application_mutation=false;state.database_mutation=false;state.credential_values_returned=false;atomicJson(file,state);return state}catch(error){state.status='failed';state.failed_at=new Date().toISOString();state.error=String(error?.message||error).slice(0,160);atomicJson(file,state);throw error}
}

if(!/^[a-f0-9]{64}$/.test(BASE_SHA))throw new Error('drtarjomeh_v29_bootstrap_base_sha_unbound');
const baseBytes=fs.readFileSync(BASE_FILE);if(sha(baseBytes)!==BASE_SHA)throw new Error('drtarjomeh_v29_bootstrap_base_sha_mismatch');
const base=await import(pathToFileURL(BASE_FILE).href+'?drt-v29-bootstrap='+BASE_SHA);
if(typeof base.registerSafeFilesPlugin!=='function')throw new Error('drtarjomeh_v29_bootstrap_base_export_missing');

export function registerSafeFilesPlugin(mcp,context){
  base.registerSafeFilesPlugin(mcp,context);
  mcp.registerTool(REQUEST_TOOL,{title:'Request DrTarjomeh v29 Bootstrap',description:'Create a fixed one-time Level-4 request to install the reviewed DrTarjomeh v29 Host Action artifact. No command, path, revision, URL, credential, or environment input is accepted.',inputSchema:{},annotations:MUT},async()=>textResult(request()));
  mcp.registerTool(STATUS_TOOL,{title:'DrTarjomeh v29 Bootstrap Status',description:'Read bounded status for one fixed v29 bootstrap request.',inputSchema:{request_id:z.string().uuid()},annotations:RO},async args=>textResult(status(args.request_id)));
  mcp.registerTool(APPLY_TOOL,{title:'Apply DrTarjomeh v29 Bootstrap',description:'Consume one pending fixed v29 bootstrap request after explicit Level-4 second confirmation. The reviewed installer is SHA-bound, preflighted, and scheduled in a fixed systemd sandbox.',inputSchema:{request_id:z.string().uuid(),second_confirmation:z.literal(CONFIRM)},annotations:MUT},async args=>textResult(apply(args.request_id,args.second_confirmation)));
}

export const BOOTSTRAP_BRIDGE_CONTRACT=Object.freeze({source_commit:SOURCE_COMMIT,one_time_use:true,production_application_mutation:false,database_mutation:false,credential_values_returned:false});
