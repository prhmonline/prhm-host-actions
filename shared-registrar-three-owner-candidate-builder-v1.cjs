'use strict';
/* Offline-only, immutable-SHA-bound candidate patches to the EXISTING owners.
 * No target files or credentials embedded in this Git source. No install.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const HASH=b=>crypto.createHash('sha256').update(b).digest('hex');
const INPUTS=Object.freeze({
 'base.server.js':['4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406',34422],
 'executor.server.js':['410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0',112811],
 'mcp.hostActionsV2.js':['bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166',12287]
});
function stop(x){throw Error('registrar_owner_candidate_'+x)}
function inject(s,anchor,code){
 if(s.split(anchor).length!==2)stop('source_anchor_missing_or_duplicate');
 return s.replace(anchor,code+'\n'+anchor);
}
function base(s){
 const helpers=String.raw`
/* Five-field registrar signer bridge: separate from legacy one-field v2. */
const REGISTRAR_BRIDGE_PATH='/opt/prhm-agent-selfmaint-exec/actions/shared-registrar-approval-center-bridge-v1.cjs';
function registrarBridge(){return require(REGISTRAR_BRIDGE_PATH)}
function verifyRegistrarBinding(b,consume){
 const keys=['approval_token','principal_id','role','tool','project','environment','action','risk','operation','arguments_sha256'];
 if(consume)keys.push('consumer');
 if(!b||typeof b!=='object'||Array.isArray(b)||
   Object.keys(b).sort().join('|')!==keys.sort().join('|')||
   b.action!=='prhm_action_registry_install_v1'||b.operation!=='host_action.prhm_action_registry_install_v1'||
   b.principal_id!=='mohammad'||b.role!=='mcp-operator'||
   b.project!=='control_plane'||b.environment!=='production'||
   b.tool!=='host_action_v2_apply'||b.risk!=='critical'||
   !/^[0-9a-f]{64}$/.test(b.arguments_sha256||'')||
   typeof b.approval_token!=='string'||b.approval_token.length<120||b.approval_token.length>16384||
   (consume&&b.consumer!=='prhm-agent-selfmaint-exec-host-actions-v2'))
    throw Object.assign(new Error('registrar_signer_binding_invalid'),{status:400});
 return b;
}
/* End fixed issuer bridge */
`;
 const routes=String.raw`
    // These AF_UNIX routes are invoked only by the existing root executor.
    if(req.method==='POST'&&req.url==='/v2/registrar/issuer/request'){
      const payload=registrarBridge().requestPayload(await readBody(req));
      const env=readEnvFile(APPROVAL_CLIENT_ENV);
      if(!env.APPROVAL_REQUEST_TOKEN)throw new Error('approval_request_token_missing');
      const out=approvalHttp('POST','/v1/requests',env.APPROVAL_REQUEST_TOKEN,payload);
      return send(res,201,{ok:true,request:out.request});
    }
    if(req.method==='POST'&&req.url==='/v2/registrar/issuer/decision'){
      const input=await readBody(req);
      if(!input||typeof input!=='object'||Array.isArray(input)||
         Object.keys(input).sort().join('|')!=='decision|request_id')
       throw Object.assign(new Error('registrar_decision_request_schema'),{status:400});
      const d=input.decision;
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.request_id||'')||
         !d||typeof d!=='object'||Array.isArray(d)||
         Object.keys(d).sort().join('|')!=='decision|note|rollback_reference|second_confirmation'||
         d.decision!=='accept'||d.second_confirmation!=='CONFIRM_LEVEL_4_CRITICAL'||
         d.rollback_reference!=='host-action-v2:prhm-action-registry-install-v1:verified-four-owner-restore'||
         d.note!=='Reviewed fixed registrar transaction; critical L4')
       throw Object.assign(new Error('registrar_decision_binding_invalid'),{status:400});
      const env=readEnvFile(APPROVAL_CLIENT_ENV);
      if(!env.APPROVAL_DECISION_TOKEN)throw new Error('approval_decision_token_missing');
      const out=approvalHttp('POST','/v1/requests/'+input.request_id+'/decision',env.APPROVAL_DECISION_TOKEN,d);
      if(!out.approval||typeof out.approval_token!=='string')
       throw Object.assign(new Error('registrar_signer_reply_invalid'),{status:502});
      return send(res,200,{ok:true,approval:out.approval,approval_token:out.approval_token});
    }
    if(req.method==='POST'&&req.url==='/v2/registrar/issuer/validate'){
      const binding=verifyRegistrarBinding(await readBody(req),false);
      const out=await approvalBridge('/v1/validate',binding);
      return send(res,200,{ok:true,valid:out.valid===true});
    }
    if(req.method==='POST'&&req.url==='/v2/registrar/issuer/consume'){
      const binding=verifyRegistrarBinding(await readBody(req),true);
      const out=await approvalBridge('/v1/consume',binding);
      return send(res,200,{ok:true,consumed:out.consumed===true,consumption:out.consumption||null});
    }
`;
 return inject(inject(s,'const HOST_ACTIONS_V2_BASE_MARKER = true;',helpers),
  "    if (req.method === 'POST' && req.url === '/v2/host-actions/request') {",routes);
}
function executor(s){
 const helpers=String.raw`
/* Trusted native dispatcher: immutable hooks must be installed/verified
 * before any registrar request (fail closed before issuer approval). */
