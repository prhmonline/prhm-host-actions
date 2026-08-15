#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');

const ACTION='solo_company_selftest_v1';
const WORKER='/opt/prhm-p0-shadow-worker/worker.js';
const ENGINE='/opt/prhm-p0-shadow-worker/p0-engine.js';
const MIGRATION='/opt/prhm-p0-fixed-executor/migrations/009_economic_input_facts.sql';
const ADMIN_PASSWORD_FILE='/etc/prhm-p0-db-helper/postgres_superuser_password';
const STATE_DIR='/var/lib/prhm-agent-selfmaint-exec/solo-company-selftest-v1';
const RESULT_FILE=path.join(STATE_DIR,'latest.json');
const LOCK_DIR=path.join(STATE_DIR,'lock');
const NODE='/usr/local/bin/prhm-node';
const PSQL='/usr/bin/psql';
const EXPECTED_WORKER_SHA='3854fcee1ab1fa64a972d0c332c799a226f522308e1f994203ffa45e600de422';
const EXPECTED_ENGINE_SHA='91a056a654155962a8bdc6760fcbd32ff5d1f475579e4d57af00153937fb48f6';
const EXPECTED_MIGRATION_SHA='dfaba6d8f454a99cdeb9286a40514ee56ae32a6f4829b7e52d7be42798c3a148';
const REQUIRED_ECONOMICS=['recommendedPrice','hardFloor','platformMinimum','minimumMarginPrice','platformFee','deliveryCost','aiOpsCost','paymentFee','riskReserve'];
const FIXED_FACTS=Object.freeze({
  recommendedPrice:1000000,
  hardFloor:700000,
  platformMinimum:100000,
  minimumMarginPrice:750000,
  platformFee:100000,
  deliveryCost:250000,
  aiOpsCost:50000,
  paymentFee:25000,
  riskReserve:25000,
  winProbability:0.8,
  humanHours:2
});
const EXPECTED_DECISION=Object.freeze({
  decision:'SEND_NOW',reason:'profitable',economicFloor:750000,finalBid:1000000,
  netProfit:550000,margin:0.55,expectedProfit:440000,expectedProfitPerHumanHour:220000
});

