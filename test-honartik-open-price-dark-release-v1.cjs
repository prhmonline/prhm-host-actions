'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const crypto=require('node:crypto');
const path=require('node:path');

const ROOT=path.join(__dirname,'test-fixtures/honartik-open-price-dark-release');
const fixture=JSON.parse(fs.readFileSync(path.join(ROOT,'release-manifest.json'),'utf8'));
const required=[
 'app/migrations/db/m261016_105000_open_price_money_capacity.php',
 'app/migrations/db/m261016_110000_open_price_schedules.php'
];
const blob=bytes=>crypto.createHash('sha1')
 .update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const changed=new Set(fixture.backendChangedFiles);

test('production baseline matches feature PR base; SHA targets are immutable',()=>{
 assert.equal(fixture.expectedProductionBackendHead,'502376d0360a338f9522e4a2be5f9dccc91408d7');
 assert.equal(fixture.backendBase,fixture.expectedProductionBackendHead);
 for(const s of [fixture.backendFeatureHead,fixture.frontendFeatureHead])
   assert.match(s,/^[a-f0-9]{40}$/);
});

test('feature changes cannot overwrite the on-server private tracked or untracked overlay',()=>{
 assert.deepEqual(fixture.dirtyProductionTracked,['app/views/admin-reserve/_form.php']);
 assert.deepEqual(fixture.untrackedProduction,['honartik-28000-refresh-905d3af8f914b0e4.xlsx']);
 for(const file of [...fixture.dirtyProductionTracked,...fixture.untrackedProduction])
   assert.equal(changed.has(file),false,'protected live-only file was changed: '+file);
});

test('both Yii migrations are pinned to exact Git blobs',()=>{
 assert.deepEqual(fixture.sourceFiles.map(f=>f.path),required);
 for(const f of fixture.sourceFiles){
   assert.equal(changed.has(f.path),true);
   assert.equal(blob(fs.readFileSync(path.join(ROOT,f.path))),f.blob);
 }
});

test('new and existing schedules remain opt-out after schema expansion',()=>{
 const source=fs.readFileSync(path.join(ROOT,required[1]),'utf8');
 for(const field of ['free_price_enabled','free_price_enabled_snapshot']){
   assert.equal(source.includes("'"+field+"', $this->boolean()->notNull()->defaultValue(false)"),true);
 }
 assert.equal(fixture.flagsPublicDefaultOff,true);
});

test('explicit independent production gates are still blocking',()=>{
 assert.equal(fixture.databaseReadinessVerified,false);
 assert.equal(fixture.productionDeploymentAuthorized,false);
});

test('refund and settlement source paths are part of the feature release',()=>{
 for(const file of [
   'app/modules/finance/services/OpenPriceCancellationService.php',
   'app/modules/finance/services/OpenPriceRefundLedger.php',
   'app/modules/finance/services/OpenPriceSettlementGuard.php',
   'common/models/SoldEvent.php','common/models/AccountSettlement.php',
   'app/modules/api/controllers/ReserveController.php'
 ])assert.equal(changed.has(file),true,file);
});
