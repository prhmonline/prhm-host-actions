#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');

const ACTION='imotion_marketing_target_register_v1';
const TARGET=Object.freeze({
  name:'imotion_marketing_prod',
  root:'/mnt/imotion-prod-vm/domains/imotion.ir/public_html',
  remoteHost:'imotion-prod-vm',
  remoteRoot:'/home/imotion/domains/imotion.ir/public_html',
  description:'iMotion marketing WordPress production site'
});
const PATHS=Object.freeze({
  api:'/home/agent/ssh-agent-api/server.js',
  project:'/home/agent/ssh-mcp-server/src/plugins/project.js',
  safeFiles:'/home/agent/ssh-mcp-server/src/plugins/safeFiles.js',
  zdt:'/opt/prhm-agent-selfmaint-exec/actions/agent-zero-downtime-bootstrap-v1.js'
});
const EXPECTED=Object.freeze({
  api:'70368fdc8be24646b10d414f6159502c2f3d338ed1132451d5b5740d1270999c',
  project:'f0a6cc26250ff0f6de05d2d67c3789a84a33c4ded8d1f0d6a1048389e955c511',
  safeFiles:'2f4cedb73d58bff927e09e8d0b534a08cf49f08b3e5da54f47900f57d8a5f910',
  zdt:'a54e2890eb455c078a4e09e92e007d71545f834dfec7d8d62bb232e1c91406b4'
});
const RESULT_DIR='/var/lib/prhm-agent-selfmaint-exec/imotion-marketing-target-register-v1';
const RESULT=RESULT_DIR+'/latest.json';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=code=>{throw new Error(code)};
function regular(file){const st=fs.lstatSync(file);return st.isFile()&&!st.isSymbolicLink();}
function read(file){if(!fs.existsSync(file)||!regular(file))fail('unsafe_or_missing_file:'+file);return fs.readFileSync(file);}
function modeOf(file){return fs.lstatSync(file).mode&0o777;}
function count(h,n){return h.split(n).length-1;}
function escapeRe(s){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function atomicBytes(file,bytes,mode){const tmp=file+'.imotion-target-'+process.pid+'-'+Date.now()+'.tmp';const fd=fs.openSync(tmp,'wx',mode);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);fs.chmodSync(file,mode);}
function atomicJson(file,obj){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});atomicBytes(file,Buffer.from(JSON.stringify(obj,null,2)+'\n'),0o600);}

