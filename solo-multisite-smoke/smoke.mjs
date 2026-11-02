import {pathToFileURL} from 'node:url';
import {DurableAuditQueue,makeBucketId} from './queue.mjs';

const fail=c=>{throw Object.assign(new Error(c),{code:c})};
export const TARGETS=Object.freeze([
  Object.freeze({id:'honartik_front',url:'https://honartik.ir/',status:200,redirect:null}),
  Object.freeze({id:'honartik_admin',url:'https://dashboard.honartik.ir/',status:302,redirect:'https://dashboard.honartik.ir/login'}),
  Object.freeze({id:'imotion_front',url:'https://i-motion.ir/',status:301,redirect:'https://imotion.ir/gym/'}),
  Object.freeze({id:'imotion_admin',url:'https://admin.i-motion.ir/',status:302,redirect:'https://admin.i-motion.ir/login'}),
  Object.freeze({id:'drtarjomeh_front',url:'https://drtarjomeh.ir/',status:200,redirect:null})
]);
export async function checkSite(target,fetchImpl=fetch){
  try{
    const response=await fetchImpl(target.url,{
      method:'GET',redirect:'manual',signal:AbortSignal.timeout(7000),
      headers:{'accept':'text/html'}
    });
    const found=response.headers?.get?.('location')||null;
    let validLocation=!target.redirect;
    if(target.redirect){
      try{validLocation=new URL(found,target.url).href===target.redirect}catch{validLocation=false}
    }
    return {id:target.id,result:response.status===target.status&&validLocation?'pass':'fail'};
  }catch{return {id:target.id,result:'fail'}}
}
export async function performChecks(fetchImpl=fetch){
  const findings=[];
  for(const target of TARGETS)findings.push(await checkSite(target,fetchImpl));
  return findings;
}
export async function runOnce({queue,fetchImpl=fetch,now=Date.now()}={}){
  if(!queue||typeof fetchImpl!=='function')fail('smoke_dependencies_missing');
  if(await queue.stopped())return {status:'stopped',executed:false};
  await queue.schedule(makeBucketId(now));
  const claimed=await queue.claim();
  if(!claimed)return {status:'idle',executed:false};
  if(await queue.stopped()){
    await queue.complete(claimed.id,{status:'failed',errorCode:'smoke_kill_switch'});
    return {status:'stopped',executed:false};
  }
  try{
    const checks=await performChecks(fetchImpl);
    const healthy=checks.every(c=>c.result==='pass');
    await queue.complete(claimed.id,{status:healthy?'succeeded':'failed',
      evidenceCount:checks.length,checks,severity:healthy?'none':'critical',
      summary:healthy?'fixed_public_smoke_pass':'fixed_public_smoke_failure',
      errorCode:healthy?null:'smoke_http_failure'});
    return {status:healthy?'succeeded':'failed',id:claimed.id,
      severity:healthy?'none':'critical',checks,mutation_count:0};
  }catch{
    await queue.complete(claimed.id,{status:'failed',errorCode:'smoke_internal_error',
      severity:'critical'});
    return {status:'failed',id:claimed.id,mutation_count:0};
  }
}
async function main(){
  if(process.argv.length!==3||!['--once','--status'].includes(process.argv[2]))
    fail('smoke_explicit_mode_required');
  const dir=process.env.SOLO_SMOKE_STATE_DIR;
  if(typeof dir!=='string'||!dir.startsWith('/var/lib/prhm-sites-smoke'))
    fail('smoke_state_path_invalid');
  const queue=new DurableAuditQueue({file:dir+'/queue.json',stopFile:dir+'/STOP'});
  if(process.argv[2]==='--status'){
    const d=await queue.snapshot();
    process.stdout.write(JSON.stringify({schema:d.schema,stopped:await queue.stopped(),
      jobs:d.jobs.length,recent:d.jobs.slice(-6).map(x=>({
        id:x.id,status:x.status,severity:x.severity,
        checks:x.checks,attempts:x.attempts,evidence_count:x.evidence_count
      }))})+'\n');
    return;
  }
  const result=await runOnce({queue});
  process.stdout.write(JSON.stringify(result)+'\n');
  if(result.status==='failed')process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  main().catch(e=>{
    process.stderr.write('SMOKE_FAILED='+String(e?.code||'unknown').slice(0,64)+'\n');
    process.exitCode=2;
  });
