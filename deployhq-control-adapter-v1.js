#!/usr/bin/env node
'use strict';


const crypto=require('node:crypto');
const DEPLOYHQ_ORIGIN='https://mohammad-heidarypur.deployhq.com';
const DEPLOYHQ_PROJECT='/projects/prhm-host-actions';
function credentialPaths(env=process.env){
  const dir=env&&env.CREDENTIALS_DIRECTORY;
  if(!dir) throw new Error('credentials_directory_missing');
  return {email:dir.replace(/\/$/,'')+'/deployhq_email',apiKey:dir.replace(/\/$/,'')+'/deployhq_api_key'};
}
function fp12(buf){return crypto.createHash('sha256').update(buf).digest('hex').slice(0,12)}
function credentialEvidence({email,apiKey}){
  const eb=Buffer.isBuffer(email)?email:Buffer.from(email||'');
  const kb=Buffer.isBuffer(apiKey)?apiKey:Buffer.from(apiKey||'');
  return {credential_present:eb.length>0&&kb.length>0,email_length:eb.length,api_key_length:kb.length,email_fingerprint:eb.length?fp12(eb):null,api_key_fingerprint:kb.length?fp12(kb):null};
}
function safeError(err,email,apiKey){
  let msg=String(err&&err.message||err||'deployhq_request_failed');
  for(const secret of [email,apiKey]) if(secret) msg=msg.split(String(secret)).join('[REDACTED]');
  msg=String(redact(msg));
  const e=new Error(msg); e.code='deployhq_request_failed'; return e;
}
function createDeployHQClient({email,apiKey,request}){
  email=Buffer.isBuffer(email)?email.toString('utf8').trim():String(email||'').trim();
  apiKey=Buffer.isBuffer(apiKey)?apiKey.toString('utf8').trim():String(apiKey||'').trim();
  if(!email||!apiKey) throw new Error('deployhq_credential_missing');
  if(typeof request!=='function') throw new Error('deployhq_request_adapter_missing');
  const authorization='Basic '+Buffer.from(email+':'+apiKey).toString('base64');
  async function call(method,path,body){
    try{
      const r=await request({origin:DEPLOYHQ_ORIGIN,method,path,headers:{accept:'application/json','content-type':'application/json',authorization},body});
      if(!r||r.status<200||r.status>=300) throw new Error('deployhq_http_'+String(r&&r.status||'unknown'));
      return redact(r.json);
    }catch(err){throw safeError(err,email,apiKey)}
  }
  return Object.freeze({
    listServers:async()=>{const j=await call('GET',DEPLOYHQ_PROJECT+'/servers');const arr=Array.isArray(j)?j:(j&&j.servers)||[];return arr.map(normalizeServer)},
    createFixedServer:async()=>normalizeServer(await call('POST',DEPLOYHQ_PROJECT+'/servers',{server:FIXED_NODE1})),
    deleteCreatedServer:async(identifier)=>{if(!/^[0-9a-f-]{36}$/i.test(String(identifier||''))&&!/^new\d+$/.test(String(identifier||''))) throw new Error('invalid_created_identifier');return call('DELETE',DEPLOYHQ_PROJECT+'/servers/'+encodeURIComponent(identifier))},
    deploymentSnapshot:async()=>{const j=await call('GET',DEPLOYHQ_PROJECT+'/deployments');const arr=(j&&j.records)||j&&j.deployments||[];return {count:arr.length,last:arr[0]&&arr[0].identifier||null}},
    commandSnapshot:async()=>{const j=await call('GET',DEPLOYHQ_PROJECT+'/commands');const arr=(j&&j.commands)||[];return {count:arr.length,last:arr[0]&&arr[0].identifier||null}},
  });
}

