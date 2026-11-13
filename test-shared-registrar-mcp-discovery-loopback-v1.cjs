'use strict';
/**
 * GitHub-hosted Ubuntu only: exercised real HTTP requests to both hardcoded
 * loopback MCP backend ports, with a throwaway CI-only bearer credential.
 * This is not evidence of production authentication or real PRHM tool load.
 */
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const probe=require('./shared-registrar-mcp-discovery-probe-v1.cjs');
const name='pbcinema_banner_publish_v1';
const TOKEN='CI_ONLY_REGISTRAR_DISCOVERY_1234567890_ABCD';
const FILE=probe.AUTH_FILE;
function gated(){
 if(process.platform!=='linux'||process.getuid()!==0||
    process.env.GITHUB_ACTIONS!=='true'||
    process.env.RUNNER_ENVIRONMENT!=='github-hosted'||
    process.env.RUNNER_OS!=='Linux'||
    process.env.REGISTRAR_MCP_DISCOVERY_LOOPBACK!=='1'||
    !/^\/home\/runner\/work\//.test(process.env.GITHUB_WORKSPACE||'')||
    fs.existsSync('/opt/prhm-agent-selfmaint/server.js')||
    fs.existsSync(FILE))throw Error('REGISTRAR_MCP_DISCOVERY_CI_ONLY');
}
const reply=(list,id)=>JSON.stringify({
 jsonrpc:'2.0',id,result:{tools:list.map(name=>({name,description:'fixture read-only'}))}
});
function server(port,tools){
 return new Promise((resolve,reject)=>{
  let requests=0,authenticated=0;
  const s=http.createServer((req,res)=>{
   requests++;
   if(req.method!=='POST'||req.url!=='/mcp') {
    res.writeHead(405);res.end();return;
   }
   if(req.headers.authorization!=='Bearer '+TOKEN) {
    res.writeHead(401,{'content-type':'application/json'});
    res.end(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32003,message:'Unauthorized'}}));return;
   }
   authenticated++;
   let buffer='';req.on('data',b=>buffer+=b);
   req.on('end',()=>{
    let msg;
    try{msg=JSON.parse(buffer)}catch{
     res.writeHead(400);res.end();return;
    }
    if(msg.method!=='tools/list'){
     res.writeHead(405);res.end();return;
    }
    res.writeHead(200,{'content-type':'application/json'});
    res.end(reply(tools,msg.id));
   });
  });
  s.once('error',reject);
  s.listen(port,'127.0.0.1',()=>resolve({server:s,counts:()=>({requests,authenticated})}));
 });
}
async function close(s){
 if(!s)return;
 await new Promise(resolve=>s.close(resolve));
}
test('both authenticated loopback MCP backends must report exact registrar tools',async()=>{
 gated();
 fs.mkdirSync(path.dirname(FILE),{recursive:true,mode:0o700});
 fs.writeFileSync(FILE,JSON.stringify({schema:'prhm.registrar.mcp-readonly-auth.v1',
   bearer_token:TOKEN})+'\n',{mode:0o600,flag:'wx'});
 fs.chmodSync(FILE,0o600);
 const tools=['host_action_v2_status','prhm_registrar_request_v1',
   'prhm_registrar_apply_v1',name];
 let blue,green;
 try{
  blue=await server(8124,tools);
  green=await server(8125,tools);
  assert.equal(await probe.verify({action:name,project:'pbcinema'}),true);
  assert.ok(blue.counts().authenticated>=1);
  assert.ok(green.counts().authenticated>=1);
 }finally{
  await close(blue?.server);
  await close(green?.server);
  fs.unlinkSync(FILE);
 }
});
test('missing root-owned credential fails closed; no unauthenticated fallback',async()=>{
 gated();
 await assert.rejects(probe.verify({action:name,project:'pbcinema'}),
  e=>e.code==='ENOENT'||/registrar_mcp_discovery_/.test(e.message));
});
