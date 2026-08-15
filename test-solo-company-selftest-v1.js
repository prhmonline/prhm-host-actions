const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {FIXED_FACTS,EXPECTED_DECISION,REQUIRED_ECONOMICS,patchWorkerText,validateResolved,validateDecision}=require('./solo-company-selftest-v1.js');

test('fixed economics deterministically imply SEND_NOW metrics',()=>{
  const floor=Math.max(FIXED_FACTS.hardFloor,FIXED_FACTS.platformMinimum,FIXED_FACTS.minimumMarginPrice);
  const bid=Math.max(FIXED_FACTS.recommendedPrice,floor);
  const net=bid-FIXED_FACTS.platformFee-FIXED_FACTS.deliveryCost-FIXED_FACTS.aiOpsCost-FIXED_FACTS.paymentFee-FIXED_FACTS.riskReserve;
  assert.equal(floor,EXPECTED_DECISION.economicFloor); assert.equal(bid,EXPECTED_DECISION.finalBid); assert.equal(net,EXPECTED_DECISION.netProfit);
  assert.equal(net/bid,EXPECTED_DECISION.margin); assert.equal(net*FIXED_FACTS.winProbability,EXPECTED_DECISION.expectedProfit); assert.equal(EXPECTED_DECISION.expectedProfit/FIXED_FACTS.humanHours,EXPECTED_DECISION.expectedProfitPerHumanHour);
});

test('patchWorker makes a unique synthetic lock and filters candidates to only fixture UUID',()=>{
  const id=crypto.randomUUID(), run=crypto.randomUUID();
  const src=`const LOCK =
  '/run/prhm-p0-shadow-worker/run.lock';
X
      where not exists (

        select 1

        from
          marketplace.opportunity_decisions d

        where
          d.opportunity_id =
            o.id
`;
  const out=patchWorkerText(src,id,run);
  assert.match(out,new RegExp('solo-selftest-'+run.replace(/-/g,'-')+'\\.lock'));
  assert.ok(out.includes(`where o.id = '${id}'::uuid`));
  assert.ok(out.includes('and not exists ('));
  assert.equal(out.includes("/run/prhm-p0-shadow-worker/run.lock"),false);
});

test('resolved fact validation requires all 11 fixed values and provenance',()=>{
  const facts={}; for(const [name,value] of Object.entries(FIXED_FACTS))facts[name]={value,provenance:{source:'solo_company_selftest_v1'}};
  assert.equal(validateResolved({count:11,facts}),true);
});

test('resolved fact validation rejects missing required fact',()=>{
  const facts={}; for(const [name,value] of Object.entries(FIXED_FACTS))facts[name]={value,provenance:{source:'solo_company_selftest_v1'}}; delete facts[REQUIRED_ECONOMICS[0]];
  assert.throws(()=>validateResolved({count:10,facts}));
});

test('decision validation accepts exact economics snapshot and auto-send false',()=>{
  const facts={}; for(const [name,value] of Object.entries(FIXED_FACTS))facts[name]={value,provenance:{source:'solo_company_selftest_v1'}};
  const d={decision:'SEND_NOW',reason:'profitable',economic_floor:750000,final_bid:1000000,net_profit:550000,margin:0.55,expected_profit:440000,expected_profit_per_human_hour:220000,input_snapshot:{schema_version:'prhm.p0-shadow-input.v2-economics',economics:{complete:true,missing:[],facts},engine_output:{decision:'SEND_NOW',autoSendAllowed:false}}};
  assert.equal(validateDecision(d),true);
});

test('decision validation rejects any auto-send true snapshot',()=>{
  const facts={}; for(const [name,value] of Object.entries(FIXED_FACTS))facts[name]={value,provenance:{source:'solo_company_selftest_v1'}};
  const d={decision:'SEND_NOW',reason:'profitable',economic_floor:750000,final_bid:1000000,net_profit:550000,margin:0.55,expected_profit:440000,expected_profit_per_human_hour:220000,input_snapshot:{schema_version:'prhm.p0-shadow-input.v2-economics',economics:{complete:true,missing:[],facts},engine_output:{decision:'SEND_NOW',autoSendAllowed:true}}};
  assert.throws(()=>validateDecision(d));
});
