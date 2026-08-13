#!/usr/local/bin/prhm-node
'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const cp=require('child_process');

const VERSION='2026-08-13.1-project-factory-v1';
const PATHS=Object.freeze({
  basicRoutes:'/home/agent/ssh-agent-api/fileBasicRoutes.js',
  registry:'/home/agent/ssh-mcp-server/src/core/registry.js',
  safeFiles:'/home/agent/ssh-mcp-server/src/plugins/safeFiles.js',
  plugin:'/home/agent/ssh-mcp-server/src/plugins/projectFactory.js',
  factoryDir:'/opt/prhm-project-factory',
  nodeRoot:'/opt/prhm-project-factory/node',
  factoryEngine:'/opt/prhm-project-factory/factory.js',
  factoryServer:'/opt/prhm-project-factory/server.js',
  factoryWorker:'/opt/prhm-project-factory/worker.js',
  unit:'/etc/systemd/system/prhm-project-factory.service',
  generatedRoot:'/home/prhm/projects/generated',
  ownerReference:'/home/prhm/projects',
  marker:'/var/lib/prhm-project-factory/bootstrap-v1.json'
});
const EXPECTED=Object.freeze({
  basicRoutes:'0d8413f9bdc3686a3ef4d5bbbd47f18c33ef061b44450bb129bc641d96716b9d',
  registry:'8ad3ef2006c212585cca00007e68137eff9f1b4a7bd867de5272b496b39c7ee3',
  safeFiles:'db64eea728085adc87c75e6408722d81ebd31259defbd70c063c7b57922256e0'
});
const NODE_TOOLCHAINS=Object.freeze({
  x64:{version:'20.20.2',file:'node-v20.20.2-linux-x64.tar.gz',dir:'node-v20.20.2-linux-x64',sha256:'19e56f0825510207dd904f087fe52faa0a4eb6b2aab5f0ea7a33830d04888b8b'},
  arm64:{version:'20.20.2',file:'node-v20.20.2-linux-arm64.tar.gz',dir:'node-v20.20.2-linux-arm64',sha256:'47ef73d543ecf6eb19435f6c03a0ac4809b3bf0dd6b26c7c571efc2a6572a74d'}
});

