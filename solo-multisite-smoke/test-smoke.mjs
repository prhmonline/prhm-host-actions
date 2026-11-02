import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableAuditQueue} from './queue.mjs';
import {TARGETS,checkSite,performChecks,runOnce} from './smoke.mjs';
async function sandbox(fn){
 const dir=await mkdtemp(join(tmpdir(),'prhm-smoke-'));
 try{return await fn({dir,queue:new DurableAuditQueue({file:dir+'/queue.json',stopFile:dir+'/STOP'})})}
 finally{await rm(dir,{recursive:true,force:true})}
}
const fakeFetch=async (url,options)=>{
 const target=TARGETS.find(x=>x.url===url);
 assert.ok(target);
 assert.equal(options.redirect,'manual');
 assert.equal(options.method,'GET');
 return {status:target.status,headers:{get:name=>name==='location'?target.redirect:null}};
};
test('exact five public origins only, no credentials or arbitrary routes',()=>{
 assert.deepEqual(TARGETS.map(x=>x.id),
 ['honartik_front','honartik_admin','imotion_front','imotion_admin','drtarjomeh_front']);
 assert.ok(TARGETS.every(x=>x.url.startsWith('https://')));
});
test('all five fixed 200/301/302 responses pass',async()=>{
 assert.deepEqual((await performChecks(fakeFetch)).map(x=>x.result),['pass','pass','pass','pass','pass']);
});
test('redirect to wrong host fails even when HTTP 302',async()=>{
 const target=TARGETS[1];
 const x=await checkSite(target,async()=>({status:302,
   headers:{get:()=> 'https://attacker.example/login'}}));
 assert.equal(x.result,'fail');
});
test('timeout/error becomes failed fixed code and contains no response body',async()=>{
 const x=await checkSite(TARGETS[0],async()=>{throw new Error('SECRET_BODY')});
 assert.deepEqual(x,{id:'honartik_front',result:'fail'});
});
test('durable result persists and 30-minute duplicate returns idle',async()=>sandbox(async ({dir,queue})=>{
 const now=1800000000000;
 const first=await runOnce({queue,fetchImpl:fakeFetch,now});
 assert.equal(first.status,'succeeded');
 assert.equal(first.checks.length,5);
 assert.equal((await queue.snapshot()).jobs[0].evidence_count,5);
 assert.equal((await runOnce({queue,fetchImpl:fakeFetch,now})).status,'idle');
 assert.doesNotMatch(await readFile(dir+'/queue.json','utf8'),/attacker.example|secret_body/i);
}));
test('target failure recorded as critical, no mutation',async()=>sandbox(async ({queue})=>{
 const faulty=async(url,opts)=>{
   if(url===TARGETS[2].url)return {status:503,headers:{get:()=>null}};
   return fakeFetch(url,opts);
 };
 const r=await runOnce({queue,fetchImpl:faulty,now:1800000000000});
 assert.equal(r.status,'failed');assert.equal(r.severity,'critical');
 assert.equal(r.mutation_count,0);
 assert.equal((await queue.snapshot()).jobs[0].error_code,'smoke_http_failure');
 assert.equal((await queue.snapshot()).jobs[0].checks.find(c=>c.id==='imotion_front').result,'fail');
}));
test('STOP prevents all network requests',async()=>sandbox(async ({dir,queue})=>{
 await writeFile(dir+'/STOP','');
 const result=await runOnce({queue,fetchImpl:async()=>{throw Error('should_not_execute')}});
 assert.equal(result.status,'stopped');assert.equal((await queue.snapshot()).jobs.length,0);
}));
test('lease recovery and corrupt journal fail closed',async()=>sandbox(async ({dir,queue})=>{
 await queue.schedule('qa-public-1');
 await queue.claim({leaseMs:1});
 assert.equal((await queue.snapshot()).jobs[0].status,'running');
 await writeFile(dir+'/queue.json','INVALID');
 await assert.rejects(()=>queue.claim());
 assert.equal(await readFile(dir+'/queue.json','utf8'),'INVALID');
}));
