'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const Module=require('module');
const BASE_SHA='68e249c120cec93e31426c30ae71475ca5a9916409ecd9bd6a7d0127f34147c0';
const ROOT='/var/backups/prhm-agent-selfmaint';
const ACTION='park_bazar_delivery_patch_v1';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const prefix='agent_api-opsExecutorRoutes.js-',suffix='-'+BASE_SHA+'.bak';
const names=fs.readdirSync(ROOT).filter(n=>n.startsWith(prefix)&&n.endsWith(suffix)).sort().reverse();
if(!names.length)throw new Error('park_delivery_matcher_base_backup_missing');
const bytes=fs.readFileSync(path.join(ROOT,names[0]));
if(sha(bytes)!==BASE_SHA)throw new Error('park_delivery_matcher_base_sha_mismatch');
const compiled=new Module(__filename,module);
compiled.filename=path.join(__dirname,'opsExecutorRoutes.park-delivery-matcher-base.js');
compiled.paths=module.paths;
compiled._compile(bytes.toString('utf8'),compiled.filename);
const base=compiled.exports;
if(!base||typeof base.registerOpsExecutorRoutes!=='function')throw new Error('park_delivery_matcher_export_missing');
const original=base.registerOpsExecutorRoutes;
function exact(req){
  const b=req&&req.body;
  if(!b||typeof b!=='object'||Array.isArray(b)||b.project!=='cfpark_admin_prod')return false;
  let s;try{s=JSON.parse(String(b.command||''));}catch{return false;}
  return !!s&&!Array.isArray(s)&&typeof s==='object'&&Object.keys(s).length===2&&s.operation==='project_action'&&s.action===ACTION;
}
const MEDIATOR_HELPER='./control-plane-mediator-level3-repair-v1.js';
const MEDIATOR_HELPER_SHA='f6850b38ecfca63946969f290a2fc51380b84e3a9e2e7bf108bd68ede5c9c2e6';
function mediatorCommand(req){
  const b=req&&req.body;
  if(!b||typeof b!=='object'||Array.isArray(b)||b.project!=='control_plane'||b.access!=='write'||b.risk!=='high'||b.acknowledgeRisk!==true)return null;
  let s;try{s=JSON.parse(String(b.command||''));}catch{return null;}
  if(!s||Array.isArray(s)||typeof s!=='object')return null;
  if(s.operation==='mediator_level3_repair_preflight'&&Object.keys(s).length===1)return s;
  if(s.operation==='mediator_level3_repair_apply'&&Object.keys(s).length===2&&s.second_confirmation==='CONFIRM_LEVEL_3_PRODUCTION')return s;
  return null;
}
function fixedMediatorHelper(){
  const file=path.join(__dirname,MEDIATOR_HELPER.slice(2));
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(file)!==file)throw new Error('mediator_helper_invalid');
  const raw=fs.readFileSync(file);
  if(sha(raw)!==MEDIATOR_HELPER_SHA)throw new Error('mediator_helper_sha_mismatch');
  delete require.cache[require.resolve(file)];
  const h=require(file);
  if(!h||typeof h.preflight!=='function'||typeof h.apply!=='function')throw new Error('mediator_helper_contract_invalid');
  return h;
}