function shaText(s){return crypto.createHash('sha256').update(Buffer.from(s,'utf8')).digest('hex');}
function read(f){return fs.readFileSync(f,'utf8');}
function assertSha(label,file,expected){const actual=shaText(read(file));if(actual!==expected)throw Error(`sha_mismatch:${label}:${actual}`);return actual;}
function replaceOnce(text,anchor,replacement,label){const i=text.indexOf(anchor);if(i<0)throw Error(`anchor_missing:${label}`);if(text.indexOf(anchor,i+anchor.length)>=0)throw Error(`anchor_not_unique:${label}`);return text.slice(0,i)+replacement+text.slice(i+anchor.length);}
function atomicWrite(file,text,mode,uid,gid){const tmp=`${file}.project-factory-${process.pid}-${Date.now()}.tmp`;fs.writeFileSync(tmp,text,{flag:'wx',mode});fs.chmodSync(tmp,mode);if(Number.isInteger(uid)&&Number.isInteger(gid))fs.chownSync(tmp,uid,gid);fs.renameSync(tmp,file);}
function backupFile(file,dir){const dest=path.join(dir,file.replace(/^\//,'').replace(/\//g,'__'));fs.copyFileSync(file,dest,fs.constants.COPYFILE_EXCL);fs.chmodSync(dest,0o600);return dest;}
function restore(file,backup){const st=fs.statSync(file);const data=fs.readFileSync(backup);const tmp=`${file}.rollback-${process.pid}-${Date.now()}.tmp`;fs.writeFileSync(tmp,data,{mode:st.mode&0o777});fs.chownSync(tmp,st.uid,st.gid);fs.renameSync(tmp,file);}
function nodeCheck(file){cp.execFileSync('/usr/local/bin/prhm-node',['--check',file],{stdio:'pipe',timeout:15000});}
function systemctl(...args){return cp.execFileSync('systemctl',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000}).trim();}
function sleep(ms){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);}
function waitFor(fn,attempts=60,delay=500){let last;for(let i=0;i<attempts;i++){try{const x=fn();if(x)return x;}catch(e){last=e;}sleep(delay);}throw last||Error('health_timeout');}
function curlUnix(socket,url){return cp.execFileSync('curl',['-fsS','--max-time','8','--unix-socket',socket,url],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:12000}).trim();}
function curlUnixPost(socket,url,payload){return cp.execFileSync('curl',['-fsS','--max-time','12','--unix-socket',socket,'-H','content-type: application/json','--data-binary',JSON.stringify(payload),url],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:16000}).trim();}
function curlLocal(url){return cp.execFileSync('curl',['-fsS','--max-time','8',url],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:12000}).trim();}
function fileSha256(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function nodeToolchainSpec(){const spec=NODE_TOOLCHAINS[process.arch];if(!spec)throw Error('unsupported_node_toolchain_arch:'+process.arch);return spec;}
function stageNodeToolchain(dir){const spec=nodeToolchainSpec();fs.mkdirSync(dir,{recursive:true,mode:0o700});const archive=path.join(dir,spec.file);const url='https://nodejs.org/dist/v'+spec.version+'/'+spec.file;cp.execFileSync('curl',['-fL','--proto','=https','--tlsv1.2','--retry','3','--connect-timeout','10','--max-time','180',url,'-o',archive],{stdio:['ignore','pipe','pipe'],timeout:210000});const actual=fileSha256(archive);if(actual!==spec.sha256)throw Error('node_toolchain_sha_mismatch:'+actual);cp.execFileSync('tar',['-xzf',archive,'-C',dir],{stdio:['ignore','pipe','pipe'],timeout:120000});const extracted=path.join(dir,spec.dir),bin=path.join(extracted,'bin');for(const name of ['node','npm','npx']){const f=path.join(bin,name);if(!fs.existsSync(f))throw Error('node_toolchain_binary_missing:'+name);}const env={...process.env,PATH:bin+':'+String(process.env.PATH||'')};const nodeVersion=cp.execFileSync(path.join(bin,'node'),['--version'],{encoding:'utf8',env,timeout:10000}).trim();const npmVersion=cp.execFileSync(path.join(bin,'npm'),['--version'],{encoding:'utf8',env,timeout:10000}).trim();const npxVersion=cp.execFileSync(path.join(bin,'npx'),['--version'],{encoding:'utf8',env,timeout:10000}).trim();if(nodeVersion!=='v'+spec.version)throw Error('node_toolchain_version_mismatch:'+nodeVersion);return{arch:process.arch,url,file:spec.file,sha256:actual,extracted,node_version:nodeVersion,npm_version:npmVersion,npx_version:npxVersion};}

const FACTORY_ENGINE=String.raw`#!/usr/local/bin/prhm-node
'use strict';
const fs=require('fs');
const path=require('path');
const {spawnSync}=require('child_process');
const STANDARD_ID='PRHM_NEW_SITE_V1';
const FACTORY_VERSION='1.3.1';
const OWNER_REFERENCE='/home/prhm/projects';
const ROOT_BASE='/home/prhm/projects/generated';
const SLUG_RE=/^[a-z][a-z0-9-]{1,48}[a-z0-9]$/;
const DOMAIN_RE=/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i;
const TOKEN_RE=/^[a-z][a-z0-9_-]{0,63}$/;
const LANG_RE=/^[a-z]{2}(?:-[A-Z]{2})?$/;
let activeRoot=null,activeState=null;
function fail(message,code=1){console.error('PRHM_BOOTSTRAP_ERROR='+message);process.exit(code);}
function parseArgs(argv){const out={manifestBase64:null,dryRun:false};for(let i=0;i<argv.length;i++){const a=argv[i];if(a==='--dry-run')out.dryRun=true;else if(a==='--manifest-base64')out.manifestBase64=argv[++i]||null;else fail('unknown_argument:'+a,2);}if(!out.manifestBase64)fail('manifest_payload_required',2);return out;}
function text(v,n,max=120){if(typeof v!=='string'||!v.trim()||v.length>max)fail('invalid_'+n,2);return v.trim();}
function token(v,n){const x=text(v,n,64);if(!TOKEN_RE.test(x))fail('invalid_'+n,2);return x;}
function arr(v,n,re,max=30){if(!Array.isArray(v)||v.length<1||v.length>max)fail('invalid_'+n,2);const x=[...new Set(v.map(z=>text(z,n,120)))];for(const z of x)if(!re.test(z))fail('invalid_'+n+':'+z,2);return x;}
function validate(raw){if(!raw||Array.isArray(raw)||typeof raw!=='object')fail('manifest_must_be_object',2);const allowed=new Set(['standard_id','slug','name','domains','languages','modules','payment_adapter','sms_adapter','brand','features']);for(const k of Object.keys(raw))if(!allowed.has(k))fail('unknown_manifest_field:'+k,2);if(raw.standard_id!==STANDARD_ID)fail('standard_id_mismatch',2);const slug=text(raw.slug,'slug',50);if(!SLUG_RE.test(slug))fail('invalid_slug',2);const name=text(raw.name,'name',120),domains=arr(raw.domains,'domains',DOMAIN_RE,10),languages=arr(raw.languages,'languages',LANG_RE,10);if(!Array.isArray(raw.modules)||raw.modules.length>50)fail('invalid_modules',2);const modules=[...new Set(raw.modules.map(x=>token(x,'module')))];const payment=raw.payment_adapter==null?null:token(raw.payment_adapter,'payment_adapter');const sms=raw.sms_adapter==null?null:token(raw.sms_adapter,'sms_adapter');const brand=raw.brand===undefined?{}:raw.brand;if(!brand||Array.isArray(brand)||typeof brand!=='object')fail('invalid_brand',2);for(const k of Object.keys(brand))if(!['display_name','primary_color','logo_path'].includes(k))fail('unknown_brand_field:'+k,2);if(brand.display_name!==undefined)text(brand.display_name,'brand_display_name',120);if(brand.primary_color!==undefined&&!/^#[0-9a-fA-F]{6}$/.test(brand.primary_color))fail('invalid_brand_primary_color',2);if(brand.logo_path!==undefined&&!/^\/[A-Za-z0-9._/-]{1,300}$/.test(brand.logo_path))fail('invalid_brand_logo_path',2);const features=raw.features===undefined?{}:raw.features;if(!features||Array.isArray(features)||typeof features!=='object'||Object.keys(features).length>100)fail('invalid_features',2);for(const [k,v] of Object.entries(features)){token(k,'feature');if(typeof v!=='boolean')fail('invalid_feature_value:'+k,2);}return{standard_id:STANDARD_ID,slug,name,domains,languages,modules,payment_adapter:payment,sms_adapter:sms,brand,features};}
function owner(){const st=fs.statSync(OWNER_REFERENCE);if(!st.isDirectory())fail('factory_owner_reference_not_directory',3);return{uid:st.uid,gid:st.gid};}
function ensureTarget(root){if(fs.existsSync(root))fail('target_exists:'+root,3);const ro=path.resolve(OWNER_REFERENCE),rb=path.resolve(ROOT_BASE),rr=path.resolve(root);if(path.dirname(rb)!==ro)fail('factory_root_parent_mismatch',3);const base=fs.lstatSync(ROOT_BASE);if(base.isSymbolicLink()||!base.isDirectory())fail('factory_root_invalid_type',3);const realOwner=fs.realpathSync(OWNER_REFERENCE),realBase=fs.realpathSync(ROOT_BASE);if(path.dirname(realBase)!==realOwner)fail('factory_root_realpath_escape',3);if(!rr.startsWith(rb+path.sep))fail('target_outside_factory_root',3);}
function plan(root,o){return[
{name:'laravel_api',command:'composer',args:['create-project','laravel/laravel:^13.0',path.join(root,'apps/api'),'--no-interaction','--prefer-dist'],cwd:root},
{name:'laravel_standard_packages',command:'composer',args:['require','laravel/sanctum:^4.3','spatie/laravel-permission:^8.0','--no-interaction'],cwd:path.join(root,'apps/api')},
{name:'next_web',command:'/opt/prhm-project-factory/node/bin/npx',args:['create-next-app@16.2.10',path.join(root,'apps/web'),'--ts','--tailwind','--eslint','--app','--src-dir','--import-alias','@/*','--use-npm','--yes','--disable-git'],cwd:root},
{name:'next_admin',command:'/opt/prhm-project-factory/node/bin/npx',args:['create-next-app@16.2.10',path.join(root,'apps/admin'),'--ts','--tailwind','--eslint','--app','--src-dir','--import-alias','@/*','--use-npm','--yes','--disable-git'],cwd:root},
{name:'git_init',command:'git',args:['init','--initial-branch=main'],cwd:root},
{name:'normalize_ownership',command:'chown',args:['-R',o.uid+':'+o.gid,root],cwd:root}
];}
function mkdirp(d){fs.mkdirSync(d,{recursive:true,mode:0o750});}
function writeJson(f,v){fs.writeFileSync(f,JSON.stringify(v,null,2)+'\n',{mode:0o640,flag:'wx'});}
function writeText(f,v){fs.writeFileSync(f,v,{mode:0o640,flag:'wx'});}
function run(s){const r=spawnSync(s.command,s.args,{cwd:s.cwd,stdio:'inherit',timeout:900000,env:{...process.env,CI:'1',COMPOSER_HOME:'/var/lib/prhm-project-factory/composer',npm_config_cache:'/var/lib/prhm-project-factory/npm-cache'}});return{name:s.name,command:s.command,args:s.args,cwd:s.cwd,started_at:new Date().toISOString(),finished_at:new Date().toISOString(),exit_code:Number.isInteger(r.status)?r.status:null,signal:r.signal||null,error:r.error?r.error.message:null};}
function compose(slug){const db=slug.replace(/-/g,'_');return 'services:\n  postgres:\n    image: public.ecr.aws/docker/library/postgres:18-alpine\n    restart: unless-stopped\n    environment:\n      POSTGRES_DB: '+db+'\n      POSTGRES_USER: '+db+'_app\n      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password\n    volumes:\n      - ./runtime/postgresql:/var/lib/postgresql\n      - ./secrets/postgres_password:/run/secrets/postgres_password:ro\n    networks:\n      - app-backend\n\n  redis:\n    image: public.ecr.aws/docker/library/redis:8-alpine\n    restart: unless-stopped\n    volumes:\n      - ./runtime/redis:/data\n    networks:\n      - app-backend\n\nnetworks:\n  app-backend:\n    driver: bridge\n';}
function rollback(root,state){try{console.error('PRHM_BOOTSTRAP_ROLLBACK='+JSON.stringify({root,failed_step:state.failed_step||null}));fs.rmSync(root,{recursive:true,force:true,maxRetries:3,retryDelay:250});return true;}catch(e){console.error('PRHM_BOOTSTRAP_ROLLBACK_ERROR='+e.message);return false;}}
function term(sig){if(activeRoot)rollback(activeRoot,activeState||{});console.error('PRHM_BOOTSTRAP_TERMINATED='+sig);process.exit(sig==='SIGINT'?130:143);}process.once('SIGTERM',()=>term('SIGTERM'));process.once('SIGINT',()=>term('SIGINT'));
function main(){const a=parseArgs(process.argv.slice(2));let raw;try{raw=JSON.parse(Buffer.from(a.manifestBase64,'base64').toString('utf8'));}catch(e){fail('manifest_payload_invalid:'+e.message,2);}const manifest=validate(raw),root=path.join(ROOT_BASE,manifest.slug);ensureTarget(root);const o=owner(),steps=plan(root,o);if(a.dryRun){console.log(JSON.stringify({ok:true,dry_run:true,factory_version:FACTORY_VERSION,standard_id:STANDARD_ID,root,owner:o,manifest,steps}));return;}activeRoot=root;mkdirp(root);mkdirp(path.join(root,'.prhm'));mkdirp(path.join(root,'apps'));for(const d of ['contracts','ui','config','modules'])mkdirp(path.join(root,'packages',d));mkdirp(path.join(root,'infra/docker'));mkdirp(path.join(root,'docs'));mkdirp(path.join(root,'scripts'));const stateFile=path.join(root,'.prhm/bootstrap-state.json');writeJson(path.join(root,'.prhm/project.json'),manifest);writeText(path.join(root,'.gitignore'),'.env\n.env.*\n!.env.example\nnode_modules/\nvendor/\n.next/\ncoverage/\nruntime/\nsecrets/\n');writeText(path.join(root,'README.md'),'# '+manifest.name+'\n\nGenerated by PRHM New Site Factory v'+FACTORY_VERSION+'.\n\nStandard: '+STANDARD_ID+'\n');writeText(path.join(root,'package.json'),JSON.stringify({name:manifest.slug,private:true,workspaces:['apps/web','apps/admin','packages/*']},null,2)+'\n');writeText(path.join(root,'docs/ARCHITECTURE.md'),'# Architecture\n\nThis project follows '+STANDARD_ID+'.\n\n- API: Laravel 13 / PHP 8.3+\n- Web: Next.js 16 / React 19 / TypeScript / Tailwind 4\n- Admin: Next.js 16 / React 19 / TypeScript\n- Database: PostgreSQL 18\n- Cache/Queue: Redis 8\n- API contract: OpenAPI\n- Environments: local -> staging -> production\n');writeText(path.join(root,'packages/contracts/openapi.yaml'),'openapi: 3.1.0\ninfo:\n  title: PRHM API\n  version: 0.1.0\npaths: {}\n');writeText(path.join(root,'packages/config/project.json'),JSON.stringify(manifest,null,2)+'\n');writeText(path.join(root,'infra/docker/compose.infrastructure.yml'),compose(manifest.slug));const state={ok:false,status:'materializing',factory_version:FACTORY_VERSION,standard_id:STANDARD_ID,root,owner:o,manifest,started_at:new Date().toISOString(),steps:[]};writeJson(stateFile,state);activeState=state;for(const s of steps){const r=run(s);state.steps.push(r);state.updated_at=new Date().toISOString();fs.writeFileSync(stateFile,JSON.stringify(state,null,2)+'\n',{mode:0o640});if(r.exit_code!==0||r.error){state.status='failed';state.failed_step=s.name;state.finished_at=new Date().toISOString();fs.writeFileSync(stateFile,JSON.stringify(state,null,2)+'\n',{mode:0o640});const rb=rollback(root,state);fail('materialization_failed:'+s.name+':rollback_'+(rb?'ok':'failed'),rb?4:5);}}state.ok=true;state.status='ready_for_configuration';state.finished_at=new Date().toISOString();fs.writeFileSync(stateFile,JSON.stringify(state,null,2)+'\n',{mode:0o640});activeState=null;activeRoot=null;console.log('PRHM_BOOTSTRAP_OK='+root);}
main();
`;

const FACTORY_WORKER=String.raw`#!/usr/local/bin/prhm-node
'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process');
const ROOT='/var/lib/prhm-project-factory/jobs';
const FACTORY='/opt/prhm-project-factory/factory.js';
const UUID=/^[0-9a-f-]{36}$/i;
function atomic(f,v){const t=f+'.'+process.pid+'.'+Date.now()+'.tmp';fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n',{mode:0o600});fs.renameSync(t,f);}
function main(){const id=String(process.argv[2]||'');if(!UUID.test(id))process.exit(2);const jf=path.join(ROOT,id+'.json');if(!fs.existsSync(jf))process.exit(3);let job=JSON.parse(fs.readFileSync(jf,'utf8'));job={...job,status:'running',pid:process.pid,started_at:new Date().toISOString(),updated_at:new Date().toISOString()};atomic(jf,job);const log=path.join(ROOT,id+'.log'),fd=fs.openSync(log,'a',0o600);const payload=Buffer.from(JSON.stringify(job.manifest),'utf8').toString('base64');const r=cp.spawnSync('/usr/local/bin/prhm-node',[FACTORY,'--manifest-base64',payload],{stdio:['ignore',fd,fd],timeout:3600000,env:{...process.env,CI:'1',COMPOSER_HOME:'/var/lib/prhm-project-factory/composer',npm_config_cache:'/var/lib/prhm-project-factory/npm-cache'}});fs.closeSync(fd);job=JSON.parse(fs.readFileSync(jf,'utf8'));job.updated_at=new Date().toISOString();job.finished_at=new Date().toISOString();job.exit_code=Number.isInteger(r.status)?r.status:null;job.signal=r.signal||null;job.error=r.error?r.error.message:null;if(job.exit_code===0&&!job.error){try{const state=JSON.parse(fs.readFileSync(path.join(job.root,'.prhm/bootstrap-state.json'),'utf8'));if(state.ok!==true||state.status!=='ready_for_configuration')throw Error('bootstrap_state_not_ready');job.status='succeeded';job.bootstrap_state={status:state.status,factory_version:state.factory_version,finished_at:state.finished_at};}catch(e){job.status='failed';job.error='postverify:'+e.message;}}else job.status='failed';atomic(jf,job);}
main();
`;

const FACTORY_SERVER=String.raw`#!/usr/local/bin/prhm-node
'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const RUN='/run/prhm-project-factory',SOCKET=path.join(RUN,'factory.sock'),DATA='/var/lib/prhm-project-factory',JOBS=path.join(DATA,'jobs'),FACTORY='/opt/prhm-project-factory/factory.js',WORKER='/opt/prhm-project-factory/worker.js';
const MAX=65536,UUID=/^[0-9a-f-]{36}$/i;
function ensure(){for(const d of [DATA,JOBS]){fs.mkdirSync(d,{recursive:true,mode:0o700});try{fs.chmodSync(d,0o700)}catch{}}}
function atomic(f,v){const t=f+'.'+process.pid+'.'+Date.now()+'.tmp';fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n',{mode:0o600});fs.renameSync(t,f);}
function body(req){return new Promise((ok,no)=>{let n=0,c=[];req.on('data',x=>{n+=x.length;if(n>MAX){no(Error('request_too_large'));req.destroy();return;}c.push(x)});req.on('end',()=>{try{ok(JSON.parse(Buffer.concat(c).toString('utf8')||'{}'))}catch{no(Error('invalid_json'))}});req.on('error',no)});}
function send(res,status,obj){const b=Buffer.from(JSON.stringify(obj));res.writeHead(status,{'content-type':'application/json','content-length':b.length,'cache-control':'no-store'});res.end(b);}
function strict(obj,allowed){if(!obj||Array.isArray(obj)||typeof obj!=='object')throw Error('invalid_body');for(const k of Object.keys(obj))if(!allowed.includes(k))throw Error('unknown_field:'+k);}
function plan(manifest){const payload=Buffer.from(JSON.stringify(manifest),'utf8').toString('base64');const r=cp.spawnSync('/usr/local/bin/prhm-node',[FACTORY,'--manifest-base64',payload,'--dry-run'],{encoding:'utf8',timeout:15000,maxBuffer:1000000,env:{...process.env,CI:'1',COMPOSER_HOME:'/var/lib/prhm-project-factory/composer',npm_config_cache:'/var/lib/prhm-project-factory/npm-cache'}});if(r.error)throw Error('factory_plan_exec:'+r.error.message);if(r.status!==0)throw Error('factory_plan_failed:'+String(r.stderr||r.stdout||'').slice(0,2000));let out;try{out=JSON.parse(String(r.stdout||'').trim())}catch{throw Error('factory_plan_invalid_json')}if(out.ok!==true||out.dry_run!==true)throw Error('factory_plan_invalid_result');return out;}
function readJob(id){if(!UUID.test(String(id||'')))throw Error('invalid_job_id');const f=path.join(JOBS,id+'.json');if(!fs.existsSync(f))throw Error('job_not_found');return JSON.parse(fs.readFileSync(f,'utf8'));}
function active(){for(const n of fs.readdirSync(JOBS)){if(!n.endsWith('.json'))continue;try{const j=JSON.parse(fs.readFileSync(path.join(JOBS,n),'utf8'));if(['queued','running'].includes(j.status))return j;}catch{}}return null;}
function tail(id,lines=120){const f=path.join(JOBS,id+'.log');if(!fs.existsSync(f))return'';return fs.readFileSync(f,'utf8').split(/\r?\n/).slice(-lines).join('\n');}
function reconcile(){for(const n of fs.readdirSync(JOBS)){if(!n.endsWith('.json'))continue;const f=path.join(JOBS,n);try{let j=JSON.parse(fs.readFileSync(f,'utf8'));if(j.status==='running'&&j.pid){let alive=true;try{process.kill(j.pid,0)}catch{alive=false}if(!alive){j.status='interrupted';j.finished_at=new Date().toISOString();j.updated_at=j.finished_at;atomic(f,j);}}}catch{}}}
async function handle(req,res){try{if(req.method==='GET'&&req.url==='/health')return send(res,200,{ok:true,service:'prhm-project-factory',version:'1.0.0',root:'/home/prhm/projects/generated'});if(req.method==='POST'&&req.url==='/v1/plan'){const x=await body(req);strict(x,['manifest']);return send(res,200,{ok:true,plan:plan(x.manifest)});}if(req.method==='POST'&&req.url==='/v1/bootstrap'){const x=await body(req);strict(x,['manifest','acknowledgeRisk']);if(x.acknowledgeRisk!==true)throw Error('explicit_acknowledgement_required');const p=plan(x.manifest);const a=active();if(a)return send(res,409,{ok:false,error:'factory_busy',active_job_id:a.job_id});const id=crypto.randomUUID(),jf=path.join(JOBS,id+'.json');const j={job_id:id,status:'queued',root:p.root,manifest:p.manifest,plan:{factory_version:p.factory_version,standard_id:p.standard_id},created_at:new Date().toISOString()};atomic(jf,j);const child=cp.spawn('/usr/local/bin/prhm-node',[WORKER,id],{detached:true,stdio:'ignore',cwd:'/opt/prhm-project-factory',env:process.env});child.unref();j.worker_pid=child.pid;j.status='running';j.started_at=new Date().toISOString();atomic(jf,j);return send(res,202,{ok:true,job_id:id,status:j.status,root:j.root});}if(req.method==='POST'&&req.url==='/v1/status'){const x=await body(req);strict(x,['job_id']);const j=readJob(String(x.job_id||''));return send(res,200,{ok:true,job:j,log_tail:tail(j.job_id)});}return send(res,404,{ok:false,error:'not_found'});}catch(e){return send(res,400,{ok:false,error:String(e.message||e).slice(0,2000)});}}
ensure();reconcile();try{if(fs.existsSync(SOCKET))fs.unlinkSync(SOCKET)}catch{}const server=http.createServer(handle);server.listen(SOCKET,()=>{fs.chmodSync(SOCKET,0o660);fs.chownSync(SOCKET,0,0);});process.on('SIGTERM',()=>server.close(()=>process.exit(0)));process.on('SIGINT',()=>server.close(()=>process.exit(0)));
`;

const MCP_PLUGIN=String.raw`import http from 'node:http';
import { z } from 'zod';
import { textResult } from '../core/result.js';
const SOCKET='/run/prhm-project-factory/factory.sock';
const Token=z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const Manifest=z.object({standard_id:z.literal('PRHM_NEW_SITE_V1'),slug:z.string().regex(/^[a-z][a-z0-9-]{1,48}[a-z0-9]$/),name:z.string().min(1).max(120),domains:z.array(z.string().min(3).max(120)).min(1).max(10),languages:z.array(z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/)).min(1).max(10),modules:z.array(Token).max(50),payment_adapter:Token.nullable().optional(),sms_adapter:Token.nullable().optional(),brand:z.object({display_name:z.string().min(1).max(120).optional(),primary_color:z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),logo_path:z.string().regex(/^\/[A-Za-z0-9._/-]{1,300}$/).optional()}).strict().optional(),features:z.record(z.string(),z.boolean()).optional()}).strict();
const RO={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
const WR={readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false};
function call(pathname,body,timeout=20000){return new Promise((resolve,reject)=>{const data=Buffer.from(JSON.stringify(body||{}));const req=http.request({socketPath:SOCKET,path:pathname,method:'POST',headers:{'content-type':'application/json','content-length':data.length}},res=>{let n=0,c=[];res.on('data',x=>{n+=x.length;if(n<=500000)c.push(x)});res.on('end',()=>{if(n>500000)return reject(Error('project_factory_response_too_large'));let out={};try{out=JSON.parse(Buffer.concat(c).toString('utf8')||'{}')}catch{return reject(Error('project_factory_invalid_response'))}if(res.statusCode<200||res.statusCode>=300||out.ok!==true)return reject(Error(String(out.error||'project_factory_rejected_'+res.statusCode)));resolve(out)});});req.setTimeout(timeout,()=>req.destroy(Error('project_factory_timeout')));req.on('error',e=>reject(Error('project_factory_bridge_error:'+e.message));req.end(data);});}
export function registerProjectFactoryPlugin(mcp){mcp.registerTool('project_factory_plan',{title:'Plan Standard PRHM Project',description:'Validate a PRHM_NEW_SITE_V1 manifest and return the exact isolated project materialization plan. Read-only; creates nothing.',inputSchema:{manifest:Manifest},annotations:RO},async({manifest})=>textResult(await call('/v1/plan',{manifest})));mcp.registerTool('project_factory_bootstrap',{title:'Bootstrap Standard PRHM Project',description:'Create one brand-new project only under /home/prhm/projects/generated from a validated PRHM_NEW_SITE_V1 manifest. Existing targets are never overwritten and failed materialization is rolled back.',inputSchema:{manifest:Manifest,acknowledgeRisk:z.literal(true)},annotations:WR},async args=>textResult(await call('/v1/bootstrap',args,30000)));mcp.registerTool('project_factory_status',{title:'Project Factory Job Status',description:'Read persistent Project Factory job status and bounded log tail.',inputSchema:{job_id:z.string().uuid()},annotations:RO},async args=>textResult(await call('/v1/status',args)));}
`;

const UNIT=`[Unit]\nDescription=PRHM Project Factory\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nUser=root\nGroup=root\nUMask=0077\nExecStart=/usr/local/bin/prhm-node /opt/prhm-project-factory/server.js\nRestart=on-failure\nRestartSec=2\nRuntimeDirectory=prhm-project-factory\nRuntimeDirectoryMode=0750\nStateDirectory=prhm-project-factory\nStateDirectoryMode=0700\nWorkingDirectory=/opt/prhm-project-factory\nEnvironment=COMPOSER_HOME=/var/lib/prhm-project-factory/composer\nEnvironment=npm_config_cache=/var/lib/prhm-project-factory/npm-cache\nEnvironment=PATH=/opt/prhm-project-factory/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin\nNoNewPrivileges=yes\nPrivateTmp=yes\nPrivateDevices=yes\nProtectSystem=strict\nProtectHome=read-only\nReadWritePaths=/home/prhm/projects/generated\nProtectKernelTunables=yes\nProtectKernelModules=yes\nProtectControlGroups=yes\nRestrictNamespaces=yes\nRestrictSUIDSGID=yes\nLockPersonality=yes\nRestrictAddressFamilies=AF_UNIX AF_INET AF_INET6\nCapabilityBoundingSet=CAP_CHOWN CAP_DAC_OVERRIDE CAP_DAC_READ_SEARCH CAP_FOWNER CAP_FSETID CAP_SETGID CAP_SETUID\nAmbientCapabilities=\nTasksMax=2048\n\n[Install]\nWantedBy=multi-user.target\n`;

const REGISTRY_HELPERS=String.raw`
const PRHM_GENERATED_PROJECTS_REGISTRY_V1 = true;
const GENERATED_PROJECTS_ROOT = '/home/prhm/projects/generated';
function refreshGeneratedProjects(projects) {
  for (const key of Object.keys(projects)) if (projects[key]?.generated === true) delete projects[key];
  try {
    if (!fs.existsSync(GENERATED_PROJECTS_ROOT)) return;
    const baseStat = fs.lstatSync(GENERATED_PROJECTS_ROOT);
    if (baseStat.isSymbolicLink() || !baseStat.isDirectory()) return;
    const baseReal = fs.realpathSync(GENERATED_PROJECTS_ROOT);
    for (const slug of fs.readdirSync(GENERATED_PROJECTS_ROOT).slice(0, 200)) {
      if (!/^[a-z][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) continue;
      const dir = path.join(GENERATED_PROJECTS_ROOT, slug);
      let st; try { st = fs.lstatSync(dir); } catch { continue; }
      if (st.isSymbolicLink() || !st.isDirectory()) continue;
      let real; try { real = fs.realpathSync(dir); } catch { continue; }
      if (path.dirname(real) !== baseReal) continue;
      const manifestFile = path.join(real, '.prhm', 'project.json');
      const stateFile = path.join(real, '.prhm', 'bootstrap-state.json');
      let ms, ss; try { ms = fs.lstatSync(manifestFile); ss = fs.lstatSync(stateFile); } catch { continue; }
      if (ms.isSymbolicLink() || ss.isSymbolicLink() || !ms.isFile() || !ss.isFile() || ms.size > 65536 || ss.size > 262144) continue;
      let manifest, state; try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { continue; }
      if (manifest?.standard_id !== 'PRHM_NEW_SITE_V1' || manifest?.slug !== slug || state?.ok !== true || state?.status !== 'ready_for_configuration') continue;
      const id = 'gen_' + slug.replace(/-/g, '_');
      if (projects[id] && projects[id].generated !== true) continue;
      projects[id] = { name: id, root: real, description: 'Generated PRHM project: ' + String(manifest.name || slug).slice(0, 120), generated: true, slug };
    }
  } catch (_) {}
}
`;

function patchBasicRoutes(input){
  if(input.includes('PRHM_GENERATED_PROJECTS_REGISTRY_V1'))throw Error('basic_routes_project_factory_already_patched');
  let out=replaceOnce(input,"const MODE_RE=/^(0600|0640|0644|0750|0755)$/;","const MODE_RE=/^(0600|0640|0644|0750|0755)$/;"+REGISTRY_HELPERS,'basic_routes_registry_helpers');
  const registerAnchor="function registerBasicFileRoutes(app,{auth,projects,appendHistory}){\n scheduleLeadOpsV3Bootstrap();";
  const registerReplacement="function registerBasicFileRoutes(app,{auth,projects,appendHistory}){\n refreshGeneratedProjects(projects);\n const generatedProjectsTimer=setInterval(()=>refreshGeneratedProjects(projects),5000);generatedProjectsTimer.unref?.();\n scheduleLeadOpsV3Bootstrap();";
  out=replaceOnce(out,registerAnchor,registerReplacement,'basic_routes_registry_start');
  const targets=" app.get('/file-targets',auth,(req,res)=>res.json({ok:true,targets:Object.keys(core.roots(projects))}));";
  const targetsReplacement=" app.get('/file-targets',auth,(req,res)=>{refreshGeneratedProjects(projects);res.json({ok:true,targets:Object.keys(core.roots(projects))});});";
  out=replaceOnce(out,targets,targetsReplacement,'basic_routes_targets_refresh');
  return out;
}
function patchRegistry(input){
  if(input.includes('registerProjectFactoryPlugin'))throw Error('registry_project_factory_already_patched');
  let out=replaceOnce(input,"import { registerHostActionsV2Plugin } from '../plugins/hostActionsV2.js';","import { registerHostActionsV2Plugin } from '../plugins/hostActionsV2.js';\nimport { registerProjectFactoryPlugin } from '../plugins/projectFactory.js';",'registry_factory_import');
  out=replaceOnce(out,'  registerHostActionsV2Plugin(mcp, context);','  registerHostActionsV2Plugin(mcp, context);\n  registerProjectFactoryPlugin(mcp, context);','registry_factory_call');
  return out;
}
function patchSafeFiles(input){
  if(input.includes('PRHM_DYNAMIC_PROJECT_TARGET_V1'))throw Error('safe_files_dynamic_target_already_patched');
  const line="const Target=z.enum(['shifa','honartik_front_prod','honartik_admin_prod','honartik_front_staging','honartik_admin_staging','imotion_front_prod','imotion_admin_prod','tarjomeh_wordpress','drtarjomeh_prod','gisheh360','titan_front_prod','titan_back_prod','agent_api','agent_mcp','root_scripts']);";
  return replaceOnce(input,line,"const Target=z.string().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/); // PRHM_DYNAMIC_PROJECT_TARGET_V1",'safe_files_dynamic_target');
}
function validateCandidate(c){
  if(!c.basicRoutes.includes('PRHM_GENERATED_PROJECTS_REGISTRY_V1'))throw Error('dynamic_registry_marker_missing');
  if(!c.registry.includes('registerProjectFactoryPlugin'))throw Error('factory_registry_missing');
  if(!c.safeFiles.includes('PRHM_DYNAMIC_PROJECT_TARGET_V1'))throw Error('dynamic_target_marker_missing');
  if(!MCP_PLUGIN.includes("project_factory_bootstrap")||!MCP_PLUGIN.includes("z.literal(true)"))throw Error('factory_mcp_guard_missing');
  if(!FACTORY_ENGINE.includes("ROOT_BASE='/home/prhm/projects/generated'"))throw Error('factory_root_not_isolated');
  if(!UNIT.includes('ReadWritePaths=/home/prhm/projects/generated'))throw Error('factory_unit_write_scope_missing');
  if(/ReadWritePaths=.*\/home\/prhm(?:\s|$)/.test(UNIT))throw Error('factory_unit_broad_home_write_forbidden');
}
function preflightCandidate(){
  for(const [label,file] of Object.entries({basicRoutes:PATHS.basicRoutes,registry:PATHS.registry,safeFiles:PATHS.safeFiles}))assertSha(label,file,EXPECTED[label]);
  if(fs.existsSync(PATHS.marker))throw Error('project_factory_bootstrap_marker_exists');
  if(fs.existsSync(PATHS.plugin)||fs.existsSync(PATHS.factoryDir)||fs.existsSync(PATHS.unit))throw Error('project_factory_install_target_already_exists');
  if(!fs.existsSync(PATHS.ownerReference)||!fs.statSync(PATHS.ownerReference).isDirectory())throw Error('project_factory_owner_reference_missing');
  for(const bin of ['composer','git','chown','curl','tar','systemctl'])cp.execFileSync('which',[bin],{stdio:'pipe',timeout:5000});
  const originals={basicRoutes:read(PATHS.basicRoutes),registry:read(PATHS.registry),safeFiles:read(PATHS.safeFiles)};
  const patched={basicRoutes:patchBasicRoutes(originals.basicRoutes),registry:patchRegistry(originals.registry),safeFiles:patchSafeFiles(originals.safeFiles)};
  validateCandidate(patched);
  const dir=`/tmp/prhm-project-factory-preflight-${process.pid}`;fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const files={basicRoutes:path.join(dir,'fileBasicRoutes.js'),registry:path.join(dir,'registry.js'),safeFiles:path.join(dir,'safeFiles.js'),plugin:path.join(dir,'projectFactory.js'),engine:path.join(dir,'factory.js'),server:path.join(dir,'factory-server.js'),worker:path.join(dir,'factory-worker.js')};
  for(const [k,v] of Object.entries({basicRoutes:patched.basicRoutes,registry:patched.registry,safeFiles:patched.safeFiles,plugin:MCP_PLUGIN,engine:FACTORY_ENGINE,server:FACTORY_SERVER,worker:FACTORY_WORKER}))fs.writeFileSync(files[k],v,{mode:0o600});
  for(const f of Object.values(files))nodeCheck(f);
  const sample={standard_id:'PRHM_NEW_SITE_V1',slug:'factory-preflight-sample',name:'Factory Preflight Sample',domains:['factory-preflight.example.com'],languages:['fa'],modules:[],payment_adapter:null,sms_adapter:null,brand:{display_name:'Factory Preflight Sample'},features:{}};
  const payload=Buffer.from(JSON.stringify(sample),'utf8').toString('base64');
  const toolchain=stageNodeToolchain(path.join(dir,'node-toolchain'));
  const dry=cp.spawnSync('/usr/local/bin/prhm-node',[files.engine,'--manifest-base64',payload,'--dry-run'],{encoding:'utf8',timeout:15000,maxBuffer:1000000});
  if(dry.error||dry.status!==0)throw Error('factory_engine_dry_run_failed:'+String(dry.stderr||dry.stdout||dry.error?.message||'').slice(0,2000));
  let plan;try{plan=JSON.parse(String(dry.stdout||'').trim())}catch{throw Error('factory_engine_dry_run_invalid_json')}
  if(plan.ok!==true||plan.dry_run!==true||plan.root!=='/home/prhm/projects/generated/factory-preflight-sample')throw Error('factory_engine_dry_run_invalid_result');
  return{originals,patched,files,toolchain,report:{ok:true,preflight_only:true,version:VERSION,current_hashes:{...EXPECTED},candidate_hashes:{basicRoutes:shaText(patched.basicRoutes),registry:shaText(patched.registry),safeFiles:shaText(patched.safeFiles),plugin:shaText(MCP_PLUGIN),engine:shaText(FACTORY_ENGINE),server:shaText(FACTORY_SERVER),worker:shaText(FACTORY_WORKER),unit:shaText(UNIT)},factory_root:PATHS.generatedRoot,write_scope:PATHS.generatedRoot,sample_plan_root:plan.root,node_toolchain:{arch:toolchain.arch,file:toolchain.file,sha256:toolchain.sha256,node_version:toolchain.node_version,npm_version:toolchain.npm_version,npx_version:toolchain.npx_version}}};
}
function main(){
  const preflightOnly=process.argv.includes('--preflight-only');
  if(process.getuid&&process.getuid()!==0)throw Error('root_required');
  const p=preflightCandidate();
  if(preflightOnly){console.log(JSON.stringify(p.report));return;}
  const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14),backupDir=`/var/backups/prhm-project-factory-bootstrap-${stamp}`;fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
  const backups=[],created=[];let generatedCreated=false;
  try{
    for(const f of [PATHS.basicRoutes,PATHS.registry,PATHS.safeFiles])backups.push([f,backupFile(f,backupDir)]);
    const stats=Object.fromEntries([PATHS.basicRoutes,PATHS.registry,PATHS.safeFiles].map(f=>[f,fs.statSync(f)]));
    const owner=fs.statSync(PATHS.ownerReference);
    if(!fs.existsSync(PATHS.generatedRoot)){fs.mkdirSync(PATHS.generatedRoot,{recursive:false,mode:0o750});fs.chownSync(PATHS.generatedRoot,owner.uid,owner.gid);generatedCreated=true;}else{const gs=fs.lstatSync(PATHS.generatedRoot);if(gs.isSymbolicLink()||!gs.isDirectory())throw Error('generated_root_invalid');}
    fs.mkdirSync(PATHS.factoryDir,{recursive:false,mode:0o755});created.push(PATHS.factoryDir);
    fs.renameSync(p.toolchain.extracted,PATHS.nodeRoot);
    atomicWrite(PATHS.factoryEngine,FACTORY_ENGINE,0o644,0,0);atomicWrite(PATHS.factoryServer,FACTORY_SERVER,0o644,0,0);atomicWrite(PATHS.factoryWorker,FACTORY_WORKER,0o644,0,0);
    const plugDir=path.dirname(PATHS.plugin),pst=fs.statSync(plugDir);atomicWrite(PATHS.plugin,MCP_PLUGIN,0o644,pst.uid,pst.gid);created.push(PATHS.plugin);
    atomicWrite(PATHS.basicRoutes,p.patched.basicRoutes,stats[PATHS.basicRoutes].mode&0o777,stats[PATHS.basicRoutes].uid,stats[PATHS.basicRoutes].gid);
    atomicWrite(PATHS.registry,p.patched.registry,stats[PATHS.registry].mode&0o777,stats[PATHS.registry].uid,stats[PATHS.registry].gid);
    atomicWrite(PATHS.safeFiles,p.patched.safeFiles,stats[PATHS.safeFiles].mode&0o777,stats[PATHS.safeFiles].uid,stats[PATHS.safeFiles].gid);
    atomicWrite(PATHS.unit,UNIT,0o644,0,0);created.push(PATHS.unit);
    systemctl('daemon-reload');systemctl('enable','--now','prhm-project-factory.service');systemctl('restart','prhm-agent-api.service');systemctl('restart','prhm-agent-mcp.service');
    waitFor(()=>systemctl('is-active','prhm-project-factory.service')==='active'?'active':'');
    const health=JSON.parse(waitFor(()=>curlUnix('/run/prhm-project-factory/factory.sock','http://localhost/health')));if(health.ok!==true||health.root!==PATHS.generatedRoot)throw Error('factory_health_invalid');
    const sample={standard_id:'PRHM_NEW_SITE_V1',slug:'factory-install-smoke',name:'Factory Install Smoke',domains:['factory-install-smoke.example.com'],languages:['fa'],modules:[],payment_adapter:null,sms_adapter:null,brand:{display_name:'Factory Install Smoke'},features:{}};
    const plan=JSON.parse(curlUnixPost('/run/prhm-project-factory/factory.sock','http://localhost/v1/plan',{manifest:sample}));if(plan.ok!==true||plan.plan?.root!=='/home/prhm/projects/generated/factory-install-smoke')throw Error('factory_plan_smoke_failed');
    const api=JSON.parse(waitFor(()=>curlLocal('http://127.0.0.1:8099/health')));if(api.ok!==true)throw Error('agent_api_health_failed');
    const mcp=JSON.parse(waitFor(()=>curlLocal('http://127.0.0.1:8123/health')));if(mcp.ok!==true)throw Error('agent_mcp_health_failed');
    for(const [f,expected] of [[PATHS.basicRoutes,p.report.candidate_hashes.basicRoutes],[PATHS.registry,p.report.candidate_hashes.registry],[PATHS.safeFiles,p.report.candidate_hashes.safeFiles],[PATHS.plugin,p.report.candidate_hashes.plugin],[PATHS.factoryEngine,p.report.candidate_hashes.engine],[PATHS.factoryServer,p.report.candidate_hashes.server],[PATHS.factoryWorker,p.report.candidate_hashes.worker]])if(shaText(read(f))!==expected)throw Error('post_install_sha_mismatch:'+f);
    fs.mkdirSync(path.dirname(PATHS.marker),{recursive:true,mode:0o700});fs.writeFileSync(PATHS.marker,JSON.stringify({...p.report,preflight_only:false,installed:true,installed_at:new Date().toISOString(),backup_dir:backupDir})+'\n',{flag:'wx',mode:0o600});
    console.log(JSON.stringify({...p.report,preflight_only:false,installed:true,backup_dir:backupDir}));
  }catch(error){const errs=[];try{systemctl('disable','--now','prhm-project-factory.service')}catch(e){errs.push('stop:'+e.message)}for(const [f,b] of backups.reverse())try{restore(f,b)}catch(e){errs.push(f+':'+e.message)}for(const f of created.reverse())try{if(f===PATHS.factoryDir)fs.rmSync(f,{recursive:true,force:true});else if(fs.existsSync(f))fs.unlinkSync(f)}catch(e){errs.push(f+':'+e.message)}if(generatedCreated)try{if(fs.existsSync(PATHS.generatedRoot)&&fs.readdirSync(PATHS.generatedRoot).length===0)fs.rmdirSync(PATHS.generatedRoot)}catch(e){errs.push('generated:'+e.message)}try{systemctl('daemon-reload')}catch(e){errs.push('daemon:'+e.message)}for(const s of ['prhm-agent-api.service','prhm-agent-mcp.service'])try{systemctl('restart',s)}catch(e){errs.push(s+':'+e.message)}if(errs.length)throw Error('project_factory_bootstrap_failed_and_rollback_failed:'+error.message+':'+errs.join('|'));throw Error('project_factory_bootstrap_failed_rolled_back:'+error.message);}
}
main();
