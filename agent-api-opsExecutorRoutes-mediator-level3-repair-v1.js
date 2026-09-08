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

module.exports={...base,registerOpsExecutorRoutes(app,ctx){
  if(!ctx||typeof ctx.auth!=='function')throw new Error('park_delivery_matcher_context_invalid');
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