function shaBuffer(b){return crypto.createHash('sha256').update(b).digest('hex');}
function shaFile(f){return shaBuffer(fs.readFileSync(f));}
function fail(m){throw new Error(m);}
function replaceOnce(text,needle,replacement,label){
  const i=text.indexOf(needle); if(i<0)fail('anchor_missing:'+label);
  if(text.indexOf(needle,i+needle.length)>=0)fail('anchor_not_unique:'+label);
  return text.slice(0,i)+replacement+text.slice(i+needle.length);
}
function exec(file,args,{input,env,allowFailure=false,timeout=30000}={}){
  const r=cp.spawnSync(file,args,{input,env:env||process.env,encoding:'utf8',timeout,maxBuffer:16*1024*1024,stdio:['pipe','pipe','pipe']});
  if(r.error)fail('exec_error:'+path.basename(file)+':'+r.error.message);
  if(!allowFailure&&r.status!==0)fail('exec_failed:'+path.basename(file)+':'+r.status+':'+String(r.stderr||r.stdout||'').slice(0,3000));
  return r;
}
function psql(sql,{readOnly=false}={}){
  const password=fs.readFileSync(ADMIN_PASSWORD_FILE,'utf8').trim(); if(!password)fail('admin_password_empty');
  const env={...process.env,PGPASSWORD:password,PGOPTIONS:readOnly?'-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=2000':'-c statement_timeout=30000 -c lock_timeout=3000'};
  try{return String(exec(PSQL,['-X','-At','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55434','-U','leadops_admin','-d','leadops'],{input:sql,env,timeout:60000}).stdout||'').trim();}
  finally{delete env.PGPASSWORD;}
}
function jsonOne(sql,{readOnly=false}={}){const raw=psql(sql,{readOnly}); if(!raw)fail('expected_json_row'); return JSON.parse(raw.split(/\r?\n/).find(x=>x.trim().startsWith('{'))||'{}');}
function sqlText(v){return "'"+String(v).replace(/'/g,"''")+"'";}
function sqlUuid(v){if(!/^[0-9a-f-]{36}$/i.test(v))fail('invalid_uuid_literal');return sqlText(v)+'::uuid';}
function numericEqual(actual,expected,tolerance=1e-9){return Number.isFinite(Number(actual))&&Math.abs(Number(actual)-expected)<=tolerance;}
function assertFlagsSafe(){
  const raw=psql(`SELECT count(*)||'|'||count(*) FILTER (WHERE enabled=true)||'|'||count(*) FILTER (WHERE flag='P0_SHADOW_MODE' AND enabled=true) FROM automation.p0_feature_flags;`,{readOnly:true});
  if(raw!=='13|1|1')fail('feature_flags_not_safe:'+raw); return raw;
}
function verifyState(){
  if(shaFile(WORKER)!==EXPECTED_WORKER_SHA)fail('worker_sha_mismatch');
  if(shaFile(ENGINE)!==EXPECTED_ENGINE_SHA)fail('engine_sha_mismatch');
  if(shaFile(MIGRATION)!==EXPECTED_MIGRATION_SHA)fail('migration_sha_mismatch');
  assertFlagsSafe();
  const raw=psql(`SELECT (to_regclass('marketplace.economic_input_facts') IS NOT NULL)::int||'|'||(to_regclass('marketplace.resolved_economic_inputs') IS NOT NULL)::int||'|'||(SELECT count(*) FROM marketplace.sources WHERE code='solo-selftest');`,{readOnly:true});
  if(raw!=='1|1|0')fail('selftest_base_state_invalid:'+raw);
  return raw;
}
function patchWorkerText(src,opportunityId,runId){
  let out=src;
  out=replaceOnce(out,"const LOCK =\n  '/run/prhm-p0-shadow-worker/run.lock';","const LOCK =\n  '/run/prhm-p0-shadow-worker/solo-selftest-"+runId+".lock';",'worker_lock');
  const needle=`      where not exists (\n\n        select 1\n\n        from\n          marketplace.opportunity_decisions d\n\n        where\n          d.opportunity_id =\n            o.id`;
  const replacement=`      where o.id = '${opportunityId}'::uuid\n\n      and not exists (\n\n        select 1\n\n        from\n          marketplace.opportunity_decisions d\n\n        where\n          d.opportunity_id =\n            o.id`;
  out=replaceOnce(out,needle,replacement,'worker_candidate_filter');
  return out;
}
function patchWorker(src,opportunityId,runId){
  if(shaBuffer(Buffer.from(src))!==EXPECTED_WORKER_SHA)fail('worker_source_sha_mismatch');
  return patchWorkerText(src,opportunityId,runId);
}
function fixtureSql(ids){
  const prov=JSON.stringify({source:ACTION,fixture_id:ids.externalId,verified_by:'fixed_host_action'});
  const factRows=Object.entries(FIXED_FACTS).map(([name,value])=>`(${sqlUuid(crypto.randomUUID())},${sqlText(name)},${Number(value)},true,${sqlText(prov)}::jsonb,${sqlUuid(ids.sourceId)},'GENERAL_TRANSLATION',${sqlUuid(ids.opportunityId)},now(),now(),now())`).join(',\n');
  return `BEGIN;\nINSERT INTO marketplace.sources(id,code,name,base_url,adapter_type,enabled,poll_interval_minutes,config,created_at,updated_at) VALUES (${sqlUuid(ids.sourceId)},'solo-selftest','Solo Company Self-Test','https://selftest.invalid','synthetic',false,1440,'{"selftest":true}'::jsonb,now(),now());\nINSERT INTO marketplace.opportunities(id,source_id,external_id,source_url,canonical_url,title,description,service_category,budget_toman_min,budget_toman_max,discovered_at,last_seen_at,status,total_score,confidence_score,risk_flags,classification_reasons,raw_payload,created_at,updated_at) VALUES (${sqlUuid(ids.opportunityId)},${sqlUuid(ids.sourceId)},${sqlText(ids.externalId)},${sqlText('https://selftest.invalid/'+ids.externalId)},${sqlText('https://selftest.invalid/'+ids.externalId)},'Solo company synthetic translation test','Synthetic fixture for end-to-end solo company validation','GENERAL_TRANSLATION',500000,1500000,now(),now(),'WAITING_APPROVAL',95,99,'[]'::jsonb,'["solo_company_selftest_v1"]'::jsonb,${sqlText(JSON.stringify({selftest:true,run_id:ids.runId}))}::jsonb,now(),now());\nINSERT INTO marketplace.opportunity_evaluations(id,opportunity_id,evaluation_version,evaluator_type,relevance_score,profitability_score,client_quality_score,scope_clarity_score,competition_score,delivery_feasibility_score,strategic_value_score,risk_score,total_score,confidence_score,recommendation,reasons,risk_flags,input_snapshot,created_at) VALUES (${sqlUuid(ids.evaluationId)},${sqlUuid(ids.opportunityId)},'solo-selftest-v1','synthetic',100,100,100,100,100,100,100,0,95,99,'SEND_NOW','["synthetic deterministic fixture"]'::jsonb,'[]'::jsonb,'{"selftest":true}'::jsonb,now());\nINSERT INTO marketplace.economic_input_facts(id,input_name,value,verified,provenance,source_id,service_category,opportunity_id,observed_at,created_at,updated_at) VALUES\n${factRows};\nCOMMIT;`;
}
function cleanupSql(ids){
  return `BEGIN;\nDELETE FROM automation.telegram_messages WHERE opportunity_id=${sqlUuid(ids.opportunityId)};\nDELETE FROM marketplace.bid_events WHERE bid_id IN (SELECT id FROM marketplace.bids WHERE opportunity_id=${sqlUuid(ids.opportunityId)});\nDELETE FROM marketplace.bids WHERE opportunity_id=${sqlUuid(ids.opportunityId)};\nDELETE FROM automation.outbox_events WHERE aggregate_id=${sqlUuid(ids.opportunityId)};\nDELETE FROM marketplace.economic_input_facts WHERE opportunity_id=${sqlUuid(ids.opportunityId)};\nDELETE FROM marketplace.opportunity_decisions WHERE opportunity_id=${sqlUuid(ids.opportunityId)};\nDELETE FROM marketplace.opportunity_evaluations WHERE opportunity_id=${sqlUuid(ids.opportunityId)};\nDELETE FROM marketplace.opportunities WHERE id=${sqlUuid(ids.opportunityId)};\nDELETE FROM marketplace.sources WHERE id=${sqlUuid(ids.sourceId)};\nCOMMIT;`;
}
function scopedCounts(ids){
  return jsonOne(`SELECT json_build_object('sources',(SELECT count(*) FROM marketplace.sources WHERE id=${sqlUuid(ids.sourceId)} OR code='solo-selftest'),'opportunities',(SELECT count(*) FROM marketplace.opportunities WHERE id=${sqlUuid(ids.opportunityId)}),'evaluations',(SELECT count(*) FROM marketplace.opportunity_evaluations WHERE opportunity_id=${sqlUuid(ids.opportunityId)}),'facts',(SELECT count(*) FROM marketplace.economic_input_facts WHERE opportunity_id=${sqlUuid(ids.opportunityId)}),'decisions',(SELECT count(*) FROM marketplace.opportunity_decisions WHERE opportunity_id=${sqlUuid(ids.opportunityId)}),'outbox',(SELECT count(*) FROM automation.outbox_events WHERE aggregate_id=${sqlUuid(ids.opportunityId)}),'bids',(SELECT count(*) FROM marketplace.bids WHERE opportunity_id=${sqlUuid(ids.opportunityId)}),'telegram',(SELECT count(*) FROM automation.telegram_messages WHERE opportunity_id=${sqlUuid(ids.opportunityId)}));`,{readOnly:true});
}
function globalSnapshot(){return jsonOne(`SELECT json_build_object('facts',(SELECT count(*) FROM marketplace.economic_input_facts),'decisions',(SELECT count(*) FROM marketplace.opportunity_decisions),'outbox_published',(SELECT count(*) FROM automation.outbox_events WHERE status='published'),'bids_submitted',(SELECT count(*) FROM marketplace.bids WHERE status='SUBMITTED'),'telegram',(SELECT count(*) FROM automation.telegram_messages));`,{readOnly:true});}
function resolvedFacts(ids){return jsonOne(`SELECT json_build_object('count',count(*),'facts',coalesce(jsonb_object_agg(input_name,jsonb_build_object('value',value,'provenance',provenance,'specificity',specificity)),'{}'::jsonb)) FROM marketplace.resolved_economic_inputs WHERE opportunity_id=${sqlUuid(ids.opportunityId)};`,{readOnly:true});}
function readDecision(ids){return jsonOne(`SELECT row_to_json(x) FROM (SELECT decision,reason,economic_floor,final_bid,net_profit,margin,expected_profit,expected_profit_per_human_hour,input_snapshot FROM marketplace.opportunity_decisions WHERE opportunity_id=${sqlUuid(ids.opportunityId)} AND decision_version='p0-shadow-v1' ORDER BY created_at DESC LIMIT 1) x;`,{readOnly:true});}
function validateResolved(resolved){
  if(Number(resolved.count)!==Object.keys(FIXED_FACTS).length)fail('resolved_fact_count_invalid:'+resolved.count);
  for(const [name,value] of Object.entries(FIXED_FACTS)){
    const f=resolved.facts?.[name]; if(!f||!numericEqual(f.value,value))fail('resolved_fact_value_invalid:'+name);
    if(f.provenance?.source!==ACTION)fail('resolved_fact_provenance_invalid:'+name);
  }
  for(const name of REQUIRED_ECONOMICS)if(!resolved.facts?.[name])fail('resolved_required_fact_missing:'+name);
  return true;
}
function validateDecision(d){
  if(!d||d.decision!==EXPECTED_DECISION.decision||d.reason!==EXPECTED_DECISION.reason)fail('decision_identity_invalid:'+JSON.stringify(d));
  for(const key of ['economicFloor','finalBid','netProfit','margin','expectedProfit','expectedProfitPerHumanHour']){
    const dbKey={economicFloor:'economic_floor',finalBid:'final_bid',netProfit:'net_profit',margin:'margin',expectedProfit:'expected_profit',expectedProfitPerHumanHour:'expected_profit_per_human_hour'}[key];
    if(!numericEqual(d[dbKey],EXPECTED_DECISION[key],1e-8))fail('decision_numeric_invalid:'+key+':'+d[dbKey]);
  }
  const s=d.input_snapshot||{};
  if(s.schema_version!=='prhm.p0-shadow-input.v2-economics')fail('snapshot_schema_invalid');
  if(s.economics?.complete!==true||!Array.isArray(s.economics?.missing)||s.economics.missing.length!==0)fail('snapshot_economics_incomplete');
  if(s.engine_output?.autoSendAllowed!==false||s.engine_output?.decision!=='SEND_NOW')fail('snapshot_autosend_or_decision_invalid');
  for(const name of REQUIRED_ECONOMICS)if(s.economics?.facts?.[name]?.provenance?.source!==ACTION)fail('snapshot_provenance_invalid:'+name);
  return true;
}
function persist(obj){fs.mkdirSync(STATE_DIR,{recursive:true,mode:0o700});fs.writeFileSync(RESULT_FILE,JSON.stringify(obj,null,2)+'\n',{mode:0o600});}
function main(){
  const args=process.argv.slice(2); if(args.length>1)fail('unexpected_arguments'); if(args.length===1&&args[0]!=='--preflight-only')fail('unexpected_argument:'+args[0]);
  const preflightOnly=args[0]==='--preflight-only'; if(process.getuid&&process.getuid()!==0)fail('must_run_as_root');
  fs.mkdirSync(STATE_DIR,{recursive:true,mode:0o700}); verifyState();
  const preflight={ok:true,schema_version:'prhm.host-action-bootstrap-preflight.v1',preflight_only:preflightOnly,action:ACTION,worker_sha256:EXPECTED_WORKER_SHA,engine_sha256:EXPECTED_ENGINE_SHA,migration_sha256:EXPECTED_MIGRATION_SHA,required_economics:REQUIRED_ECONOMICS,fixed_expected_decision:EXPECTED_DECISION,database_mutation:false,business_mutation:false,p0_live:false,proposal_send:false,bid_send:false};
  if(preflightOnly){console.log(JSON.stringify(preflight));return;}
  try{fs.mkdirSync(LOCK_DIR,{mode:0o700});}catch{fail('selftest_lock_busy');}
  const ids={runId:crypto.randomUUID(),sourceId:crypto.randomUUID(),opportunityId:crypto.randomUUID(),evaluationId:crypto.randomUUID()}; ids.externalId='SELFTEST-'+ids.runId;
  const tempWorker=path.join(STATE_DIR,'worker-'+ids.runId+'.js');
  let fixtureCreated=false; let cleanupVerified=false; let result=null; let originalError=null;
  const before=globalSnapshot();
  try{
    psql(fixtureSql(ids)); fixtureCreated=true;
    const scopedBefore=scopedCounts(ids); if(Number(scopedBefore.sources)!==1||Number(scopedBefore.opportunities)!==1||Number(scopedBefore.evaluations)!==1||Number(scopedBefore.facts)!==11||Number(scopedBefore.decisions)!==0)fail('fixture_counts_invalid:'+JSON.stringify(scopedBefore));
    validateResolved(resolvedFacts(ids));
    const patched=patchWorker(fs.readFileSync(WORKER,'utf8'),ids.opportunityId,ids.runId);
    fs.writeFileSync(tempWorker,patched,{mode:0o700}); exec(NODE,['--check',tempWorker],{timeout:15000});
    const workerRun=exec(NODE,[tempWorker,'--pilot=1'],{timeout:90000}); const workerOutput=String(workerRun.stdout||'');
    for(const marker of ['ELIGIBLE=1','PILOT_SELECTED=1','PILOT_INSERTED=1','AUTOSEND_TRUE=0','PROPOSAL_SEND=NO','BID_SEND=NO','OUTBOX_WRITE=NO','RESULT=PILOT_SUCCESS'])if(!workerOutput.includes(marker))fail('worker_marker_missing:'+marker+':'+workerOutput.slice(0,2000));
    const decision=readDecision(ids); validateDecision(decision);
    const scopedAfterWorker=scopedCounts(ids); if(Number(scopedAfterWorker.decisions)!==1||Number(scopedAfterWorker.outbox)!==0||Number(scopedAfterWorker.bids)!==0||Number(scopedAfterWorker.telegram)!==0)fail('selftest_send_or_decision_count_invalid:'+JSON.stringify(scopedAfterWorker));
    result={schema_version:'prhm.host-action-result.v1',ok:true,action:ACTION,run_id:ids.runId,external_id:ids.externalId,decision:decision.decision,reason:decision.reason,economic_floor:Number(decision.economic_floor),final_bid:Number(decision.final_bid),net_profit:Number(decision.net_profit),margin:Number(decision.margin),expected_profit:Number(decision.expected_profit),expected_profit_per_human_hour:Number(decision.expected_profit_per_human_hour),resolved_fact_count:11,required_economics_complete:true,provenance_verified:true,worker_filtered_to_fixture:true,worker_output_verified:true,auto_send_allowed:false,outbox_write:false,bid_write:false,telegram_write:false,proposal_send:false,bid_send:false,p0_live:false,business_mutation:false,synthetic_database_mutation:true,before,worker_output:workerOutput.trim().split(/\r?\n/)};
  }catch(e){originalError=e;}
  finally{
    try{if(fixtureCreated)psql(cleanupSql(ids));}catch(e){if(!originalError)originalError=e;else originalError=new Error('selftest_failed_cleanup_error:'+originalError.message+':'+e.message);}
    try{if(fs.existsSync(tempWorker))fs.unlinkSync(tempWorker);}catch(e){if(!originalError)originalError=e;}
    try{fs.rmdirSync(LOCK_DIR);}catch{}
    try{const residue=scopedCounts(ids); cleanupVerified=Object.values(residue).every(v=>Number(v)===0); if(!cleanupVerified)throw new Error('selftest_cleanup_residue:'+JSON.stringify(residue));}catch(e){if(!originalError)originalError=e;else originalError=new Error(originalError.message+':'+e.message);}
  }
  if(originalError){const failed={schema_version:'prhm.host-action-result.v1',ok:false,action:ACTION,error:String(originalError.message||originalError),cleanup_verified:cleanupVerified,external_id:ids.externalId,business_mutation:false,p0_live:false,proposal_send:false,bid_send:false};persist(failed);throw originalError;}
  const after=globalSnapshot(); assertFlagsSafe(); result.after=after; result.cleanup_verified=cleanupVerified; result.synthetic_fixture_residue=false; result.finished_at=new Date().toISOString(); persist(result); console.log(JSON.stringify(result));
}
if(require.main===module)main();
module.exports={FIXED_FACTS,EXPECTED_DECISION,REQUIRED_ECONOMICS,patchWorker,patchWorkerText,validateResolved,validateDecision,numericEqual};
