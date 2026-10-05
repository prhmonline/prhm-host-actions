'use strict';
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');

const ACTION='mcp_selfmaint_level3_wrapper_repair_v1';
const TARGET='/home/agent/ssh-mcp-server/server.js';
const EXPECTED_SHA256='831c872f80917eb976bbdb9fa320f74528542656720e02df12c82508b149d185';
const BACKUP_ROOT='/var/backups/prhm-mcp-selfmaint-level3-wrapper-repair-v1';
const LEVEL3='CONFIRM_LEVEL_3_PRODUCTION';
const LEVEL4='CONFIRM_LEVEL_4_CRITICAL';
const ZOD_IMPORT_ANCHOR="import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';";
const ZOD_IMPORT="import { z } from 'zod';";
const HANDLER_ANCHOR='let titanOpsHandler=null;';
const REGISTER_OLD='  return previousRegisterTool.call(this,name,config,next,...rest);';
const REGISTER_NEW='  return previousRegisterTool.call(this,name,selfmaintApplyConfig(name,config),next,...rest);';
const TOOL_OLD='  return previousTool.call(this,name,description,schema,next,...rest);';
const TOOL_NEW='  return previousTool.call(this,name,selfmaintApplyDescription(name,description),selfmaintApplySchema(name,schema),next,...rest);';
const HELPER=`const SELFMAINT_APPLY='selfmaint_apply';\nconst SELFMAINT_LEVEL3='${LEVEL3}';\nconst SELFMAINT_LEVEL4='${LEVEL4}';\nfunction selfmaintApplySchema(name,schema){\n  if(name!==SELFMAINT_APPLY)return schema;\n  if(!schema||typeof schema!=='object'||Array.isArray(schema)||!Object.prototype.hasOwnProperty.call(schema,'second_confirmation'))throw new Error('selfmaint_apply_schema_invalid');\n  return {...schema,second_confirmation:z.union([z.literal(SELFMAINT_LEVEL3),z.literal(SELFMAINT_LEVEL4)])};\n}\nfunction selfmaintApplyConfig(name,config){\n  if(name!==SELFMAINT_APPLY)return config;\n  if(!config||typeof config!=='object'||Array.isArray(config)||!config.inputSchema)throw new Error('selfmaint_apply_config_invalid');\n  return {...config,description:'Apply one stored SHA-bound self-maintenance request using the exact confirmation required by its stored approval level.',inputSchema:selfmaintApplySchema(name,config.inputSchema)};\n}\nfunction selfmaintApplyDescription(name,description){return name===SELFMAINT_APPLY?'Apply one stored SHA-bound self-maintenance request using the exact confirmation required by its stored approval level.':description;}`;

const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const count=(s,n)=>String(s).split(String(n)).length-1;
function replaceOne(source,before,after,label){const n=count(source,before);if(n!==1)throw new Error(`mcp_level3_anchor_mismatch:${label}:${n}`);return source.replace(before,after);}
function transformWrapper(source){
  const bytes=Buffer.from(String(source),'utf8');
  if(sha(bytes)!==EXPECTED_SHA256)throw new Error('mcp_level3_wrapper_preimage_sha_mismatch');
  let next=String(source);
  if(count(next,ZOD_IMPORT)!==0)throw new Error('mcp_level3_zod_import_already_present');
  if(count(next,'SELFMAINT_LEVEL3')!==0||count(next,'selfmaintApplyConfig')!==0)throw new Error('mcp_level3_repair_marker_already_present');
  next=replaceOne(next,ZOD_IMPORT_ANCHOR,`${ZOD_IMPORT_ANCHOR}\n${ZOD_IMPORT}`,'zod_import');
  next=replaceOne(next,HANDLER_ANCHOR,`${HANDLER_ANCHOR}\n\n${HELPER}`,'helper');
  next=replaceOne(next,REGISTER_OLD,REGISTER_NEW,'register_tool');
  next=replaceOne(next,TOOL_OLD,TOOL_NEW,'legacy_tool');
  for(const required of [LEVEL3,LEVEL4,REGISTER_NEW,TOOL_NEW,ZOD_IMPORT])if(!next.includes(required))throw new Error('mcp_level3_candidate_postcondition_missing');
  const candidate=Buffer.from(next,'utf8');
  return {source:next,sha256:sha(candidate),bytes:candidate};
}
function syntaxCheck(file){const r=cp.spawnSync(process.execPath,['--check',file],{encoding:'utf8',timeout:30000,maxBuffer:300000});if(r.error||r.status!==0)throw new Error(`mcp_level3_candidate_syntax_invalid:${String(r.stderr||r.stdout||r.error).slice(-1000)}`);}
function assertRegular(file){const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(file)!==file)throw new Error('mcp_level3_target_invalid');return st;}
function writeAtomic(file,bytes,st){const tmp=`${file}.mcp-level3-${process.pid}-${Date.now()}.mjs`;fs.writeFileSync(tmp,bytes,{flag:'wx',mode:st.mode&0o777});fs.chownSync(tmp,st.uid,st.gid);fs.chmodSync(tmp,st.mode&0o777);syntaxCheck(tmp);fs.renameSync(tmp,file);}
function applyToPath({target,backupRoot,injectFailure=false}){
  const st=assertRegular(target),original=fs.readFileSync(target);
  if(sha(original)!==EXPECTED_SHA256)throw new Error('mcp_level3_wrapper_preimage_sha_mismatch');
  const candidate=transformWrapper(original.toString('utf8'));
  fs.mkdirSync(backupRoot,{recursive:true,mode:0o700});
  const backup=path.join(backupRoot,`server-${Date.now()}-${EXPECTED_SHA256}.bak`);
  fs.writeFileSync(backup,original,{flag:'wx',mode:0o600});
  let mutated=false;
  try{
    writeAtomic(target,candidate.bytes,st);mutated=true;
    if(injectFailure)throw new Error('injected_after_wrapper_write');
    if(sha(fs.readFileSync(target))!==candidate.sha256)throw new Error('mcp_level3_wrapper_postwrite_sha_mismatch');
    return {ok:true,action:ACTION,old_sha256:EXPECTED_SHA256,new_sha256:candidate.sha256,backup_path:backup,rollback_performed:false};
  }catch(error){
    if(mutated){try{writeAtomic(target,original,st);if(sha(fs.readFileSync(target))!==EXPECTED_SHA256)throw new Error('rollback_sha_mismatch');}catch(rb){throw new Error(`mcp_level3_repair_failed_rollback_failed:${error.message}:${rb.message}`);}error.rollback_performed=true;}
    throw error;
  }
}
function apply(){if(process.getuid&&process.getuid()!==0)throw new Error('root_required');return applyToPath({target:TARGET,backupRoot:BACKUP_ROOT});}
module.exports={ACTION,TARGET,EXPECTED_SHA256,LEVEL3,LEVEL4,transformWrapper,applyToPath,apply};
if(require.main===module){const mode=process.argv[2]||'preflight';if(mode==='preflight'){const st=assertRegular(TARGET),source=fs.readFileSync(TARGET),candidate=transformWrapper(source.toString('utf8'));process.stdout.write(JSON.stringify({ok:true,action:ACTION,preflight_only:true,current_sha256:sha(source),candidate_sha256:candidate.sha256,mode:st.mode&0o777})+'\n');}else if(mode==='apply')process.stdout.write(JSON.stringify(apply())+'\n');else throw new Error('unexpected_arguments');}
