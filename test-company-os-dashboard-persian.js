const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=__dirname;
const collector=fs.readFileSync(path.join(root,'company-os-dashboard','collector.js'),'utf8');
const app=fs.readFileSync(path.join(root,'company-os-dashboard','public','app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'company-os-dashboard','public','index.html'),'utf8');

test('all current P0 decision codes and operational fallbacks have Persian presentation labels',()=>{
  for(const code of ['SEND_NOW','ASK_CLARIFICATION','PRICE_UP','ESCALATE_TO_CEO','REJECT_FALSE_POSITIVE','REJECT_UNPROFITABLE','CHANNEL_BLOCKED','STALE']){
    assert.match(app,new RegExp(code));
  }
  for(const reason of ['economics_inputs_incomplete','price_inputs_missing','profitable','opportunity_stale','platform_quota_exhausted','economic_floor_above_client_budget']){
    assert.match(app,new RegExp(reason));
  }
  assert.match(app,/نامشخص/);
  assert.match(app,/decision_fa|decisionFa|faDecision/);
  assert.match(app,/reason_fa|reasonFa|faReason/);
});

test('collector exposes only persisted original URL and proposal/message evidence',()=>{
  assert.match(collector,/original_url/);
  assert.match(collector,/canonical_url|source_url/);
  assert.match(collector,/upstream_proposal/);
  assert.match(collector,/communications/);
  assert.match(collector,/drafts/);
  assert.match(collector,/SUBMITTED|submitted/);
  assert.doesNotMatch(collector,/https:\/\/www\.karlancer\.com\/projects\/\$\{/);
});

test('opportunity details distinguish sent text, unsent draft and no communication',()=>{
  for(const phrase of ['ارسال‌شده به مشتری','پیش‌نویس آماده‌شده — ارسال نشده','هیچ پیامی برای این پروژه ارسال نشده است','مشاهده آگهی اصلی','لینک آگهی ثبت نشده است']){
    assert.match(app,new RegExp(phrase));
  }
  assert.match(app,/openOpportunityDetails|renderOpportunityDetails/);
  assert.match(app,/original_url/);
  assert.match(html,/opportunity-details|detail-drawer|details-panel/);
});

test('source coverage explicitly includes ParsCoders, Karlancer and Divar with evidence-based state',()=>{
  for(const source of ['parscoders','karlancer','divar']) assert.match(collector,new RegExp(source));
  assert.match(collector,/not_connected/);
  assert.match(collector,/last_checked_at|last_activity_at/);
  assert.match(collector,/discovered_today/);
  assert.match(app,/منابع بررسی پروژه/);
  assert.match(app,/متصل نیست/);
  assert.match(html,/sources-grid|source-coverage/);
});
