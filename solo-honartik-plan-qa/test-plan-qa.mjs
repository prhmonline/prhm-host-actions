import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableAuditQueue,makeBucketId} from './queue.mjs';
import {EVENTS,ORIGIN,performChecks,runOnce} from './plan-qa.mjs';

const perEvent=[
  {id:61,title:'تاکسیدرمی',schedule:413,total:'۲۰',sold:'۲',free:'۱۸'},
  {id:63,title:'عروس ناخدا',schedule:422,total:'۱۲',sold:'۳',free:'۹'}
];
function eventHtml(e){
 return '<html><head><title>خرید بلیت '+e.title+' | هنرتیک</title></head>'+
  '<body><a href="/theater/'+e.id+'?schedule_id='+e.schedule+'#seat-panel">سانس</a>'+
  '<a href="/seat-selection/'+e.schedule+'">مشاهده پلان</a></body></html>';
}
function planHtml(e){
 const seatMarkup=Array.from({length:25},(_,i)=>'<button data-seat="'+(i+1)+'"></button>').join('');
 return '<html><head><title>انتخاب صندلی | هنرتیک</title></head>'+
 '<body><a href="/login?ref=%2Fseat-selection%2F'+e.schedule+'">ورود</a>'+
 '<a href="/theater/'+e.id+'">تئاتر</a>'+
 '<p>نمایش همه '+e.total+' صندلی '+e.sold+' فروخته‌شده</p>'+
 '<p>انتخاب صندلی '+e.free+' صندلی آزاد</p>'+seatMarkup+'</body></html>';
}
function fakeFetch(edits={}){
 const called=[];
 const fn=async(url,options)=>{
   called.push({url,method:options.method,redirect:options.redirect,hasAuth:Object.keys(options.headers||{}).some(k=>/auth|cookie/i.test(k))});
   assert.equal(options.method,'GET');
   assert.equal(options.redirect,'manual');
   assert.ok(url.startsWith(ORIGIN+'/'));
   const path=url.slice(ORIGIN.length);
   if(path==='/login')return {status:200,text:async()=>'<title>ورود و ثبت نام</title>شماره تلفن'};
   for(const event of perEvent){
     if(path==='/theater/'+event.id)return {status:200,text:async()=>edits.event?.(event)||eventHtml(event)};
     if(path==='/seat-selection/'+event.schedule)return {status:200,text:async()=>edits.plan?.(event)||planHtml(event)};
   }
   throw Error('unexpected_target_'+path);
 };
 return {fn,called};
}
async function sandbox(fn){
 const dir=await mkdtemp(join(tmpdir(),'honartik-plan-qa-'));
 try{return await fn({dir,queue:new DurableAuditQueue({file:join(dir,'queue.json'),stopFile:join(dir,'STOP')})})}
 finally{await rm(dir,{recursive:true,force:true})}
}
test('fixed two public shows only; no payment/login/seat-selection submission',()=>{
 assert.deepEqual(EVENTS.map(x=>x.id),[61,63]);
 assert.equal(ORIGIN,'https://honartik.ir');
});
test('17 contract checks pass and capacity math supports Persian digits',async()=>{
 const {fn,called}=fakeFetch();
 const r=await performChecks(fn);
 assert.equal(r.checks.length,17);
 assert.ok(r.checks.every(x=>x.result==='pass'));
 assert.equal(r.metrics[0].total,20);
 assert.equal(r.metrics[0].sold,2);
 assert.equal(r.metrics[0].free,18);
 assert.equal(r.metrics[1].showtime_id,422);
 assert.equal(called.length,5);
 assert.ok(called.every(x=>x.method==='GET'&&!x.hasAuth&&x.redirect==='manual'));
});
test('wrong seat arithmetic is a critical persistent failure',async()=>sandbox(async ({queue})=>{
 const {fn}=fakeFetch({plan:e=>e.id===61?planHtml({...e,free:'۱۷'}):planHtml(e)});
 const r=await runOnce({queue,fetchImpl:fn,now:1800000000000});
 assert.equal(r.status,'failed');assert.equal(r.severity,'critical');
 assert.ok(r.checks.some(x=>x.id==='taxidermy_seat_math'&&x.result==='fail'));
 assert.equal((await queue.snapshot()).jobs[0].error_code,'qa_plan_contract_failed');
}));
test('guest login return link absence fails closed',async()=>{
 const {fn}=fakeFetch({plan:e=>e.id===63?planHtml(e).replace('/login?ref=%2Fseat-selection%2F422','/login'):planHtml(e)});
 const r=await performChecks(fn);
 assert.equal(r.checks.find(x=>x.id==='captain_bride_login_return').result,'fail');
});
test('out-of-scope showtime is not probed and all dependent checks fail',async()=>{
 const {fn,called}=fakeFetch({event:e=>e.id===61?eventHtml(e).replace('schedule_id=413','schedule_id=999'):eventHtml(e)});
 const r=await performChecks(fn);
 assert.equal(r.checks.find(x=>x.id==='taxidermy_showtime').result,'fail');
 assert.equal(r.checks.find(x=>x.id==='taxidermy_plan_http').result,'fail');
 assert.equal(called.some(x=>x.url.endsWith('/seat-selection/999')),false);
});
test('durable report stored, repeated hour idempotent and contains no HTML',async()=>sandbox(async ({dir,queue})=>{
 const {fn,called}=fakeFetch();
 const now=1800000000000;
 const first=await runOnce({queue,fetchImpl:fn,now});
 assert.equal(first.status,'succeeded');
 assert.equal(first.checks.length,17);
 assert.equal(first.mutation_count,0);
 assert.equal(first.browser_executed,false);
 const recheck=await runOnce({queue,fetchImpl:fn,now});
 assert.equal(recheck.status,'idle');
 assert.equal(called.length,5);
 const record=(await queue.snapshot()).jobs[0];
 assert.equal(record.evidence_count,17);
 assert.equal(record.status,'succeeded');
 assert.doesNotMatch(await readFile(dir+'/queue.json','utf8'),/data-seat=|شماره تلفن|href=|cookie|Bearer/);
}));
test('protected STOP file prevents every outbound GET',async()=>sandbox(async ({dir,queue})=>{
 await writeFile(dir+'/STOP','');
 let calls=0;
 const r=await runOnce({queue,fetchImpl:async()=>{calls++;throw Error('must-not-run')}});
 assert.equal(r.status,'stopped');assert.equal(calls,0);
 assert.equal((await queue.snapshot()).jobs.length,0);
}));
test('lease expiry and corrupt data fail closed',async()=>sandbox(async ({dir,queue})=>{
 await queue.schedule('qa-honartik-1');
 await queue.claim({leaseMs:1});
 await writeFile(dir+'/queue.json','INVALID');
 await assert.rejects(()=>queue.claim());
 assert.equal(await readFile(dir+'/queue.json','utf8'),'INVALID');
}));
test('hourly bucket uniqueness',()=>{
 assert.equal(makeBucketId(1800000000000),makeBucketId(1800000001000));
 assert.notEqual(makeBucketId(1800000000000),makeBucketId(1800003600000));
});
