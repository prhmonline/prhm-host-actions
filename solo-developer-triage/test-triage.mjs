import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {SCHEMA,SOURCES,sanitizeQueue,gather} from './collect.mjs';
import {STATE_SCHEMA,validateEvidence,runOnce} from './triage.mjs';
import {runPipeline} from './pipeline.mjs';

const NOW=1800000000000;
const qaJob=(extra={})=>({
 id:'qa-honartik-500',
 status:'failed',severity:'critical',
 updated_at:NOW,attempts:1,summary:'Bearer SHOULD_NEVER_LEAK',
 checks:[{id:'taxidermy_seat_math',result:'fail'},
         {id:'login_page',result:'pass'}],
 raw_debug_info:'customer phone 09123456789',
 ...extra
});
const queue=(source,jobs)=>({schema:source.schema,jobs});
function baseline(){
 let stored={schema:STATE_SCHEMA,proposals:[]};
 const saves=[];
 return {
  loadState:async()=>structuredClone(stored),
  saveState:async s=>{stored=structuredClone(s);saves.push(structuredClone(s));},
  stopped:async()=>false,
  get:()=>stored,saves
 };
}
test('all three QA sources are pinned, not caller-selected',()=>{
 assert.deepEqual(SOURCES.map(x=>x.id),['cfpark','multisite','honartik_plan']);
 assert.ok(SOURCES.every(x=>x.file.startsWith('/var/lib/private/')));
});
test('redact raw PII, tokens, HTML, statuses and retain only explicit finding codes',()=>{
 const src=SOURCES[2];
 const events=sanitizeQueue(src,queue(src,[qaJob()]),NOW);
 assert.equal(events.length,1);
 assert.equal(events[0].project,'honartik_plan');
 assert.deepEqual(events[0].failed_checks,[{id:'taxidermy_seat_math',result:'fail'}]);
 assert.equal(events[0].severity,'critical');
 assert.match(events[0].fingerprint,/^[a-f0-9]{64}$/);
 const json=JSON.stringify(events);
 assert.doesNotMatch(json,/09123456789|Bearer|SHOULD_NEVER_LEAK|customer phone|raw_debug/);
});
test('healthy and old QA jobs create no incident; warnings remain warnings',()=>{
 const src=SOURCES[0];
 assert.deepEqual(sanitizeQueue(src,queue(src,[
  qaJob({id:'old',updated_at:NOW-200000000}),
  qaJob({id:'newhealthy',status:'succeeded',severity:'none',checks:[]})
 ]),NOW),[]);
 const warning=sanitizeQueue(src,queue(src,[
  qaJob({id:'warning-1',status:'succeeded',severity:'warning',
    checks:[{id:'git_clean',result:'warn'}]})
 ]),NOW);
 assert.equal(warning[0].severity,'warning');
});
test('collector validates all source schemas, fixed reader and output length',async()=>{
 const critical=SOURCES[2];
 const evidence=await gather({now:NOW,load:async src=>queue(src,
  src.id===critical.id?[qaJob()]:[])});
 assert.equal(evidence.schema,SCHEMA);
 assert.equal(evidence.findings.length,1);
 assert.equal(evidence.findings[0].project,'honartik_plan');
 await assert.rejects(()=>gather({now:NOW,load:async src=>queue({...src,schema:'wrong'},[])}),/developer_source_schema_invalid/);
});
test('data poisoning, invalid check IDs and unknown project are rejected',()=>{
 const src=SOURCES[0];
 assert.throws(()=>sanitizeQueue(src,{schema:src.schema,jobs:[qaJob({
  checks:[{id:'../etc/shadow',result:'fail'}]})]},NOW),/developer_qa_check_invalid/);
 assert.throws(()=>validateEvidence({schema:SCHEMA,findings:[{
  fingerprint:'a'.repeat(64),project:'fake-project',
  qa_job_id:'qa-0',severity:'critical',updated_at:NOW,failed_checks:[]
 }]}),/developer_evidence_invalid/);
});
test('isolated critical QA becomes a bounded review-only proposal, never code/PR/deploy',async()=>{
 const src=SOURCES[2],evidence={schema:SCHEMA,generated_at:NOW,
   findings:sanitizeQueue(src,queue(src,[qaJob()]),NOW)};
 const ctx=baseline();
 const one=await runOnce({evidence,...ctx,now:NOW});
 assert.equal(one.status,'proposals_created');
 assert.equal(one.new_proposals,1);
 assert.equal(one.code_changes_made,false);
 assert.equal(one.pull_requests_created,false);
 assert.equal(one.production_mutations,0);
 const proposal=ctx.get().proposals[0];
 assert.equal(proposal.action_code,'inspect_guest_plan_regression');
 assert.equal(proposal.status,'awaiting_human_review');
 assert.equal(proposal.source_repository,null);
 assert.equal(proposal.code_changes_made,false);
 assert.equal(proposal.deployment_performed,false);
 const again=await runOnce({evidence,...ctx,now:NOW});
 assert.equal(again.status,'idle');
 assert.equal(ctx.get().proposals.length,1);
 assert.equal(ctx.saves.length,1);
});
test('kill switch prevents proposal writes, even with critical input',async()=>{
 const src=SOURCES[2],evidence={schema:SCHEMA,
  findings:sanitizeQueue(src,queue(src,[qaJob()]),NOW)};
 const ctx=baseline();
 const res=await runOnce({evidence,...ctx,stopped:async()=>true});
 assert.equal(res.status,'stopped');
 assert.equal(ctx.get().proposals.length,0);
 assert.equal(ctx.saves.length,0);
});
test('corrupted proposal state fails closed without overwrite',async()=>{
 const src=SOURCES[2],evidence={schema:SCHEMA,
  findings:sanitizeQueue(src,queue(src,[qaJob()]),NOW)};
 const ctx=baseline();
 await assert.rejects(()=>runOnce({evidence,...ctx,
  loadState:async()=>({schema:'unknown',proposals:[]})}),/developer_state_corrupt/);
 assert.equal(ctx.saves.length,0);
});
test('no automatic CLI execution without exact mode',()=>{
 const script=fileURLToPath(new URL('./triage.mjs',import.meta.url));
 const result=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:8000});
 assert.equal(result.status,2);
 assert.match(result.stderr,/DEV_TRIAGE_ERROR=developer_mode_required/);
});

test('fixed production pipeline consumes all QA queues, records one proposal and never uses Git/network',async()=>{
  const ctx=baseline();
  const r=await runPipeline({now:NOW,...ctx,
    load:async src=>queue(src,src.id==='honartik_plan'?[qaJob()]:[])});
  assert.equal(r.status,'proposals_created');
  assert.equal(r.qa_sources_checked,3);
  assert.equal(r.incident_count,1);
  assert.equal(r.git_access,false);
  assert.equal(r.network_access,false);
  assert.equal(ctx.get().proposals.length,1);
});
test('healthy fixed QA queues produce idle pipeline and no state mutation',async()=>{
  const ctx=baseline();
  const r=await runPipeline({now:NOW,...ctx,load:async src=>queue(src,[])});
  assert.equal(r.status,'idle');
  assert.equal(r.new_proposals,0);
  assert.equal(ctx.saves.length,0);
});
test('pipeline STOP checked before reading even one protected QA source',async()=>{
  const ctx=baseline();
  const r=await runPipeline({now:NOW,...ctx,stopped:async()=>true,
    load:async()=>{throw Error('should_not_touch_qa')}});
  assert.equal(r.status,'stopped');
  assert.equal(ctx.saves.length,0);
});