const REGISTRAR_DISPATCHER='/opt/prhm-agent-selfmaint-exec/actions/shared-registrar-native-dispatcher-v1.cjs';
const REGISTRAR_HOOKS='/opt/prhm-agent-selfmaint-exec/actions/shared-registrar-native-host-hooks-v1.cjs';
function nativeRegistrar(){
 const hooks=require(REGISTRAR_HOOKS);
 if(typeof hooks.createTrustedHooks!=='function')throw new Error('registrar_host_hooks_missing');
 const installed=hooks.createTrustedHooks();
 if(typeof installed?.nativeInstallerHooks!=='function')throw new Error('registrar_native_installer_hooks_missing');
 return require(REGISTRAR_DISPATCHER).createForExistingRootExecutor({
  approvalCenterTransport:{
   postTypedRequest:p=>callBase('/v2/registrar/issuer/request','POST',p),
   postDecision:(id,decision)=>callBase('/v2/registrar/issuer/decision','POST',{request_id:id,decision}),
   postValidate:p=>callBase('/v2/registrar/issuer/validate','POST',p),
   postConsume:p=>callBase('/v2/registrar/issuer/consume','POST',p)
  },
  nativeInstallerHooks:()=>installed.nativeInstallerHooks(),
  auditMetadata:async e=>{
   if(!e||!['registrar_pending_created','registrar_native_installed'].includes(e.event)||
      !UUID_RE.test(e.request_id||'')||!SHA_RE.test(e.arguments_sha256||''))
     throw new Error('registrar_audit_event_invalid');
   const fd=fs.openSync(path.join(DATA_ROOT,'registrar-audit-v1.jsonl'),'a',0o600);
   try{fs.writeSync(fd,JSON.stringify({event:e.event,request_id:e.request_id,
     arguments_sha256:e.arguments_sha256,policy_version:e.policy_version,
     token_exposed:false,at:new Date().toISOString()})+'\n');fs.fsyncSync(fd)}
   finally{fs.closeSync(fd)}
  }
 });
}
/* End native registrar */
`;
 const routes=String.raw`
    // Dedicated five-field route; legacy one-field v2 is preserved verbatim.
    if(req.method==='POST'&&req.url==='/v2/registrar/request'){
      return json(res,201,await nativeRegistrar().request(await readBody(req)));
    }
    if(req.method==='POST'&&req.url==='/v2/registrar/execute'){
      return json(res,200,await nativeRegistrar().execute(await readBody(req)));
    }
`;
 return inject(inject(s,'const HOST_ACTIONS_V2_EXEC_MARKER = true;',helpers),
  "    if (req.method === 'POST' && req.url === '/v2/host-actions/request') {",routes);
}
function mcp(s){
 const defs=String.raw`
const RegistrarConfirm=z.literal('CONFIRM_LEVEL_4_CRITICAL');
const RegistrarCommit=z.string().regex(/^[a-f0-9]{40}$/);
const RegistrarSha256=z.string().regex(/^[a-f0-9]{64}$/);
`;
 const routes=String.raw`
  // Existing MCP connection; no generic command, endpoint or token input.
  mcp.registerTool('prhm_registrar_request_v1',{
   title:'Request Shared Registrar L4',
   description:'Fixed five-field SHA-bound Registrar approval request.',
   inputSchema:{action:z.literal('prhm_action_registry_install_v1'),
    project:z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/),
    source_commit:RegistrarCommit,manifest_commit:RegistrarCommit,
    manifest_sha256:RegistrarSha256},annotations:REQUEST
  },async args=>textResult(await callExec('/v2/registrar/request','POST',args)));
  mcp.registerTool('prhm_registrar_apply_v1',{
   title:'Apply Signed Shared Registrar L4',
   description:'Consume one signed L4 and apply reviewed immutable source with rollback.',
   inputSchema:{request_id:z.string().uuid(),second_confirmation:RegistrarConfirm},
   annotations:APPLY
  },async args=>textResult(await callExec('/v2/registrar/execute','POST',args,1200000)));
`;
 return inject(inject(s,
  "const Level3Confirmation=z.literal('CONFIRM_LEVEL_3_PRODUCTION');",defs),
  "  mcp.registerTool('host_action_v2_request'",routes);
}
const transforms=Object.freeze({'base.server.js':base,'executor.server.js':executor,'mcp.hostActionsV2.js':mcp});
function buildOne(name,original){
 const pin=INPUTS[name];
 if(!pin||!Buffer.isBuffer(original)||original.length!==pin[1]||HASH(original)!==pin[0])
  stop('pinned_preimage_mismatch:'+name);
 const candidate=Buffer.from(transforms[name](original.toString('utf8')),'utf8');
 if(candidate.length<=original.length||HASH(candidate)===pin[0])
  stop('candidate_unchanged_or_truncated');
 return Object.freeze({name,bytes:candidate,before_sha256:pin[0],after_sha256:HASH(candidate)});
}
function createPrivate(originalDir,candidateDir){
 const input=path.resolve(originalDir),target=path.resolve(candidateDir);
 if(input===target||!fs.statSync(target).isDirectory())stop('unsafe_candidate_target');
 const names=Object.keys(transforms);
 if(names.some(n=>fs.existsSync(path.join(target,n))))stop('candidate_already_exists');
 const candidates=names.map(n=>buildOne(n,fs.readFileSync(path.join(input,n))));
 for(const item of candidates){
  const fd=fs.openSync(path.join(target,item.name),'wx',0o600);
  try{fs.writeSync(fd,item.bytes);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
 }
 return {ok:true,candidate_only:true,production_mutation:false,
  native_hooks_required:true,files:candidates.map(x=>({
   name:x.name,before_sha256:x.before_sha256,
   after_sha256:x.after_sha256,bytes:x.bytes.length
  }))};
}
module.exports=Object.freeze({INPUTS,buildOne,createPrivate});
if(require.main===module){
 try{
  if(process.argv.length!==4)stop('private_source_and_candidate_paths_required');
  process.stdout.write(JSON.stringify(createPrivate(process.argv[2],process.argv[3]))+'\n');
 }catch(e){process.stderr.write(e.message+'\n');process.exitCode=1}
}