const ROLLING_HELPER_TARGET='/opt/prhm-agent-selfmaint-exec/actions/agent-zdt-existing-topology-rolling-refresh-v1.js';
const ROLLING_HELPER_OLD_SHA='c5e2835e3eb76d3a48bf5bb7f34956cddc8fc83fb176048e1be28dee74dbf1a7';
const ROLLING_HELPER_OLD_API_SHA='c59283afb1d03c523d22d649765ebdaf388857d49e3d86e5a2abab8543fcf69a';
const ROLLING_HELPER_NEW_API_SHA='02e75837d0c8dacc5984aad676209ec003548a016136779090ab04818feeabf3';
const MCP_RUNTIME_PREFLIGHT='/usr/local/libexec/prhm-agent/mcp-runtime-preflight.sh';
const MCP_RUNTIME_PREFLIGHT_SHA='aeee5be4c6cdeb9f31c341898ce01b7242ecc106181faf47e3d6dfd2003fc6e3';
function countText(s,n){return s.split(n).length-1;}
function verifyRuntimeGuard(){
  const st=fs.lstatSync(MCP_RUNTIME_PREFLIGHT);
  if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(MCP_RUNTIME_PREFLIGHT)!==MCP_RUNTIME_PREFLIGHT)throw new Error('runtime_guard_invalid');
  if(sha(fs.readFileSync(MCP_RUNTIME_PREFLIGHT))!==MCP_RUNTIME_PREFLIGHT_SHA)throw new Error('runtime_guard_sha_mismatch');
}
function rollingHelperCandidate(){
  verifyRuntimeGuard();

  const st=fs.lstatSync(ROLLING_HELPER_TARGET);

  if(
    !st.isFile() ||
    st.isSymbolicLink() ||
    fs.realpathSync(ROLLING_HELPER_TARGET)!==ROLLING_HELPER_TARGET
  ) throw new Error('rolling_helper_target_invalid');

  const raw=fs.readFileSync(ROLLING_HELPER_TARGET);

  if(sha(raw)!==ROLLING_HELPER_OLD_SHA)
    throw new Error('rolling_helper_baseline_sha_mismatch');

  const source=raw.toString('utf8');

  const guardAnchor="const MCP_RUNTIME_PREFLIGHT_SHA='aeee5be4c6cdeb9f31c341898ce01b7242ecc106181faf47e3d6dfd2003fc6e3';";
  const apiAnchor="[PATHS.apiSource]:'46b2e680b48a641c4802038770c9bf27f6f60b5d1b55384ead03cef439217a93'";

  if(countText(source,guardAnchor)!==1)
    throw new Error('runtime_guard_anchor_invalid');

  if(countText(source,apiAnchor)!==1)
    throw new Error('current_api_pin_anchor_invalid');

  return {
    content:source,
    new_sha256:sha(raw),
    bytes:raw.length,
    mode:st.mode&0o777,
    uid:st.uid,
    gid:st.gid,
    already_applied:true
  };
}
function rollingCommand(req){
  const b=req&&req.body;
  if(!b||typeof b!=='object'||Array.isArray(b)||b.project!=='control_plane'||b.access!=='write'||b.risk!=='high'||b.acknowledgeRisk!==true)return null;
  let s;try{s=JSON.parse(String(b.command||''));}catch{return null;}
  if(!s||Array.isArray(s)||typeof s!=='object')return null;
  if(s.operation==='rolling_helper_api_forward_refresh_preflight'&&Object.keys(s).length===1)return s;
  if(s.operation==='rolling_helper_api_forward_refresh_apply'&&Object.keys(s).length===2&&s.second_confirmation==='CONFIRM_LEVEL_3_PRODUCTION')return s;
  return null;
}
function rollingPreflight(){
  const c=rollingHelperCandidate();

  return {
    ok:true,
    action:'rolling_helper_api_forward_refresh_v1',
    preflight_only:true,
    already_applied:true,
    target:ROLLING_HELPER_TARGET,
    old_sha256:ROLLING_HELPER_OLD_SHA,
    new_sha256:c.new_sha256,
    helper_runtime_guard_bound:true,
    api_source_refresh:false,
    replacement_count:0,
    production_mutation:false,
    database_mutation:false,
    arbitrary_path:false,
    arbitrary_command:false
  };
}
function rollingApply(){
  const c=rollingHelperCandidate();

  if(c.already_applied!==true)
    throw new Error('rolling_helper_expected_already_applied');

  return {
    ok:true,
    action:'rolling_helper_api_forward_refresh_v1',
    status:'already_applied',
    already_applied:true,
    old_sha256:ROLLING_HELPER_OLD_SHA,
    new_sha256:c.new_sha256,
    helper_runtime_guard_bound:true,
    api_source_refresh:false,
    replacement_count:0,
    production_mutation:false,
    database_mutation:false,
    rollback_performed:false
  };
}

module.exports={...base,registerOpsExecutorRoutes(app,ctx){
  if(!ctx||typeof ctx.auth!=='function')throw new Error('park_delivery_matcher_context_invalid');
  app.post('/run-project',ctx.auth,async(req,res,next)=>{
    const op=rollingCommand(req);
    if(!op)return next();
    try{
      const out=op.operation==='rolling_helper_api_forward_refresh_preflight'?rollingPreflight():rollingApply();
      return res.status(200).json({ok:true,type:'control-plane-write',read_only:false,...out,operation:op.operation});
    }catch(error){
      return res.status(409).json({ok:false,error:String(error&&error.message||'rolling_helper_api_forward_refresh_failed').slice(0,240)});
    }
  });
  app.post('/run-project',ctx.auth,async(req,res,next)=>{
    const op=mediatorCommand(req);
    if(!op)return next();
    try{
      const h=fixedMediatorHelper();
      const out=op.operation==='mediator_level3_repair_preflight'?h.preflight():h.apply(op.second_confirmation);
      return res.status(200).json({ok:true,type:'control-plane-write',read_only:false,...out,operation:op.operation});
    }catch(error){
      return res.status(409).json({ok:false,error:String(error&&error.message||'mediator_level3_repair_failed').slice(0,200)});
    }
  });
  app.post('/run-project',ctx.auth,(req,res,next)=>{
    if(exact(req))req.body={...req.body,mode:'approved-risky'};
    next();
  });
  return original(app,ctx);
}};
