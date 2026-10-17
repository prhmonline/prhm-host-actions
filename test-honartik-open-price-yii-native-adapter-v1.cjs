'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {PINS}=require('./honartik-open-price-yii-scratch-v1.cjs');
const {parseExecutedReceipt,createNativeAdapter,MARKERS}=
  require('./honartik-open-price-yii-native-adapter-v1.cjs');
const money={
  'finance_transactions.amount':'bigint',
  'finance_transactions.paying_amount':'bigint',
  'finance_wallet.amount':'bigint'
};
const features={
  'schedule.free_price_enabled':true,
  'schedule.free_price_description':true,
  'reserve.free_price_enabled_snapshot':true,
  'reserve.free_price_original_amount':true,
  'reserve.free_price_minimum_amount':true,
  'reserve.free_price_proposed_amount':true,
  'reserve.free_price_gateway_amount':true,
  'reserve.free_price_extra_amount':true
};
function fixture(changes={}, dropMarker){
 const receipt={
  mariadbVersion:'10.6.23-MariaDB',testedDatabase:'honartik_db',
  rowCounts:{...PINS.expectedCounts},
  moneyColumnTypes:{...money},addedColumns:{...features},
  financialBaselineDigest:'a'.repeat(64),
  financialAfterDigest:'a'.repeat(64),
  ...changes
 };
 return [...MARKERS.filter(x=>x!==dropMarker),
  'YII_REHEARSAL_RECEIPT_JSON='+JSON.stringify(receipt),''].join('\n');
}
test('actual-restored receipt parser accepts exact fixed 10.6 evidence',()=>{
 const r=parseExecutedReceipt(fixture());
 assert.equal(r.rowCounts.reserve,36738);
 assert.equal(r.mariadbVersion,'10.6.23-MariaDB');
});
test('a purely synthetic or partial DDL output cannot pass',()=>{
 for(const marker of MARKERS)
  assert.throws(()=>parseExecutedReceipt(fixture({},marker)),/missing_runtime_marker/);
});
test('missing or duplicate real database receipt fails closed',()=>{
 assert.throws(()=>parseExecutedReceipt(MARKERS.join('\n')+'\n'),
  /missing_unique_actual_yii_receipt/);
 const s=fixture();
 assert.throws(()=>parseExecutedReceipt(s+'YII_REHEARSAL_RECEIPT_JSON={}\n'),
  /missing_unique_actual_yii_receipt/);
 assert.throws(()=>parseExecutedReceipt(MARKERS.join('\n')+'\nYII_REHEARSAL_RECEIPT_JSON=no\n'),
  /invalid_yii_json_receipt/);
});
test('MariaDB version, identity and restored dataset must match',()=>{
 for(const patch of [
  {mariadbVersion:'11.8.6'},{mariadbVersion:'10.5.21'},
  {testedDatabase:'honartik_live'},
  {rowCounts:{...PINS.expectedCounts,finance_wallet:42}},
  {rowCounts:{...PINS.expectedCounts,unknown:1}},
  {rowCounts:{}}
 ])assert.throws(()=>parseExecutedReceipt(fixture(patch)));
});
test('no missing, added or wrong-sized columns accepted',()=>{
 for(const patch of [
  {moneyColumnTypes:{...money,'finance_transactions.amount':'int'}},
  {moneyColumnTypes:{...money,'finance_wallet.amount':'bigint unsigned'}},
  {moneyColumnTypes:{'finance_transactions.amount':'bigint'}},
  {addedColumns:{...features,'reserve.free_price_extra_amount':false}},
  {addedColumns:{...features,other:true}},
  {addedColumns:{}}
 ])assert.throws(()=>parseExecutedReceipt(fixture(patch)));
});
test('financial aggregates must be unchanged in actual restored database',()=>{
 for(const patch of [
  {financialAfterDigest:'b'.repeat(64)},
  {financialAfterDigest:null},
  {financialBaselineDigest:'a'},
  {financialBaselineDigest:'x'.repeat(64)}
 ])assert.throws(()=>parseExecutedReceipt(fixture(patch)));
});
test('partial, duplicated or unbounded result never becomes a trusted success',()=>{
 const s=fixture();
 assert.throws(()=>parseExecutedReceipt(s+'x'.repeat(270000)),/unbounded_rehearsal_output/);
 assert.throws(()=>parseExecutedReceipt(s+'ISOLATED_CLEANUP=PASS\n'),/missing_runtime_marker/);
 assert.throws(()=>parseExecutedReceipt(s.replace('ISOLATED_CLEANUP=PASS','ISOLATED_CLEANUP=FAIL')),
  /missing_runtime_marker/);
});
test('no direct native CLI execution or approval generation',()=>{
 const r=spawnSync(process.execPath,[require.resolve('./honartik-open-price-yii-native-adapter-v1.cjs')],
   {encoding:'utf8'});
 assert.equal(r.status,2);
 const x=JSON.parse(r.stdout);
 assert.equal(x.installed,false);
 assert.equal(x.productionChanged,false);
});
test('trusted adapter cannot be constructed from client inputs or plain callbacks',()=>{
 assert.throws(()=>createNativeAdapter({}),/trusted_native_registration_missing/);
 assert.throws(()=>createNativeAdapter({
  consumeBoundApproval:async()=>({}),appendDurableAudit:async()=>({})
 }),/trusted_native_registration_missing/);
});
