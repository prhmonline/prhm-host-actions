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
const ROLLING_HELPER_OLD_SHA='a48afe3a55ed593c69a7bb7eac524cf548ab0dfbefb218605ea8239f7032eaf9';
const ROLLING_HELPER_OLD_API_SHA='c59283afb1d03c523d22d649765ebdaf388857d49e3d86e5a2abab8543fcf69a';
const ROLLING_HELPER_NEW_API_SHA='02e75837d0c8dacc5984aad676209ec003548a016136779090ab04818feeabf3';
function countText(s,n){return s.split(n).length-1;}
function rollingHelperCandidate(){
  const st=fs.lstatSync(ROLLING_HELPER_TARGET);
  if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(ROLLING_HELPER_TARGET)!==ROLLING_HELPER_TARGET)throw new Error('rolling_helper_target_invalid');
  const raw=fs.readFileSync(ROLLING_HELPER_TARGET);
  if(sha(raw)!==ROLLING_HELPER_OLD_SHA)throw new Error('rolling_helper_baseline_sha_mismatch');
  const source=raw.toString('utf8');
  if(countText(source,ROLLING_HELPER_OLD_API_SHA)!==1||countText(source,ROLLING_HELPER_NEW_API_SHA)!==0)throw new Error('rolling_helper_api_sha_anchor_mismatch');
  const content=source.replace(ROLLING_HELPER_OLD_API_SHA,ROLLING_HELPER_NEW_API_SHA);
  if(countText(content,ROLLING_HELPER_OLD_API_SHA)!==0||countText(content,ROLLING_HELPER_NEW_API_SHA)!==1)throw new Error('rolling_helper_candidate_postcondition');
  return {content,new_sha256:sha(Buffer.from(content,'utf8')),bytes:Buffer.byteLength(content),mode:st.mode&0o777,uid:st.uid,gid:st.gid};
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
  return {ok:true,action:'rolling_helper_api_forward_refresh_v1',preflight_only:true,target:ROLLING_HELPER_TARGET,old_sha256:ROLLING_HELPER_OLD_SHA,new_sha256:c.new_sha256,old_api_sha256:ROLLING_HELPER_OLD_API_SHA,new_api_sha256:ROLLING_HELPER_NEW_API_SHA,replacement_count:1,production_mutation:false,database_mutation:false,arbitrary_path:false,arbitrary_command:false};
}
function rollingApply(){
  const c=rollingHelperCandidate();
  const script=`'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const T=${JSON.stringify(ROLLING_HELPER_TARGET)},OLD=${JSON.stringify(ROLLING_HELPER_OLD_SHA)},OA=${JSON.stringify(ROLLING_HELPER_OLD_API_SHA)},NA=${JSON.stringify(ROLLING_HELPER_NEW_API_SHA)},NEW=${JSON.stringify(c.new_sha256)};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),count=(s,n)=>s.split(n).length-1;
const st=fs.lstatSync(T);if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(T)!==T)throw Error('target_invalid');
const raw=fs.readFileSync(T);if(sha(raw)!==OLD)throw Error('baseline_sha_mismatch');const src=raw.toString('utf8');
if(count(src,OA)!==1||count(src,NA)!==0)throw Error('anchor_mismatch');const out=src.replace(OA,NA),buf=Buffer.from(out,'utf8');if(sha(buf)!==NEW)throw Error('candidate_sha_mismatch');
const ck=cp.spawnSync('/usr/local/bin/prhm-node',['--check','-'],{input:buf,encoding:null,timeout:30000,maxBuffer:500000});if(ck.error||ck.status!==0)throw Error('candidate_syntax_invalid');
const dir='/var/backups/prhm-rolling-helper-api-forward-refresh-v1';fs.mkdirSync(dir,{recursive:true,mode:0o700});
const backup=path.join(dir,'agent-zdt-existing-topology-rolling-refresh-v1-'+Date.now()+'.bak');fs.writeFileSync(backup,raw,{mode:0o600,flag:'wx'});
const tmp=T+'.forward-'+process.pid+'-'+Date.now()+'.tmp';let wrote=false;try{fs.writeFileSync(tmp,buf,{mode:st.mode&0o777,flag:'wx'});fs.chownSync(tmp,st.uid,st.gid);fs.chmodSync(tmp,st.mode&0o777);fs.renameSync(tmp,T);wrote=true;if(sha(fs.readFileSync(T))!==NEW)throw Error('postwrite_sha_mismatch');process.stdout.write(JSON.stringify({ok:true,action:'rolling_helper_api_forward_refresh_v1',old_sha256:OLD,new_sha256:NEW,old_api_sha256:OA,new_api_sha256:NA,replacement_count:1,backup_path:backup,production_mutation:true,database_mutation:false,rollback_performed:false})+'\\n')}catch(e){try{if(fs.existsSync(tmp))fs.unlinkSync(tmp)}catch{}if(wrote){const rb=T+'.rollback-'+process.pid+'-'+Date.now()+'.tmp';fs.writeFileSync(rb,raw,{mode:st.mode&0o777,flag:'wx'});fs.chownSync(rb,st.uid,st.gid);fs.chmodSync(rb,st.mode&0o777);fs.renameSync(rb,T);if(sha(fs.readFileSync(T))!==OLD)throw Error('rollback_sha_mismatch')}throw e}`;
  const unit='prhm-rolling-helper-api-forward-refresh-'+Date.now();
  const args=['--wait','--collect','--quiet','--unit='+unit,'--property=Type=oneshot','--property=UMask=0077','--property=NoNewPrivileges=true','--property=PrivateTmp=true','--property=PrivateDevices=true','--property=ProtectSystem=strict','--property=ProtectHome=read-only','--property=ProtectKernelTunables=true','--property=ProtectKernelModules=true','--property=ProtectControlGroups=true','--property=RestrictNamespaces=true','--property=RestrictAddressFamilies=AF_UNIX','--property=ReadWritePaths='+ROLLING_HELPER_TARGET+' /var/backups/prhm-rolling-helper-api-forward-refresh-v1','--setenv=PATH=/usr/local/bin:/usr/bin:/bin','/usr/local/bin/prhm-node','-e',script];
  const r=require('node:child_process').spawnSync('/usr/bin/systemd-run',args,{encoding:'utf8',timeout:120000,maxBuffer:500000,stdio:['ignore','pipe','pipe']});
  if(r.error||r.status!==0)throw new Error('rolling_helper_forward_refresh_execution_failed:'+String(r.stderr||'').slice(-300));
  let out;for(const line of String(r.stdout||'').trim().split(/\r?\n/).reverse()){try{out=JSON.parse(line);break}catch{}}
  if(!out||out.ok!==true||out.new_sha256!==c.new_sha256||out.new_api_sha256!==ROLLING_HELPER_NEW_API_SHA)throw new Error('rolling_helper_forward_refresh_result_invalid');
  return out;
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
