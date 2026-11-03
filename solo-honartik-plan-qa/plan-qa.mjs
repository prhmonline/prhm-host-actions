import {pathToFileURL} from 'node:url';
import {DurableAuditQueue,makeBucketId} from './queue.mjs';

// Production reads are deliberately limited to public HTML GETs.
// No cookies, seat selection, locking, login submission or checkout.
export const ORIGIN='https://honartik.ir';
export const EVENTS=Object.freeze([
  Object.freeze({id:61,name:'تاکسیدرمی',key:'taxidermy'}),
  Object.freeze({id:63,name:'عروس ناخدا',key:'captain_bride'})
]);
const CODE=/^[a-z0-9_]{1,64}$/;
const fail=c=>{throw Object.assign(new Error(c),{code:c})};

function countMarker(raw,needle){
  return raw.split(needle).length-1;
}
function numberOf(input){
  if(typeof input!=='string')return NaN;
  const normalized=input.replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-0x6f0))
    .replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-0x660))
    .replace(/[٬,]/g,'');
  return /^\d{1,7}$/.test(normalized)?Number(normalized):NaN;
}
function plainText(html){
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ')
    .replace(/\s+/g,' ').trim();
}
function hasTitle(html,pattern){
  const title=(html.match(/<title[^>]*>([^<]*)<\/title>/i)||[])[1]||'';
  return pattern.test(title);
}
function check(id,pass){return {id,result:pass?'pass':'fail'}}
async function getHtml(fetchImpl,path){
  if(!/^\/(theater\/(?:61|63)|seat-selection\/\d{1,9}|login)$/.test(path))
    fail('qa_unapproved_path');
  const response=await fetchImpl(ORIGIN+path,{
    method:'GET',redirect:'manual',cache:'no-store',
    headers:{accept:'text/html'},signal:AbortSignal.timeout(9000)
  });
  if(response?.status!==200)return {status:response?.status??0,html:''};
  const html=await response.text();
  if(typeof html!=='string'||html.length>1_500_000)
    fail('qa_unexpected_response_size');
  return {status:200,html};
}
export async function performChecks(fetchImpl=fetch){
  const checks=[],metrics=[];
  const login=await getHtml(fetchImpl,'/login');
  checks.push(check('login_page',
    login.status===200&&hasTitle(login.html,/ورود/)&&login.html.includes('شماره تلفن')));
  for(const event of EVENTS){
    const prefix=event.key;
    const detail=await getHtml(fetchImpl,'/theater/'+event.id);
    checks.push(check(prefix+'_event_http',detail.status===200));
    checks.push(check(prefix+'_event_title',hasTitle(detail.html,new RegExp(event.name))));
    const seatId=(detail.html.match(/href=["']\/seat-selection\/(\d{1,9})["']/i)||[])[1]||'';
    const validSeatId=/^\d{1,9}$/.test(seatId) &&
      detail.html.includes('schedule_id='+seatId);
    checks.push(check(prefix+'_showtime',validSeatId));
    if(!validSeatId){
      for(const suffix of ['plan_http','plan_title','seat_markup','seat_math','login_return'])
        checks.push(check(prefix+'_'+suffix,false));
      continue;
    }
    const plan=await getHtml(fetchImpl,'/seat-selection/'+seatId);
    checks.push(check(prefix+'_plan_http',plan.status===200));
    checks.push(check(prefix+'_plan_title',hasTitle(plan.html,/انتخاب صندلی/)));
    const text=plainText(plan.html);
    const summary=text.match(/نمایش همه\s*([0-9۰-۹٠-٩,٬]+)\s*صندلی\s*([0-9۰-۹٠-٩,٬]+)\s*فروخته/);
    const free=text.match(/انتخاب صندلی\s*([0-9۰-۹٠-٩,٬]+)\s*صندلی آزاد/);
    const total=numberOf(summary?.[1]),sold=numberOf(summary?.[2]),available=numberOf(free?.[1]);
    checks.push(check(prefix+'_seat_markup',Number.isSafeInteger(total)&&total>0&&
      countMarker(plan.html,'data-seat')>=total));
    const mathValid=Number.isSafeInteger(total)&&Number.isSafeInteger(sold)&&
      Number.isSafeInteger(available)&&total>0&&sold>=0&&available>=0&&
      sold+available===total;
    checks.push(check(prefix+'_seat_math',mathValid));
    checks.push(check(prefix+'_login_return',
      plan.html.includes('/login?ref=%2Fseat-selection%2F'+seatId)&&
      plan.html.includes('/theater/'+event.id)));
    metrics.push({event_id:event.id,showtime_id:Number(seatId),
      total:Number.isFinite(total)?total:null,
      sold:Number.isFinite(sold)?sold:null,
      free:Number.isFinite(available)?available:null});
  }
  return {checks,metrics};
}
export async function runOnce({queue,fetchImpl=fetch,now=Date.now()}={}){
  if(!queue||typeof fetchImpl!=='function')fail('qa_dependencies_missing');
  if(await queue.stopped())return {status:'stopped',executed:false};
  await queue.schedule(makeBucketId(now));
  const job=await queue.claim();
  if(!job)return {status:'idle',executed:false};
  if(await queue.stopped()){
    await queue.complete(job.id,{status:'failed',errorCode:'qa_kill_switch'});
    return {status:'stopped',executed:false};
  }
  try{
    const {checks,metrics}=await performChecks(fetchImpl);
    const healthy=checks.length===17&&checks.every(x=>x.result==='pass');
    await queue.complete(job.id,{status:healthy?'succeeded':'failed',
      summary:healthy?'honartik_guest_plan_ssr_pass':'honartik_guest_plan_ssr_failure',
      errorCode:healthy?null:'qa_plan_contract_failed',
      severity:healthy?'none':'critical',checks,evidenceCount:checks.length});
    return {status:healthy?'succeeded':'failed',id:job.id,
      severity:healthy?'none':'critical',checks,metrics,mutation_count:0,
      browser_executed:false,transaction_executed:false};
  }catch(e){
    const code=CODE.test(String(e?.code||''))?e.code:'qa_readonly_execution_failed';
    await queue.complete(job.id,{status:'failed',errorCode:code,severity:'critical'});
    return {status:'failed',id:job.id,error_code:code,mutation_count:0};
  }
}
async function main(){
  if(process.argv.length!==3||!['--once','--status'].includes(process.argv[2]))
    fail('qa_explicit_mode_required');
  const dir=process.env.SOLO_PLAN_QA_STATE_DIR;
  if(typeof dir!=='string'||!dir.startsWith('/var/lib/prhm-honartik-plan-qa'))
    fail('qa_runtime_state_path_invalid');
  const queue=new DurableAuditQueue({file:dir+'/queue.json',stopFile:dir+'/STOP'});
  if(process.argv[2]==='--status'){
    const data=await queue.snapshot();
    process.stdout.write(JSON.stringify({schema:data.schema,stopped:await queue.stopped(),
      jobs:data.jobs.length,recent:data.jobs.slice(-6).map(x=>({
        id:x.id,status:x.status,severity:x.severity,checks:x.checks,
        evidence_count:x.evidence_count,error_code:x.error_code
      }))})+'\n');return;
  }
  const result=await runOnce({queue});
  process.stdout.write(JSON.stringify(result)+'\n');
  if(result.status==='failed')process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  main().catch(e=>{
    process.stderr.write('HONARTIK_PLAN_QA_ERROR='+String(e?.code||'qa_unexpected_failure').slice(0,64)+'\n');
    process.exitCode=2;
  });
