'use strict';
const fs=require('fs');
const path=require('path');
const https=require('https');
const crypto=require('crypto');
const cp=require('child_process');
const Module=require('module');

const BASE_SHA='91b2bb02fbcbea18a62f035bd28dfe6b6205f1165a894cf9a7abadb8cd354b08';
const BACKUP_ROOT='/var/backups/prhm-agent-selfmaint';
const ULID='01ktm91d15f6mebm8qj6cbs7tb';
const TOKEN_FILE='/etc/honartik/iticket.token';
const HONARTIK_ROOT='/home/honartik/domains/dashboard.honartik.ir/public_html';
const STARTUP_RESULT=path.join(__dirname,'.honartik-iticket-current-check.json');
const EXPECTED={
  'app/components/iticket/support/IticketResource.php':'6e7c7dd1da2b10f90d154f4bc4a87c78831e12833eae323b2d310459794a46a2',
  'app/components/iticket/catalog/IticketCatalogAdapter.php':'5dd2a29b7e47a0a461fce7ad0dfc54d75286956528c786b6c0efd90879559bee',
  'app/components/iticket/schedules/IticketScheduleAdapter.php':'621f79ae3c870af1f9db7037e9acca2eefee7bc3d600585cf968f5aa4270d7db',
  'app/components/iticket/tests/CatalogAdapterTest.php':'d027c89fb5ac4f24992070e86839254b345b0938ddac8db206a770bfe5860e4c',
  'app/components/iticket/tests/ScheduleAdapterTest.php':'adf92b2e9fb5784c3401a40841ac2a889e7f228bad4bec238e08f3134f475829',
  'app/components/iticket/tests/ResourceMappingTest.php':'40dde8a85c781ffbe47c68dfcb12a0bc6a84ac22fba0bb1c692031f04786e8e5'
};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(message){throw new Error(message)}
function loadBase(){
  const prefix='agent_api-opsExecutorRoutes.js-';
  const suffix='-'+BASE_SHA+'.bak';
  const names=fs.readdirSync(BACKUP_ROOT).filter(n=>n.startsWith(prefix)&&n.endsWith(suffix)).sort().reverse();
  if(!names.length)fail('iticket_probe_base_backup_missing');
  const full=path.join(BACKUP_ROOT,names[0]);
  const m=new Module(__filename,module);m.filename=full;m.paths=module.paths;m._compile(fs.readFileSync(full,'utf8'),full);
  if(!m.exports||typeof m.exports.registerOpsExecutorRoutes!=='function')fail('iticket_probe_base_export_missing');
  return m.exports;
}
const base=loadBase();
function probe(){
  return new Promise((resolve,reject)=>{
    let st;try{st=fs.lstatSync(TOKEN_FILE)}catch{return reject(new Error('iticket_token_missing'))}
    if(!st.isFile()||st.isSymbolicLink())return reject(new Error('iticket_token_file_invalid'));
    let token='';try{token=fs.readFileSync(TOKEN_FILE,'utf8').trim()}catch{return reject(new Error('iticket_token_unreadable'))}
    if(!token||token.length>4096)return reject(new Error('iticket_token_invalid'));
    const req=https.request({hostname:'console.iticket.ir',port:443,method:'GET',path:'/api/v1/places/'+ULID,headers:{Accept:'application/json','X-Api-Access-Token':token,'User-Agent':'prhm-honartik-iticket-place-check/1'},rejectUnauthorized:true,timeout:10000},response=>{
      const chunks=[];let size=0;response.on('data',chunk=>{size+=chunk.length;if(size<=131072)chunks.push(chunk)});
      response.on('end',()=>{if(size>131072)return reject(new Error('iticket_place_response_too_large'));if(response.statusCode<200||response.statusCode>=300)return reject(new Error('iticket_place_http_'+response.statusCode));let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return reject(new Error('iticket_place_invalid_json'))}const data=body&&body.data,title=data&&data.attributes&&data.attributes.title;if(!data||typeof data!=='object'||String(data.id||'')!==ULID||typeof title!=='string'||title.trim()==='')return reject(new Error('iticket_place_contract_invalid'));resolve({http_status:response.statusCode,resource_type:String(data.type||''),id:ULID,title:title.trim(),title_source:'data.attributes.title',authenticated:true,token_exposed:false,raw_response_exposed:false})});
    });req.once('timeout',()=>req.destroy(new Error('iticket_place_timeout')));req.once('error',reject);req.end();
  });
}
function walkPhp(dir,out=[]){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){if(ent.name.includes('.agent-backup.'))continue;const full=path.join(dir,ent.name);if(ent.isSymbolicLink())fail('iticket_test_symlink_refused');if(ent.isDirectory())walkPhp(full,out);else if(ent.isFile()&&ent.name.endsWith('.php'))out.push(full)}return out}
function execPhp(args,timeout=60000){const r=cp.spawnSync('/usr/bin/php',args,{cwd:HONARTIK_ROOT,encoding:'utf8',timeout,maxBuffer:1024*1024,env:{PATH:'/usr/bin:/bin',LC_ALL:'C.UTF-8',HOME:'/tmp'}});return{status:r.status,error:r.error?.message||null,stdout:String(r.stdout||'').slice(0,12000),stderr:String(r.stderr||'').slice(0,12000)}}
function verifyIticketPatch(){
  for(const [rel,want] of Object.entries(EXPECTED)){const full=path.join(HONARTIK_ROOT,rel);const st=fs.lstatSync(full);if(!st.isFile()||st.isSymbolicLink())fail('iticket_patch_file_invalid:'+rel);const got=sha(fs.readFileSync(full));if(got!==want)fail('iticket_patch_sha_mismatch:'+rel)}
  const roots=[path.join(HONARTIK_ROOT,'app/components/iticket'),path.join(HONARTIK_ROOT,'app/modules/iticket')];
  const phpFiles=[...new Set(roots.flatMap(r=>walkPhp(r)))].sort();
  for(const file of phpFiles){const r=execPhp(['-l',file],30000);if(r.status!==0)fail('php_lint_failed:'+path.relative(HONARTIK_ROOT,file)+':'+(r.stderr||r.stdout).slice(0,300))}
  const testDir=path.join(HONARTIK_ROOT,'app/components/iticket/tests');
  const tests=fs.readdirSync(testDir,{withFileTypes:true}).filter(e=>e.isFile()&&e.name.endsWith('.php')&&!e.name.includes('.agent-backup.')).map(e=>path.join(testDir,e.name)).sort();
  if(!tests.length)fail('iticket_test_suite_empty');
  const results=[];for(const file of tests){const r=execPhp(['-d','open_basedir='+HONARTIK_ROOT+':/tmp','-d','allow_url_fopen=0','-d','disable_functions=curl_init,curl_exec,fsockopen,pfsockopen,stream_socket_client',file],90000);if(r.status!==0)fail('iticket_test_failed:'+path.basename(file)+':'+(r.stderr||r.stdout).slice(0,500));results.push({file:path.basename(file),marker:r.stdout.trim().slice(0,500)})}
  return {patch_sha256:EXPECTED,php_lint_count:phpFiles.length,test_count:results.length,tests:results,test_external_network_allowed:false,test_token_read_allowed:false};
}
function writeStartupResult(value){const tmp=STARTUP_RESULT+'.'+process.pid+'.'+Date.now()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(tmp,STARTUP_RESULT);fs.chmodSync(STARTUP_RESULT,0o600)}
module.exports={...base,registerOpsExecutorRoutes(app,ctx){
  if(!ctx||typeof ctx.auth!=='function')fail('iticket_context_invalid');
  app.post('/run-project',ctx.auth,async(req,res,next)=>{const b=req&&req.body;if(!b||typeof b!=='object'||Array.isArray(b)||b.project!=='control_plane'||b.access!=='read')return next();let op;try{op=JSON.parse(String(b.command||''))}catch{return next()}if(!op||Array.isArray(op)||Object.keys(op).length!==1||op.operation!=='honartik_iticket_place_probe_v1')return next();try{return res.status(200).json(await probe())}catch(error){return res.status(502).json({ok:false,type:'honartik-iticket-place-probe-v1',error:String(error&&error.message||'iticket_place_probe_failed').slice(0,180),token_exposed:false,raw_response_exposed:false})}});
  app.post('/honartik/iticket/v14/preflight',ctx.auth,(req,res)=>{try{return res.status(200).json({ok:true,type:'honartik-iticket-current-readiness-v1',read_only:true,...verifyIticketPatch()})}catch(error){return res.status(409).json({ok:false,type:'honartik-iticket-current-readiness-v1',error:String(error&&error.message||'iticket_readiness_failed').slice(0,700)})}});
  app.post('/honartik/iticket/v14/place-probe',ctx.auth,async(req,res)=>{try{return res.status(200).json({ok:true,type:'honartik-iticket-place-probe-v1',read_only:true,...await probe(),database_mutation:false,application_mutation:false,token_exposed:false,raw_response_exposed:false})}catch(error){return res.status(502).json({ok:false,type:'honartik-iticket-place-probe-v1',read_only:true,error:String(error&&error.message||'iticket_place_probe_failed').slice(0,180),database_mutation:false,application_mutation:false,token_exposed:false,raw_response_exposed:false})}});
  return base.registerOpsExecutorRoutes(app,ctx);
}};
setImmediate(async()=>{const started_at=new Date().toISOString();try{const checks=verifyIticketPatch();const place=await probe();writeStartupResult({ok:true,type:'honartik-iticket-current-check-v1',read_only:true,started_at,finished_at:new Date().toISOString(),...checks,place,database_mutation:false,application_mutation:false,token_exposed:false})}catch(error){writeStartupResult({ok:false,type:'honartik-iticket-current-check-v1',read_only:true,started_at,finished_at:new Date().toISOString(),error:String(error&&error.message||error).slice(0,1200),database_mutation:false,application_mutation:false,token_exposed:false})}});
