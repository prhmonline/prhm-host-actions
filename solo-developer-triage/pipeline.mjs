import {readFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gather,readNoFollow} from './collect.mjs';
import {STATE_SCHEMA,runOnce,atomicWrite} from './triage.mjs';

const ROOT='/var/lib/prhm-developer-triage';
const fail=code=>{throw Object.assign(new Error(code),{code})};
export async function runPipeline({now=Date.now(),load=source=>readNoFollow(source.file),
  loadState,saveState,stopped}={}){
  if(typeof loadState!=='function'||typeof saveState!=='function'||typeof stopped!=='function')
    fail('developer_pipeline_dependencies_missing');
  if(await stopped())return {status:'stopped',processed:0};
  const evidence=await gather({now,load});
  const result=await runOnce({evidence,loadState,saveState,stopped,now});
  return {...result,qa_sources_checked:3,incident_count:evidence.findings.length,
    network_access:false,git_access:false};
}
async function main(){
  if(process.argv.length!==3||process.argv[2]!=='--once')
    fail('developer_pipeline_mode_required');
  if(process.getuid?.()!==0)fail('developer_fixed_root_reader_required');
  if(process.env.SOLO_DEVELOPER_STATE_DIR!==ROOT)
    fail('developer_state_path_invalid');
  const file=join(ROOT,'proposals.json');
  const stop=join(ROOT,'STOP');
  const stopped=async()=>{try{await access(stop);return true}
    catch(e){if(e.code==='ENOENT')return false;throw e}};
  const loadState=async()=>{try{return JSON.parse(await readFile(file,'utf8'))}
    catch(e){if(e.code==='ENOENT')return {schema:STATE_SCHEMA,proposals:[]};throw e}};
  const result=await runPipeline({loadState,
    saveState:data=>atomicWrite(file,data),stopped});
  process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  main().catch(e=>{
    process.stderr.write('DEVELOPER_PIPELINE_ERROR='+String(e?.code||'developer_error').slice(0,72)+'\n');
    process.exitCode=2;
  });