const FIXED_NODE1=Object.freeze({
  name:'PRHM Host Bootstrap - node1',
  hostname:'185.191.76.138',
  port:22022,
  username:'root',
  protocol_type:'ssh',
  server_path:'/root',
  branch:'main',
  auto_deploy:false,
});
const FIXED_KEYS=Object.keys(FIXED_NODE1);
const SECRET_KEY_RE=/(authorization|token|secret|password|private.?key|api.?key)/i;
const SECRET_VALUE_RE=/bearer\s+[A-Za-z0-9._~+\/-]{8,}/i;
const TEMP_RE=/^TEMP Honartik iTicket V14 /;
function redact(value,key=''){
  if(SECRET_KEY_RE.test(String(key))) return '[REDACTED]';
  if(Array.isArray(value)) return value.map(v=>redact(v));
  if(value&&typeof value==='object'){
    const out={}; for(const [k,v] of Object.entries(value)) out[k]=redact(v,k); return out;
  }
  if(typeof value==='string'&&SECRET_VALUE_RE.test(value)) return '[REDACTED]';
  return value;
}
function normalizeServer(server){
  const out={identifier:server&&server.identifier};
  for(const k of FIXED_KEYS) out[k]=server&&server[k];
  return out;
}
function matchesFixed(server){return FIXED_KEYS.every(k=>server&&server[k]===FIXED_NODE1[k]);}
function classifyCanonical(servers){
  const same=(servers||[]).filter(s=>s&&s.name===FIXED_NODE1.name);
  if(!same.length) return {state:'absent'};
  const exact=same.filter(matchesFixed);
  if(exact.length===1&&same.length===1) return {state:'exact',identifier:exact[0].identifier};
  return {state:'conflict',identifiers:same.map(s=>s.identifier).filter(Boolean)};
}
function tempIds(servers){return (servers||[]).filter(s=>TEMP_RE.test(String(s&&s.name||''))).map(s=>s.identifier).filter(Boolean).sort();}
function sameJson(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function send(res,status,obj){const body=JSON.stringify(redact(obj));res.statusCode=status;res.setHeader('content-type','application/json');res.end(body)}
function readJson(req){return new Promise((resolve,reject)=>{let body='';req.on('data',d=>{body+=d;if(body.length>8192) reject(new Error('request_too_large'))});req.on('end',()=>{if(!body)return resolve(undefined);try{resolve(JSON.parse(body))}catch{reject(new Error('invalid_json'))}});req.on('error',reject)})}
function snapEqual(a,b){return JSON.stringify(a||{})===JSON.stringify(b||{})}
function createAdapter(deps){
  const need=['listServers','createFixedServer','deleteCreatedServer','deploymentSnapshot','commandSnapshot'];
  for(const k of need) if(!deps||typeof deps[k]!=='function') throw new Error('missing_dependency_'+k);
  return async function handler(req,res){
    try{
      const url=new URL(req.url,'http://127.0.0.1');
      if(req.method==='GET'&&url.pathname==='/health') return send(res,200,{ok:true,service:'prhm-deployhq-control-core'});
      if(req.method==='GET'&&url.pathname==='/v1/node1'){
        const servers=await deps.listServers(); const c=classifyCanonical(servers);
        return send(res,200,{ok:true,canonical:c,temp_honartik_ids:tempIds(servers),servers:(servers||[]).map(normalizeServer)});
      }
      if(req.method!=='POST'||url.pathname!=='/v1/node1/create-fixed') return send(res,404,{ok:false,error:'route_not_allowed'});
      const body=await readJson(req); if(body!==undefined&&(body===null||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)) return send(res,400,{ok:false,error:'fixed_contract_override_forbidden'});
      const beforeServers=await deps.listServers();
      const canonical=classifyCanonical(beforeServers);
      if(canonical.state==='conflict') return send(res,409,{ok:false,error:'canonical_name_conflict'});
      if(canonical.state==='exact') return send(res,200,{ok:true,canonical_created:false,canonical_identifier:canonical.identifier,config_match:true,deployment_executed:false,command_executed:false,honartik_targets_mutated:false,rollback_performed:false});
      const beforeTemp=tempIds(beforeServers), beforeDep=await deps.deploymentSnapshot(), beforeCmd=await deps.commandSnapshot();
      let createdId=null;
      try{
        const created=await deps.createFixedServer(); createdId=created&&created.identifier;
        if(!createdId) throw Object.assign(new Error('canonical_create_failed'),{code:'canonical_create_failed'});
        const afterServers=await deps.listServers();
        const afterTemp=tempIds(afterServers), afterDep=await deps.deploymentSnapshot(), afterCmd=await deps.commandSnapshot();
        let error=null;
        if(!sameJson(beforeTemp,afterTemp)) error='honartik_targets_changed';
        else if(!snapEqual(beforeDep,afterDep)) error='unexpected_deployment_side_effect';
        else if(!snapEqual(beforeCmd,afterCmd)) error='unexpected_command_side_effect';
        else {
          const readback=classifyCanonical(afterServers);
          if(readback.state!=='exact'||readback.identifier!==createdId) error='canonical_config_mismatch';
        }
        if(error){await deps.deleteCreatedServer(createdId);return send(res,409,{ok:false,error,rollback_performed:true,canonical_identifier:createdId});}
        return send(res,201,{ok:true,canonical_created:true,canonical_identifier:createdId,config_match:true,deployment_executed:false,command_executed:false,honartik_targets_mutated:false,rollback_performed:false});
      }catch(err){
        if(createdId){try{await deps.deleteCreatedServer(createdId)}catch(rollbackErr){return send(res,500,{ok:false,error:'rollback_failed',rollback_failed:true})}}
        return send(res,502,{ok:false,error:err&&err.code||'canonical_create_failed'});
      }
    }catch(err){return send(res,400,{ok:false,error:err&&err.message||'bad_request'})}
  }
}

const fs=require('node:fs');
const http=require('node:http');
const https=require('node:https');
const LISTEN=Object.freeze({host:'127.0.0.1',port:8791});
function validateListen(v){if(!v||v.host!=='127.0.0.1'||v.port!==8791)throw new Error('non_loopback_bind_forbidden');return true}
function httpsRequest({origin,method,path,headers,body}){
  if(origin!==DEPLOYHQ_ORIGIN) return Promise.reject(new Error('deployhq_origin_forbidden'));
  return new Promise((resolve,reject)=>{
    const u=new URL(path,origin); const payload=body===undefined?null:Buffer.from(JSON.stringify(body));
    const req=https.request({protocol:u.protocol,hostname:u.hostname,port:u.port||443,path:u.pathname+u.search,method,headers:{...headers,...(payload?{'content-length':String(payload.length)}:{})},timeout:15000},res=>{
      let size=0,chunks=[];res.on('data',d=>{size+=d.length;if(size>1024*1024){req.destroy(new Error('deployhq_response_too_large'));return}chunks.push(d)});res.on('end',()=>{const text=Buffer.concat(chunks).toString('utf8');let json={};if(text){try{json=JSON.parse(text)}catch{return reject(new Error('deployhq_invalid_json'))}}resolve({status:res.statusCode,json})});
    }); req.on('timeout',()=>req.destroy(new Error('deployhq_timeout')));req.on('error',reject);if(payload)req.write(payload);req.end();
  });
}
function loadRuntimeCredentials(env=process.env,readFile=fs.readFileSync){const p=credentialPaths(env);return {email:readFile(p.email),apiKey:readFile(p.apiKey)}}
function runServer({env=process.env,readFile=fs.readFileSync,request=httpsRequest,listen=LISTEN}={}){
  validateListen(listen); const creds=loadRuntimeCredentials(env,readFile); const client=createDeployHQClient({...creds,request}); const server=http.createServer(createAdapter(client)); server.listen(listen.port,listen.host); return server;
}

module.exports={FIXED_NODE1,redact,normalizeServer,classifyCanonical,createAdapter,credentialPaths,credentialEvidence,createDeployHQClient,LISTEN,validateListen,httpsRequest,loadRuntimeCredentials,runServer};

if(require.main===module){const args=process.argv.slice(2);if(args.length===1&&args[0]==='--serve'){runServer();}else{process.stderr.write('unexpected_arguments\n');process.exitCode=2}}
