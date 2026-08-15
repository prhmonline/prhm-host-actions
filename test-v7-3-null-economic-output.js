
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const helperPath=path.join(__dirname,'real-market-shadow-uat-v1.js');
function loadVerifyDecision(){let src=fs.readFileSync(helperPath,'utf8');src=src.replace("try{main()}catch(e){process.stderr.write(String(e&&e.stack||e)+'\\n');process.exit(1)}",'module.exports={verifyDecision};');const sandbox={module:{exports:{}},exports:{},require,process,console,Buffer};vm.runInNewContext(src,sandbox,{filename:helperPath});return sandbox.module.exports.verifyDecision;}
test('incomplete economics decision accepts null floor/bid and rejects fabricated financial outputs',()=>{
  const verifyDecision=loadVerifyDecision();
  const d={decision:'ASK_CLARIFICATION',reason:'economics_inputs_incomplete',economic_floor:null,final_bid:null,net_profit:null,margin:null,expected_profit:null,expected_profit_per_human_hour:null,input_snapshot:{engine_input:{recommendedPrice:null,hardFloor:null,platformMinimum:null,minimumMarginPrice:null,platformFee:null,deliveryCost:null,aiOpsCost:null,paymentFee:null,riskReserve:null},engine_output:{autoSendAllowed:false}}};
  assert.doesNotThrow(()=>verifyDecision(d));
});