function injectImotionMarketingProject(baseSource){
  if(typeof baseSource!=='string')throw new Error('imotion_marketing_base_source_invalid');
  if(baseSource.includes('imotion_marketing_prod'))throw new Error('imotion_marketing_target_already_present');
  for(const marker of ['imotion_front_prod','imotion_admin_prod','/mnt/imotion-prod-vm/domains/i-motion.ir/public_html','/home/imotion/domains/i-motion.ir/public_html'])if(!baseSource.includes(marker))throw new Error('imotion_marketing_anchor_missing:'+marker);
  const re=/\n([ \t]*)(?:['"])?imotion_admin_prod(?:['"])?\s*:/g;
  const matches=[...baseSource.matchAll(re)];
  if(matches.length!==1)throw new Error('imotion_marketing_admin_anchor_count:'+matches.length);
  const m=matches[0],indent=m[1]||'';
  const binding=indent+"imotion_marketing_prod: { root: '/mnt/imotion-prod-vm/domains/imotion.ir/public_html', remoteHost: 'imotion-prod-vm', remoteRoot: '/home/imotion/domains/imotion.ir/public_html', description: 'iMotion marketing WordPress production site' },\n";
  const at=m.index+1;
  return baseSource.slice(0,at)+binding+baseSource.slice(at);
}
function patchAgentApiServer(source){
  if(source.includes('injectImotionMarketingProject('))fail('agent_api_marketing_patch_already_present');
  const re=/([A-Za-z_$][\w$]*)\._compile\(([A-Za-z_$][\w$]*),\s*\1\.filename\);/g;
  const matches=[...source.matchAll(re)];
  if(matches.length!==1)fail('agent_api_compile_anchor_count:'+matches.length);
  const m=matches[0],moduleVar=m[1],sourceVar=m[2];
  const fn=injectImotionMarketingProject.toString();
  const replacement=moduleVar+'._compile(injectImotionMarketingProject('+sourceVar+'),'+moduleVar+'.filename);';
  return source.slice(0,m.index)+fn+'\n'+replacement+source.slice(m.index+m[0].length);
}
function projectProxySource(){return `
function imotionMarketingProjectProxy(mcp){
  return new Proxy(mcp,{get(target,prop){
    if(prop==='tool')return(name,description,schema,handler)=>{
      if(name!=='run_project_command')return target.tool(name,description,schema,handler);
      const shape=typeof schema?.shape==='function'?schema.shape():schema?.shape;
      const projectSchema=shape?.project;
      const options=Array.isArray(projectSchema?.options)?projectSchema.options:null;
      if(typeof schema?.extend!=='function'||!options||!options.includes('imotion_front_prod')||!options.includes('imotion_admin_prod'))throw new Error('imotion_marketing_project_schema_unexpected');
      if(options.includes('imotion_marketing_prod'))throw new Error('imotion_marketing_project_schema_already_present');
      const expanded=schema.extend({project:z.enum([...options,'imotion_marketing_prod'])});
      return target.tool(name,description,expanded,handler);
    };
    const v=target[prop];return typeof v==='function'?v.bind(target):v;
  }});
}
`;}
function patchProjectPlugin(source){
  if(source.includes('imotionMarketingProjectProxy')||source.includes('imotion_marketing_prod'))fail('project_plugin_marketing_patch_already_present');
  const re=/export function registerProjectPlugin\s*\(/g;
  const matches=[...source.matchAll(re)];if(matches.length!==1)fail('project_export_anchor_count:'+matches.length);
  let out=source;
  if(!/from\s*['"]zod['"]/.test(out))out="import { z } from 'zod';\n"+out;
  out=out.replace(/export function registerProjectPlugin\s*\(/,'function registerProjectPluginOriginal(');
  out+='\n'+projectProxySource()+"\nexport function registerProjectPlugin(mcp,context){return registerProjectPluginOriginal(imotionMarketingProjectProxy(mcp),context);}\n";
  return out;
}
function patchSafeFiles(source){
  if(source.includes("'imotion_marketing_prod'")||source.includes('"imotion_marketing_prod"'))fail('safe_files_marketing_target_already_present');
  const start='ExpandedTarget=z.enum([';const s=source.indexOf(start);if(s<0)fail('safe_files_enum_start_missing');const e=source.indexOf(']);',s);if(e<0)fail('safe_files_enum_end_missing');
  const body=source.slice(s,e);const marker="'imotion_admin_prod'";const i=body.indexOf(marker);if(i<0)fail('safe_files_admin_anchor_missing');if(body.indexOf(marker,i+1)>=0)fail('safe_files_admin_anchor_duplicate');
  const abs=s+i+marker.length;return source.slice(0,abs)+",'imotion_marketing_prod'"+source.slice(abs);
}
function replaceBoundSha(source,file,oldSha,newSha,required){
  if(!source.includes(file)){if(required)fail('zdt_path_missing:'+file);return source;}
  const re=new RegExp("(['\\\"]"+escapeRe(file)+"['\\\"]\\s*:\\s*['\\\"])"+oldSha+"(['\\\"])",'g');
  const matches=[...source.matchAll(re)];if(matches.length!==1)fail('zdt_sha_binding_count:'+file+':'+matches.length);
  return source.replace(re,'$1'+newSha+'$2');
}
function patchZdtManifest(source,newHashes){
  if(!newHashes||!/^[a-f0-9]{64}$/.test(newHashes.api)||!/^[a-f0-9]{64}$/.test(newHashes.project)||!/^[a-f0-9]{64}$/.test(newHashes.safeFiles))fail('zdt_new_hashes_invalid');
  let out=replaceBoundSha(source,PATHS.api,EXPECTED.api,newHashes.api,true);
  out=replaceBoundSha(out,PATHS.project,EXPECTED.project,newHashes.project,false);
  out=replaceBoundSha(out,PATHS.safeFiles,EXPECTED.safeFiles,newHashes.safeFiles,false);
  return out;
}
function syntaxCheck(label,bytes,ext){const dir=path.dirname(PATHS[label]||PATHS.zdt),tmp=path.join(dir,'.imotion-check-'+process.pid+'-'+Date.now()+ext);try{fs.writeFileSync(tmp,bytes,{mode:0o600,flag:'wx'});const r=cp.spawnSync('/usr/local/bin/prhm-node',['--check',tmp],{encoding:'utf8',timeout:15000,maxBuffer:200000});if(r.error||r.status!==0)fail('syntax_check_failed:'+label+':'+String(r.stderr||r.stdout||r.error?.message||'').slice(0,500));}finally{try{fs.unlinkSync(tmp)}catch{}}}
function verifyBaselines(){for(const [key,file] of Object.entries(PATHS)){const actual=sha(read(file));if(actual!==EXPECTED[key])fail('baseline_sha_mismatch:'+key+':'+actual);}return true;}
function buildCandidates(){
  const api=Buffer.from(patchAgentApiServer(read(PATHS.api).toString('utf8')),'utf8');
  const project=Buffer.from(patchProjectPlugin(read(PATHS.project).toString('utf8')),'utf8');
  const safeFiles=Buffer.from(patchSafeFiles(read(PATHS.safeFiles).toString('utf8')),'utf8');
  const hashes={api:sha(api),project:sha(project),safeFiles:sha(safeFiles)};
  const zdt=Buffer.from(patchZdtManifest(read(PATHS.zdt).toString('utf8'),hashes),'utf8');
  syntaxCheck('api',api,'.cjs');syntaxCheck('project',project,'.mjs');syntaxCheck('safeFiles',safeFiles,'.mjs');syntaxCheck('zdt',zdt,'.cjs');
  return{api,project,safeFiles,zdt,hashes:{...hashes,zdt:sha(zdt)}};
}
function preflight(){verifyBaselines();const c=buildCandidates();return{ok:true,schema_version:'prhm.host-action-preflight.v1',action:ACTION,preflight_only:true,target:TARGET,candidate_sha256:c.hashes,requires_zdt_refresh:true,production_site_mutation:false,database_mutation:false,redirect_mutation:false,canonical_mutation:false,deploy:false,external_network:false,token_read:false};}
function backupOriginals(){fs.mkdirSync(RESULT_DIR,{recursive:true,mode:0o700});const dir=path.join(RESULT_DIR,'backup-'+Date.now()+'-'+crypto.randomBytes(4).toString('hex'));fs.mkdirSync(dir,{mode:0o700});const states={};for(const [key,file] of Object.entries(PATHS)){const bytes=read(file),mode=modeOf(file),backup=path.join(dir,key+'.bak');fs.writeFileSync(backup,bytes,{mode:0o600,flag:'wx'});states[key]={file,mode,backup,sha256:sha(bytes)};}return{dir,states};}
function restore(backup,mutated){const failures=[];for(const key of [...mutated].reverse()){try{const s=backup.states[key],bytes=fs.readFileSync(s.backup);if(sha(bytes)!==s.sha256)throw new Error('backup_sha_mismatch');atomicBytes(s.file,bytes,s.mode);}catch(e){failures.push(key+':'+String(e.message||e));}}if(failures.length)fail('rollback_failed:'+failures.join('|'));}
function apply(){const started_at=new Date().toISOString();verifyBaselines();const c=buildCandidates(),backup=backupOriginals(),mutated=[];try{
  for(const key of ['api','project','safeFiles','zdt']){mutated.push(key);atomicBytes(PATHS[key],c[key],backup.states[key].mode);if(sha(read(PATHS[key]))!==c.hashes[key])fail('post_write_sha_mismatch:'+key);}
  const result={ok:true,schema_version:'prhm.host-action-result.v1',action:ACTION,started_at,finished_at:new Date().toISOString(),target:TARGET,registered_in_source:true,requires_zdt_refresh:true,candidate_sha256:c.hashes,backup_dir:backup.dir,production_site_mutation:false,database_mutation:false,redirect_mutation:false,canonical_mutation:false,deploy:false,external_network:false,token_read:false,rollback_performed:false,rollback:{performed:false}};
  atomicJson(RESULT,result);return result;
}catch(error){let rb=null;try{restore(backup,mutated);rb=true}catch(e){rb=false;throw new Error('imotion_marketing_target_failed_and_rollback_failed:'+String(error.message||error)+':'+String(e.message||e));}finally{try{atomicJson(RESULT,{ok:false,schema_version:'prhm.host-action-result.v1',action:ACTION,error:String(error.message||error).slice(0,1000),production_site_mutation:false,database_mutation:false,redirect_mutation:false,canonical_mutation:false,deploy:false,external_network:false,token_read:false,rollback_performed:rb,rollback:{performed:rb}})}catch{}}throw new Error('imotion_marketing_target_failed_rolled_back:'+String(error.message||error));}}
if(require.main===module){try{const out=process.argv.includes('--preflight-only')?preflight():apply();process.stdout.write(JSON.stringify(out)+'\n');}catch(error){process.stderr.write(String(error?.stack||error)+'\n');process.exitCode=1;}}
module.exports={ACTION,TARGET,PATHS,EXPECTED,sha,injectImotionMarketingProject,patchAgentApiServer,patchProjectPlugin,patchSafeFiles,patchZdtManifest,preflight,apply};
