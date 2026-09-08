export const FIXED_BOOTSTRAP = Object.freeze({
  api_sha256: '01e11a69b4c5a110aad16d4ee71efd11bdd6c52c6594d09117b5d4bb339ace20',
  mcp_sha256: 'b3cfc90b72cf3f13fecf9c0737369646c6625cda7ca527ed017c78834385a7e4',
  base_runtime_sha256: 'a23b4fec52123f8ad484f31576281c2f1933f24a3c811cd98c28e764a292e315',
  expected_pid: 4015906,
  service: 'prhm-agent-selfmaint.service'
});

function count(source, needle) {
  return source.split(needle).length - 1;
}

const API_ANCHOR = "const base=require(BASE_FILE);\nfunction registerSelfmaintRoutes(app,ctx){return base.registerSelfmaintRoutes(appProxy(app),ctx);}";
const MCP_ANCHOR = "export function registerSelfmaintPlugin(mcp,context){return base.registerSelfmaintPlugin(wrappedMcp(mcp),context);}";

export function patchApiSource(source) {
  if (typeof source !== 'string') throw new Error('api_source_invalid');
  if (source.includes('selfmaint_base_fixed_refresh_v1')) throw new Error('api_already_patched');
  if (count(source, API_ANCHOR) !== 1) throw new Error('api_anchor_invalid');
  const block = `const fsRefresh=require('fs');
const cryptoRefresh=require('crypto');
const cpRefresh=require('child_process');
const REFRESH_SERVICE='prhm-agent-selfmaint.service';
const BASE_RUNTIME_PATH='/opt/prhm-agent-selfmaint/server.js';
const BASE_RUNTIME_SHA='a23b4fec52123f8ad484f31576281c2f1933f24a3c811cd98c28e764a292e315';
const EXPECTED_PID=4015906;
const REFRESH_ROUTE='/selfmaint/base-fixed-refresh-v1';
const REFRESH_SOCKET='/run/prhm-agent-selfmaint/selfmaint.sock';
const refreshDigest=b=>cryptoRefresh.createHash('sha256').update(b).digest('hex');
function refreshPid(){const v=cpRefresh.execFileSync('/usr/bin/systemctl',['show',REFRESH_SERVICE,'-p','MainPID','--value'],{encoding:'utf8',timeout:10000}).trim();const n=Number(v);if(!Number.isInteger(n)||n<=0)fail('selfmaint_base_refresh_pid_invalid');return n;}
function refreshActive(){return cpRefresh.execFileSync('/usr/bin/systemctl',['is-active',REFRESH_SERVICE],{encoding:'utf8',timeout:10000}).trim()==='active';}
function refreshHealth(){return new Promise((resolve,reject)=>{const q=http.request({socketPath:REFRESH_SOCKET,path:'/health',method:'GET'},r=>{let size=0;const chunks=[];r.on('data',c=>{size+=c.length;if(size<=65536)chunks.push(c)});r.on('end',()=>{if(size>65536)return reject(new Error('selfmaint_base_refresh_health_too_large'));let out={};try{out=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{return reject(new Error('selfmaint_base_refresh_health_invalid_json'))}resolve(r.statusCode===200&&out.ok===true&&out.service==='prhm-agent-selfmaint')})});q.setTimeout(3000,()=>q.destroy(new Error('selfmaint_base_refresh_health_timeout')));q.on('error',reject);q.end();});}
async function runBaseFixedRefresh(){
  const runtimeSha=refreshDigest(fsRefresh.readFileSync(BASE_RUNTIME_PATH));if(runtimeSha!==BASE_RUNTIME_SHA)fail('selfmaint_base_refresh_runtime_sha_drift');
  const before=refreshPid();if(before!==EXPECTED_PID)fail('selfmaint_base_refresh_pid_drift');if(!refreshActive())fail('selfmaint_base_refresh_service_not_active');
  cpRefresh.execFileSync('/usr/bin/systemctl',['restart',REFRESH_SERVICE],{encoding:'utf8',timeout:30000});
  let after=0,healthy=false;for(let i=0;i<30;i++){try{after=refreshPid();healthy=after!==before&&refreshActive()&&await refreshHealth();if(healthy)break}catch{}await new Promise(r=>setTimeout(r,250));}
  const postSha=refreshDigest(fsRefresh.readFileSync(BASE_RUNTIME_PATH));if(postSha!==BASE_RUNTIME_SHA)fail('selfmaint_base_refresh_post_sha_drift');if(after===before||after<=0)fail('selfmaint_base_refresh_pid_not_changed');if(!healthy)fail('selfmaint_base_refresh_health_not_ok');
  return {ok:true,type:'selfmaint-base-fixed-refresh-v1',action:'selfmaint_base_fixed_refresh_v1',service:REFRESH_SERVICE,before_pid:before,after_pid:after,runtime_sha256:postSha,service_active:true,health_ok:true,file_mutation:false,database_mutation:false,application_mutation:false,arbitrary_input:false,one_shot:true};
}
const base=require(BASE_FILE);
function registerSelfmaintRoutes(app,ctx){const result=base.registerSelfmaintRoutes(appProxy(app),ctx);const auth=ctx&&ctx.auth;if(typeof auth!=='function')fail('selfmaint_base_refresh_auth_missing');app.post(REFRESH_ROUTE,auth,async(req,res)=>{try{if(req.body&&typeof req.body==='object'&&Object.keys(req.body).length)fail('selfmaint_base_refresh_zero_input_required');return res.json(await runBaseFixedRefresh())}catch(e){return res.status(e&&e.policy?409:500).json({ok:false,error:String(e&&e.message||e).slice(0,200),file_mutation:false,database_mutation:false,application_mutation:false})}});return result;}`;
  return source.replace(API_ANCHOR, block);
}

export function patchMcpSource(source) {
  if (typeof source !== 'string') throw new Error('mcp_source_invalid');
  if (source.includes('selfmaint_base_fixed_refresh_v1')) throw new Error('mcp_already_patched');
  if (count(source, MCP_ANCHOR) !== 1) throw new Error('mcp_anchor_invalid');
  const replacement = `export function registerSelfmaintPlugin(mcp,context){const result=base.registerSelfmaintPlugin(wrappedMcp(mcp),context);const agent=context&&context.agent;if(agent&&typeof agent.callAgent==='function'){mcp.registerTool('selfmaint_base_fixed_refresh_v1',{title:'Refresh Self-maintenance Base Runtime',description:'Fixed zero-input one-shot SHA/PID-bound refresh of prhm-agent-selfmaint.service. No arbitrary command, path, action, service, database or application input.',inputSchema:{},annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:false}},async()=>textResult(await agent.callAgent('/selfmaint/base-fixed-refresh-v1','POST',{})));}return result;}`;
  return source.replace(MCP_ANCHOR, replacement);
}
